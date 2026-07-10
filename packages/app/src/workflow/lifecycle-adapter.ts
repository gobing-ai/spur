/**
 * Lifecycle engine adapter — bridges `LifecyclePort` to `ts-dual-workflow-engine`.
 *
 * One parameterized adapter drives both the task and feature lifecycles; the only
 * differences are the run-binding kind, workflow name, external-key prefix, and the
 * guard var name. A {@link LifecycleProfile} carries those four values; behaviour is
 * shared (design §5.2 create-or-attach + requestTransition, DD-04 file-wins re-seed,
 * ADR-022 no local FSM fallback — the engine owns the state-machine graph).
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

/**
 * The per-lifecycle configuration that distinguishes task from feature runs.
 * Everything else in {@link LifecycleAdapter} is shared.
 */
export interface LifecycleProfile {
    /** Run-binding kind recorded in `task_run_links` (the generic entity-run link table). */
    linkKind: string;
    /** Workflow definition name (matches the shipped `workflows/<name>.yaml` filename). */
    workflowName: string;
    /** External-key prefix for the durable run binding, e.g. `task` → `task:<id>`. */
    entityPrefix: string;
    /** Workflow var name bound so shell guards (`spur <x> check ${vars.<varKey>}`) target this entity. */
    varKey: string;
}

/** Task lifecycle: run binding `task:<wbs>`, guard var `wbs`. */
export const TASK_LIFECYCLE_PROFILE: LifecycleProfile = {
    linkKind: 'lifecycle',
    workflowName: 'task-lifecycle',
    entityPrefix: 'task',
    varKey: 'wbs',
};

/** Feature lifecycle: run binding `feature:<id>`, guard var `featureId` (DD-13 guards live in the YAML). */
export const FEATURE_LIFECYCLE_PROFILE: LifecycleProfile = {
    linkKind: 'feature-lifecycle',
    workflowName: 'feature-lifecycle',
    entityPrefix: 'feature',
    varKey: 'featureId',
};

/** Options for constructing the lifecycle engine adapter. */
export interface LifecycleAdapterOptions {
    /** Lifecycle profile: task vs feature run binding, workflow, link kind, guard var. */
    profile: LifecycleProfile;
    /** Lazily resolves the DB adapter (engine persistence + task_run_links). */
    getDb(): Promise<DbAdapter>;
    /** Builds the `TaskRunLinkDao` for the given DB adapter. */
    taskRunLinkDao(db: DbAdapter): TaskRunLinkDao;
    /** Absolute path to the `<workflow>.yaml` workflow definition. */
    workflowPath: string;
    /** Working directory passed to shell guards (e.g. `spur task check`). */
    cwd: string;
    /** Resolved path to the spur CLI binary that shell guards invoke.
     *  Injected so guards bypass PATH ambiguity (the `spur` on PATH may be
     *  a different version or compiled without the `task`/`feature` commands). */
    spurBin: string;
}

/**
 * Engine-backed lifecycle port. Validates transitions against the profile's
 * state-machine graph and enforces its guards (e.g. `spur task check` on
 * `wip→testing`, the feature `verifying` guards in DD-13). The file's frontmatter
 * status is the single source of truth (DD-04): before every transition the engine
 * run is re-seeded from the file, so a missing or disagreeing engine state self-heals.
 */
export class LifecycleAdapter implements LifecyclePort {
    private readonly opts: LifecycleAdapterOptions;
    private workflowCache: StateMachineWorkflowDef | undefined;

    constructor(opts: LifecycleAdapterOptions) {
        this.opts = opts;
    }

    /**
     * Request a lifecycle transition through the engine (design §5.2):
     * 1. create-or-attach the durable run `<prefix>:<id>` (R1).
     * 2. record a `task_run_links` row (kind=profile.linkKind) on first attach (R4).
     * 3. file-wins re-seed: force the engine's current state to the file's
     *    `currentStatus` and emit the corrective event (DD-04, R3).
     * 4. `requestTransition(currentStatus → to)`; a denial returns
     *    `{ allowed: false }` with the guard report so the write aborts (R2).
     */
    async requestTransition(ref: EntityRef, currentStatus: string, to: string): Promise<TransitionResult> {
        const { profile } = this.opts;
        const db = await this.opts.getDb();
        const svc = new EngineWorkflowService(createDefaultWorkflowEngineHost(), new DbWorkflowPersistenceAdapter(db));
        const workflow = this.bindGuardVar(await this.loadWorkflow(), ref.id);
        const externalKey = `${profile.entityPrefix}:${ref.id}`;
        const now = new Date().toISOString();

        // ── P2: provenance gate — task transitions to `done` must have a
        // pipeline run recorded (or an explicit auditable bypass) ──
        if (to === 'done' && profile.entityPrefix === 'task') {
            const links = await this.opts.taskRunLinkDao(db).listByWbs(ref.id, 20);
            const hasPipelineRun = links.some((l) => l.kind === 'pipeline');
            const hasPriorBypass = links.some((l) => l.kind === 'provenance_bypass');
            if (!hasPipelineRun && !hasPriorBypass) {
                if (process.env.SPUR_PROVENANCE_OVERRIDE === '1') {
                    await this.opts.taskRunLinkDao(db).insert({
                        id: createId('trl'),
                        wbs: ref.id,
                        run_id: 'manual',
                        kind: 'provenance_bypass',
                        created_at: now,
                    });
                } else {
                    return {
                        allowed: false,
                        from: currentStatus,
                        to,
                        report:
                            `No pipeline run recorded for ${ref.id}. Run the pipeline first (` +
                            `spur workflow run task-pipeline.yaml --vars '{"wbs":"${ref.id}"}'), ` +
                            'or set SPUR_PROVENANCE_OVERRIDE=1 to bypass (recorded).',
                    };
                }
            }
        }

        // ── R1: create-or-attach the durable named run ──
        const existing = await svc.findRunByKey(profile.workflowName, externalKey);
        const runId = existing?.id ?? createId('run');
        await svc.createOrAttachRun({
            id: runId,
            workflow_name: profile.workflowName,
            mode: 'state-machine',
            status: 'running',
            started_at: existing?.started_at ?? now,
            completed_at: null,
            metadata_json: '{}',
            external_key: externalKey,
        });

        // ── R4: link the lifecycle run to the entity on first attach ──
        if (existing === undefined) {
            await this.opts.taskRunLinkDao(db).insert({
                id: createId('trl'),
                wbs: ref.id,
                run_id: runId,
                kind: profile.linkKind,
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

    /** Load + cache the profile's workflow definition (must be a state-machine). */
    private async loadWorkflow(): Promise<StateMachineWorkflowDef> {
        if (this.workflowCache === undefined) {
            const def = await loadWorkflowDef(this.opts.workflowPath, { validateSchema: false });
            if (def.kind !== 'state-machine') {
                throw new Error(
                    `${this.opts.profile.workflowName} workflow must be a state-machine; got "${def.kind}"`,
                );
            }
            this.workflowCache = def;
        }
        return this.workflowCache;
    }

    /** Bind the run's guard var (e.g. `wbs`/`featureId`) so shell guards target this entity. */
    private bindGuardVar(workflow: StateMachineWorkflowDef, id: string): StateMachineWorkflowDef {
        return {
            ...workflow,
            vars: { ...workflow.vars, [this.opts.profile.varKey]: id, spurBin: this.opts.spurBin },
        };
    }

    /** Compose a human-readable guard report from the engine denial. */
    private formatDenial(detail: string, guardReport: unknown): string {
        if (guardReport === undefined || guardReport === null) return detail;
        const report = typeof guardReport === 'string' ? guardReport : JSON.stringify(guardReport);
        return `${detail} — ${report}`;
    }
}
