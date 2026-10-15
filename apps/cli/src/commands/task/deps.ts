import type { Command } from '@commander-js/extra-typings';
import { DependencyMutationError } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task deps`. */
export function registerTaskDepsCommand(task: Command, context: CliContext): void {
    // ── deps (task 0303 — CLI-safe dependencies[] mutation) ──
    task.command('deps')
        .summary('Mutate the dependencies[] frontmatter array on a task.')
        .description(
            'Mutate the `dependencies[]` array on an existing task. Operations:\n' +
                '  set <wbs...>     — replace the array with the given WBS values\n' +
                '  add <wbs...>     — append the given values (deduped)\n' +
                '  remove <wbs...>  — drop the given values\n' +
                '  clear            — empty the array\n\n' +
                'Validation: WBS format, existence, self-edge, duplicates, cycle detection, and the ' +
                'ADR-137 freeze (a new edge onto a `deprecated` task is refused) all run BEFORE any write (atomic — R2).\n\n' +
                'Exit codes: 0 success, 1 generic error, 2 usage error, 3 validation error.',
        )
        .argument('<wbs>', 'Task WBS number to mutate')
        .argument('<op>', 'Operation: set | add | remove | clear')
        .argument('[values...]', 'WBS values (required for set/add/remove; forbidden for clear)')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, op, values, options) => {
            const allowedOps = ['set', 'add', 'remove', 'clear'] as const;
            if (!allowedOps.includes(op as (typeof allowedOps)[number])) {
                writeJsonError(
                    context.output,
                    options,
                    `Unknown op "${op}". Allowed: ${allowedOps.join(', ')}.`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const typedOp = op as (typeof allowedOps)[number];
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.mutateDependencies(wbs, typedOp, values);
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else {
                    const list = result.dependencies.length > 0 ? result.dependencies.join(', ') : '(none)';
                    context.output.write(`Set dependencies on task ${result.ref.id}: [${list}]`);
                }
            } catch (err) {
                if (err instanceof DependencyMutationError) {
                    writeJsonError(context.output, options, `[${err.code}] ${err.message}`, 'INTERNAL_ERROR');
                    // usage → 2, all other validation codes → 3
                    context.setExitCode(err.code === 'usage' ? 2 : 3);
                } else {
                    writeJsonError(context.output, options, String(err));
                    context.setExitCode(1);
                }
            }
        });
}
