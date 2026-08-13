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

    /** Update a run's terminal status, completion timestamp, and artifact refs. */
    async updateExit(
        runId: string,
        status: 'exited' | 'errored',
        completedAt: string,
        artifactRefsJson: string,
    ): Promise<void> {
        await this.db.run(
            `UPDATE coordination_runs SET status = ?, completed_at = ?, artifact_refs_json = ? WHERE run_id = ?`,
            status,
            completedAt,
            artifactRefsJson,
            runId,
        );
    }

    /** Get a run row by runId, or null. */
    async getByRunId(runId: string): Promise<CoordinationRunRow | null> {
        try {
            return (
                (await this.db.queryFirst<CoordinationRunRow>(
                    `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json
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
                    `SELECT spec_id, agent_kind, process_id, run_id, generation, status, started_at, completed_at, artifact_refs_json
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
