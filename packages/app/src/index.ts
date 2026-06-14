// Public API surface for @gobing-ai/spur-app.
// Application-services layer extracted from the CLI command files (tasks 0009–0011).

export type { RuleEvalRunRow, RuleRunRow } from '@gobing-ai/spur-domain';
export type {
    AgentResolveResult,
    AgentRunDeps,
    AgentServiceContext,
    AgentServiceOutput,
} from './services/agent-service';
export { AgentService } from './services/agent-service';
export type {
    CorpusMigratorOptions,
    FileReport,
    MigrateOptions,
    MigrationFlag,
    MigrationReport,
} from './services/corpus-migrator';
export { CorpusMigrator } from './services/corpus-migrator';
export type {
    HistoryAnalyzeResult,
    HistoryImportResult,
    HistoryServiceContext,
} from './services/history-service';
export { HistoryService } from './services/history-service';
export type {
    CapturingEmitter,
    EntityRef,
    EventEmitter,
    LifecyclePort,
    NoopEventEmitter,
    PlanningEvent,
    PlanningEventName,
    PlanningWriteServiceOptions,
    SchemaLifecyclePort,
    TransitionResult,
    WriteResult,
} from './services/planning-write-service';
export { PlanningWriteService } from './services/planning-write-service';
export { type PluginListEntry, PluginService } from './services/plugin-service';
export {
    type Colorize,
    type FailOnSeverity,
    type RuleEvaluateOptions,
    type RuleEvaluationServiceResult as RuleEvaluationResult,
    type RuleEvaluationServiceResult,
    type RuleListEntry,
    type RuleListFileEntry,
    type RuleListPresetEntry,
    type RuleListServiceResult,
    type RuleListServiceResult as RuleListResult,
    RuleService,
    type RuleServiceContext,
    type RuleServiceOutput,
    type RuleValidateOptions,
    type RuleValidateServiceResult as RuleValidateResult,
    type RuleValidateServiceResult,
} from './services/rule-service';
export type { CheckFindings, CheckResult as TaskCheckResult, SectionMatrix } from './services/task-check';
export { TaskCheckService } from './services/task-check';
export type { TaskServiceContext, TaskShowResult, TaskSummary } from './services/task-service';
export { TaskService } from './services/task-service';
export type {
    AgentSpecInput,
    InboxEntry,
    InboxResult,
    SendResult,
    TeamServiceContext,
    TeamServiceOutput,
    TeamStatusEntry,
    TeamStatusResult,
} from './services/team-service';
export { TeamService } from './services/team-service';
export type {
    TimelineEvent,
    WorkflowAppServiceContext,
    WorkflowListEntry,
    WorkflowListResult,
    WorkflowRunResult,
    WorkflowTraceEntry,
    WorkflowTraceFilter,
    WorkflowTraceListResult,
    WorkflowTraceTimeline,
    WorkflowValidateResult,
} from './services/workflow-service';
export { WorkflowAppService } from './services/workflow-service';
export { AgentRunActionRunner } from './workflow/actions/agent-run';
export { FileExistsActionRunner } from './workflow/actions/file-exists';
export { FileReadActionRunner } from './workflow/actions/file-read';
export { HitlConfirmActionRunner } from './workflow/actions/hitl-confirm';
export { HitlInputActionRunner } from './workflow/actions/hitl-input';
export { HitlSelectActionRunner } from './workflow/actions/hitl-select';
export { RuleCheckActionRunner } from './workflow/actions/rule-check';
// Workflow built-in action runners
export { registerSpurBuiltins, type SpurWorkflowBuiltinsOptions } from './workflow/builtins';
