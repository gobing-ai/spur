/**
 * `spur workflow profile <workflow>` — read-only per-node step profile across the last N runs
 * (runs, executions, p50/max durations, idle gaps, cache hits) with the §10 cache-window flags,
 * for `sp:spur-doctor`. Absorbed from the retired `plugins/sp/scripts/workflow-step-profile.ts`
 * (script-absorption PR-6). Thin adapter over `@gobing-ai/spur-app/step-profile-cli`.
 */
import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { resolveSpurArgv, resolveSpurBin } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';
import { writeStepText } from '../task/step-output';

/** Register `spur workflow profile`. */
export function registerWorkflowProfileCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('profile')
        .summary('Per-node step profile of a workflow’s last N runs (read-only evidence)')
        .description(
            [
                'Profile the last N done runs of <workflow> from `spur workflow trace`: per node and action kind',
                'it reports runs, executions, p50/max durationMs, p50 idle gap, session mode and cacheHit p50',
                'with coverage, then flags the cache-window budgets. Unknown evidence is `?`/null, never 0.',
                'Exit: 0 profile produced (flags included), 1 a spur call failed or its JSON did not parse.',
            ].join('\n'),
        )
        .argument('<workflow>', 'workflow name')
        .option('--last <n>', 'number of recent done runs to sample (default 20)')
        .option('--window <sec>', 'cache window W in seconds (default 300)')
        .option('--spur-bin <cmd>', 'spur invocation for the trace reads (default: this spur)')
        .option(...SHARED_OPTIONS.json)
        .action(async (name, options) => {
            const { runStepProfileCli } = await import('@gobing-ai/spur-app/step-profile-cli');
            const argv: string[] = [name];
            if (options.last !== undefined) argv.push('--last', options.last);
            if (options.window !== undefined) argv.push('--window', options.window);
            if (options.spurBin !== undefined) argv.push('--spur-bin', options.spurBin);
            if (options.json === true) argv.push('--json');
            const result = runStepProfileCli(argv, resolveSpurBin(), resolveSpurArgv());
            writeStepText(context.output, 'stdout', result.stdout);
            writeStepText(context.output, 'stderr', result.stderr);
            context.setExitCode(result.exitCode);
        });
}
