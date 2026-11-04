import { type Command, Option } from '@commander-js/extra-typings';
import type { BatchPlanRequest } from '@gobing-ai/spur-app/pipeline-steps';
import type { CliContext } from '../../context';
import { writeStepText } from './step-output';

/**
 * Register `spur task batch-plan <waves|order>` and `spur task batch-plan-children` — the
 * letters-first batch plan projection the batch driver publishes (script-absorption PR-5; replaces
 * the plugin script `batch-plan`). Siblings of `task batch-create`.
 */
export function registerTaskBatchPlanCommand(task: Command, context: CliContext): void {
    const run = async (req: BatchPlanRequest): Promise<void> => {
        const { runBatchPlan } = await import('@gobing-ai/spur-app/pipeline-steps');
        const outcome = await runBatchPlan(req, (path) => context.fs.readFile(context.fs.resolve(path)));
        writeStepText(context.output, 'stdout', outcome.stdout);
        writeStepText(context.output, 'stderr', outcome.stderr);
        context.setExitCode(outcome.exitCode);
    };
    const childrenReq = (options: { letter?: string; plan?: string }): BatchPlanRequest => ({
        mode: 'task-children',
        ...(options.letter !== undefined ? { letter: options.letter } : {}),
        ...(options.plan !== undefined ? { plan: options.plan } : {}),
    });

    task.command('batch-plan')
        .summary('Project a task batch: visible plan waves or dependency order.')
        .description(
            [
                'Batch plan projection (JSON on stdout):',
                '  waves --tasks <file>                  {wbs,name}[] → { waves } (A Prepare batch, B..Y tasks, Z report)',
                '  order --tasks <file> [--concurrency n] {wbs,dependencies?,files?}[] → { order, waves, cycle, overlaps, mode, reason }',
                'Exit: 0 success, 1 unreadable/invalid input, 2 usage error.',
            ].join('\n'),
        )
        .argument('<mode>', 'waves | order')
        .option('--tasks <file>', 'tasks JSON file')
        .option('--concurrency <n>', 'parallel slots for order (default 2)')
        // Hidden one-release `task-children` mode shim (task 1290): warns, then runs batch-plan-children.
        .addOption(new Option('--letter <letter>').hideHelp())
        .addOption(new Option('--plan <file>').hideHelp())
        .action(async (mode, options) => {
            if (mode === 'task-children') {
                context.output.error(
                    'spur task batch-plan task-children is deprecated; use spur task batch-plan-children',
                );
                await run(childrenReq(options));
                return;
            }
            await run({
                mode,
                ...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
                ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
            });
        });

    task.command('batch-plan-children')
        .summary('Project one task row’s phase digits from the visible batch plan.')
        .description(
            [
                'Task-row phase digits (JSON on stdout) from a `spur workflow show --format todo --json`',
                'payload or a bare plan array.',
                'Exit: 0 success, 1 unreadable/invalid input, 2 usage error.',
            ].join('\n'),
        )
        .option('--letter <letter>', 'task row letter A-Z')
        .option('--plan <file>', 'todo-format workflow plan payload or bare plan array')
        .allowExcessArguments(false)
        .action((options) => run(childrenReq(options)));
}
