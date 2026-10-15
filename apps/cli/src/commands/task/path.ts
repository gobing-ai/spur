import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task path`. */
export function registerTaskPathCommand(task: Command, context: CliContext): void {
    // ── path ──
    task.command('path')
        .summary('Resolve a WBS to its absolute task file path.')
        .argument('<wbs>', 'Task WBS number')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const filePath = await svc.getFilePath(wbs);
                if (filePath !== null) {
                    if (options.json) {
                        context.output.write(toEnvelopeJson({ wbs, filePath }, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(filePath);
                    }
                } else {
                    writeJsonError(context.output, options, `Task ${wbs} not found`, 'NOT_FOUND');
                    context.setExitCode(1);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
