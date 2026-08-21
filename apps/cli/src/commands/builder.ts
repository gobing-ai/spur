import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { bumpVer, dropTags } from '../release-ops';
import { SHARED_OPTIONS } from './shared-options';

/**
 * Register `spur builder` — release plumbing promoted from spur-dev (task 0617, ADR-051
 * amendment R5). Exactly two verbs, by explicit operator consent: `bump-ver` and
 * `drop-tags`. Anything else stays internal until it argues against that line explicitly.
 */
export function registerBuilderCommand(program: Command, context: CliContext): void {
    const noun = program.command('builder').summary('release plumbing: version bumps and release tags');

    noun.command('bump-ver')
        .summary('bump a package version, commit, tag, optionally push')
        .description(
            [
                'Bump one workspace package (or every released package with --all),',
                'rewrite workspace pins, commit, and tag. A bare version bumps all:',
                '  spur builder bump-ver 0.1.4          # every released package',
                '  spur builder bump-ver spur 0.1.4     # one package by id',
            ].join('\n'),
        )
        .option('--all', 'bump every released package in one commit with per-package + aggregate tags')
        .option('--push', 'push the branch and release tag to origin')
        .option(...SHARED_OPTIONS.json)
        .argument('[target]', 'package id, or the version itself when bumping all')
        .argument('[version]', 'target semver version')
        .action(async (target, version, options) => {
            const args = [target, version].filter((value) => value !== undefined);
            if (options.all === true) args.push('--all');
            if (options.push === true) args.push('--push');
            try {
                await bumpVer(args, context.cwd, context.output);
                if (options.json === true) {
                    context.output.write(
                        toJson({ ok: true, verb: 'bump-ver', target: target ?? 'all', version: version ?? '' }),
                    );
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(toJson({ ok: false, verb: 'bump-ver', error: message }));
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
        .argument('[target]', 'package id, or the version itself when dropping all')
        .argument('[version]', 'semver version of the tags to drop')
        .action(async (target, version, options) => {
            const args = [target, version].filter((value) => value !== undefined);
            if (options.all === true) args.push('--all');
            if (options.remote === true) args.push('--remote');
            try {
                await dropTags(args, context.cwd, context.output);
                if (options.json === true) {
                    context.output.write(
                        toJson({ ok: true, verb: 'drop-tags', target: target ?? 'all', version: version ?? '' }),
                    );
                }
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(toJson({ ok: false, verb: 'drop-tags', error: message }));
                    context.setExitCode(1);
                    return;
                }
                context.output.error(message);
                context.setExitCode(1);
            }
        });
}
