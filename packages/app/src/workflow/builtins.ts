import type { WorkflowEngineHost } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { AgentService } from '../services/agent-service';
import type { RuleService } from '../services/rule-service';
import { AgentRunActionRunner } from './actions/agent-run';
import { FileExistsActionRunner } from './actions/file-exists';
import { FileReadActionRunner } from './actions/file-read';
import { RuleCheckActionRunner } from './actions/rule-check';

/** Dependencies injected into spur-specific built-in action runners. */
export interface SpurWorkflowBuiltinsOptions {
    agentService: AgentService;
    ruleService: RuleService;
    fileSystem?: FileSystem;
}

/** Register all spur-specific built-in action runners on a workflow host. */
export function registerSpurBuiltins(host: WorkflowEngineHost, options: SpurWorkflowBuiltinsOptions): void {
    const fileSystem = options.fileSystem ?? createNodeFileSystem();
    host.registerAction(new AgentRunActionRunner(options.agentService), 'builtin');
    host.registerAction(new RuleCheckActionRunner(options.ruleService), 'builtin');
    host.registerAction(new FileExistsActionRunner(fileSystem), 'builtin');
    host.registerAction(new FileReadActionRunner(fileSystem), 'builtin');
}
