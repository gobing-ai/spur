import type { HitlResponder, WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { RunOutputSinkConfig } from '../observability/run-output-sink';
import type { AgentService } from '../services/agent-service';
import type { RuleService } from '../services/rule-service';
import { AgentRunActionRunner } from './actions/agent-run';
import { FileExistsActionRunner } from './actions/file-exists';
import { FileReadActionRunner } from './actions/file-read';
import { FileReadIntoVarActionRunner } from './actions/file-read-into-var';
import { HitlConfirmActionRunner } from './actions/hitl-confirm';
import { HitlInputActionRunner } from './actions/hitl-input';
import { HitlSelectActionRunner } from './actions/hitl-select';
import { type HostAllowlist, HttpRequestActionRunner, type HttpRequester } from './actions/http-request';
import { ResponseValidateActionRunner, type ResponseValidateEngine } from './actions/response-validate';
import { RuleCheckActionRunner } from './actions/rule-check';
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
    /** Per-run live output capture bounds (task 0414); when set, agent.run steps write `.spur/run/<runId>-output.log`. */
    outputLog?: RunOutputSinkConfig;
}

/** Register all spur-specific built-in action runners on a workflow host. */
export function registerSpurBuiltins(host: WorkflowEngineHost, options: SpurWorkflowBuiltinsOptions): void {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    host.registerAction(
        new AgentRunActionRunner(
            options.agentService,
            options.observabilityBus,
            options.steeringController,
            options.outputLog,
        ),
        'builtin',
    );
    host.registerAction(new RuleCheckActionRunner(options.ruleService), 'builtin');
    host.registerAction(new FileExistsActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadIntoVarActionRunner(fileSystem), 'builtin');
    host.registerAction(new HitlConfirmActionRunner(options.hitlResponder), 'builtin');
    host.registerAction(new HitlSelectActionRunner(options.hitlResponder), 'builtin');
    host.registerAction(new HitlInputActionRunner(options.hitlResponder), 'builtin');
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
