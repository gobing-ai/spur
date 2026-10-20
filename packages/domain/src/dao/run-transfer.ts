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
 * `external-key-conflict` is graded by what the refused source run actually owns (1090
 * follow-up, extended by 1149 R1). The identity belongs to the TARGET's row either way, so a
 * source row with no child rows has nothing to orphan — it is a bare bookkeeping row the worktree
 * created for itself (the pipeline precheck's auto-profile feature reopen runs in the execution tree,
 * so a `feature-lifecycle`/`feature:<id>` row is created in a throwaway DB while the invoking tree
 * already owns that key). That case reports `reason:'external-key-conflict-bookkeeping'` and does NOT
 * fail the pass. Task 1149 R1 extends this to any TERMINAL lifecycle row (`task-lifecycle` or
 * `feature-lifecycle` with status `done`/`failed`/`cancelled`): the batch's outcome reaches the
 * receiving row via the terminal reconcile (1047 R1), so the worktree-created lifecycle row does not
 * orphan provenance and refusing teardown is avoided. A non-terminal duplicate lifecycle row and any
 * non-lifecycle run (`task-pipeline`) keep the fail-closed `external-key-conflict`.
 *
 * Evidence for the grading (run `ada5a36c`, task 1090): the refused `feature:H1` row owned 0
 * child rows in every child table, against 48 `action_runs` for that run's task-pipeline run
 * and 9 `action_runs` + 5 `phase_runs` for its wrap run in the same archive.
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
    readonly reason: 'id-exists' | 'external-key-conflict' | 'external-key-conflict-bookkeeping';
}

/** Outcome of one transfer pass: inserted run ids in source order, plus runs the conflict policy refused. */
export interface RunTransferResult {
    /** Ids inserted into the target DB, in source order. */
    readonly persistedIds: readonly string[];
    /** Runs refused by the conflict policy; the pre-existing target rows stand. */
    readonly skipped: readonly RunTransferSkipped[];
}

/** Child tables keyed by `run_id`, copied per persisted run (engine schema order). */
const CHILD_TABLES = [
    'action_runs',
    'phase_runs',
    'transition_runs',
    'workflow_states',
    'artifacts',
    'task_run_links',
] as const;

/**
 * Ledger tables correlated by `run_id`, copied after the run's children (task 1262 R2).
 * Deliberately NOT part of {@link CHILD_TABLES}: that list also drives the `ownsChildren`
 * conflict grading below, where a run owning only ledger rows must not read as provenance
 * for a lifecycle bookkeeping row (and vice versa).
 */
const LEDGER_TABLES = ['system_events', 'decision_logs'] as const;

const LIFECYCLE_WORKFLOWS = new Set(['task-lifecycle', 'feature-lifecycle']);
const TERMINAL_STATUSES = new Set(['done', 'failed', 'cancelled']);

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

/**
 * Copy one run's ledger rows (task 1262 R2). `system_events.sequence` is the target ledger's
 * global cursor, so copied events are renumbered above the target's current maximum in source
 * order — verbatim source sequences collide with the target's own rows. `decision_logs` carries
 * no cursor and copies as-is. Both insert by id, so a second persist is a no-op.
 */
async function ledgerOps(
    from: DbAdapter,
    to: DbAdapter,
    runId: string,
): Promise<{ sql: string; params: readonly unknown[] }[]> {
    const ops: { sql: string; params: readonly unknown[] }[] = [];
    for (const table of LEDGER_TABLES) {
        // A source DB older than the ledger migration has no such table; skipping it keeps a
        // pre-ledger worktree transferable instead of refusing teardown on a missing table.
        const present = await from.queryFirst<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
            table,
        );
        if (present === undefined) continue;
        const rows =
            table === 'system_events'
                ? await from.queryAll<RawRow>('SELECT * FROM system_events WHERE run_id = ? ORDER BY sequence', runId)
                : await from.queryAll<RawRow>(`SELECT * FROM ${table} WHERE run_id = ?`, runId);
        if (rows.length === 0) continue;
        const columns = await tableColumns(to, table);
        if (table === 'system_events') {
            const targetMax =
                (await to.queryFirst<{ m: number | null }>('SELECT MAX(sequence) AS m FROM system_events'))?.m ?? 0;
            ops.push(
                ...insertIfAbsentOps(
                    table,
                    rows.map((row, index) => ({ ...row, sequence: targetMax + index + 1 })),
                    columns,
                ),
            );
            continue;
        }
        ops.push(...insertIfAbsentOps(table, rows, columns));
    }
    return ops;
}

async function tableColumns(db: DbAdapter, table: string): Promise<Set<string>> {
    const rows = await db.queryAll<{ name: string }>(`PRAGMA table_info(${table})`);
    return new Set(rows.map((row) => row.name));
}

/** One worktree run-row identity: the id plus its workflow name (task 0984 R5). */
export interface RunIdRow {
    readonly id: string;
    /** Declared workflow name (`task-lifecycle`, `task-pipeline`, …); null for legacy rows. */
    readonly workflowName: string | null;
}

/**
 * List the run identities present in `from`. Raw SQL lives here (domain-only rule): the
 * app-side persistWorktreeRuns validation seam reads worktree-sourced ids (and their
 * workflow names, which decide the record-missing tolerance) through this instead of
 * inlining its own queries.
 */
export async function listRunIdRows(from: DbAdapter): Promise<RunIdRow[]> {
    return (
        await from.queryAll<{ id: string; workflow_name: string | null }>('SELECT id, workflow_name FROM runs')
    ).map((row) => ({ id: row.id, workflowName: row.workflow_name }));
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
                // Grade the refusal by what the source row owns (see the module doc). A childless
                // row is bookkeeping the worktree created for itself, not provenance.
                let ownsChildren = false;
                for (const table of CHILD_TABLES) {
                    const child = await from.queryFirst<{ c: number }>(
                        `SELECT COUNT(*) AS c FROM ${table} WHERE run_id = ?`,
                        id,
                    );
                    if ((child?.c ?? 0) > 0) {
                        ownsChildren = true;
                        break;
                    }
                }
                const isLifecycleTerminal =
                    LIFECYCLE_WORKFLOWS.has(String(row.workflow_name)) && TERMINAL_STATUSES.has(String(row.status));
                const isBookkeeping = !ownsChildren || isLifecycleTerminal;
                skipped.push({
                    id,
                    reason: isBookkeeping ? 'external-key-conflict-bookkeeping' : 'external-key-conflict',
                });
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
        ops.push(...(await ledgerOps(from, to, id)));
        await to.batch(ops);
        persistedIds.push(id);
    }
    return { persistedIds, skipped };
}
