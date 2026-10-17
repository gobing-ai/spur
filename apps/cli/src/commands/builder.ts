import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../context';
import { toEnvelopeJson } from '../output';
import { bumpVer, checkVersionDrift, dropTags, publishPackage } from '../release-ops';
import { registerBuilderPrAliasCommand, registerBuilderPrCommands } from './builder/pr';
import { registerBuilderShowBranchesCommand } from './builder/show-branches';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Register `spur builder` — release plumbing promoted from spur-dev (task 0617, ADR-051
 * amendment R5; charter extended by script-absorption Q1/Q5 for `pr` (PR-7) and `publish` /
 * `bump-ver --check` (PR-9), by feature-L1 operator consent for `show-branches` (task 1218), and
 * by task 1219 for the four flat `pr-<verb>` verbs that replace the `pr <op>` layer).
 * Verbs: `bump-ver`, `drop-tags`, `publish`, `show-branches`, `pr-status`, `pr-check`, `pr-open`,
 * `pr-review` (+ the hidden, deprecated `pr` alias).
 */
export function registerBuilderCommand(program: Command, context: CliContext): void {
    const noun = program
        .command('builder')
        .summary('release plumbing: version bumps, tags, branch topology, and PR-review ops');

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

    noun.command('publish')
        .summary('resolve workspace/catalog ranges, build, and npm publish a package (CI)')
        .description(
            [
                'CI publish for npm Trusted Publishing (OIDC): rewrite workspace:/catalog: ranges in',
                '<dir>/package.json, run `bun run build:bundle`, `npm publish --access public`, and',
                'restore the manifest on every exit path.',
            ].join('\n'),
        )
        .option('--otp <code>', 'npm one-time password (local publishes only)')
        .argument('<dir>', 'package directory, relative to the workspace root')
        .action(async (dir, options) => {
            try {
                await publishPackage(dir, {
                    repoRoot: context.cwd,
                    output: context.output,
                    ...(options.otp !== undefined ? { otp: options.otp } : {}),
                });
            } catch (err) {
                context.output.error(err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });

    registerBuilderShowBranchesCommand(noun, context);
    registerBuilderPrCommands(noun, context);
    registerBuilderPrAliasCommand(noun, context);
}
