import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { resolveSpurBin } from '../../workflow/resolve-spur-bin';

/**
 * Register `spur feature handoff [id]` — the idea-pipeline finalization (task 0518/0824): zip the
 * batch item names to the created WBS values, apply `depends_on_names` through `spur task deps`,
 * refresh the feature roster, check every created task and write
 * `.spur/run/<runId>-idea-handoff.md` with exactly one next command (script-absorption PR-5;
 * replaces the plugin script `idea-handoff` and its generated bundle).
 *
 * Thin transport over the app entry `runIdeaHandoffCli`. Exit 0 on success, 1 on any failure,
 * including a missing run id or feature id (fail closed, never a silent skip).
 */
export function registerFeatureHandoffCommand(feature: Command, context: CliContext): void {
    feature
        .command('handoff')
        .summary('Finalize the idea pipeline: task ordering, roster refresh and the handoff report.')
        .description(
            [
                'Reads .spur/run/<runId>-idea-{task-batch,batch-create-result,task-order}.json (and the optional',
                '-idea-ready.json), applies dependencies, refreshes the roster, checks each task and writes',
                '.spur/run/<runId>-idea-handoff.md with one recommended next command.',
                'Exit: 0 success; 1 failure (missing ids or inputs, a mapping or CLI error).',
                'Flags fall back to the workflow env names: featureId, __runId, spurBin.',
            ].join('\n'),
        )
        .argument('[id]', 'Feature ID (env: featureId)')
        .option('--run-id <id>', 'idea-pipeline run id (env: __runId)')
        .option(
            '--spur-bin <cmd>',
            'spur invocation for the nested task/feature calls (env: spurBin; default: this spur)',
        )
        .action(async (id, options) => {
            const { runIdeaHandoffCli } = await import('@gobing-ai/spur-app');
            const env = context.env;
            const outcome = await runIdeaHandoffCli({
                __runId: options.runId ?? env.__runId,
                featureId: id ?? env.featureId,
                spurBin: options.spurBin ?? env.spurBin ?? resolveSpurBin(),
            });
            context.setExitCode(outcome.exitCode);
        });
}
