import type { SearchHit, SearchResponse, SearchStatus } from '@gobing-ai/spur-contracts';
import { useEffect, useState } from 'react';
import { Badge, Button, Input, Loading, Select } from '@/ui';
import { api } from '../../lib/rpc-client';
import type { WebModule } from '../types';

/**
 * Search board module (feature A34 R9, design `docs/design/hybrid-search.md` §4 Board).
 *
 * Auto-discovered by `apps/web/src/modules/discover.ts`. Data flows only through the
 * typed `api.search.*` oRPC client — the module holds no search logic (ADR-021); a
 * degraded backend renders inline as the skipped reason + hint, never an error state.
 */

/** One backend group header + its hits. Exported for module-test rendering. */
export function HitGroup(props: {
    label: string;
    hits: readonly SearchHit[] | null;
    skip: { reason: string; hint?: string } | null;
}) {
    const { label, hits, skip } = props;
    if (hits === null) {
        if (skip === null) return null;
        return (
            <section aria-label={`${label} group`} className="mb-4 text-sm opacity-70">
                <h3 className="font-medium mb-1">{label}</h3>
                <p>
                    skipped: {skip.reason}
                    {skip.hint !== undefined ? ` — ${skip.hint}` : ''}
                </p>
            </section>
        );
    }
    return (
        <section aria-label={`${label} group`} className="mb-4">
            <h3 className="font-medium mb-1">
                {label} ({hits.length})
            </h3>
            {hits.length === 0 ? <p className="text-sm opacity-70">no matches</p> : null}
            <ol className="flex flex-col gap-2">
                {hits.map((hit) => (
                    <HitRow key={`${hit.path}:${hit.startLine}`} hit={hit} />
                ))}
            </ol>
        </section>
    );
}

/** `path:start-end` heading, snippet in monospace, `matchedBy` badge when both routes agree. */
function HitRow(props: { hit: SearchHit }) {
    const { hit } = props;
    const range = hit.startLine === hit.endLine ? `${hit.startLine}` : `${hit.startLine}-${hit.endLine}`;
    return (
        <li className="text-sm">
            <div className="flex items-center gap-2">
                <span className="font-mono">
                    {hit.path}:{range}
                </span>
                {hit.matchedBy.length > 1 ? <Badge variant="info">{hit.matchedBy.join('+')}</Badge> : null}
            </div>
            <pre className="font-mono text-xs whitespace-pre-wrap mt-0.5">{hit.snippet}</pre>
        </li>
    );
}

/** rg/zg readiness strip using the exact hint strings from the service. */
function StatusStrip(props: { status: SearchStatus | null }) {
    const { status } = props;
    if (status === null) return null;
    return (
        <div
            role="status"
            aria-label="search backend status"
            className="flex flex-wrap items-center gap-2 text-xs mb-3"
        >
            <Badge variant={status.rg.available ? 'success' : 'warning'}>
                rg {status.rg.available ? (status.rg.version ?? 'available') : 'not installed'}
            </Badge>
            <Badge variant={status.zg.available && status.zg.index === 'ready' ? 'success' : 'warning'}>
                zg {status.zg.available ? (status.zg.version ?? 'available') : 'not installed'} · index{' '}
                {status.zg.index}
            </Badge>
            {status.zg.hint !== undefined ? <span className="opacity-70">{status.zg.hint}</span> : null}
        </div>
    );
}

/** Modes and scopes offered by the segmented control / select. */
const MODES = ['auto', 'exact', 'fuzzy'] as const;
const SCOPES = ['all', 'docs', 'code'] as const;

/** Search shell: query input, mode/scope controls, grouped results, status strip. */
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

    return (
        <div className="p-4 max-w-4xl">
            <h2 className="text-lg font-medium mb-2">Search</h2>
            <p className="text-sm opacity-70 mb-3">Exact and semantic search over docs and code</p>
            <StatusStrip status={status} />
            <form
                className="flex items-center gap-2 mb-4"
                onSubmit={(e) => {
                    e.preventDefault();
                    runSearch();
                }}
            >
                <label className="sr-only" htmlFor="search-query">
                    Search query
                </label>
                <Input
                    id="search-query"
                    type="text"
                    placeholder="Search docs and code…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="flex-1"
                />
                <div role="radiogroup" aria-label="Search mode" className="flex items-center gap-1">
                    {MODES.map((m) => (
                        <Button
                            key={m}
                            type="button"
                            aria-pressed={mode === m}
                            variant={mode === m ? 'primary' : 'outline'}
                            onClick={() => setMode(m)}
                        >
                            {m}
                        </Button>
                    ))}
                </div>
                <label className="sr-only" htmlFor="search-scope">
                    Search scope
                </label>
                <Select
                    id="search-scope"
                    value={scope}
                    onChange={(e) => setScope(e.target.value as (typeof SCOPES)[number])}
                >
                    {SCOPES.map((s) => (
                        <option key={s} value={s}>
                            {s}
                        </option>
                    ))}
                </Select>
                <Button type="submit" variant="primary" disabled={pending || query.trim().length === 0}>
                    {pending ? 'Searching…' : 'Search'}
                </Button>
            </form>
            {error !== null ? <p className="text-sm text-error mb-3">{error}</p> : null}
            {pending && response === null ? <Loading /> : null}
            {response !== null ? (
                <>
                    <HitGroup label="Exact" hits={response.groups.exact} skip={exactSkip} />
                    <HitGroup label="Fuzzy" hits={response.groups.fuzzy} skip={fuzzySkip} />
                    {response.groups.exact !== null &&
                    response.groups.fuzzy !== null &&
                    response.groups.exact.length === 0 &&
                    response.groups.fuzzy.length === 0 ? (
                        <p className="text-sm opacity-70">no matches</p>
                    ) : null}
                </>
            ) : null}
        </div>
    );
}

/** Board module registration (sidebar order 15: between observability 10 and history 20). */
export const module: WebModule = {
    id: 'search',
    name: 'Search',
    icon: '🔎',
    route: 'search',
    component: SearchShell,
    sidebarLabel: 'Search',
    description: 'Exact and semantic search over docs and code',
    order: 15,
};
