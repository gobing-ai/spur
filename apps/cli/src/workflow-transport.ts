/**
 * Composition root for the boot-free workflow transports (script-absorption PR-4):
 * `spur workflow commit-guard <op>` and the WT-4 landing verbs `persist-out` / `persist-check`.
 *
 * Like the plugin scripts they replace, they must not create `.spur/spur.db` in the cwd (the app
 * runners open the run-owning trees' database themselves) and must not print the startup banner.
 * So `index.ts` dispatches them before the full boot, and this module is the only place they mount.
 */
import type { Command } from '@commander-js/extra-typings';
import { registerWorkflowCommitGuardCommand } from './commands/workflow/commit-guard';
import { registerWorkflowPersistCommand } from './commands/workflow/persist';
import type { CliContext } from './context';

export { isWorkflowTransportInvocation } from './workflow-transport-argv';

/** Mount the transports under `workflow`. */
export function registerWorkflowTransportCommands(
    workflow: Command,
    context: Pick<CliContext, 'cwd' | 'env' | 'output' | 'setExitCode'>,
): void {
    registerWorkflowCommitGuardCommand(workflow, context);
    registerWorkflowPersistCommand(workflow, context);
}
