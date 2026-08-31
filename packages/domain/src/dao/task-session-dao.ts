import type { DbAdapter } from '@gobing-ai/ts-db';

// ── Types (task 0722, feature E6) ──

/**
 * Exactness of a task↔session attribution. Import-derived rows are always
 * `estimated` — even deterministic operational syntax is retrospective evidence —
 * and remain distinguishable from invoke-boundary `exact` mappings. The write path
 * never lets an estimated write shadow or overwrite an exact row.
 */
export type TaskSessionExactness = 'exact' | 'estimated';

/** Allowlisted operational-evidence mechanism that produced the attribution. */
export type TaskSessionMechanism = 'slash-command' | 'spur-cli';

/** Which normalized record kind carried the evidence (bounded audit locator, R2). */
export type TaskSessionEvidenceKind = 'user-command' | 'cli-tool';

/** Raw `history_task_session` row. */
export interface TaskSessionRow {
    wbs: string;
    source: string;
    session_id: string;
    exactness: TaskSessionExactness;
    mechanism: TaskSessionMechanism;
    evidence_kind: TaskSessionEvidenceKind;
    evidence_ref: string | null;
    resolved_at: string;
}

/** Input for writing one task↔session attribution row. */
export interface InsertTaskSessionInput {
    wbs: string;
    source: string;
    sessionId: string;
    exactness: TaskSessionExactness;
    mechanism: TaskSessionMechanism;
    evidenceKind: TaskSessionEvidenceKind;
    /** Bounded locator (`<file basename>#<line>`), never transcript content. */
    evidenceRef: string | null;
    resolvedAt: string;
}

// ── DAO ──

/**
 * DAO for the `history_task_session` table (task 0722): the direct many-to-many
 * task↔session authority written by history import. Keyed by
 * `(wbs, source, session_id)` — idempotent re-imports and exact-over-estimated
 * precedence are enforced here, not by callers.
 */
export class TaskSessionDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Write one attribution row. Write-path invariants (task 0722 R2):
     *
     * - **Idempotent** — an existing row for the same `(wbs, source, session_id)`
     *   key is never duplicated; an `estimated` re-write of any existing row is a
     *   no-op (`'present'`).
     * - **Exact-over-estimated** — an `exact` write upgrades an `estimated` row
     *   in place (one row per key, strongest evidence wins).
     *
     * @returns `'created'` when a row was written/upgraded, `'present'` when an
     * existing row made the write a no-op.
     */
    async insert(input: InsertTaskSessionInput): Promise<'created' | 'present'> {
        const existing = await this.db.queryFirst<{ exactness: string }>(
            `SELECT exactness FROM history_task_session WHERE wbs = ? AND source = ? AND session_id = ?`,
            input.wbs,
            input.source,
            input.sessionId,
        );
        if (existing != null) {
            if (input.exactness === 'exact' && existing.exactness !== 'exact') {
                await this.db.run(
                    `UPDATE history_task_session
                     SET exactness = ?, mechanism = ?, evidence_kind = ?, evidence_ref = ?, resolved_at = ?
                     WHERE wbs = ? AND source = ? AND session_id = ?`,
                    input.exactness,
                    input.mechanism,
                    input.evidenceKind,
                    input.evidenceRef,
                    input.resolvedAt,
                    input.wbs,
                    input.source,
                    input.sessionId,
                );
                return 'created';
            }
            return 'present';
        }
        await this.db.run(
            `INSERT INTO history_task_session (wbs, source, session_id, exactness, mechanism, evidence_kind, evidence_ref, resolved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            input.wbs,
            input.source,
            input.sessionId,
            input.exactness,
            input.mechanism,
            input.evidenceKind,
            input.evidenceRef,
            input.resolvedAt,
        );
        return 'created';
    }

    /** Whether one attribution row already exists (dry-run preview, R4). */
    async hasLink(wbs: string, source: string, sessionId: string): Promise<boolean> {
        const row = await this.db.queryFirst<{ n: number }>(
            `SELECT COUNT(*) AS n FROM history_task_session WHERE wbs = ? AND source = ? AND session_id = ?`,
            wbs,
            source,
            sessionId,
        );
        return (row?.n ?? 0) > 0;
    }

    /** All attribution rows for one task WBS (selector-side lookup). */
    async listByWbs(wbs: string): Promise<TaskSessionRow[]> {
        try {
            return await this.db.queryAll<TaskSessionRow>(
                `SELECT wbs, source, session_id, exactness, mechanism, evidence_kind, evidence_ref, resolved_at
                 FROM history_task_session WHERE wbs = ? ORDER BY resolved_at, source, session_id`,
                wbs,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_task_session')) return [];
            throw error;
        }
    }

    /** All attribution rows for one (source, session_id) pair (session-side lookup). */
    async listBySession(source: string, sessionId: string): Promise<TaskSessionRow[]> {
        try {
            return await this.db.queryAll<TaskSessionRow>(
                `SELECT wbs, source, session_id, exactness, mechanism, evidence_kind, evidence_ref, resolved_at
                 FROM history_task_session WHERE source = ? AND session_id = ? ORDER BY resolved_at, wbs`,
                source,
                sessionId,
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: history_task_session')) return [];
            throw error;
        }
    }

    /** Delete all rows (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM history_task_session');
    }

    /** Delete one source's rows — the reconcile step of a full-mode attribution pass (R4). */
    async deleteBySource(source: string): Promise<void> {
        await this.db.run('DELETE FROM history_task_session WHERE source = ?', [source]);
    }
}
