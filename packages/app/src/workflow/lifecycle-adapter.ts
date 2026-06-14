/**
 * Lifecycle engine adapter — bridges `LifecyclePort` to `ts-dual-workflow-engine`.
 *
 * Design §5.2: run binding `task:<wbs>`, create-or-attach, requestTransition.
 * DD-04: file-wins rehydration on missing/disagreeing engine state.
 * ADR-022: no local FSM fallback — the engine owns the state-machine graph.
 *
 * Upstream gate cleared: `@gobing-ai/ts-dual-workflow-engine` ≥0.3.17 ships
 * `WorkflowService.createOrAttachRun` (E1 durable named runs) and
 * `requestTransition` / `reseedRun` (E2 external transition API).
 */

import { createId, type DbAdapter, type TaskRunLinkDao } from '@gobing-ai/spur-domain';
import {
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
    loadWorkflowDef,
    type StateMachineWorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EntityRef, LifecyclePort, TransitionResult } from '../services/planning-write-service';

/** Run-binding kind recorded in `task_run_links`. */
const LIFECYCLE_LINK_KIND = 'lifecycle';

/** Workflow definition name (matches `config/workflows/task-lifecycle.yaml`). */
const TASK_LIFECYCLE_WORKFLOW = 'task-lifecycle';

/** Options for constructing the lifecycle engine adapter. */
export interface LifecycleAdapterOptions {
    /** Lazily resolves the DB adapter (engine persistence + task_run_links). */
    getDb(): Promise<DbAdapter>;
    /** Builds the `TaskRunLinkDao` for the given DB adapter. */
    taskRunLinkDao(db: DbAdapter): TaskRunLinkDao;
    /** Absolute path to the `task-lifecycle.yaml` workflow definition. */
    workflowPath: string;
    /** Working directory passed to shell guards (e.g. `spur task check`). */
    cwd: string;
}

/**
 * Engine-backed lifecycle port. Validates transitions against the
 * `task-lifecycle` state-machine graph and enforces its guards (e.g.
 * `spur task check` on `wip→testing`). The file's frontmatter status is the
 * single source of truth (DD-04): before every transition the engine run is
 * re-seeded from the file, so a missing or disagreeing engine state self-heals.
 */
export class LifecycleAdapter implements LifecyclePort {
    private readonly opts: LifecycleAdapterOptions;
    private workflowCache: StateMachineWorkflowDef | undefined;

    constructor(opts: LifecycleAdapterOptions) {
        this.opts = opts;
    }

    /**
     * Request a lifecycle transition through the engine (design §5.2):
     * 1. create-or-attach the durable run `task:<wbs>` (R1).
     * 2. record a `task_run_links` row (kind=lifecycle) on attach (R4).
     * 3. file-wins re-seed: force the engine's current state to the file's
     *    `currentStatus` and emit the corrective event (DD-04, R3).
     * 4. `requestTransition(currentStatus → to)`; a denial returns
     *    `{ allowed: false }` with the guard report so the write aborts (R2).
     */
    async requestTransition(ref: EntityRef, currentStatus: string, to: string): Promise<TransitionResult> {
        const db = await this.opts.getDb();
        const svc = new EngineWorkflowService(createDefaultWorkflowEngineHost(), new DbWorkflowPersistenceAdapter(db));
        const workflow = this.withWbs(await this.loadWorkflow(), ref.id);
        const externalKey = `task:${ref.id}`;
        const now = new Date().toISOString();

        // ── R1: create-or-attach the durable named run ──
        const existing = await svc.findRunByKey(TASK_LIFECYCLE_WORKFLOW, externalKey);
        const runId = existing?.id ?? createId('run');
        await svc.createOrAttachRun({
            id: runId,
            workflow_name: TASK_LIFECYCLE_WORKFLOW,
            mode: 'state-machine',
            status: 'running',
            started_at: existing?.started_at ?? now,
            completed_at: null,
            metadata_json: '{}',
            external_key: externalKey,
        });

        // ── R4: link the lifecycle run to the task on first attach ──
        if (existing === undefined) {
            await this.opts.taskRunLinkDao(db).insert({
                id: createId('trl'),
                wbs: ref.id,
                run_id: runId,
                kind: LIFECYCLE_LINK_KIND,
                created_at: now,
            });
        }

        // ── R3 / DD-04: file wins — re-seed the engine from the file status ──
        // The frontmatter is the SSOT; force the run's current state to it so a
        // missing or disagreeing engine state self-heals before we transition.
        await svc.reseedRun(workflow, runId, currentStatus);

        // ── R2: request the transition; map the engine result to the port ──
        const result = await svc.requestTransition(workflow, runId, to, { workdir: this.opts.cwd });
        if (result.allowed) {
            return { allowed: true, from: result.fromState, to: result.toState };
        }
        return {
            allowed: false,
            from: currentStatus,
            to,
            report: this.formatDenial(result.detail, result.guardReport),
        };
    }

    /** Load + cache the task-lifecycle workflow definition (state-machine). */
    private async loadWorkflow(): Promise<StateMachineWorkflowDef> {
        if (this.workflowCache === undefined) {
            const def = await loadWorkflowDef(this.opts.workflowPath, { validateSchema: false });
            if (def.kind !== 'state-machine') {
                throw new Error(`task-lifecycle workflow must be a state-machine; got "${def.kind}"`);
            }
            this.workflowCache = def;
        }
        return this.workflowCache;
    }

    /** Bind the run's `wbs` var so shell guards (`spur task check ${vars.wbs}`) target this task. */
    private withWbs(workflow: StateMachineWorkflowDef, wbs: string): StateMachineWorkflowDef {
        return { ...workflow, vars: { ...workflow.vars, wbs } };
    }

    /** Compose a human-readable guard report from the engine denial. */
    private formatDenial(detail: string, guardReport: unknown): string {
        if (guardReport === undefined || guardReport === null) return detail;
        const report = typeof guardReport === 'string' ? guardReport : JSON.stringify(guardReport);
        return `${detail} — ${report}`;
    }
}
