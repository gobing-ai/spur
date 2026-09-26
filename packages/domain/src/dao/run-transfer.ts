import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Worktree → invoking-tree run provenance transfer (task 0975 R1).
 *
 * A `--worktree` inline run persists its `runs` row, its `action_runs` / `phase_runs` /
 * `transition_runs` / `workflow_states` children, and the two-file run record inside the
 * worktree's `.spur/` — exactly the tree create-mode WT-4 removes. This module is the
 * domain operation the pre-teardown persist-out step runs: it copies run rows and their
 * child rows from a source (worktree) DB into a target (invoking-tree) DB. Both sides are
 * schema-migrated Spur project DBs, so every engine column travels verbatim.
 *
 * Conflict policy — read-verify, never a blind upsert: an id already present in the
 * target is reported as `skipped[{id, reason:'id-exists'}]`; a run whose
 * `(workflow_name, external_key)` matches a live target row (partial unique index
 * `idx_runs_external_key`) is reported as `skipped[{id, reason:'external-key-conflict'}]`.
 * A skipped run's target row is never modified. Child rows insert with
 * `ON CONFLICT(id) DO NOTHING`, so persisting the same worktree twice leaves every
 * invoking-tree row count unchanged (idempotent).
 *
 * Columns copy by INTERSECTION: the engine applies guarded ALTERs (`owner_attempt`,
 * `owner_pid`, `interrupt_reason`) to any DB it runs in, so an engine-touched worktree DB
 * can carry columns a freshly CLI-migrated invoking tree does not have yet (they appear
 * when the engine next runs there). Rows travel verbatim for every column both sides
 * share; engine-only occupancy bookkeeping never blocks the provenance copy.
 *
 * Each run and its children commit as ONE `DbAdapter.batch` — an invoking tree never
 * holds a run row whose children are half-copied.
 */

export interface RunTransferSkipped {
    readonly id: string;
    readonly reason: 'id-exists' | 'external-key-conflict';
}

/** Outcome of one transfer pass: inserted run ids in source order, plus runs the conflict policy refused. */
export interface RunTransferResult {
    /** Ids inserted into the target DB, in source order. */
    readonly persistedIds: readonly string[];
    /** Runs refused by the conflict policy; the pre-existing target rows stand. */
    readonly skipped: readonly RunTransferSkipped[];
}

/** Child tables keyed by `run_id`, copied per persisted run (engine schema order). */
const CHILD_TABLES = ['action_runs', 'phase_runs', 'transition_runs', 'workflow_states'] as const;

/** Row shape as `SELECT *` returns it — column names come from the migrated schema. */
type RawRow = { readonly [column: string]: unknown };

function insertIfAbsentOps(
    table: string,
    rows: readonly RawRow[],
    targetColumns: ReadonlySet<string>,
): { sql: string; params: readonly unknown[] }[] {
    return rows.map((row) => {
        // Column intersection (see module doc): drop columns the target's migrated schema
        // does not declare — engine-guarded ALTER columns, chiefly.
        const columns = Object.keys(row).filter((column) => targetColumns.has(column));
        return {
            sql:
                `INSERT INTO ${table} (${columns.join(', ')}) ` +
                `VALUES (${columns.map(() => '?').join(', ')}) ON CONFLICT(id) DO NOTHING`,
            params: columns.map((column) => row[column]),
        };
    });
}

async function tableColumns(db: DbAdapter, table: string): Promise<Set<string>> {
    const rows = await db.queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(rows.map((row) => row.name));
}

/**
 * Copy every run row and its child rows from `from` into `to`; read-verify, idempotent,
 * one batch per run. Full conflict and column-intersection contract in the module doc.
 */
export async function transferRunTables(from: DbAdapter, to: DbAdapter): Promise<RunTransferResult> {
    const persistedIds: string[] = [];
    const skipped: RunTransferSkipped[] = [];
    const targetRunsColumns = await tableColumns(to, 'runs');
    const sourceRows = await from.queryAll<RawRow>('SELECT * FROM runs');
    for (const row of sourceRows) {
        const id = String(row.id);
        if ((await to.queryFirst('SELECT id FROM runs WHERE id = ?', id)) !== undefined) {
            skipped.push({ id, reason: 'id-exists' });
            continue;
        }
        if (row.external_key !== null && row.external_key !== undefined) {
            // Same key tuple the partial unique index idx_runs_external_key enforces
            // (`IS ?` keeps a NULL workflow_name comparable).
            const conflict = await to.queryFirst<{ id: string }>(
                'SELECT id FROM runs WHERE external_key IS NOT NULL AND workflow_name IS ? AND external_key = ?',
                row.workflow_name ?? null,
                row.external_key,
            );
            if (conflict !== undefined) {
                skipped.push({ id, reason: 'external-key-conflict' });
                continue;
            }
        }
        const ops = insertIfAbsentOps('runs', [row], targetRunsColumns);
        for (const table of CHILD_TABLES) {
            ops.push(
                ...insertIfAbsentOps(
                    table,
                    await from.queryAll<RawRow>(`SELECT * FROM ${table} WHERE run_id = ?`, id),
                    await tableColumns(to, table),
                ),
            );
        }
        await to.batch(ops);
        persistedIds.push(id);
    }
    return { persistedIds, skipped };
}
