// Public API surface for @gobing-ai/spur-app.
// Application-services layer extracted from the CLI command files (tasks 0009–0011).

export type { RuleEvalRunRow, RuleRunRow } from '@gobing-ai/spur-domain';
export {
    type RetroCorrelationReport,
    type RetroCorrelationWindow,
    RetroCorrelator,
} from '@gobing-ai/spur-domain';
export type { PlanningFolders } from './config/planning-folders';
export { resolvePlanningFolders } from './config/planning-folders';
export {
    GuardDeniedError,
    hitlAutoApproveEnabled,
    hitlConfirmDefault,
    LockTimeoutError,
} from './errors';
export {
    type AgentExecutionEvent,
    AgentExecutionLifecycle,
    type AgentExecutionObserver,
    type AgentExecutionOptions,
    type AgentExecutionStartedEvent,
    type AgentRoutingAttribution,
    configuredSecretValues,
    redactAndBound,
} from './observability/agent-execution';
// Canonical escalation packet projection from run evidence (task 0709)
export {
    ESCALATION_PACKET_KIND,
    EscalationPacketSink,
    type EscalationPacketSinkOptions,
} from './observability/escalation-packet-sink';
// Consolidated all-in-one per-run workflow run log (feature D2 / task 0426)
export {
    DEFAULT_RUN_LOG_MAX_BYTES,
    type WorkflowRunLogConfig,
    WorkflowRunLogSink,
} from './observability/workflow-run-log-sink';
export {
    type CliEnvelope,
    type EnvelopeCapableOutput,
    type EnvelopeErrorPayload,
    type EnvelopeOptions,
    envelopeEnabled,
    toEnvelopeError,
    toEnvelopeJson,
    writeJsonError,
} from './output/envelope';
export {
    createFileAgentInstanceStore,
    type RoleTargetResolution,
    resolveAgentSelector,
    resolveRoleTarget,
} from './services/agent-instance-store';
export type {
    AgentConfig,
    AgentExecutorConfig,
    AgentResolveResult,
    AgentResolveSource,
    AgentRoleDefinition,
    AgentRunCaptureResult,
    AgentRunDeps,
    AgentServiceContext,
    AgentServiceOutput,
} from './services/agent-service';
export { _resetAgentServiceShimsForTest, AgentService } from './services/agent-service';
export type {
    AnchorFileReport,
    AnchorQualifyReport,
    QualifiedAnchor,
} from './services/anchor-qualifier';
export {
    anchorQualify,
    buildTrackedBasenameIndex,
    qualifyAnchors,
    qualifySectionBody,
    resolveConfiguredTaskDirs,
} from './services/anchor-qualifier';
export type { BaselineEntry, CorpusCheckResult, CorpusSeverity } from './services/corpus-check';
export {
    baselineSeverity,
    collectObservedFindings,
    loadAcceptedFindings,
    reconcileBaseline,
    resolveFogRange,
    runCorpusCheck,
} from './services/corpus-check';
export type {
    CorpusMigratorOptions,
    FileReport,
    MigrateOptions,
    MigrationFlag,
    MigrationReport,
} from './services/corpus-migrator';
// R3 (0452): CorpusMigrator is @internal — no public CLI surface.
export { CorpusMigrator } from './services/corpus-migrator';
export type {
    GuardInput,
    GuardOutcome,
    VerdictAggregate,
    VerdictArtifact,
    VerdictRowStatus,
} from './services/done-transition-guard';
export {
    computeAggregate,
    evaluateDoneTransition,
    formatDenialMessage,
    formatNoopMessage,
    readVerdictArtifact,
} from './services/done-transition-guard';
export { bridgeEventBus } from './services/event-bridge';
export type {
    SystemEventCatalogEntry,
    SystemEventCatalogMetadata,
    SystemEventMetadataField,
    SystemEventName,
    SystemEventPayloadPolicy,
    SystemEventSource,
    SystemEventTablePresentationInput,
} from './services/event-names';
export {
    buildSystemEventEnvelope,
    humanStepLabel,
    humanWorkflowTitle,
    isSystemEventEnvelopeV2,
    looksLikeOpaqueId,
    normalizeSystemEventPayload,
    PLANNING_EVENT_NAMES,
    projectStoredSystemEventEnvelope,
    projectTablePresentation,
    SYSTEM_EVENT_CATALOG,
    SYSTEM_EVENT_CATALOG_METADATA,
    SYSTEM_EVENT_ENVELOPE_SCHEMA_VERSION,
    SYSTEM_EVENT_NAMES,
    SYSTEM_EVENT_PERSISTED_NAMES,
    SYSTEM_EVENT_PREFIXES,
    SYSTEM_EVENT_STREAMED_NAMES,
    systemEventCatalogEntry,
    systemEventProjectContext,
} from './services/event-names';
export type { FailureRule } from './services/failure-classification';
export { classifyDispatch, permissionFailureEvidence } from './services/failure-classification';
export type {
    CheckFeatureFindings,
    CheckFeatureResult,
    CheckFeatureSeverity,
    FeatureMatrixEntry,
    FeatureSectionMatrix,
} from './services/feature-check';
export { DEFAULT_FEATURE_MATRIX, FeatureCheckService, verdictRowsMatchScenarios } from './services/feature-check';
export type {
    FeatureActionJob,
    FeatureActionName,
    FeatureServiceContext,
    FeatureShowResult,
    FeatureSummary,
    FeatureSyncAllResult,
    FeatureSyncOptions,
    FeatureSyncProposal,
    FeatureSyncResult,
} from './services/feature-service';
export {
    FEATURE_ACTION_COMMANDS,
    FEATURE_ACTION_NAMES,
    FeatureService,
    isFeatureActionName,
} from './services/feature-service';
export {
    ALL_FINDING_CODES,
    FINDING_CODES,
    type FindingCode,
    isFindingCode,
} from './services/finding-codes';
export {
    type HistoryRollupRefreshResult,
    refreshHistoryRollups,
} from './services/history-analysis-service';
export type { HistoryBoardService } from './services/history-board-mock-service';
export { MockHistoryBoardService } from './services/history-board-mock-service';
export { LiveHistoryBoardService, type LiveHistoryBoardServiceOptions } from './services/history-board-service';
export type {
    HistoryRefreshEnqueueOptions,
    HistoryRefreshEnqueueResult,
    HistoryRefreshJobDeps,
    HistoryRefreshPayload,
    HistoryRefreshTriggerConfig,
    HistoryRefreshTriggerPoint,
} from './services/history-refresh-service';
export {
    enqueueHistoryRefresh,
    HISTORY_REFRESH_CONTEXT_ENV,
    HISTORY_REFRESH_JOB,
    handleHistoryRefreshJob,
    parseHistoryRefreshContext,
    validateHistoryRefreshPayload,
} from './services/history-refresh-service';
export type {
    AnalyzeOptions,
    ArtifactResolution,
    DailyOptions,
    DailyResult,
    FanOutResult,
    HistoryAnalyzeResult,
    HistoryImportResult,
    HistoryServiceContext,
    ImportAllOptions,
    RefreshCoverage,
    ResolvedArtifact,
    RunHistoryReportResult,
} from './services/history-service';
export {
    computeExitCode,
    formatIssue,
    HistoryService,
    pruneReports,
    resolveArtifactPath,
    runHistoryReport,
} from './services/history-service';
export type { JobWorkerConsumer, JobWorkerServiceOptions } from './services/job-worker-service';
export { JobHandlerRegistry, JobWorkerService } from './services/job-worker-service';
export type {
    InvokeEventSnapshot,
    OccupantLifecycle,
    OccupantPin,
    OccupantWaitDeps,
    SendWaitUntil,
    WaitErrorCode,
    WaitForOccupantOptions,
    WaitStartSnapshot,
    WaitUntil,
} from './services/occupant-wait';
export {
    DEFAULT_STALL_MS,
    POLL_INTERVAL_MS,
    projectLifecycle,
    satisfies,
    snapshotOccupant,
    WaitError,
    waitForOccupant,
} from './services/occupant-wait';
export type {
    EnsurePipelineRunLinkOptions,
    EnsurePipelineRunLinkResult,
} from './services/pipeline-run-link';
export { ensurePipelineRunLink, TASK_FORWARD_CHAIN } from './services/pipeline-run-link';
export { BusPlanningEventEmitter, type PlanningEventMap } from './services/planning-events';
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
export type {
    OsProcessRow,
    ProcessInspector,
} from './services/process-inspector';
export {
    createPsProcessInspector,
    PS_LIST_ARGV,
    parseEtimeToSeconds,
    parsePsOutput,
    UnsupportedProcessPlatformError,
} from './services/process-inspector';
export type {
    ProcessInventoryRow,
    ProcessInventoryServiceOptions,
    ProcessInventorySnapshot,
    ProcessInventorySource,
    SupervisorOverlayEntry,
} from './services/process-inventory-service';
export { ProcessInventoryService } from './services/process-inventory-service';
export {
    classifyPortBindError,
    isPortAvailable,
    isPortLive,
    normalizeProjectPath,
    type PortProbe,
    type PortProbeResult,
    ProjectRegistry,
    portBindingAvailable,
    probePort,
    setPortProbeForTests,
} from './services/project-registry';
export {
    type DetachedServeChild,
    type DetachedServeSpawn,
    type DetachedServeSpawnOptions,
    type ProjectStartOptions,
    type ProjectStartResult,
    resolveSpurServeCommand,
    setDetachedServeSpawnForTests,
    startRegisteredProject,
} from './services/project-start';
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
    type RuleTraceDetail,
    type RuleTraceEvaluation,
    type RuleTraceRun,
    type RuleValidateOptions,
    type RuleValidateServiceResult as RuleValidateResult,
    type RuleValidateServiceResult,
} from './services/rule-service';
export {
    AGENT_SESSION_SOURCES,
    RunSessionObserver,
    type RunSessionObserverOptions,
    type RunSessionOverlapRegistry,
    type RunSessionWatermark,
} from './services/run-session-observer';
export type {
    RunStoreAction,
    RunStoreDetail,
    RunStoreListEntry,
    RunStoreListQuery,
    RunStoreListResult,
    RunStorePhase,
    RunStoreServiceContext,
    RunStoreTransition,
    RunStoreWbsLink,
} from './services/run-store-service';
export {
    clampRunStoreLimit,
    decodeRunListCursor,
    encodeRunListCursor,
    RUN_STORE_LIST_DEFAULT_LIMIT,
    RUN_STORE_LIST_MAX_LIMIT,
    RUN_STORE_WBS_DEFAULT_LIMIT,
    RUN_STORE_WBS_MAX_LIMIT,
    RunStoreBadCursorError,
    RunStoreNotFoundError,
    RunStoreService,
    summarizeActionResult,
} from './services/run-store-service';
export type {
    ProcessEntry,
    ProcessEventBus,
    ProcessEventPayload,
    ProcessFrame,
    SupervisorOptions,
    SupervisorTeamMemberEventPayload,
} from './services/supervisor-service';
export { SupervisorService } from './services/supervisor-service';
export type { SystemEventEmitterLogger } from './services/system-event-emitter';
export { SystemEventEmitter } from './services/system-event-emitter';
export type {
    SystemEventAction,
    SystemEventActionKind,
    SystemEventCorrelationContext,
    SystemEventEnvelopeV2,
    SystemEventProducerPackage,
    SystemEventProjectContext,
    SystemEventRemediationKind,
    SystemEventSeverity,
} from './services/system-event-envelope';
export {
    FOLLOW_POLL_INTERVAL_MS,
    type FollowSystemEventsOptions,
    followSystemEventsAfter,
} from './services/system-event-follow';
export type { SystemEventRetentionConfig } from './services/system-event-retention';
export {
    DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA,
    resolveRetentionQuotas,
} from './services/system-event-retention';
export {
    extractSystemEventActor,
    extractSystemEventCorrelation,
    type PlanningEventBus,
    registerSystemEventTap,
    type SystemEventBus,
    type SystemEventCorrelation,
    type SystemEventTap,
} from './services/system-event-tap';
export type { AttributeSessionsInput } from './services/task-attribution';
export { attributeSessions } from './services/task-attribution';
export type { CheckFindings, CheckResult as TaskCheckResult, SectionMatrix } from './services/task-check';
export {
    extractReviewSectionBody,
    hasPopulatedPriorityTable,
    TaskCheckService,
} from './services/task-check';
export type { TaskFileHit, TaskFolderSource } from './services/task-locator';
export { TaskLocator } from './services/task-locator';
export type {
    RecordOptions,
    RecordResult,
    VerdictCheck,
    VerdictRequirement,
    VerifyVerdict,
} from './services/task-record';
export {
    isRecordAuthoredReview,
    parseVerdict,
    readVerdict,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
} from './services/task-record';
export type {
    TaskScaffoldContext,
    TaskScaffoldOptions,
    TaskScaffoldResult,
} from './services/task-scaffold';
export { TaskScaffoldService } from './services/task-scaffold';
export type {
    FolderConfig,
    ParentWireResult,
    SectionMutationResult,
    TaskActionJob,
    TaskActionName,
    TaskActionResult,
    TaskFoldersConfig,
    TaskServiceContext,
    TaskShowResult,
    TaskSummary,
} from './services/task-service';
export {
    DependencyMutationError,
    DuplicateFollowUpError,
    SectionMutationError,
    TASK_ACTION_COMMANDS,
    TaskService,
    WbsCollisionError,
} from './services/task-service';
export type { BatchAggregation, BatchTaskOutcome, BatchTaskResult } from './services/task-verdict';
export { aggregateBatchVerdicts, classifyTaskOutcome, deriveVerdict } from './services/task-verdict';
export type {
    AgentSpecInput,
    InboxEntry,
    InboxResult,
    MaterializeResult,
    MessageEndpointIdentity,
    MessageEventBus,
    MessageEventPayload,
    RecentMessageRow,
    RecentMessagesResult,
    SendResult,
    TeamLifecycleEventPayload,
    TeamListing,
    TeamMemberEventPayload,
    TeamServiceContext,
    TeamServiceEventBus,
    TeamServiceOutput,
    TeamStatusEntry,
    TeamStatusResult,
    TeardownResult,
} from './services/team-service';
export { resolveAutostartSet, TeamService } from './services/team-service';
export type {
    TokenLedgerServiceOptions,
    ToolUseEvent,
    ToolUseEventType,
    ToolUseSnapshot,
    ToolUseSnapshotOptions,
} from './services/token-ledger-service';
export {
    clampToolUseLimit,
    parseLedgerLine,
    TOKEN_LEDGER_DEFAULT_LIMIT,
    TOKEN_LEDGER_MAX_LIMIT,
    TOKEN_LEDGER_RELATIVE_PATH,
    TokenLedgerService,
    tailTokenLedgerFile,
} from './services/token-ledger-service';
export type {
    TokenLedgerWatcherOptions,
    TokenLedgerWatchListener,
} from './services/token-ledger-watcher';
export { TokenLedgerWatcher } from './services/token-ledger-watcher';
export type {
    CleanedRun,
    PausedRun,
    TimelineEvent,
    WorkflowAppServiceContext,
    WorkflowCleanResult,
    WorkflowListEntry,
    WorkflowListResult,
    WorkflowRunResult,
    WorkflowTraceEntry,
    WorkflowTraceFilter,
    WorkflowTraceListResult,
    WorkflowTraceTimeline,
    WorkflowValidateResult,
} from './services/workflow-service';
export {
    resolveOutputLogConfig,
    resolveWorkflowFile,
    resolveWorkflowLogRetentionDays,
    WorkflowAppService,
} from './services/workflow-service';
export { AgentRunActionRunner } from './workflow/actions/agent-run';
export { CommandGateActionRunner, type CommandGateOptions } from './workflow/actions/command-gate';
export { FileExistsActionRunner } from './workflow/actions/file-exists';
export { FileReadActionRunner } from './workflow/actions/file-read';
export { FileReadIntoVarActionRunner } from './workflow/actions/file-read-into-var';
export { HitlConfirmActionRunner } from './workflow/actions/hitl-confirm';
export { HitlInputActionRunner } from './workflow/actions/hitl-input';
export {
    ResponseValidateActionRunner,
    type ResponseValidateEngine,
    type ResponseValidateResult,
} from './workflow/actions/response-validate';
export { RuleCheckActionRunner } from './workflow/actions/rule-check';
export { RunArtifactActionRunner, type RunArtifactOptions } from './workflow/actions/run-artifact';
// Workflow built-in action runners
export { registerSpurBuiltins, type SpurWorkflowBuiltinsOptions } from './workflow/builtins';
export {
    type CompositionCheckDiff,
    type CompositionCheckResult,
    canonicalJsonStringify,
    checkWorkflowComposition,
    computeDefinitionDigest,
    extractResolvedWorkflowFacts,
    type WorkflowActionBaseline,
    type WorkflowCompositionBaseline,
    type WorkflowEntryBaseline,
} from './workflow/composition-baseline';
export {
    buildEscalationPacket,
    decisionKindForGate,
    ESCALATION_PACKET_SCHEMA_VERSION,
    type EscalationDecisionKind,
    type EscalationPacket,
    escalationFingerprint,
    extractProofDigest,
    renderEscalationMarkdown,
} from './workflow/escalation-packet';
export {
    type FinalizeIdeaHandoffOptions,
    type FinalizeIdeaHandoffResult,
    finalizeIdeaHandoff,
} from './workflow/idea-handoff';
export {
    type IdeaHandoffCliEnv,
    type IdeaHandoffCliOutcome,
    runIdeaHandoffCli,
} from './workflow/idea-handoff-cli';
export {
    FEATURE_LIFECYCLE_PROFILE,
    LifecycleAdapter,
    type LifecycleAdapterOptions,
    type LifecycleProfile,
    TASK_LIFECYCLE_PROFILE,
} from './workflow/lifecycle-adapter';
// Workflow observability — per-step event stream for the board / live consumers
export {
    createWorkflowEventIdentity,
    decorateWorkflowEvent,
    ObservableWorkflowAdapter,
    type WorkflowActionFinishedEvent,
    type WorkflowActionMetadata,
    type WorkflowActionStartedEvent,
    type WorkflowEventIdentity,
    type WorkflowObservabilityBus,
    type WorkflowObservabilityEventMap,
    type WorkflowPhaseEvent,
    type WorkflowRunFinalizedEvent,
    type WorkflowRunStartedEvent,
    type WorkflowTransitionEvent,
} from './workflow/observability';
export {
    type FollowWorkflowProgressOptions,
    followWorkflowProgress,
    getLatestSystemEventSequence,
} from './workflow/progress-follow';
export {
    type ProjectWorkflowProgressOptions,
    projectWorkflowProgress,
    type WorkflowActionAttempt,
    type WorkflowActionProgress,
    type WorkflowArtifactRef,
    type WorkflowNextTransition,
    type WorkflowProgressDiagnostic,
    type WorkflowProgressProjection,
    type WorkflowStateProgress,
    type WorkflowTransitionProgress,
} from './workflow/progress-projection';
export {
    type ComputeProofInputOptions,
    computeProofInputFingerprint,
    createGitAlternateTree,
    extractFeatureProofData,
    extractTaskProofData,
    type FeatureProofData,
    ProofInputFingerprint,
    type TaskProofData,
} from './workflow/proof-input-fingerprint';
export {
    parseSteeringPolicy,
    type SteeringAck,
    type SteeringActionPolicy,
    type SteeringCommand,
    type SteeringDecision,
    type SteeringOperation,
    type SteeringRetryPolicy,
    type SteeringSnapshot,
    type SteeringState,
    WorkflowSteeringController,
} from './workflow/steering';
// Workflow step reporter — pure event→line / def→plan formatters for CLI progress (0114)
export {
    buildWorkflowSteps,
    renderActionHeartbeat,
    renderRunPlan,
    renderStepLine,
    renderWorkflowTodo,
    type StepEvent,
    type StepLineRenderer,
    type StepRenderOptions,
    type WorkflowOutputDetail,
    type WorkflowStep,
} from './workflow/step-reporter';
export { WorkflowTraceWriter } from './workflow/trace-writer';
