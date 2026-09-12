import type { DbAdapter } from '@gobing-ai/ts-db';

// ── Types (feature G4 / ADR-057 wave 1) ──

/**
 * Live occupant identity for a spec-addressed run. `specId` is retained even
 * after `drainIntoPrompt` rewrites `--agent` to the spec's coding-agent type so
 * a sibling agent can address the run by spec + runId.
 */
export interface OccupantRef {
    specId: string;
    agentKind: string;
    /** Supervisor registry id when supervised; null for one-shot `agent run`. */
    processId: string | null;
    runId: string;
    /** Monotonic per specId; +1 each new run row. */
    generation: number;
}

/** Path-only artifact reference — never stdout/stderr bodies (design §4). */
export interface CoordinationArtifactRef {
    kind: 'result' | 'log' | 'verdict';
    path: string;
    mediaType?: string;
}

/** Coordination-facing run record: occupant + status + path-only artifact refs. */
export interface CoordinationRun {
    occupant: OccupantRef;
    status: 'running' | 'exited' | 'errored';
    startedAt: string;
    completedAt: string | null;
    artifactRefs: CoordinationArtifactRef[];
}

/** Raw coordination_runs row. */
export interface CoordinationRunRow {
    spec_id: string;
    agent_kind: string;
    process_id: string | null;
    run_id: string;
    generation: number;
    status: string;
    started_at: string;
    completed_at: string | null;
    artifact_refs_json: string;
    message_ids_json: string;
    task_id: string | null;
    outcome: string;
}

/**
 * 0833 completion receipt: the durable association between a finished run and
 * the request that caused it, written by the exit sink in
 * `AgentService.executeRun` (R1). `messageIds` are the inbox messages claimed
 * by the drain that produced the invocation — empty for a run with no
 * originating request (R7: an empty list, never an invented association).
 * `outcome` is a closed vocabulary: the exit sink writes only
 * 'run-exit-only' (zero exit, no verification result — R4) or 'errored';
 * 'verified' is reserved for the workflow verification path (R3: run exit is
 * not task completion).
 */
export interface CoordinationRunReceipt {
    messageIds: string[];
    taskId?: string;
    outcome: 'run-exit-only' | 'errored' | 'verified';
}

/** Input for inserting a run at invoke start (status=running). */
export interface StartCoordinationRunInput {
    specId: string;
    agentKind: string;
    processId: string | null;
    runId: string;
    generation: number;
    startedAt: string;
}

// ── DAO ──

/**
 * DAO for the `coordination_runs` table (ADR-057 wave 1). Stores occupant pins
 * and path-only artifact refs so another agent can address a sibling run by
 * runId. Never stores stdout/stderr bodies.
 */
export class CoordinationRunDao {
    constructor(private readonly db: DbAdapter) {}

    /** Insert a run row at status=running. Call once per invoke at start. */
    async insertStart(input: StartCoordinationRunInput): Promise<void> {
        await this.db.run(
            `INSERT INTO coordination_runs
                (spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json)
             VALUES (?, ?, ?, ?, ?, 'running', ?, NULL, '[]')`,
            input.specId,
            input.agentKind,
            input.processId,
            input.runId,
            input.generation,
            input.startedAt,
        );
    }

    /**
     * Update a run's terminal status, completion timestamp, artifact refs, and
     * completion receipt (0833 R1). The receipt is required so no caller can
     * forget the correlation — `{ messageIds: [], outcome: … }` is the
     * legitimate empty case (R7).
     */
    async updateExit(
        runId: string,
        status: 'exited' | 'errored',
        completedAt: string,
        artifactRefsJson: string,
        receipt: CoordinationRunReceipt,
    ): Promise<void> {
        await this.db.run(
            `UPDATE coordination_runs
             SET status = ?, completed_at = ?, artifact_refs_json = ?, message_ids_json = ?, task_id = ?, outcome = ?
             WHERE run_id = ?`,
            status,
            completedAt,
            artifactRefsJson,
            JSON.stringify(receipt.messageIds),
            receipt.taskId ?? null,
            receipt.outcome,
            runId,
        );
    }

    /**
     * Runs whose receipt records the given originating message id (0833 R5).
     * json1 `json_each` over `message_ids_json`; ordering is newest-start first.
     */
    async listByMessageId(messageId: string): Promise<CoordinationRunRow[]> {
        return (
            (await this.db.queryAll<CoordinationRunRow>(
                `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json, message_ids_json, task_id, outcome
                 FROM coordination_runs r, json_each(r.message_ids_json)
                 WHERE json_each.value = ?
                 ORDER BY r.started_at DESC`,
                messageId,
            )) ?? []
        );
    }

    /** Runs whose receipt records the given task id (0833 R5). */
    async listByTaskId(taskId: string): Promise<CoordinationRunRow[]> {
        return (
            (await this.db.queryAll<CoordinationRunRow>(
                `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json, message_ids_json, task_id, outcome
                 FROM coordination_runs
                 WHERE task_id = ?
                 ORDER BY started_at DESC`,
                taskId,
            )) ?? []
        );
    }

    /** Get a run row by runId, or null. */
    async getByRunId(runId: string): Promise<CoordinationRunRow | null> {
        try {
            return (
                (await this.db.queryFirst<CoordinationRunRow>(
                    `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json, message_ids_json, task_id, outcome
                     FROM coordination_runs WHERE run_id = ?`,
                    runId,
                )) ?? null
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: coordination_runs')) {
                return null;
            }
            throw error;
        }
    }

    /** Latest occupant row for a specId (highest generation, then newest started), or null. */
    async getLatestBySpecId(specId: string): Promise<CoordinationRunRow | null> {
        try {
            return (
                (await this.db.queryFirst<CoordinationRunRow>(
                    `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json, message_ids_json, task_id, outcome
                     FROM coordination_runs
                     WHERE spec_id = ?
                     ORDER BY generation DESC, started_at DESC
                     LIMIT 1`,
                    specId,
                )) ?? null
            );
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: coordination_runs')) {
                return null;
            }
            throw error;
        }
    }

    /** Max generation observed for a specId, or null if none. */
    async maxGeneration(specId: string): Promise<number | null> {
        try {
            const row = await this.db.queryFirst<{ g: number | null }>(
                'SELECT MAX(generation) AS g FROM coordination_runs WHERE spec_id = ?',
                specId,
            );
            return row?.g ?? null;
        } catch (error) {
            if (error instanceof Error && error.message.includes('no such table: coordination_runs')) {
                return null;
            }
            throw error;
        }
    }

    /** Delete all rows (test teardown only). */
    async deleteAll(): Promise<void> {
        await this.db.run('DELETE FROM coordination_runs');
    }
}
