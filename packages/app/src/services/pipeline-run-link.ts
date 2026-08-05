/**
 * Shared pipeline provenance run-link helper (task 0436 residuals).
 *
 * Both `spur task run-link` and `TaskService.record(--transition done)` need the
 * same idempotent "ensure a kind=pipeline link exists" behaviour. Co-locating it
 * here removes the CLI/service duplication residual and gives record a single
 * call site to invoke just before the hop to `done` (not before the whole walk).
 */

import { createId, type DbAdapter, TaskRunLinkDao } from '@gobing-ai/spur-domain';

/**
 * Canonical forward lifecycle chain for task statuses — matches
 * `config/workflows/task-lifecycle.yaml` forward path
 * (`backlog → todo → wip → testing → done`). Keep in lock-step with that YAML;
 * `packages/app/tests/services/pipeline-run-link.test.ts` asserts the parity.
 */
export const TASK_FORWARD_CHAIN: readonly string[] = ['backlog', 'todo', 'wip', 'testing', 'done'];

export interface EnsurePipelineRunLinkResult {
    /** True when a new row was inserted; false when a pipeline link already existed. */
    created: boolean;
    id: string;
    wbs: string;
    runId: string;
    kind: 'pipeline';
}

export interface EnsurePipelineRunLinkOptions {
    /**
     * Explicit `run_id` for a newly created link. When omitted, a deterministic
     * `record:<wbs>:<ms>` id is used (record path) — callers that want a
     * different provenance prefix (e.g. `chain:…` for `run-link`) pass their own.
     */
    runId?: string;
}

/**
 * Idempotent ensure: if any `pipeline` run-link already exists for `wbs`, return
 * it; otherwise insert one. Used by the record auto-walk (just before the hop
 * to `done`) and by the CLI `run-link` command.
 */
export async function ensurePipelineRunLink(
    db: DbAdapter,
    wbs: string,
    options: EnsurePipelineRunLinkOptions = {},
): Promise<EnsurePipelineRunLinkResult> {
    const dao = new TaskRunLinkDao(db);
    const links = await dao.listByWbs(wbs, 20);
    const existing = links.find((l) => l.kind === 'pipeline');
    if (existing) {
        return {
            created: false,
            id: existing.id,
            wbs: existing.wbs,
            runId: existing.run_id,
            kind: 'pipeline',
        };
    }
    const id = createId('trl');
    const runId = options.runId ?? `record:${wbs}:${Date.now()}`;
    await dao.insert({
        id,
        wbs,
        run_id: runId,
        kind: 'pipeline',
        created_at: new Date().toISOString(),
    });
    return { created: true, id, wbs, runId, kind: 'pipeline' };
}
