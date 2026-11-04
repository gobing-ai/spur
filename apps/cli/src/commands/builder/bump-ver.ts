import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { bumpVer, checkVersionDrift } from '../../release-ops';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur builder bump-ver`. */
export function registerBuilderBumpVerCommand(noun: Command, context: CliContext): void {
    noun.command('bump-ver')
        .summary('bump a package version, commit, tag, optionally push')
        .description(
            [
                'Bump one workspace package (or every released package with --all),',
                'rewrite workspace pins, commit, and tag. A bare version bumps all:',
                '  spur builder bump-ver 0.1.4          # every released package',
                '  spur builder bump-ver spur 0.1.4     # one package by id',
                '  spur builder bump-ver --check spur   # pre-publish drift guard (read-only)',
                '--check fails (exit 1) when .claude-plugin/marketplace.json or a listed plugin.json',
                'drifted from the package version; target defaults to the aggregate package.',
            ].join('\n'),
        )
        .option('--check', 'only verify marketplace/plugin versions match the package version (no writes)')
        .option('--all', 'bump every released package in one commit with per-package + aggregate tags')
        .option('--push', 'push the branch and release tag to origin')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[target]', 'package id, or the version itself when bumping all')
        .argument('[version]', 'target semver version')
        .action(async (target, version, options) => {
            const args = [target, version].filter((value) => value !== undefined);
            if (options.all === true) args.push('--all');
            if (options.push === true) args.push('--push');
            try {
                if (options.check === true) {
                    if (version !== undefined) throw new Error('bump-ver --check takes only a package id');
                    if (options.all === true || options.push === true)
                        throw new Error('bump-ver --check rejects incompatible write flags (--push/--all)');
                    const code = await checkVersionDrift(target, context.cwd, context.output, context.spurConfig);
                    if (options.json === true) {
                        context.output.write(
                            toEnvelopeJson(
                                { ok: code === 0, verb: 'bump-ver', check: true, target: target ?? 'aggregate' },
                                { enveloped: options.jsonEnvelope },
                            ),
                        );
                    }
                    if (code !== 0) context.setExitCode(code);
                    return;
                }
                await bumpVer(args, context.cwd, context.output, context.spurConfig);
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: true, verb: 'bump-ver', target: target ?? 'all', version: version ?? '' },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, verb: 'bump-ver', error: message },
                            {
                                enveloped: options.jsonEnvelope,
                                error: {
                                    code: 'INTERNAL_ERROR',
                                    message: message,
                                    details: { cliCode: 'bump-ver', verb: 'bump-ver' },
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
