import type { SearchHit, SearchResponse, SearchStatus } from '@gobing-ai/spur-contracts';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Input, Loading, Select } from '@/ui';
import ModuleIcon from '../../components/ModuleIcon';
import { ModuleHeader, ModuleShell } from '../../components/module-kit';
import { api } from '../../lib/rpc-client';
import type { WebModule } from '../types';

/**
 * Search board module (feature A34 R9, design `docs/design/hybrid-search.md` §4 Board).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts`. Data flows only through the
 * typed `api.search.*` oRPC client — the module holds no search logic (ADR-021); a
 * degraded backend renders inline as the skipped reason + hint, never an error state.
 */

const MODES = ['auto', 'exact', 'fuzzy'] as const;
const SCOPES = ['all', 'docs', 'code'] as const;

const MODE_LABELS: Record<(typeof MODES)[number], string> = {
    auto: 'Auto',
    exact: 'Exact',
    fuzzy: 'Fuzzy',
};

const SCOPE_LABELS: Record<(typeof SCOPES)[number], string> = {
    all: 'All',
    docs: 'Docs',
    code: 'Code',
};

/** Resolve a Board deep link when a hit points to a task or feature markdown file. */
function resolveBoardHref(filePath: string): { href: string; label: string } | null {
    const taskMatch = filePath.match(/(?:^|\/)docs\/tasks[^/]*\/(\d{4})_[^/]+\.md$/);
    if (taskMatch?.[1]) return { href: `/board/tasks/${taskMatch[1]}`, label: `Task ${taskMatch[1]}` };
    const featureMatch = filePath.match(/(?:^|\/)docs\/features\/(F\d+)_[^/]+\.md$/i);
    if (featureMatch?.[1]) return { href: `/board/features/${featureMatch[1]}`, label: featureMatch[1] };
    return null;
}

/** Highlight case-insensitive query tokens inside a snippet without HTML injection. */
function highlightSnippet(snippet: string, query: string): ReactNode {
    const trimmed = query.trim();
    if (trimmed.length < 2) return snippet;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    const parts = snippet.split(regex);
    if (parts.length <= 1) return snippet;
    const exactMatcher = new RegExp(`^${escaped}$`, 'i');
    let offset = 0;
    return parts.map((part) => {
        const start = offset;
        offset += part.length;
        return exactMatcher.test(part) ? (
            <mark key={`m-${start}`} className="bg-primary/20 text-base-content rounded px-0.5 font-semibold">
                {part}
            </mark>
        ) : (
            part
        );
    });
}

/** One backend group header + its hits. Exported for module-test rendering. */
export function HitGroup(props: {
    label: string;
    hits: readonly SearchHit[] | null;
    skip: { reason: string; hint?: string } | null;
    query?: string;
}) {
    const { label, hits, skip, query = '' } = props;
    if (hits === null) {
        if (skip === null) return null;
        return (
            <section
                aria-label={`${label} group`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-base-content/10 bg-base-200/50 px-4 py-2.5 text-xs text-base-content/60"
            >
                <span className="font-medium text-base-content/70">{label}</span>
                <span>
                    skipped: {skip.reason}
                    {skip.hint !== undefined ? ` — ${skip.hint}` : ''}
                </span>
            </section>
        );
    }
    return (
        <section
            aria-label={`${label} group`}
            className="bg-base-200 rounded-xl border border-base-content/10 p-4 flex flex-col gap-3"
        >
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/70">
                    {label} ({hits.length})
                </h3>
            </div>
            {hits.length === 0 ? <p className="text-xs text-base-content/60">no matches</p> : null}
            {hits.length > 0 ? (
                <ol className="flex flex-col gap-2">
                    {hits.map((hit) => (
                        <HitRow key={`${hit.path}:${hit.startLine}`} hit={hit} query={query} />
                    ))}
                </ol>
            ) : null}
        </section>
    );
}

/** `path:start-end` heading with split dir/filename, Board link when applicable, and highlighted snippet. */
function HitRow(props: { hit: SearchHit; query: string }) {
    const { hit, query } = props;
    const range = hit.startLine === hit.endLine ? `${hit.startLine}` : `${hit.startLine}-${hit.endLine}`;
    const lastSlash = hit.path.lastIndexOf('/');
    const dir = lastSlash >= 0 ? hit.path.slice(0, lastSlash + 1) : '';
    const file = lastSlash >= 0 ? hit.path.slice(lastSlash + 1) : hit.path;
    const boardLink = resolveBoardHref(hit.path);

    return (
        <li className="bg-base-100 rounded-lg border border-base-content/10 p-3 text-sm transition-colors hover:border-base-content/25">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <div className="font-mono text-xs break-all">
                    {dir ? <span className="text-base-content/50">{dir}</span> : null}
                    <span className="font-semibold text-base-content">{file}</span>
                    <span className="text-base-content/50">:{range}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {hit.matchedBy.length > 1 ? <Badge variant="info">{hit.matchedBy.join('+')}</Badge> : null}
                    {boardLink ? (
                        <Link to={boardLink.href} className="text-xs font-medium text-primary hover:underline">
                            Open {boardLink.label} →
                        </Link>
                    ) : null}
                </div>
            </div>
            <pre className="font-mono text-xs leading-relaxed bg-base-200/60 border border-base-content/5 rounded-md px-3 py-2 overflow-x-auto whitespace-pre-wrap break-words text-base-content/90">
                {highlightSnippet(hit.snippet, query)}
            </pre>
        </li>
    );
}

/** Search shell: clean header, spacious query bar with mode/scope dropdowns, and scannable result cards. */
function SearchShell() {
    const [query, setQuery] = useState('');
    const [mode, setMode] = useState<(typeof MODES)[number]>('auto');
    const [scope, setScope] = useState<(typeof SCOPES)[number]>('all');
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [response, setResponse] = useState<SearchResponse | null>(null);
    const [status, setStatus] = useState<SearchStatus | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        api.search
            .status(undefined, { signal: controller.signal })
            .then((res) => {
                if (res?.data) setStatus(res.data);
            })
            .catch(() => {
                // Status is advisory; the query path carries the authoritative hints.
            });
        return () => controller.abort();
    }, []);

    const runSearch = () => {
        const trimmed = query.trim();
        if (trimmed.length === 0 || pending) return;
        setPending(true);
        setError(null);
        api.search
            .query({ query: trimmed, mode, scope, limit: 20 })
            .then((res) => {
                setResponse(res?.data ?? null);
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'search failed');
            })
            .finally(() => {
                setPending(false);
            });
    };

    const exactSkip = response?.skipped.find((s) => s.route === 'exact') ?? null;
    const fuzzySkip = response?.skipped.find((s) => s.route === 'fuzzy') ?? null;

    const statusSummary = status
        ? !status.rg.available
            ? 'Exact search (rg) unavailable'
            : !status.zg.available || status.zg.index !== 'ready'
              ? `Semantic index: ${status.zg.index}`
              : null
        : null;

    return (
        <ModuleShell className="search" data-search-shell>
            <ModuleHeader
                icon={<ModuleIcon id="search" size="lg" className="h-7 w-7 text-spur-accent" aria-hidden="true" />}
                title="Search"
                subtitle="Exact and semantic search over docs and code"
                status={
                    statusSummary === null ? undefined : (
                        <span role="status" className="text-xs text-base-content/50 font-mono">
                            {statusSummary}
                        </span>
                    )
                }
            />

            {/* Query & Filter Bar */}
            <form
                className="bg-base-200 rounded-xl border border-base-content/10 p-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                    e.preventDefault();
                    runSearch();
                }}
            >
                <div className="relative flex-1 min-w-[260px] flex items-center">
                    <svg
                        className="w-4 h-4 text-base-content/40 absolute left-3 pointer-events-none"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path
                            fillRule="evenodd"
                            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                            clipRule="evenodd"
                        />
                    </svg>
                    <label className="sr-only" htmlFor="search-query">
                        Search query
                    </label>
                    <Input
                        id="search-query"
                        type="text"
                        placeholder="Search docs, tasks, features, and code…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="w-full pl-9 pr-8"
                    />
                    {query.length > 0 ? (
                        <button
                            type="button"
                            aria-label="Clear search"
                            onClick={() => {
                                setQuery('');
                                setResponse(null);
                                setError(null);
                            }}
                            className="absolute right-2.5 text-xs text-base-content/40 hover:text-base-content"
                        >
                            ✕
                        </button>
                    ) : null}
                </div>
                <label className="sr-only" htmlFor="search-mode">
                    Search mode
                </label>
                <Select
                    id="search-mode"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as (typeof MODES)[number])}
                    className="w-auto"
                >
                    {MODES.map((m) => (
                        <option key={m} value={m}>
                            {MODE_LABELS[m]}
                        </option>
                    ))}
                </Select>
                <label className="sr-only" htmlFor="search-scope">
                    Search scope
                </label>
                <Select
                    id="search-scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
                    className="w-auto"
                >
                    {SCOPES.map((s) => (
                        <option key={s} value={s}>
                            {SCOPE_LABELS[s]}
                        </option>
                    ))}
                </Select>
                <Button type="submit" variant="primary" disabled={pending || query.trim().length === 0}>
                    {pending ? 'Searching…' : 'Search'}
                </Button>
            </form>

            {error !== null ? (
                <div className="bg-base-200 rounded-xl border border-base-content/10 p-4 text-sm text-error">
                    {error}
                </div>
            ) : null}

            {pending && response === null ? (
                <div className="bg-base-200 rounded-xl border border-base-content/10 p-10 flex justify-center">
                    <Loading />
                </div>
            ) : null}

            {!pending && response === null && error === null ? (
                <div className="bg-base-200 rounded-xl border border-base-content/10 p-10 flex flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-medium text-base-content/80">Search repository docs and code</p>
                    <p className="text-xs text-base-content/55 max-w-md">
                        Use <span className="font-mono">Exact</span> for literal strings or regex,{' '}
                        <span className="font-mono">Fuzzy</span> for semantic matches, or{' '}
                        <span className="font-mono">Auto</span> to combine both.
                    </p>
                </div>
            ) : null}

            {response !== null ? (
                <div className="flex flex-col gap-3">
                    <HitGroup label="Exact" hits={response.groups.exact} skip={exactSkip} query={response.query} />
                    <HitGroup label="Fuzzy" hits={response.groups.fuzzy} skip={fuzzySkip} query={response.query} />
                    {response.groups.exact !== null &&
                    response.groups.fuzzy !== null &&
                    response.groups.exact.length === 0 &&
                    response.groups.fuzzy.length === 0 ? (
                        <div className="bg-base-200 rounded-xl border border-base-content/10 p-6 text-center text-xs text-base-content/60">
                            no matches
                        </div>
                    ) : null}
                </div>
            ) : null}
        </ModuleShell>
    );
}

/** Board module registration (sidebar order 15: between observability 10 and history 20). */
export const module: WebModule = {
    id: 'search',
    name: 'Search',
    route: 'search',
    component: SearchShell,
    sidebarLabel: 'Search',
    description: 'Exact and semantic search over docs and code',
    order: 15,
};
