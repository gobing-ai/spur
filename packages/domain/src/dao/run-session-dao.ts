import type { DbAdapter } from '@gobing-ai/ts-db';

// ── Types (feature E6 / task 0557) ──

/**
 * Exactness of a run→session mapping. `estimated` (task 0558) is written by
 * retroactive time-window correlation and is never allowed to overwrite or
 * shadow an `exact` row (R2) — the distinction task 0559 and task 0547 R4
 * depend on.
 */
export type RunSessionExactness = 'exact' | 'unresolved' | 'estimated';

/**
 * Mechanism that produced a run→session mapping. `inferred` (task 0558) marks
 * a mapping derived after the fact from run windows + history timestamps rather
 * than observed at the spawn boundary or supplied by the caller.
 */
export type RunSessionMechanism = 'observed' | 'supplied' | 'inferred';

/** Raw `history_run_session` row. */
export interface RunSessionRow {
    run_id: string;
    source: string;
    /** NULL for unresolved rows — a run that resolved nothing has no session id. */
    session_id: string | null;
    exactness: RunSessionExactness;
    mechanism: RunSessionMechanism;
    resolved_at: string;
}

/** Input for recording one run→session mapping at invoke exit. */
export interface InsertRunSessionInput {
    runId: string;
    /** Importer source id (`pi`, `claude`, `codex`, …) the mapping refers to. */
    source: string;
    sessionId: string | null;
    exactness: RunSessionExactness;
    mechanism: RunSessionMechanism;
    resolvedAt: string;
}

// ── DAO ──

/**
 * DAO for the `history_run_session` table (feature E6): the run→session
 * mapping captured at the agent invoke boundary. The import path may promote
 * an unresolved row when a session is observed inside that run's own session
 * directory. Both lookup directions are index-backed (R4).
 */
export class RunSessionDao {
    constructor(private readonly db: DbAdapter) {}

    /** Record one mapping row. */
    async insert(input: InsertRunSessionInput): Promise<void> {
        await this.db.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            input.runId,
            input.source,
            input.sessionId,
            input.exactness,
            input.mechanism,
            input.resolvedAt,
        );
    }

    /** All mapping rows for a run id (a workflow run may map several sessions). */
    async getByRunId(runId: string): Promise<RunSessionRow[]> {
        try {
            return await this.db.queryAll<RunSessionRow>(
                `SELECT run_id, source, session_id, exactness, mechanism, resolved_at
                 FROM history_run_session WHERE run_id = ? ORDER BY resolved_at`,
                runId,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_run_session')) {
                return [];
            }
            throw error;
        }
    }

    /** All mapping rows for one (source, session_id) pair (reverse lookup). */
    async getBySession(source: string, sessionId: string): Promise<RunSessionRow[]> {
        try {
            return await this.db.queryAll<RunSessionRow>(
                `SELECT run_id, source, session_id, exactness, mechanism, resolved_at
                 FROM history_run_session WHERE source = ? AND session_id = ? ORDER BY resolved_at`,
                source,
                sessionId,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_run_session')) {
                return [];
            }
            throw error;
        }
    }

    /** Distinct importer sources recorded for each run, including unresolved rows. */
    async listRunSources(): Promise<Array<Pick<RunSessionRow, 'run_id' | 'source'>>> {
        try {
            return await this.db.queryAll<Pick<RunSessionRow, 'run_id' | 'source'>>(
                `SELECT DISTINCT run_id, source FROM history_run_session ORDER BY run_id, source`,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_run_session')) return [];
            throw error;
        }
    }

    /** Promote sessions imported from one run-owned directory to exact observed mappings. */
    async observeImportedSessions(input: {
        runId: string;
        source: string;
        sourceFilePrefix: string;
        resolvedAt: string;
    }): Promise<void> {
        try {
            await this.db.run(
                `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
                 SELECT DISTINCT ?, ?, h.session_id, 'exact', 'observed', ?
                 FROM history_message h
                 WHERE h.source = ? AND h.session_id IS NOT NULL
                   AND substr(h.source_file, 1, length(?)) = ?
                   AND NOT EXISTS (
                       SELECT 1 FROM history_run_session m
                       WHERE m.run_id = ? AND m.source = ? AND m.session_id = h.session_id
                         AND m.exactness = 'exact'
                   )`,
                input.runId,
                input.source,
                input.resolvedAt,
                input.source,
                input.sourceFilePrefix,
                input.sourceFilePrefix,
                input.runId,
                input.source,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_run_session')) return;
            if (error instanceof Error && error.message.includes('no such table: history_message')) return;
            throw error;
        }
    }

    /**
     * Write an inferred (estimated) mapping produced by retroactive correlation
     * (task 0558). The write path enforces both invariants before inserting:
     *
     * - **R2** — an `exact` row for the run is never downgraded or shadowed: the
     *   insert is skipped when any exact row exists for `runId`. A run covered
     *   by task 0557's boundary observation is authoritative and left untouched.
     * - **R4** — re-runs are idempotent: the insert is skipped when an identical
     *   `estimated` row for the same `(run_id, source, session_id)` already
     *   exists.
     *
     * @returns true when a row was actually written, false when a guard skipped it.
     */
    async insertInferred(input: {
        runId: string;
        source: string;
        sessionId: string;
        resolvedAt: string;
    }): Promise<boolean> {
        const blocked = await this.db.queryFirst<{ blocked: number }>(
            `SELECT EXISTS(
                 SELECT 1 FROM history_run_session
                 WHERE run_id = ?1
                   AND (exactness = 'exact'
                        OR (exactness = 'estimated' AND source = ?2 AND session_id = ?3))
             ) AS blocked`,
            input.runId,
            input.source,
            input.sessionId,
        );
        if ((blocked?.blocked ?? 0) > 0) return false;

        await this.db.run(
            `INSERT INTO history_run_session (run_id, source, session_id, exactness, mechanism, resolved_at)
             VALUES (?, ?, ?, 'estimated', 'inferred', ?)`,
            input.runId,
            input.source,
            input.sessionId,
            input.resolvedAt,
        );
        return true;
    }

    /**
     * Align `history_message.provenance` with this table (task 0559 R5).
     *
     * Launch provenance is a mapping fact: a (source, session_id) present here was
     * spur-launched (observed at the invoke boundary, supplied, or retroactively
     * inferred); anything else is ambient. The importer's cwd-substring heuristic
     * is deleted, so rows import as `ambient` and this two-way alignment is the
     * only writer of `spur-run` — the ambient→spur-run pass promotes mapped
     * sessions and the reverse pass self-heals rows mislabelled by the old
     * heuristic. Idempotent; safe to run after every import.
     */
    async alignMessageProvenance(): Promise<void> {
        try {
            await this.db.run(
                `UPDATE history_message SET provenance = 'spur-run'
                 WHERE provenance = 'ambient' AND session_id IS NOT NULL
                   AND EXISTS (SELECT 1 FROM history_run_session m
                               WHERE m.source = history_message.source
                                 AND m.session_id = history_message.session_id
                                 AND m.session_id IS NOT NULL)`,
            );
            await this.db.run(
                `UPDATE history_message SET provenance = 'ambient'
                 WHERE provenance = 'spur-run'
                   AND NOT EXISTS (SELECT 1 FROM history_run_session m
                                   WHERE m.source = history_message.source
                                     AND m.session_id = history_message.session_id
                                     AND m.session_id IS NOT NULL)`,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_run_session')) return;
            if (error instanceof Error && error.message.includes('no such table: history_message')) return;
            throw error;
        }
    }

    /** Delete all rows (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM history_run_session');
    }
}
