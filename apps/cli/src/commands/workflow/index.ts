import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerWorkflowCancelCommand } from './cancel';
import { registerWorkflowCleanCommand } from './clean';
import { registerWorkflowCommitGuardCommand } from './commit-guard';
import { registerWorkflowContinueCommand } from './continue';
import { registerWorkflowCostCommand } from './cost';
import { registerWorkflowInlineCommand } from './inline';
import { registerWorkflowListCommand } from './list';
import { registerWorkflowProfileCommand } from './profile';
import { registerWorkflowProgressCommand } from './progress';
import { registerWorkflowRunCommand } from './run';
import { registerWorkflowShowCommand } from './show';
import { registerWorkflowSummaryCommand } from './summary';
import { registerWorkflowTraceCommand } from './trace';
import { registerWorkflowValidateCommand } from './validate';

/** Register `spur workflow` commands. */
export function registerWorkflowCommand(program: Command, context: CliContext): void {
    const workflow = program.command('workflow').summary('validate and execute workflow YAML files');
    registerWorkflowValidateCommand(workflow, context);
    registerWorkflowRunCommand(workflow, context);
    registerWorkflowContinueCommand(workflow, context);
    registerWorkflowCleanCommand(workflow, context);
    registerWorkflowCancelCommand(workflow, context);
    registerWorkflowListCommand(workflow, context);
    registerWorkflowShowCommand(workflow, context);
    registerWorkflowTraceCommand(workflow, context);
    registerWorkflowProgressCommand(workflow, context);
    // Run measurement read-outs absorbed from the plugin scripts (script-absorption PR-6).
    registerWorkflowSummaryCommand(workflow, context);
    registerWorkflowProfileCommand(workflow, context);
    // The inline driver's transports (PR-4). Real invocations take the boot-free early dispatch in
    // `index.ts`; mounting them here keeps them in `spur workflow --help` and the full tree.
    registerWorkflowInlineCommand(workflow, context);
    registerWorkflowCommitGuardCommand(workflow, context);
    registerWorkflowCostCommand(workflow, context);
}

export { waitForResumeClaim } from './continue';
export {
    existingRunRefusal,
    existingWorkflowRun,
    expectedDigestMismatch,
    InvalidRunIdError,
    submitSteeringLine,
    validateRunId,
    WORKFLOW_RUN_ACTIVE_ENV,
    waitForRunRegistration,
    writeWorkflowPlanArtifact,
} from './run';
export { asyncRegisterTimeoutMs, workflowPlanArtifactPath } from './shared';
export { followRunLog, followTrace, formatActionCost, formatTraceTimeline } from './trace';
export { formatWorkflowVersion } from './validate';
