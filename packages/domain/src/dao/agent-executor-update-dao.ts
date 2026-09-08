import type { DbAdapter } from '@gobing-ai/ts-db';

/**
 * Durable latest-observation delivery record for quota-driven executor
 * disabling (feature B5 / task 0799, ADR-111). One row per
 * `(project_id, executor_name)` in the existing project SQLite database —
 * deliberately independent of the prunable `system_events` ledger, which is
 * audit history, not a work queue. The row carries delivery state only; the
 * project YAML remains the execution authority.
 *
 * `observed_at`/`applied_at`/`retry_after` are UTC ISO-8601 millisecond
 * strings so lexical comparison equals chronological comparison (the
 * observation order is `(observed_at, observation_id)` with deterministic
 * lexical ID tie-breaking — never a distributed causal clock).
 */
export interface AgentExecutorUpdateRow {
    project_id: string;
    executor_name: string;
    observation_id: string;
    observed_at: string;
    agent: string | null;
    model: string | null;
    /** Desired value: 1 = disable, 0 = explicit recovery. Constrained by CHECK at DDL level. */
    disabled: 0 | 1;
    /** Observation last confirmed applied to the project YAML; null while pending. */
    applied_observation_id: string | null;
    applied_at: string | null;
    /** Failed drain attempts for the current pending observation (reset by a newer arrival or a successful ack). */
    attempts: number;
    retry_after: string | null;
    last_error: string | null;
}

/** Trusted attribution + desired value for one quota observation. */
export interface RecordAgentExecutorUpdateInput {
    project_id: string;
    executor_name: string;
    observation_id: string;
    /** UTC ISO-8601 millisecond timestamp (normalized upstream / by the app layer). */
    observed_at: string;
    /** Resolved profile binding used to reject events for replaced profiles. */
    agent: string | null;
    model: string | null;
    disabled: boolean;
}

/** Outcome of a conditional latest-observation upsert. */
export type RecordAgentExecutorUpdateOutcome =
    /** The row now carries this observation as pending. */
    | 'recorded'
    /** Same observation redelivered — no mutation (idempotent replay). */
    | 'duplicate'
    /** A strictly newer observation is already retained — the stale one is ignored. */
    | 'superseded';

/**
 * DAO for `agent_executor_updates`. Owns every SQL statement for the table,
 * including the latest-observation conditional upsert and the
 * version-specific acknowledgement — callers never hand-write update SQL.
 * Raw SQL over `DbAdapter`, same pattern as {@link SystemEventDao}.
 */
export class AgentExecutorUpdateDao {
    constructor(private readonly db: DbAdapter) {}

    /**
     * Conditionally retain the newest observation for `(project_id,
     * executor_name)`. Ordering is `(observed_at, observation_id)` with
     * lexical ID tie-breaking: a strictly newer arrival supersedes (and
     * resets retry state — a newer observation is fresh delivery work, not a
     * retry of the old one), the same `observation_id` is an idempotent
     * no-op, and an older/equal-order arrival from a different id never
     * replaces a newer row. The write re-checks the guard under the
     * statement's write lock, so a racing reader decision cannot overwrite a
     * row that turned newer in between.
     */
    async recordObservation(input: RecordAgentExecutorUpdateInput): Promise<RecordAgentExecutorUpdateOutcome> {
        const existing = await this.getUpdate(input.project_id, input.executor_name);
        if (existing !== undefined) {
            if (existing.observation_id === input.observation_id) return 'duplicate';
            if (
                !observationIsNewer(
                    input.observed_at,
                    input.observation_id,
                    existing.observed_at,
                    existing.observation_id,
                )
            ) {
                return 'superseded';
            }
        }
        const disabled = input.disabled ? 1 : 0;
        await this.db.run(
            `INSERT INTO agent_executor_updates (
                 project_id, executor_name, observation_id, observed_at, agent, model, disabled,
                 applied_observation_id, applied_at, attempts, retry_after, last_error
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, NULL, NULL)
             ON CONFLICT (project_id, executor_name) DO UPDATE SET
                 observation_id = excluded.observation_id,
                 observed_at = excluded.observed_at,
                 agent = excluded.agent,
                 model = excluded.model,
                 disabled = excluded.disabled,
                 applied_observation_id = NULL,
                 applied_at = NULL,
                 attempts = 0,
                 retry_after = NULL,
                 last_error = NULL
             WHERE excluded.observation_id != agent_executor_updates.observation_id
               AND (
                   excluded.observed_at > agent_executor_updates.observed_at
                   OR (
                       excluded.observed_at = agent_executor_updates.observed_at
                       AND excluded.observation_id > agent_executor_updates.observation_id
                   )
               )`,
            input.project_id,
            input.executor_name,
            input.observation_id,
            input.observed_at,
            input.agent,
            input.model,
            disabled,
        );
        // The guard may have rejected the write under concurrency; re-read so
        // the returned outcome reflects the retained row, never the stale read.
        const retained = await this.getUpdate(input.project_id, input.executor_name);
        if (retained === undefined) return 'superseded';
        if (retained.observation_id === input.observation_id) return 'recorded';
        return 'superseded';
    }

    /**
     * Acknowledge exactly `observation_id` as applied (version-specific).
     * When a newer observation superseded the row while the YAML write was in
     * flight, the ack is a no-op and the newer arrival stays pending — an
     * older write is never allowed to mark a newer observation applied.
     * Returns true when this call performed the acknowledgement.
     */
    async ackApplied(
        projectId: string,
        executorName: string,
        observationId: string,
        appliedAt: string,
    ): Promise<boolean> {
        await this.db.run(
            `UPDATE agent_executor_updates
             SET applied_observation_id = ?3,
                 applied_at = ?4,
                 attempts = 0,
                 retry_after = NULL,
                 last_error = NULL
             WHERE project_id = ?1
               AND executor_name = ?2
               AND observation_id = ?3`,
            projectId,
            executorName,
            observationId,
            appliedAt,
        );
        const changed = await this.db.queryFirst<{ n: number }>('SELECT changes() AS n');
        return (changed?.n ?? 0) > 0;
    }

    /**
     * Retain a visible failure for the current pending observation
     * (version-conditional: a superseded observation is never marked). The
     * row stays pending so a later restart retries it (design §5).
     */
    async recordFailure(
        projectId: string,
        executorName: string,
        observationId: string,
        error: string,
        retryAfter: string | null,
    ): Promise<void> {
        await this.db.run(
            `UPDATE agent_executor_updates
             SET attempts = attempts + 1,
                 retry_after = ?4,
                 last_error = ?5
             WHERE project_id = ?1
               AND executor_name = ?2
               AND observation_id = ?3`,
            projectId,
            executorName,
            observationId,
            retryAfter,
            error,
        );
    }

    /**
     * Rows with retained work: `observation_id` differs from
     * `applied_observation_id` (never-applied, or superseded by a newer
     * pending arrival after a previous ack). Oldest observation first, so a
     * serial drain applies history in order and each newer arrival makes the
     * older one's application a no-op through the updater's own idempotency.
     */
    async pendingUpdates(projectId?: string): Promise<AgentExecutorUpdateRow[]> {
        if (projectId !== undefined) {
            return this.db.queryAll<AgentExecutorUpdateRow>(
                `SELECT ${AGENT_EXECUTOR_UPDATE_COLUMNS}
                 FROM agent_executor_updates
                 WHERE project_id = ?1
                   AND (applied_observation_id IS NULL OR applied_observation_id != observation_id)
                 ORDER BY observed_at ASC, observation_id ASC`,
                projectId,
            );
        }
        return this.db.queryAll<AgentExecutorUpdateRow>(
            `SELECT ${AGENT_EXECUTOR_UPDATE_COLUMNS}
             FROM agent_executor_updates
             WHERE applied_observation_id IS NULL OR applied_observation_id != observation_id
             ORDER BY observed_at ASC, observation_id ASC`,
        );
    }

    /** Retained row for one executor, or undefined. */
    async getUpdate(projectId: string, executorName: string): Promise<AgentExecutorUpdateRow | undefined> {
        const row = await this.db.queryFirst<AgentExecutorUpdateRow>(
            `SELECT ${AGENT_EXECUTOR_UPDATE_COLUMNS}
             FROM agent_executor_updates
             WHERE project_id = ?1 AND executor_name = ?2`,
            projectId,
            executorName,
        );
        return row ?? undefined;
    }

    /** Delete every row (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM agent_executor_updates');
    }
}

/** Column list every projection returns, in row order. */
const AGENT_EXECUTOR_UPDATE_COLUMNS =
    'project_id, executor_name, observation_id, observed_at, agent, model, disabled, applied_observation_id, applied_at, attempts, retry_after, last_error';

/**
 * Deterministic observation order: `(observed_at, observation_id)` lexical —
 * timestamps are normalized UTC ISO-8601 ms, so lexical order is chronological.
 */
export function observationIsNewer(leftAt: string, leftId: string, rightAt: string, rightId: string): boolean {
    if (leftAt !== rightAt) return leftAt > rightAt;
    return leftId > rightId;
}
