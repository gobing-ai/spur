import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task refresh`. */
export function registerTaskRefreshCommand(task: Command, context: CliContext): void {
    // ── refresh ──
    task.command('refresh')
        .summary('Re-scan the task corpus and report counts (kanban.md retired — A17 cutover).')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.refresh();
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else {
                    context.output.write(`Corpus scanned — ${result.tasks} tasks across ${result.folders} folder(s)`);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
