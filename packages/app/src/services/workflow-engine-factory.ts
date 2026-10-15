import { dirname, relative } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import { ActionRunDao, ArtifactDao, CoordinationRunDao, type RunDefinitionSource } from '@gobing-ai/spur-domain';
import {
    collectWorkflowExtensions,
    createDefaultWorkflowEngineHost,
    DbWorkflowPersistenceAdapter,
    WorkflowService as EngineWorkflowService,
    loadWorkflowExtensionsIntoHost,
    type WorkflowDef,
    type WorkflowEngineHost,
    type WorkflowPersistenceAdapter,
} from '@gobing-ai/ts-dual-workflow-engine';
import type { EventBus } from '@gobing-ai/ts-infra';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { decisionLogSink } from '../decision/decision-log';
import { getDecisionService } from '../decision/decision-service';
import type { SystemEventBus } from '../services/system-event-tap';
import { createRunLogTraceFailureRecorder, withActionTrace } from '../workflow/action-trace';
import { resolveDurableArtifactPath, resolveRunArtifactPath } from '../workflow/actions/run-path';
import { registerSpurBuiltins } from '../workflow/builtins';
import { computeDefinitionDigest } from '../workflow/composition-baseline';
import type { SummaryResolver } from '../workflow/decision-evidence';
import { type DecisionEvaluator, evaluateDecision } from '../workflow/decision-hitl-responder';
import type { FleetDispatchDeps } from '../workflow/fleet-dispatch';
import { ObservableWorkflowAdapter, type WorkflowObservabilityBus } from '../workflow/observability';
import { loadRunCorrelation } from '../workflow/run-correlation';
import type { WorkflowSteeringController } from '../workflow/steering';
import { AgentCoordinationService, type CoordinationEventBus } from './agent-coordination-service';
import { withWorkflowIdentity } from './event-bridge';
import { FleetDispatcher } from './fleet-dispatcher';
import { FleetService } from './fleet-service';
import { withRunIdentityRecording, withSelfPidRecording, workflowVersionLiteral } from './workflow-run-recording';
import type { WorkflowAppServiceContext } from './workflow-service';

/**
 * Builds the engine-side {@link EngineWorkflowService} for {@link WorkflowAppService}: persistence
 * adapters, decision evaluator + decision-log sink, and workflow extension loading. Shared by
 * `workflow run`, `workflow continue`, `workflow validate` and the paused-run lookup.
 */
export class WorkflowEngineFactory {
    constructor(private readonly ctx: WorkflowAppServiceContext) {}

    async createEngineService(
        opts: {
            recordSelfPid?: boolean;
            events?: EventBus<Record<string, (event: unknown) => void>>;
            steeringController?: WorkflowSteeringController;
            /** Workflow def + source file to load YAML extensions from (0533 R1). */
            extensions?: { workflow: WorkflowDef; file: string };
            /** Resolved launch source recorded with the run identity (0784 R1). */
            definitionSource?: RunDefinitionSource;
        } = {},
    ): Promise<EngineWorkflowService> {
        const processExec = this.ctx.processExecutor?.();
        const host = createDefaultWorkflowEngineHost(processExec !== undefined ? { processExecutor: processExec } : {});
        const bus = this.ctx.observabilityBus?.();
        // R1 (0451): load agent config slice at composition root so AgentRunActionRunner
        // receives real config values instead of reading a fake context.config cast.
        // R4 (0451): also inject requireDiff excludeGlobs from all registered task folders
        // + features dir so multi-folder corpus edits never pass the empty-implement gate.
        let agentSlice: {
            default?: string;
            sessionAffinity?: boolean;
            excludeGlobs?: string[];
            secretValues?: readonly string[];
        } = {
            ...(this.ctx.secretValues !== undefined ? { secretValues: this.ctx.secretValues } : {}),
        };
        // A5/ADR-082: the merged config is threaded on the context — no per-slice load.
        // 0799 R3: the launch boundary prefers a fresh merged config so a quota
        // event applied by the updater gates this workflow run immediately.
        const agent =
            this.ctx.reloadAgentConfig !== undefined
                ? (await this.ctx.reloadAgentConfig())?.agent
                : this.ctx.spurConfig?.agent;
        agentSlice = {
            ...agentSlice,
            ...(agent?.default !== undefined ? { default: agent.default } : {}),
            ...(agent?.sessionAffinity !== undefined ? { sessionAffinity: agent.sessionAffinity } : {}),
        };
        try {
            const fs = createNodeFileSystem(this.ctx.cwd);
            const { foldersConfig, featuresDir } = await resolvePlanningFolders(fs);
            const folderGlobs = Object.keys(foldersConfig.folders).map((k) => `${k}/*`);
            agentSlice = {
                ...agentSlice,
                excludeGlobs: [...folderGlobs, `${featuresDir}/*`],
            };
        } catch {
            // keep agent-run defaults (docs/tasks3 + docs/features) when folder resolve fails
        }
        // 0942/ADR-126: the fleet executor surface deps — composed from the same ctx
        // slice the CLI threads (A5/ADR-082). Both services are cheap and lazy (the DB
        // opens on first use); selecting the surface still requires the run var, so an
        // engine host that never opts in keeps today's dispatch behavior byte-for-byte.
        const fleetFs = createNodeFileSystem(this.ctx.cwd);
        const fleetCoordination = new AgentCoordinationService({
            cwd: this.ctx.cwd,
            env: getEnvVars(),
            ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
            ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
            getDb: () => this.ctx.getDb(),
            fs: fleetFs,
            ...(bus !== undefined ? { eventBus: bus as unknown as CoordinationEventBus } : {}),
        });
        const fleetDispatchDeps: FleetDispatchDeps = {
            fleet: new FleetService({
                fs: fleetFs,
                ...(this.ctx.spurConfig !== undefined ? { spurConfig: this.ctx.spurConfig } : {}),
                ...(this.ctx.reloadAgentConfig !== undefined ? { reloadAgentConfig: this.ctx.reloadAgentConfig } : {}),
                openDb: () => this.ctx.getDb(),
            }),
            // G71 R1/R5: the one fleet dispatch primitive — the stage adapter resolves
            // the role + prompt and hands the enqueue and receipt wait to this.
            dispatcher: new FleetDispatcher({
                coordination: fleetCoordination,
                // Lazy: the workflow ctx opens its DB asynchronously, so resolve the
                // adapter per receipt read rather than at composition time.
                runs: {
                    listByMessageId: async (messageId: string) =>
                        new CoordinationRunDao(await this.ctx.getDb()).listByMessageId(messageId),
                },
            }),
            now: () => Date.now(),
        };
        registerSpurBuiltins(host, {
            agentService: this.ctx.agentService(),
            ruleService: this.ctx.ruleService(),
            hitlResponder: this.ctx.hitlResponder(),
            decisionEvaluator: this.buildDecisionEvaluator(bus),
            httpRequester: this.ctx.httpRequester?.(),
            hostAllowlist: this.ctx.hostAllowlist?.(),
            ...(bus !== undefined ? { observabilityBus: bus } : {}),
            ...(processExec !== undefined ? { processExecutor: processExec } : {}),
            ...(opts.steeringController !== undefined ? { steeringController: opts.steeringController } : {}),
            agentConfig: agentSlice,
            getDb: () => this.ctx.getDb(),
            // 0941 R4: decide degrades to its declared default unless the config switch is on.
            decideDecisionMaker: this.ctx.spurConfig?.workflows?.decideDecisionMaker === true,
            // 1100: the workflow caller's decision-log sink — mode/secrets from this
            // caller's own config + env, never the cached DecisionService's state.
            decisionLog: await this.buildDecisionLogSink(),
            // 0941 R4: the backend comes from existing DecisionMaker config when the composition root supplies one.
            ...(this.ctx.decisionMaker !== undefined ? { decideMaker: this.ctx.decisionMaker } : {}),
            // Task 1094: the catalog-reference decide path resolves through the shared service;
            // inline decide options are deprecated through ctx.warn.
            decisionService: () => getDecisionService(this.ctx.spurConfig ?? null, this.ctx.cwd),
            warn: (message: string) => this.ctx.warn?.(message),
            // 0942/ADR-126: the fleet executor surface for `agent.run`.
            fleetDispatchDeps,
            // 0901 R5: configured secrets redact streamed shell output at the
            // emission boundary (bus → CLI logs + system-event ledger).
            ...(this.ctx.secretValues !== undefined ? { secretValues: this.ctx.secretValues } : {}),
        });
        // 0533 R1/R4: register YAML-declared extensions (actions/guards) on the
        // same host run/continue use, before the service is constructed. The
        // shared loader validates relative paths (abs/`..` rejected) and fails
        // closed on a missing or mis-shaped module — before any workflow step.
        if (opts.extensions !== undefined) {
            await this.loadWorkflowExtensions(host, opts.extensions.workflow, opts.extensions.file);
        }
        const db = await this.ctx.getDb();
        // ADR-117 / task 0868: the action-boundary emission is best-effort through the
        // SAME writer the inline driver calls — a persistence failure is recorded to the
        // run log and never wedges the run. The run-row closure (`finalizeRun`) is NOT
        // best-effort: it propagates, so the engine's terminal closure fails loudly as it
        // did before the writer. Pure pass-through otherwise, so engine behavior is
        // unchanged on success.
        let persistence: WorkflowPersistenceAdapter = withActionTrace(
            new DbWorkflowPersistenceAdapter(db),
            createRunLogTraceFailureRecorder(this.ctx.cwd),
        );
        // Async worker: stamp this process's pid onto the run row at creation so
        // `spur workflow cancel` can SIGTERM the live process group.
        if (opts.recordSelfPid === true) {
            persistence = withSelfPidRecording(persistence, db);
        }
        if (opts.extensions !== undefined) {
            // 0768 R1: one identity merge (digest + version literal) at run creation;
            // a merge failure propagates and aborts the run before any action runs.
            // 0784 R1: launch sites additionally pin path/layer/workdir in the same
            // statement so resume can replay the launched definition exactly.
            persistence = withRunIdentityRecording(persistence, db, {
                definitionDigest: computeDefinitionDigest(opts.extensions.workflow),
                workflowVersion: workflowVersionLiteral(opts.extensions.workflow),
                ...(opts.definitionSource !== undefined ? { source: opts.definitionSource } : {}),
            });
        }
        const adapter = bus
            ? new ObservableWorkflowAdapter(
                  persistence,
                  // R3 (0601): decorate the observability bus with workflow identity so
                  // every adapter event carries workflowName + nodeLabel. The def is
                  // available here via the extension registration seam (0533).
                  opts.extensions !== undefined ? withWorkflowIdentity(bus, opts.extensions.workflow) : bus,
              )
            : persistence;
        return new EngineWorkflowService(host, adapter);
    }

    /**
     * Task 1100: the workflow caller's decision-log sink, built from this caller's
     * own config + env (never the cached DecisionService's withConfig state).
     * `decisions.log = 'off'` ⇒ undefined and no rows are written.
     */
    private async buildDecisionLogSink() {
        return decisionLogSink(await this.ctx.getDb(), this.ctx.spurConfig ?? null, getEnvVars());
    }

    /**
     * Application decision evaluator for explicit never/evidence HITL modes (0911). Composes the
     * merged-config activation switch, action-evidence DAO, optional provider factory, configured
     * secrets and the registered-summary artifact resolver. `bus` is the run's observability bus:
     * evidence-mode operator gates decide through the catalog service (1099) and its lifecycle
     * events flow on the same bus with caller `gate`.
     */
    private buildDecisionEvaluator(bus?: WorkflowObservabilityBus): DecisionEvaluator {
        const summary: SummaryResolver = {
            resolve: async (runId, path) => {
                const fs = createNodeFileSystem(this.ctx.cwd);
                let canonicalPath: string | undefined;
                for (const root of ['scratch', 'runs', 'evidence'] as const) {
                    try {
                        canonicalPath =
                            root === 'scratch'
                                ? await resolveRunArtifactPath(fs, this.ctx.cwd, path)
                                : await resolveDurableArtifactPath(fs, this.ctx.cwd, path, root);
                        break;
                    } catch {
                        /* Try the other owned plane; each enforces physical confinement. */
                    }
                }
                if (canonicalPath === undefined) return { ok: false, reason: 'invalid-evidence' };
                const dao = new ArtifactDao(await this.ctx.getDb());
                const registered = await dao.artifactsWithIdByRunId(runId);
                let match = registered.find((row) => row.path === canonicalPath);
                if (match === undefined) {
                    const source = relative(fs.realPath?.(this.ctx.cwd) ?? this.ctx.cwd, canonicalPath);
                    for (const row of registered) {
                        try {
                            const retained = await resolveDurableArtifactPath(fs, this.ctx.cwd, row.path, 'runs');
                            const identity = await resolveDurableArtifactPath(
                                fs,
                                this.ctx.cwd,
                                `${row.path}.source`,
                                'runs',
                            );
                            if ((await fs.readFile(identity)) !== source) continue;
                            canonicalPath = retained;
                            match = row;
                            break;
                        } catch {
                            /* An unproven source cannot satisfy registered-summary evidence. */
                        }
                    }
                }
                if (match === undefined) return { ok: false, reason: 'invalid-evidence' };
                let raw: string;
                try {
                    raw = await fs.readFile(canonicalPath);
                } catch {
                    return { ok: false, reason: 'invalid-evidence' };
                }
                return { ok: true, artifactId: match.id, raw };
            },
        };
        return {
            evaluate: (request, config) =>
                evaluateDecision(request, config, {
                    enabled: this.ctx.spurConfig?.workflows?.hitlDecisionMaker === true,
                    evidence: async (request) =>
                        new ActionRunDao(await this.ctx.getDb()).actionRowsByRunId(request.runId),
                    decisionMaker: this.ctx.decisionMaker,
                    secrets: this.ctx.secretValues,
                    warn: this.ctx.warn,
                    summary,
                    // 1099: evidence-mode confirm gates decide through the catalog decision
                    // `gate-evidence` (same construction the `decision` CLI serves).
                    decisionService: () => getDecisionService(this.ctx.spurConfig ?? null, this.ctx.cwd),
                    // 1100: the gate's decision rows use the workflow service DB — same
                    // caller-config sink as the decide action, resolved lazily per call.
                    decisionLog: async () => await this.buildDecisionLogSink(),
                    // Task 1113 R3: gate events join the run — workflowName from the run
                    // row, wbs from the snapshot's effective vars (never throws).
                    runCorrelation: async (runId) =>
                        loadRunCorrelation(new DbWorkflowPersistenceAdapter(await this.ctx.getDb()), runId),
                    // SAFETY: WorkflowObservabilityBus and SystemEventBus are nominal names over
                    // one structural ts-infra EventBus instance (ADR-044 event bridge), decide.ts.
                    ...(bus !== undefined ? { bus: bus as unknown as SystemEventBus } : {}),
                }),
        };
    }

    /**
     * Load YAML-declared `extensions.actions` / `extensions.guards` modules onto a
     * workflow host (0533 R1). Paths are resolved against the workflow file's own
     * directory; the shared loader rejects absolute paths and `..` traversal and
     * fails closed when a module is missing or lacks the declared capability.
     * The YAML declaration itself is the allowExtensions signal (R3) — a listed
     * extension is always loaded, never silently dropped.
     */
    async loadWorkflowExtensions(host: WorkflowEngineHost, workflow: WorkflowDef, file: string): Promise<void> {
        const refs = collectWorkflowExtensions(workflow.name, dirname(file), workflow.extensions);
        if (refs.length === 0) return;
        const nodeFs = createNodeFileSystem();
        await loadWorkflowExtensionsIntoHost(host, refs, {
            allowExtensions: true,
            moduleLoader: async (absPath) => (await import(absPath)) as Record<string, unknown>,
            realPath: (absPath) => (nodeFs.realPath ? nodeFs.realPath(absPath) : absPath),
        });
    }
}
