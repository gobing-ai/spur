/**
 * Feature lifecycle engine adapter — bridges `LifecyclePort` to `ts-dual-workflow-engine`.
 *
 * The feature sibling of `LifecycleAdapter` (0055). Design §5.2: run binding
 * `feature:<id>`, create-or-attach, requestTransition. DD-04: file-wins
 * rehydration. The `verifying` guards (DD-13) live in `feature-lifecycle.yaml`:
 * `active→verifying` warns via `spur feature check` (non-blocking), `verifying→done`
 * gates on `spur feature check --strict`, `verifying→active` is rework (mandatory
 * History entry via the write-service step 7).
 *
 * Feature status vocabulary: backlog → active → verifying → done (+ blocked/cancelled).
 *
 * Upstream gate cleared: `@gobing-ai/ts-dual-workflow-engine` ≥0.3.17 ships
 * `createOrAttachRun` (E1) + `requestTransition` / `reseedRun` (E2).
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

/** Run-binding kind recorded in `task_run_links` (reused as the generic entity-run link table). */
const LIFECYCLE_LINK_KIND = 'feature-lifecycle';

/** Workflow definition name (matches `config/workflows/feature-lifecycle.yaml`). */
const FEATURE_LIFECYCLE_WORKFLOW = 'feature-lifecycle';

/** Options for constructing the feature lifecycle engine adapter. */
export interface FeatureLifecycleAdapterOptions {
    /** Lazily resolves the DB adapter (engine persistence + run links). */
    getDb(): Promise<DbAdapter>;
    /** Builds the `TaskRunLinkDao` (generic entity-run link table) for the given DB adapter. */
    taskRunLinkDao(db: DbAdapter): TaskRunLinkDao;
    /** Absolute path to the `feature-lifecycle.yaml` workflow definition. */
    workflowPath: string;
    /** Working directory passed to shell guards (e.g. `spur feature check`). */
    cwd: string;
}

/**
 * Engine-backed lifecycle port for features. Validates transitions against the
 * `feature-lifecycle` state-machine graph and enforces its guards (DD-13). The
 * file's frontmatter status is the SSOT (DD-04): before every transition the
 * engine run is re-seeded from the file, so a missing/disagreeing state self-heals.
 */
export class FeatureLifecycleAdapter implements LifecyclePort {
    private readonly opts: FeatureLifecycleAdapterOptions;
    private workflowCache: StateMachineWorkflowDef | undefined;

    constructor(opts: FeatureLifecycleAdapterOptions) {
        this.opts = opts;
    }

    /**
     * Request a feature lifecycle transition through the engine (design §5.2):
     * 1. create-or-attach the durable run `feature:<id>` (R1).
     * 2. record a `task_run_links` row (kind=feature-lifecycle) on first attach.
     * 3. file-wins re-seed from the file's `currentStatus` (DD-04).
     * 4. `requestTransition`; a denial returns `{ allowed: false }` with the guard
     *    report so the write aborts (R1). `verifying` guards (DD-13) live in the YAML.
     */
    async requestTransition(ref: EntityRef, currentStatus: string, to: string): Promise<TransitionResult> {
        const db = await this.opts.getDb();
        const svc = new EngineWorkflowService(createDefaultWorkflowEngineHost(), new DbWorkflowPersistenceAdapter(db));
        const workflow = this.withFeatureId(await this.loadWorkflow(), ref.id);
        const externalKey = `feature:${ref.id}`;
        const now = new Date().toISOString();

        // ── R1: create-or-attach the durable named run ──
        const existing = await svc.findRunByKey(FEATURE_LIFECYCLE_WORKFLOW, externalKey);
        const runId = existing?.id ?? createId('run');
        await svc.createOrAttachRun({
            id: runId,
            workflow_name: FEATURE_LIFECYCLE_WORKFLOW,
            mode: 'state-machine',
            status: 'running',
            started_at: existing?.started_at ?? now,
            completed_at: null,
            metadata_json: '{}',
            external_key: externalKey,
        });

        // ── Link the lifecycle run to the feature on first attach ──
        if (existing === undefined) {
            await this.opts.taskRunLinkDao(db).insert({
                id: createId('trl'),
                wbs: ref.id,
                run_id: runId,
                kind: LIFECYCLE_LINK_KIND,
                created_at: now,
            });
        }

        // ── DD-04: file wins — re-seed the engine from the file status ──
        await svc.reseedRun(workflow, runId, currentStatus);

        // ── R1: request the transition; map the engine result to the port ──
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

    /** Load + cache the feature-lifecycle workflow definition (state-machine). */
    private async loadWorkflow(): Promise<StateMachineWorkflowDef> {
        if (this.workflowCache === undefined) {
            const def = await loadWorkflowDef(this.opts.workflowPath, { validateSchema: false });
            if (def.kind !== 'state-machine') {
                throw new Error(`feature-lifecycle workflow must be a state-machine; got "${def.kind}"`);
            }
            this.workflowCache = def;
        }
        return this.workflowCache;
    }

    /** Bind the run's `featureId` var so shell guards (`spur feature check ${vars.featureId}`) target this feature. */
    private withFeatureId(workflow: StateMachineWorkflowDef, featureId: string): StateMachineWorkflowDef {
        return { ...workflow, vars: { ...workflow.vars, featureId } };
    }

    /** Compose a human-readable guard report from the engine denial. */
    private formatDenial(detail: string, guardReport: unknown): string {
        if (guardReport === undefined || guardReport === null) return detail;
        const report = typeof guardReport === 'string' ? guardReport : JSON.stringify(guardReport);
        return `${detail} — ${report}`;
    }
}
