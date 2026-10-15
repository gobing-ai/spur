/**
 * Composition root for the boot-free workflow transports (script-absorption PR-4):
 * `spur workflow inline <op>` and `spur workflow commit-guard <op>`.
 *
 * The inline pipeline driver calls these from inside a worktree many times per run. Like the
 * plugin scripts they replace, they must not create `.spur/spur.db` in the cwd (the app runners
 * open the run-owning tree's database themselves), must not print the startup banner, and must
 * not fail on a config they never read. So `index.ts` dispatches them before the full boot, and
 * this module is the only place they load config (ADR-082: the two ops that need it, `decide` and
 * `dispatch-failure`, get the merged result threaded in) — hence its entry in the
 * `spur-config-loader-only-at-composition-roots` exclude list.
 */
import type { Command } from '@commander-js/extra-typings';
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { registerWorkflowCommitGuardCommand } from './commands/workflow/commit-guard';
import { registerWorkflowInlineCommand, type WorkflowInlineDeps } from './commands/workflow/inline';
import { EMBEDDED_SPUR_SCHEMAS } from './config/embedded-schemas';
import type { CliContext } from './context';

export { isWorkflowTransportInvocation } from './workflow-transport-argv';

/** Mount both transports under `workflow` with the live config loader. */
export function registerWorkflowTransportCommands(
    workflow: Command,
    context: Pick<CliContext, 'cwd' | 'env' | 'output' | 'setExitCode'>,
    deps: WorkflowInlineDeps = {},
): void {
    registerWorkflowInlineCommand(workflow, context, {
        loadConfig: (cwd) => loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }),
        ...deps,
    });
    registerWorkflowCommitGuardCommand(workflow, context);
}
