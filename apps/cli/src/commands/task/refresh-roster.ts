import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur task refresh-roster`. */
export function registerTaskRefreshRosterCommand(task: Command, context: CliContext): void {
    // ── refresh-roster ──
    task.command('refresh-roster')
        .summary("Regenerate a parent task's sub-task roster block in its ## Plan (0121 roll-up gate's generator).")
        .argument('<wbs>', 'Parent task WBS number')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.refreshRoster(wbs);
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else if (!result.written) {
                    context.output.write(`Task ${wbs} has no sub-tasks — nothing to roster.`);
                } else {
                    context.output.write(`Roster refreshed for ${wbs} (${result.childCount} sub-task(s)).`);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
