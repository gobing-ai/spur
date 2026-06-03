// Public API surface for @gobing-ai/spur-app.
// Application-services layer extracted from the CLI command files (tasks 0009–0011).
export type {
    AgentResolveResult,
    AgentRunDeps,
    AgentServiceContext,
    AgentServiceOutput,
} from './services/agent-service';
export { AgentService } from './services/agent-service';
export type {
    HistoryAnalyzeResult,
    HistoryImportResult,
    HistoryServiceContext,
} from './services/history-service';
export { HistoryService } from './services/history-service';
export {
    type Colorize,
    type FailOnSeverity,
    type RuleEvaluateOptions,
    type RuleEvaluationServiceResult,
    type RuleListEntry,
    type RuleListServiceResult,
    RuleService,
    type RuleServiceContext,
    type RuleServiceOutput,
    type RuleValidateOptions,
    type RuleValidateServiceResult,
} from './services/rule-service';
export type {
    WorkflowAppServiceContext,
    WorkflowListResult,
    WorkflowRunResult,
    WorkflowValidateResult,
} from './services/workflow-service';
export { WorkflowAppService } from './services/workflow-service';
