import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { dropTags } from '../../release-ops';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur builder drop-tags`. */
export function registerBuilderDropTagsCommand(noun: Command, context: CliContext): void {
    noun.command('drop-tags')
        .summary('delete release tags locally and optionally on origin')
        .description(
            [
                'Delete one package release tag (or every released tag plus the aggregate',
                'with --all / a bare version). Use --remote to also delete on origin.',
            ].join('\n'),
        )
        .option('--all', 'drop every released tag plus the aggregate tag')
        .option('--remote', 'also delete the tag(s) on origin')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[target]', 'package id, or the version itself when dropping all')
        .argument('[version]', 'semver version of the tags to drop')
        .action(async (target, version, options) => {
            const args = [target, version].filter((value) => value !== undefined);
            if (options.all === true) args.push('--all');
            if (options.remote === true) args.push('--remote');
            try {
                await dropTags(args, context.cwd, context.output, context.spurConfig);
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: true, verb: 'drop-tags', target: target ?? 'all', version: version ?? '' },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, verb: 'drop-tags', error: message },
                            {
                                enveloped: options.jsonEnvelope,
                                error: {
                                    code: 'INTERNAL_ERROR',
                                    message: message,
                                    details: { cliCode: 'drop-tags', verb: 'drop-tags' },
                                },
                            },
                        ),
                    );
                    context.setExitCode(1);
                    return;
                }
                context.output.error(message);
                context.setExitCode(1);
            }
        });
}
