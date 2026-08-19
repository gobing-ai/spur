import type { ArtifactDao, DbAdapter } from '@gobing-ai/spur-domain';
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
import { FileExistsActionRunner } from './actions/file-exists';
import { FileReadActionRunner } from './actions/file-read';
import { FileReadIntoVarActionRunner } from './actions/file-read-into-var';
import { HitlConfirmActionRunner } from './actions/hitl-confirm';
import { HitlInputActionRunner } from './actions/hitl-input';
import { HitlSelectActionRunner } from './actions/hitl-select';
import { type HostAllowlist, HttpRequestActionRunner, type HttpRequester } from './actions/http-request';
import { ResponseValidateActionRunner, type ResponseValidateEngine } from './actions/response-validate';
import { RuleCheckActionRunner } from './actions/rule-check';
import { RunArtifactActionRunner } from './actions/run-artifact';
import { StreamingShellActionRunner } from './actions/shell';
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
        ),
        'builtin',
    );
    // Streaming shell runner — replaces the engine's buffered shell runner by kind.
    // When `createDefaultWorkflowEngineHost` supplied a processExecutor it is
    // forwarded here; otherwise a fresh default keeps the streaming contract.
    host.registerAction(
        new StreamingShellActionRunner(options.processExecutor ?? new NodeProcessExecutor(), options.observabilityBus),
        'builtin',
    );
    // Env-var shell guard — replaces the engine's `shell` guard by kind, so guard commands
    // reference vars as `$NAME` instead of having values embedded in the command string
    // (task 0435; the guard-side counterpart to the action handoff in task 0432).
    host.registerGuard(new EnvShellGuardRunner(options.processExecutor ?? new NodeProcessExecutor()), 'builtin');
    host.registerAction(new RuleCheckActionRunner(options.ruleService), 'builtin');
    host.registerAction(new FileExistsActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadIntoVarActionRunner(fileSystem), 'builtin');
    host.registerAction(new HitlConfirmActionRunner(options.hitlResponder), 'builtin');
    host.registerAction(new HitlSelectActionRunner(options.hitlResponder), 'builtin');
    host.registerAction(new HitlInputActionRunner(options.hitlResponder), 'builtin');
    host.registerAction(
        new CommandGateActionRunner(options.processExecutor ?? new NodeProcessExecutor(), fileSystem),
        'builtin',
    );
    host.registerAction(new RunArtifactActionRunner(options.getDb, fileSystem, options.artifactDao), 'builtin');
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
