import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature move`. */
export function registerFeatureMoveCommand(feature: Command, context: CliContext): void {
    // ── move ──
    feature
        .command('move')
        .summary('Move a feature to a new parent — cascade rename of the subtree (DD-14).')
        .argument('<id>', 'Feature ID to move')
        .option('--parent <id>', 'New parent feature ID (omit to move to a top-level group)')
        .option(...SHARED_OPTIONS.dryRunFeatureMap)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.move(id, options.parent ?? null, { dryRun: options.dryRun === true });
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else if (result.dryRun) {
                    context.output.write(`Dry run — ${result.movedCount} feature(s) would be re-IDed:`);
                    for (const [oldId, newId] of Object.entries(result.mapping)) {
                        context.output.write(`  ${oldId} → ${newId}`);
                    }
                    context.output.write(`  ${result.tasksUpdated.length} task edge(s) would be updated`);
                } else {
                    context.output.write(
                        `Moved ${result.movedCount} feature(s); ${result.tasksUpdated.length} task edge(s) updated`,
                    );
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
