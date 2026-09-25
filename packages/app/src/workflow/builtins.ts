import type { ArtifactDao, DbAdapter } from '@gobing-ai/spur-domain';
import type { DecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { HitlResponder, WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import type { AgentService } from '../services/agent-service';
import type { RuleService } from '../services/rule-service';
import { AgentRunActionRunner, type AgentRunAgentConfig } from './actions/agent-run';
import { CommandGateActionRunner } from './actions/command-gate';
import { type DecideActionDeps, DecideActionRunner } from './actions/decide';
import { DoctorProbeActionRunner } from './actions/doctor-probe';
import { FileExistsActionRunner } from './actions/file-exists';
import { FileReadActionRunner } from './actions/file-read';
import { FileReadIntoVarActionRunner } from './actions/file-read-into-var';
import { HitlConfirmActionRunner } from './actions/hitl-confirm';
import { HitlInputActionRunner } from './actions/hitl-input';
import { HitlSelectActionRunner } from './actions/hitl-select';
import { type HostAllowlist, HttpRequestActionRunner, type HttpRequester } from './actions/http-request';
import { ProofFingerprintActionRunner } from './actions/proof-fingerprint';
import { ResponseValidateActionRunner, type ResponseValidateEngine } from './actions/response-validate';
import { RuleCheckActionRunner } from './actions/rule-check';
import { RunArtifactActionRunner } from './actions/run-artifact';
import { StreamingShellActionRunner } from './actions/shell';
import type { DecisionEvaluator } from './decision-hitl-responder';
import type { FleetDispatchDeps } from './fleet-dispatch';
import { ContractViolationGuardRunner } from './guards/contract-violation';
import { EnvShellGuardRunner } from './guards/shell';
import type { WorkflowObservabilityBus } from './observability';
import type { WorkflowSteeringController } from './steering';
/** Dependencies injected into spur-specific built-in action runners. */
export interface SpurWorkflowBuiltinsOptions {
    agentService: AgentService;
    ruleService: RuleService;
    hitlResponder: HitlResponder;
    fileSystem?: FileSystem;
    httpRequester?: HttpRequester;
    hostAllowlist?: HostAllowlist;
    responseValidateEngine?: ResponseValidateEngine;
    observabilityBus?: WorkflowObservabilityBus;
    steeringController?: WorkflowSteeringController;
    /** Process executor for shell actions (task 0421 R9). Defaults to a fresh NodeProcessExecutor. */
    processExecutor?: ProcessExecutor;
    /** Agent config slice injected at composition root (R1, task 0451). */
    agentConfig?: AgentRunAgentConfig;
    /** Database getter for database-backed builtins (run.artifact). */
    getDb?: () => Promise<DbAdapter>;
    /** Artifact DAO for artifact actions. */
    artifactDao?: ArtifactDao;
    /** Configured secret values redacted from streamed shell output (0901 R5). */
    secretValues?: readonly string[];
    /** Application-owned decision evaluator for explicit never/evidence HITL modes (0911). */
    decisionEvaluator?: DecisionEvaluator;
    /** `workflow.decideDecisionMaker` switch for the non-pausing decide action (0941 R4). Default false. */
    decideDecisionMaker?: boolean;
    /** Optional provider factory for the decide action backend (0941 R4); defaults to the shared lazy maker. */
    decideMaker?: () => Promise<DecisionMaker>;
    /** Fleet executor deps for `agent.run` (0942/ADR-126). Absent = a selected fleet surface fails 'not wired'. */
    fleetDispatchDeps?: FleetDispatchDeps;
}

/** Register all spur-specific built-in action runners on a workflow host. */
export function registerSpurBuiltins(host: WorkflowEngineHost, options: SpurWorkflowBuiltinsOptions): void {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    host.registerAction(
        new AgentRunActionRunner(
            options.agentService,
            options.observabilityBus,
            options.steeringController,
            options.agentConfig,
            options.fleetDispatchDeps,
        ),
        'builtin',
    );
    // Streaming shell runner — replaces the engine's buffered shell runner by kind.
    // When `createDefaultWorkflowEngineHost` supplied a processExecutor it is
    // forwarded here; otherwise a fresh default keeps the streaming contract.
    host.registerAction(
        new StreamingShellActionRunner(
            options.processExecutor ?? new NodeProcessExecutor(),
            options.observabilityBus,
            options.secretValues ?? [],
        ),
        'builtin',
    );
    // Env-var shell guard — replaces the engine's `shell` guard by kind, so guard commands
    // reference vars as `$NAME` instead of having values embedded in the command string
    // (task 0435; the guard-side counterpart to the action handoff in task 0432).
    host.registerGuard(new EnvShellGuardRunner(options.processExecutor ?? new NodeProcessExecutor()), 'builtin');
    // Contract-violation guard (ADR-118, task 0871): routes the named third stage
    // outcome to a distinct repair edge. Opt-in per definition — absent an edge
    // the outcome keeps today's behaviour.
    host.registerGuard(new ContractViolationGuardRunner(), 'builtin');
    host.registerAction(new RuleCheckActionRunner(options.ruleService), 'builtin');
    host.registerAction(new FileExistsActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadIntoVarActionRunner(fileSystem), 'builtin');
    host.registerAction(new HitlConfirmActionRunner(options.hitlResponder, options.decisionEvaluator), 'builtin');
    host.registerAction(new HitlSelectActionRunner(options.hitlResponder, options.decisionEvaluator), 'builtin');
    host.registerAction(new HitlInputActionRunner(options.hitlResponder), 'builtin');
    // Non-pausing decide action (0941, ADR-125): degrades to the declared default whenever the
    // switch is off, no backend is available, the backend fails, or confidence is low — the run
    // never pauses and the action never fails for model problems.
    host.registerAction(
        new DecideActionRunner(fileSystem, {
            enabled: options.decideDecisionMaker === true,
            ...(options.decideMaker !== undefined ? { decisionMaker: options.decideMaker } : {}),
        } satisfies DecideActionDeps),
        'builtin',
    );
    host.registerAction(
        new CommandGateActionRunner(options.processExecutor ?? new NodeProcessExecutor(), fileSystem),
        'builtin',
    );
    // Pre-launch executor doctor probe (task 0608 / D6 R4–R5). Replaces the task-pipeline
    // precheck shell classifier: soft probe that writes PASS/FAIL to a status file under
    // .spur/run/ and always succeeds so transition guards route on the token.
    host.registerAction(
        new DoctorProbeActionRunner(
            options.processExecutor ?? new NodeProcessExecutor(),
            fileSystem,
            options.observabilityBus,
            options.agentService,
        ),
        'builtin',
    );
    host.registerAction(
        new RunArtifactActionRunner(options.getDb, fileSystem, options.artifactDao, options.processExecutor),
        'builtin',
    );
    host.registerAction(
        new ProofFingerprintActionRunner(fileSystem, options.processExecutor, options.observabilityBus),
        'builtin',
    );
    if (options.httpRequester) {
        host.registerAction(
            new HttpRequestActionRunner(options.httpRequester, options.hostAllowlist ?? new Set()),
            'builtin',
        );
    }
    if (options.responseValidateEngine) {
        host.registerAction(new ResponseValidateActionRunner(options.responseValidateEngine), 'builtin');
    }
}
