import type { Command } from '@commander-js/extra-typings';
import type { WriteResult } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature update`. */
export function registerFeatureUpdateCommand(feature: Command, context: CliContext): void {
    // ── update ──
    feature
        .command('update')
        .summary('Update a feature status, scalar frontmatter field, or section body.')
        .argument('<id>', 'Feature ID')
        .argument('[status]', 'New lifecycle status')
        .addHelpText(
            'after',
            [
                'Section names are validated against the closed-world canonical set; a rejected',
                '`--section` costs a failed write. List valid names first:',
                '`spur task sections <wbs> list`.',
            ].join('\n'),
        )
        .option('--field <key>', 'Frontmatter field to set (e.g. priority)')
        .option('--value <value>', 'New value for --field')
        .option(...SHARED_OPTIONS.section)
        .option(...SHARED_OPTIONS.fromFile)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, status, options) => {
            const svc = await makeService(context, options.folder);
            try {
                let result: WriteResult | undefined;
                if (options.section !== undefined) {
                    if (options.fromFile === undefined) {
                        writeJsonError(
                            context.output,
                            options,
                            '--from-file is required with --section',
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    result = await svc.updateSection(id, options.section, options.fromFile);
                    if (!options.json) {
                        for (const warning of result.warnings ?? []) {
                            context.output.error(warning);
                        }
                        context.output.write(`Updated section '${options.section}' in feature ${result.ref.id}`);
                    }
                } else if (options.fromFile !== undefined) {
                    writeJsonError(
                        context.output,
                        options,
                        '--section is required with --from-file',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                if (options.field !== undefined) {
                    if (options.value === undefined) {
                        writeJsonError(
                            context.output,
                            options,
                            '--value is required with --field',
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                    result = await svc.update(id, options.field, options.value);
                    if (!options.json) {
                        context.output.write(`Updated ${options.field} on feature ${result.ref.id}`);
                    }
                } else if (options.value !== undefined) {
                    writeJsonError(context.output, options, '--field is required with --value', 'VALIDATION_FAILED');
                    context.setExitCode(2);
                    return;
                }
                if (status !== undefined) {
                    result = await svc.transition(id, status);
                    if (!options.json) {
                        context.output.write(`${result.ref.id}: ${result.fromStatus} → ${result.toStatus}`);
                    }
                }
                if (result === undefined) {
                    writeJsonError(
                        context.output,
                        options,
                        'Either <status>, --field/--value, or --section/--from-file is required',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
