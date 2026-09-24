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
    type TransitionDenied,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { EntityRef, LifecyclePort, TransitionResult } from '../services/planning-write-service';
import { extractReviewSectionBody, hasPopulatedPriorityTable } from '../services/task-check';
import { createRunLogTraceFailureRecorder, withActionTrace } from './action-trace';
import { StreamingShellActionRunner } from './actions/shell';
import { EnvShellGuardRunner } from './guards/shell';

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
    /**
     * Optional loader for task markdown used by the in-process Review L3 done-gate
     * (task 0278 R1). When omitted, the adapter reads `ref.filePath` from disk.
     * Return `null` to skip the content gate (shell `task check --strict-core` still runs).
     * Tests inject synthetic bodies without touching the filesystem.
     */
    readTaskMarkdown?: (ref: EntityRef) => Promise<string | null>;
    /**
     * Opt-in audited bypass of the P2 provenance gate (task 0902 wave 2; was the
     * `SPUR_PROVENANCE_OVERRIDE` env var). When `true`, a `* → done` transition with no
     * pipeline run records a `provenance_bypass` link instead of denying; the bypass
     * stays recorded and audited exactly as before. Absent/false keeps the gate strict.
     */
    provenanceBypass?: boolean;
    /**
     * Run the target state's `onEnter` shell actions after the engine accepts the hop
     * and before the file write is allowed (0948 AC1). The engine's external
     * `requestTransition` commits the hop and does not execute `onEnter`; feature
     * lifecycle's verifying caller is that shell. Default true. Fixture guard tests
     * set false so they do not start the repo-wide pass.
     */
    runEnterActions?: boolean;
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
        // The lifecycle workflows' shell guards reference vars by name (`$featureId`) rather than
        // embedding resolved values in the command string (task 0435). That handoff lives in
        // Spur's guard runner, so this host must register it — the engine's default guard spawns
        // with no `env`, which would expand every `$NAME` to empty and deny every transition.
        const host = createDefaultWorkflowEngineHost();
        host.registerGuard(new EnvShellGuardRunner(new NodeProcessExecutor()), 'builtin');
        const persistence = withActionTrace(
            new DbWorkflowPersistenceAdapter(db),
            createRunLogTraceFailureRecorder(this.opts.cwd),
        );
        const svc = new EngineWorkflowService(host, persistence);
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
                if (this.opts.provenanceBypass === true) {
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
                            'or pass --provenance-bypass on `spur task update` to bypass (recorded).',
                    };
                }
            }

            // ── 0278 R1: Review L3 content gate (populated P1–P4 table) ──
            // Defense-in-depth alongside the shell guard
            // `${spurBin} task check ${wbs} --strict-core`. Provenance alone is
            // not enough — 0277 reached done with a prose-only Review when the
            // shell path was unreliable.
            const reviewDenial = await this.checkReviewReadyForDone(ref);
            if (reviewDenial !== null) {
                return {
                    allowed: false,
                    from: currentStatus,
                    to,
                    report: reviewDenial,
                };
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
            // The engine's external hop does not run onEnter. Feature-lifecycle's
            // verifying caller is an onEnter shell (0948 R1/AC1); run it before the
            // file write is allowed. A failure leaves the file at `currentStatus`.
            // The next transition reseeds from that file (DD-04).
            const enterFailure = await this.runTargetEnterActions(workflow, to, runId);
            if (enterFailure !== null) {
                return { allowed: false, from: currentStatus, to, report: enterFailure };
            }
            // F16/F17: finalize the durable run when the entity lands in a terminal-ish
            // resting state so it never reads `running` forever. `done` is deliberately
            // re-enterable in the workflow defs, but a parked entity has no in-flight work; a
            // later reopen (done→wip) flips the run back to `running` below. Engine
            // `WorkflowStatus` has no 'cancelled', so cancelled maps to 'failed' — the
            // run did not conclude normally.
            const terminalStatus = to === 'cancelled' ? 'failed' : to === 'done' ? 'done' : null;
            await persistence.finalizeRun(
                runId,
                terminalStatus ?? 'running',
                // Port takes non-null `completedAt`. On reopen (→ running) the timestamp is
                // the transition time; harmless — consumers gate on `status`, never on
                // `completed_at` (F16/F17 was a status bug, not a timestamp bug).
                new Date().toISOString(),
            );
            return { allowed: true, from: result.fromState, to: result.toState };
        }
        return {
            allowed: false,
            from: currentStatus,
            to,
            report: this.formatDenialWithLegalPaths(result, workflow, currentStatus, ref.id),
        };
    }

    /**
     * Execute the target state's onEnter shell actions with workflow vars exported
     * into the child environment. `$spurBin` stays a shell variable so a multi-word
     * invocation is not pasted into the command string (0948 R1). Returns a denial
     * report, or null when there is nothing to run or every shell exits 0.
     */
    private async runTargetEnterActions(
        workflow: StateMachineWorkflowDef,
        to: string,
        runId: string,
    ): Promise<string | null> {
        if (this.opts.runEnterActions === false) return null;
        const actions = workflow.states.find((state) => state.id === to)?.onEnter ?? [];
        if (actions.length === 0) return null;
        const runner = new StreamingShellActionRunner(new NodeProcessExecutor());
        const vars = workflow.vars ?? {};
        for (const [index, action] of actions.entries()) {
            if (action.kind !== 'shell') {
                return `State "${to}" onEnter[${index}] is kind "${action.kind}"; the lifecycle caller only runs shell onEnter actions.`;
            }
            const command = action.options?.command;
            if (typeof command !== 'string' || command.trim() === '') {
                return `State "${to}" onEnter[${index}] has no shell command.`;
            }
            const result = await runner.execute(
                { ...action.options },
                {
                    runId,
                    workdir: this.opts.cwd,
                    stateOrNodeId: to,
                    vars,
                    env: {},
                },
            );
            if (!result.ok) {
                const stderr = typeof result.data?.stderr === 'string' ? result.data.stderr.trim() : '';
                const tail = stderr.length > 2000 ? stderr.slice(-2000) : stderr;
                const exitCode = result.data?.exitCode ?? 'unknown';
                return [`State "${to}" onEnter shell failed (exit ${String(exitCode)}).`, result.error ?? '', tail]
                    .filter((part) => part !== '')
                    .join(' ');
            }
        }
        return null;
    }

    /**
     * R3 (0692): enrich an engine transition denial with the legal path(s) from
     * the current state and the command that reaches them. A bare
     * "No transition from X to Y" names no remedy; the lifecycle graph in the
     * workflow def does. `no-such-transition` means the target edge is absent,
     * so the legal next states are exactly the workflow's declared `from` edges.
     */
    private formatDenialWithLegalPaths(
        result: TransitionDenied,
        workflow: StateMachineWorkflowDef,
        currentStatus: string,
        id: string,
    ): string {
        const base = this.formatDenial(result.detail, result.guardReport);
        if (result.reason !== 'no-such-transition') return base;
        const legal = workflow.transitions.filter((t) => t.from === currentStatus).map((t) => t.to);
        if (legal.length === 0) return base;
        const command =
            this.opts.profile.entityPrefix === 'feature'
                ? `spur feature sync ${id} (derives the legal hop path)`
                : `spur task update ${id} <legal-status> or \`spur task record ${id} --transition <legal-status>\``;
        return `${base}. Legal path(s) from ${currentStatus}: ${legal.join(' → ')}. Reach them via \`${command}\`.`;
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

    /**
     * In-process Review L3 gate for `testing → done` (task 0278 R1).
     * @returns denial report string, or `null` when the gate passes or is skipped.
     */
    private async checkReviewReadyForDone(ref: EntityRef): Promise<string | null> {
        const markdown = await this.loadTaskMarkdown(ref);
        if (markdown === null) {
            // File unreadable / not injected — shell strict-core still runs.
            return null;
        }
        const reviewBody = extractReviewSectionBody(markdown);
        if (reviewBody === null || !hasPopulatedPriorityTable(reviewBody)) {
            return (
                `Review L3 gate failed for task ${ref.id}: ### Review must contain a populated ` +
                `P1–P4 priority findings table before testing→done (strict-core). ` +
                `Author the table via /sp:dev-review, then re-run the done transition.`
            );
        }
        return null;
    }

    private async loadTaskMarkdown(ref: EntityRef): Promise<string | null> {
        if (this.opts.readTaskMarkdown) {
            return this.opts.readTaskMarkdown(ref);
        }
        try {
            const fs = createNodeFileSystem(this.opts.cwd);
            return await fs.readFile(ref.filePath);
        } catch {
            return null;
        }
    }

    /** Compose a human-readable guard report from the engine denial. */
    private formatDenial(detail: string, guardReport: unknown): string {
        if (guardReport === undefined || guardReport === null) return detail;
        const report = typeof guardReport === 'string' ? guardReport : JSON.stringify(guardReport);
        return `${detail} — ${report}`;
    }
}
