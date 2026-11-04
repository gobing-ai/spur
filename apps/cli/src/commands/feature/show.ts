import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature show`. */
export function registerFeatureShowCommand(feature: Command, context: CliContext): void {
    // ── show ──
    feature
        .command('show')
        // `get` alias (0534 R1): mirrors `task show` — the noun is symmetric (show by id),
        // so the same discovery gap applies.
        .alias('get')
        .summary('Show a feature by ID.')
        .argument('<id>', 'Feature ID')
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.show(id);
                if (result === null) {
                    writeJsonError(context.output, options, `Feature ${id} not found`, 'NOT_FOUND');
                    context.setExitCode(1);
                    return;
                }
                if (options.json) {
                    const { content, ...rest } = result;
                    context.output.write(toEnvelopeJson({ ...rest, content }, { enveloped: options.jsonEnvelope }));
                } else {
                    context.output.write(result.content);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
