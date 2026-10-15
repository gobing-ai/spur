import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerWorkflowCancelCommand } from './cancel';
import { registerWorkflowCleanCommand } from './clean';
import { registerWorkflowContinueCommand } from './continue';
import { registerWorkflowCostCommand } from './cost';
import { registerWorkflowListCommand } from './list';
import { registerWorkflowProgressCommand } from './progress';
import { registerWorkflowRunCommand } from './run';
import { registerWorkflowShowCommand } from './show';
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
