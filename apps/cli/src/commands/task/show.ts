import type { Command } from '@commander-js/extra-typings';
import { taskStatusIcon } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task show`. */
export function registerTaskShowCommand(task: Command, context: CliContext): void {
    // ── show ──
    task.command('show')
        // `get` alias (0534 R1): agents reach for `get` (6 live invocations in feature A
        // forensics); Commander's lexical suggester cannot bridge get→show (edit distance),
        // so an alias is the only close. One help entry, one code path.
        .alias('get')
        .summary('Show a task by WBS.')
        .argument('<wbs>', 'Task WBS number')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.show(wbs);
                if (options.json) {
                    const { frontmatter, ...rest } = result;
                    context.output.write(toEnvelopeJson({ ...rest, frontmatter }, { enveloped: options.jsonEnvelope }));
                } else {
                    context.output.write(
                        `${taskStatusIcon(result.status)} ${result.status.toUpperCase()} — ${result.wbs}\n\n${result.content}`,
                    );
                }
            } catch (err) {
                const cliCode = (err as { cliCode?: string } | null)?.cliCode;
                writeJsonError(
                    context.output,
                    options,
                    String(err),
                    'INTERNAL_ERROR',
                    cliCode !== undefined ? { cliCode } : undefined,
                );
                context.setExitCode(1);
            }
        });
}
