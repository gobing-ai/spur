import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature create`. */
export function registerFeatureCreateCommand(feature: Command, context: CliContext): void {
    // ── create ──
    feature
        .command('create')
        .summary('Create a feature; allocates a hierarchical ID (DD-14) under the create-lock.')
        .argument('<name>', 'Feature name')
        .option('--parent <id>', 'Parent feature ID (child gets the next free digit 1-9)')
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (name, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.create(name, options.parent);
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else {
                    context.output.write(`Created feature ${result.ref.id}: ${result.ref.filePath}`);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
