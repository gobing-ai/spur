import type { DbAdapter } from '@gobing-ai/ts-db';
import { buildTimeRangeClauses } from './selector-time-range';

/**
 * Surface usage — which authored commands/skills were actually invoked (task 1399, feature H85).
 *
 * The inventory is injected (the app layer owns the plugin dirs); this module only counts. Rows come
 * from `history_skill_call`, whose `skill_name` is the E93 canonical form (`sp:dev-run`), so one
 * query attributes every inventory item without guessing from a name prefix.
 *
 * The artifact is the only evidence plane (history-anatomy primary directive): a finding that an item
 * is unused is worth nothing unless the window is long enough to support it, hence `comparable`.
 */

/** Editorial constant: a shorter window cannot support a zero-use claim (R4). */
export const ZERO_USE_MIN_WINDOW_DAYS = 30;

/** One inventory entry, named as E93 records it (`sp:<name>`). */
export interface SurfaceInventoryItem {
    kind: 'command' | 'skill';
    name: string;
}

/** Per-item call count over the window. */
export interface SurfaceUsageItem extends SurfaceInventoryItem {
    /** Rows in `history_skill_call` for this item (any evidence kind, any status — a request counts). */
    calls: number;
}

/** The surface-usage block of the history artifact. */
export interface SurfaceUsage {
    /** Every inventory item with its window count, in inventory order. */
    items: SurfaceUsageItem[];
    /** Inventory items with no row in the window. Empty when the window is too short to claim it. */
    zeroUse: SurfaceInventoryItem[];
    /** Window length in days; null when unbounded (full history). */
    windowDays: number | null;
    /** False when the window is shorter than {@link ZERO_USE_MIN_WINDOW_DAYS} — zero-use is not comparable. */
    comparable: boolean;
}

/** Options for {@link surfaceUsageSummary}. */
export interface SurfaceUsageOptions {
    /** Inclusive lower bound on `history_skill_call.started_at` (ISO). */
    since?: string;
    /** Inclusive upper bound (ISO). */
    until?: string;
    /** The authored surfaces to measure; an empty inventory yields an empty block. */
    inventory: SurfaceInventoryItem[];
}

/**
 * Count each inventory item's invocations in the window (1399 R1).
 *
 * Never-fabricate: an item absent from the ledger is reported as zero-use only when the window is
 * comparable; the caller renders `not comparable` otherwise. A missing history plane reads as an
 * empty block (best-effort, like the rest of the trace path), never a throw.
 */
export async function surfaceUsageSummary(db: DbAdapter, spec: SurfaceUsageOptions): Promise<SurfaceUsage> {
    const windowDays = windowLengthDays(spec.since, spec.until);
    const comparable = windowDays !== null && windowDays >= ZERO_USE_MIN_WINDOW_DAYS;
    if (spec.inventory.length === 0) return { items: [], zeroUse: [], windowDays, comparable };

    const { clauses, params } = buildTimeRangeClauses(
        { since: spec.since ?? null, until: spec.until ?? null },
        { column: 'started_at', grain: 'instant' },
    );
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const names = spec.inventory.map((item) => item.name);
    const placeholders = names.map(() => '?').join(', ');

    let rows: Array<{ skill_name: string; calls: number }>;
    try {
        rows = await db.queryAll<{ skill_name: string; calls: number }>(
            `SELECT skill_name, COUNT(*) AS calls
             FROM history_skill_call
             ${where === '' ? 'WHERE' : `${where} AND`} skill_name IN (${placeholders})
             GROUP BY skill_name`,
            ...params,
            ...names,
        );
    } catch {
        // No history plane yet: an empty block, never a fabricated all-zero inventory.
        return { items: [], zeroUse: [], windowDays, comparable };
    }

    const counts = new Map(rows.map((row) => [row.skill_name, Number(row.calls)]));
    const items: SurfaceUsageItem[] = spec.inventory.map((item) => ({ ...item, calls: counts.get(item.name) ?? 0 }));
    const zeroUse = comparable
        ? items.filter((item) => item.calls === 0).map(({ kind, name }) => ({ kind, name }))
        : [];
    return { items, zeroUse, windowDays, comparable };
}

/** Inclusive window length in days, or null when either bound is absent (unbounded). */
function windowLengthDays(since: string | undefined, until: string | undefined): number | null {
    if (since === undefined || until === undefined) return null;
    const from = Date.parse(since);
    const to = Date.parse(until);
    if (Number.isNaN(from) || Number.isNaN(to)) return null;
    return (to - from) / 86_400_000;
}
