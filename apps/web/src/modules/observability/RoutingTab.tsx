import { useEffect, useState } from 'react';
import { Badge, Loading } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';

// ---------------------------------------------------------------------------
// Wire shapes — the two J6 aggregates consumed as-is (tasks 0546 / 0547).
// The component adds no query of its own; these narrow the server envelope.
// ---------------------------------------------------------------------------

/** One (role, executor, source) pair from `routingSummary` (0546). */
export interface RoutingPair {
    /** Role the run was serving; null for a pure pin (no role recorded). */
    role: string | null;
    /** Executor that served the role. */
    executor: string;
    /** Selection source: `role` | `explicit` (pin) | `default` | `phase` | `stage` | `priority`; null when absent. */
    source: string | null;
    /** Dispatch count for the pair. */
    runs: number;
    /** Escalations that started from this pair's executor on runs of this role. */
    escalations: number;
}

/** Token totals bucket from `roleTokenSummary` (0547) — tokens, never prices. */
export interface TokenTotals {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    records: number;
    recordsWithUsage: number;
}

/** Per-role attribution from `roleTokenSummary` (0547). */
export interface RoleAttribution {
    /** Role the attributed runs served; null groups pure pins. */
    role: string | null;
    /** Attributed runs in the window — coverage denominator. */
    totalRuns: number;
    /** Runs that matched ≥1 history row — coverage numerator. */
    matchedRuns: number;
    /** Totals from exact run→session mappings; null when none measured. */
    exact: TokenTotals | null;
    /** Totals from estimated (time-window) mappings; null when none measured. */
    estimated: TokenTotals | null;
    /** True when neither bucket holds a measured figure — unmeasured, never zero-as-fact (0547 R3). */
    unmeasured: boolean;
}

/** Client view of `GET /api/observability/routing-summary`. */
export interface RoutingSummaryView {
    window: { since: string; until: string };
    pairs: RoutingPair[];
    roles: RoleAttribution[];
}

function narrowTokenTotals(value: unknown): TokenTotals | null {
    if (value === null || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (
        typeof o.inputTokens !== 'number' ||
        typeof o.outputTokens !== 'number' ||
        typeof o.cacheReadTokens !== 'number' ||
        typeof o.cacheCreationTokens !== 'number' ||
        typeof o.records !== 'number' ||
        typeof o.recordsWithUsage !== 'number'
    ) {
        return null;
    }
    return {
        inputTokens: o.inputTokens,
        outputTokens: o.outputTokens,
        cacheReadTokens: o.cacheReadTokens,
        cacheCreationTokens: o.cacheCreationTokens,
        records: o.records,
        recordsWithUsage: o.recordsWithUsage,
    };
}

function narrowRoleAttribution(value: unknown): RoleAttribution | null {
    if (value === null || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (
        !(o.role === null || typeof o.role === 'string') ||
        typeof o.totalRuns !== 'number' ||
        typeof o.matchedRuns !== 'number' ||
        typeof o.unmeasured !== 'boolean'
    ) {
        return null;
    }
    return {
        role: o.role,
        totalRuns: o.totalRuns,
        matchedRuns: o.matchedRuns,
        exact: narrowTokenTotals(o.exact),
        estimated: narrowTokenTotals(o.estimated),
        unmeasured: o.unmeasured,
    };
}

function narrowRoutingPair(value: unknown): RoutingPair | null {
    if (value === null || typeof value !== 'object') return null;
    const o = value as Record<string, unknown>;
    if (
        !(o.role === null || typeof o.role === 'string') ||
        typeof o.executor !== 'string' ||
        !(o.source === null || typeof o.source === 'string') ||
        typeof o.runs !== 'number' ||
        typeof o.escalations !== 'number'
    ) {
        return null;
    }
    return { role: o.role, executor: o.executor, source: o.source, runs: o.runs, escalations: o.escalations };
}

/**
 * Runtime-narrow the routing-summary envelope. Returns null on any shape
 * failure (R6-style guard); malformed rows are dropped so a single bad pair
 * never blanks the whole surface.
 */
export function parseRoutingSummaryResponse(value: unknown): RoutingSummaryView | null {
    if (value === null || typeof value !== 'object') return null;
    const obj = value as Record<string, unknown>;
    const routing = obj.routing;
    const tokens = obj.tokens;
    if (routing === null || typeof routing !== 'object' || tokens === null || typeof tokens !== 'object') return null;
    const r = routing as Record<string, unknown>;
    const t = tokens as Record<string, unknown>;
    const window = r.window;
    if (window === null || typeof window !== 'object') return null;
    const w = window as Record<string, unknown>;
    if (typeof w.since !== 'string' || typeof w.until !== 'string') return null;
    if (!Array.isArray(r.pairs) || !Array.isArray(t.roles)) return null;

    const pairs: RoutingPair[] = [];
    for (const raw of r.pairs) {
        const pair = narrowRoutingPair(raw);
        if (pair) pairs.push(pair);
    }
    const roles: RoleAttribution[] = [];
    for (const raw of t.roles) {
        const role = narrowRoleAttribution(raw);
        if (role) roles.push(role);
    }
    return { window: { since: w.since, until: w.until }, pairs, roles };
}

// ---------------------------------------------------------------------------
// Honest-state rendering helpers
// ---------------------------------------------------------------------------

/** Human label for a selection source; `explicit` is a pin, everything else role-resolved. */
export function sourceLabel(source: string | null): string {
    switch (source) {
        case 'explicit':
            return 'pinned';
        case 'role':
            return 'resolved';
        case 'default':
            return 'default';
        case null:
            return '—';
        default:
            return source;
    }
}

const numberFormat = new Intl.NumberFormat('en-US');

/** Plain token count — grouping separators only, never a currency symbol (R2). */
export function formatTokenCount(value: number): string {
    return numberFormat.format(value);
}

/** Renders one token bucket (exact or estimated) as a labelled row. */
function TokenBucketRow({ label, totals }: { label: string; totals: TokenTotals }) {
    return (
        <div data-token-bucket={label} className="text-xs">
            <Badge size="xs" variant={label === 'estimated' ? 'warning' : 'success'}>
                {label}
            </Badge>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 mt-1">
                <dt className="text-spur-text-muted">input</dt>
                <dd className="tabular-nums text-right">{formatTokenCount(totals.inputTokens)}</dd>
                <dt className="text-spur-text-muted">cache read</dt>
                <dd className="tabular-nums text-right">{formatTokenCount(totals.cacheReadTokens)}</dd>
                <dt className="text-spur-text-muted">cache write</dt>
                <dd className="tabular-nums text-right">{formatTokenCount(totals.cacheCreationTokens)}</dd>
                <dt className="text-spur-text-muted">output</dt>
                <dd className="tabular-nums text-right">{formatTokenCount(totals.outputTokens)}</dd>
            </dl>
        </div>
    );
}

/** One role's token attribution — unmeasured renders as itself, never as zero (R3). */
function RoleTokenCard({ role }: { role: RoleAttribution }) {
    const roleName = role.role ?? '—';
    return (
        <div className="bg-base-100 border border-spur-border rounded-md p-3" data-role-attribution={roleName}>
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-spur-text">{roleName}</span>
                <span className="text-[10px] text-spur-text-muted tabular-nums">
                    matched {role.matchedRuns} of {role.totalRuns} runs
                </span>
            </div>
            {role.unmeasured ? (
                <div className="mt-1 text-xs" data-unmeasured>
                    <Badge size="xs" variant="ghost">
                        unmeasured
                    </Badge>
                    <span className="ml-1 text-spur-text-muted">
                        no token data recorded for this role — not a measured zero
                    </span>
                </div>
            ) : (
                <div className="mt-2 flex flex-wrap gap-4">
                    {role.exact ? <TokenBucketRow label="exact" totals={role.exact} /> : null}
                    {role.estimated ? <TokenBucketRow label="estimated" totals={role.estimated} /> : null}
                </div>
            )}
        </div>
    );
}

/** Routing tab: role→executor aggregate + per-role token totals (task 0552). */
export default function RoutingTab() {
    const [state, setState] = useState<RoutingSummaryView | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const controller = new AbortController();
        (async () => {
            try {
                const res = await fetchWithTimeout(
                    new Request(`${resolveApiUrl()}/observability/routing-summary`, { signal: controller.signal }),
                );
                if (!res.ok) throw new Error(`routing summary fetch failed: ${res.status}`);
                const body = parseRoutingSummaryResponse((await res.json()) as unknown);
                if (!body) throw new Error('routing summary response failed schema validation');
                setState(body);
            } catch (err) {
                if (controller.signal.aborted) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();
        return () => controller.abort();
    }, []);

    if (error) {
        return (
            <div className="p-4 text-sm text-error" role="alert">
                Failed to load routing summary: {error}
            </div>
        );
    }
    if (state === null) {
        return (
            <div className="flex items-center justify-center h-32 text-spur-text-muted text-sm">
                <Loading size="sm" /> Loading routing summary…
            </div>
        );
    }

    const isEmpty = state.pairs.length === 0 && state.roles.length === 0;

    return (
        <div className="flex flex-col h-full overflow-hidden" data-routing-tab>
            <div className="px-4 py-2 border-b border-spur-border bg-base-200 shrink-0 flex items-baseline justify-between">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                    Routing &amp; token consumption
                </span>
                <span className="text-[10px] text-spur-text-muted tabular-nums" data-covered-window>
                    covered {state.window.since} → {state.window.until}
                </span>
            </div>

            {isEmpty ? (
                <div className="flex-1 flex items-center justify-center p-4" data-routing-empty>
                    <div className="text-sm text-spur-text-muted italic">
                        No routing attribution has been recorded in the covered window — nothing to show yet.
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {state.pairs.length > 0 ? (
                        <section className="bg-base-100 border border-spur-border rounded-md" data-routing-table>
                            <div className="px-3 py-2 border-b border-spur-border">
                                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                                    Role → executor
                                </span>
                                <span className="ml-2 text-[10px] text-spur-text-muted">
                                    runs and escalations per pair; pinned and role-resolved counted separately
                                </span>
                            </div>
                            <table className="table table-sm w-full">
                                <thead>
                                    <tr className="text-[10px] uppercase text-spur-text-muted">
                                        <th>Role</th>
                                        <th>Executor</th>
                                        <th>Source</th>
                                        <th className="text-right">Runs</th>
                                        <th className="text-right">Escalations</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {state.pairs.map((pair) => (
                                        <tr key={`${pair.role ?? ''}:${pair.executor}:${pair.source ?? ''}`}>
                                            <td className="text-sm text-spur-text">{pair.role ?? '—'}</td>
                                            <td className="text-sm text-spur-text">{pair.executor}</td>
                                            <td>
                                                <Badge
                                                    size="xs"
                                                    variant={pair.source === 'explicit' ? 'warning' : 'ghost'}
                                                >
                                                    {sourceLabel(pair.source)}
                                                </Badge>
                                            </td>
                                            <td className="text-right tabular-nums text-spur-text">
                                                {formatTokenCount(pair.runs)}
                                            </td>
                                            <td className="text-right tabular-nums text-spur-text">
                                                {formatTokenCount(pair.escalations)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="px-3 py-1.5 border-t border-spur-border text-[10px] text-spur-text-muted">
                                “—” role groups pure pins (no role recorded); escalations count runs that started too
                                cheap on this executor.
                            </div>
                        </section>
                    ) : null}

                    {state.roles.length > 0 ? (
                        <section data-token-section>
                            <div className="px-1 pb-1.5">
                                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                                    Token consumption by role
                                </span>
                                <span className="ml-2 text-[10px] text-spur-text-muted">
                                    input, cache read, cache write, output — token totals only
                                </span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                {state.roles.map((role) => (
                                    <RoleTokenCard key={role.role ?? 'pin'} role={role} />
                                ))}
                            </div>
                        </section>
                    ) : null}
                </div>
            )}
        </div>
    );
}
