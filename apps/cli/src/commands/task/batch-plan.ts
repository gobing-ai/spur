import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { writeStepText } from './step-output';

/**
 * Register `spur task batch-plan <waves|order|task-children>` — the letters-first batch plan
 * projection the batch driver publishes (script-absorption PR-5; replaces the plugin script
 * `batch-plan`). Sibling of `task batch-create`.
 */
export function registerTaskBatchPlanCommand(task: Command, context: CliContext): void {
    task.command('batch-plan')
        .summary('Project a task batch: visible plan waves, dependency order, or a task row’s phase digits.')
        .description(
            [
                'Batch plan projection (JSON on stdout):',
                '  waves --tasks <file>                  {wbs,name}[] → { waves } (A Prepare batch, B..Y tasks, Z report)',
                '  order --tasks <file> [--concurrency n] {wbs,dependencies?,files?}[] → { order, waves, cycle, overlaps, mode, reason }',
                '  task-children --letter <A-Z> --plan <file>  todo --json payload (or bare plan) → phase digits',
                'Exit: 0 success, 1 unreadable/invalid input, 2 usage error.',
            ].join('\n'),
        )
        .argument('<mode>', 'waves | order | task-children')
        .option('--tasks <file>', 'tasks JSON file (waves, order)')
        .option('--concurrency <n>', 'parallel slots for order (default 2)')
        .option('--letter <letter>', 'task row letter A-Z (task-children)')
        .option('--plan <file>', 'todo-format workflow plan payload or bare plan array (task-children)')
        .action(async (mode, options) => {
            const { runBatchPlan } = await import('@gobing-ai/spur-app/pipeline-steps');
            const outcome = await runBatchPlan(
                {
                    mode,
                    ...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
                    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
                    ...(options.letter !== undefined ? { letter: options.letter } : {}),
                    ...(options.plan !== undefined ? { plan: options.plan } : {}),
                },
                (path) => context.fs.readFile(context.fs.resolve(path)),
            );
            writeStepText(context.output, 'stdout', outcome.stdout);
            writeStepText(context.output, 'stderr', outcome.stderr);
            context.setExitCode(outcome.exitCode);
        });
}
