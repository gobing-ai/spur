import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task resolve`. */
export function registerTaskResolveCommand(task: Command, context: CliContext): void {
    // ── resolve ──
    task.command('resolve')
        .summary('Resolve a file path to its owning task WBS.')
        .argument('<file-path>', 'File path to resolve')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.strictTaskPath)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (filePath, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.resolve(filePath, { strict: options.strict === true });
                if (result) {
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(`${result.wbs}  ${result.filePath}`);
                    }
                } else {
                    writeJsonError(context.output, options, `No owning task found for ${filePath}`, 'NOT_FOUND');
                    context.setExitCode(1);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
