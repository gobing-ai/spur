/**
 * `@gobing-ai/spur-app/pipeline-steps` — the deterministic pipeline steps behind
 * `spur task wrapup|preflight|batch-plan` (script-absorption plan PR-5).
 *
 * A narrow entry so those CLI verbs load only these modules, not the whole app barrel.
 */

export {
    PREFLIGHT_USAGE,
    type PreflightOutcome,
    type PreflightRequest,
    parseCommaList,
    parseDepStatuses,
    recoveryHint,
    runPreflight,
} from '../services/planning-preflight';
export {
    BATCH_PLAN_MODES,
    BATCH_PLAN_USAGE,
    type BatchPlanOutcome,
    type BatchPlanRequest,
    type ReadInputFile,
    runBatchPlan,
} from './batch-plan';
export {
    changedPathsOf,
    DOC_OWNED_SURFACES,
    type DriftProbeEnv,
    type DriftProbeOptions,
    type DriftProbeResult,
    driftReasonForPath,
    runDriftProbe,
    type SpurRunner,
    type SpurShowResult,
    solutionSectionOf,
} from './wrapup/drift-probe';
export { childEnv, spurCommand } from './wrapup/spur-command';
export {
    DOC_SYNC_SCOPE_STATUS_SUFFIX,
    DOC_SYNC_SNAPSHOT_SUFFIX,
    DOC_SYNC_SUPERSESSION_STATUS_SUFFIX,
    docSyncScopeViolations,
    GIT_UNAVAILABLE_MARKER,
    isDocSyncAllowedPath,
    isWrapupStepOp,
    jqPick,
    porcelainPath,
    resolveTasks,
    runDocSupersessionCheck,
    runDocSyncScope,
    runDocSyncSnapshot,
    runMetrics,
    runWrapupStep,
    SNAPSHOT_MISSING,
    SUPERSESSION_PIN,
    taskStatusOf,
    verdictFromTestingSection,
    WBS_PATTERN,
    WRAPUP_STEP_OPS,
    type WrapupStepOp,
    type WrapupStepsEnv,
    type WrapupStepsOptions,
    writeRouteReason,
} from './wrapup/steps';
