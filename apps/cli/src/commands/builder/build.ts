import { resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    BuildError,
    type BuildResult,
    buildBinaries,
    buildCli,
    buildServer,
    bundleConfig,
    bundleWeb,
    resolveSourceRoot,
    verifyPack,
} from '@gobing-ai/spur-app/builder';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/**
 * `spur builder build-cli|build-server|build-binaries [--source-root <dir>]` — compiled artifacts.
 *
 * One grammar, no mode operand: each verb names the artifact it produces. `--source-root` defaults
 * to the invocation cwd and must be a Spur checkout (validated before anything is opened or
 * patched). Child build output is captured as `diagnostics` so `--json` stays one document.
 */
export function registerBuilderBuildCliCommand(noun: Command, context: CliContext): void {
    registerBuildVerb(noun, context, 'build-cli', 'compile the checkout’s `spur` binary', buildCli);
}

/** Register `spur builder build-server`. */
export function registerBuilderBuildServerCommand(noun: Command, context: CliContext): void {
    registerBuildVerb(noun, context, 'build-server', 'compile the checkout’s standalone server', buildServer);
}

/** Register the three artifact verbs: `bundle-config`, `bundle-web`, `verify-pack`. */
export function registerBuilderArtifactCommands(noun: Command, context: CliContext): void {
    bootFree(noun.command('bundle-config'))
        .summary('stage the checkout config/ tree (with $schema injection) into an output directory')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('<out-dir>', 'destination directory, relative to the invocation cwd')
        .action(async (outDir, options) => {
            await runVerb(
                context,
                options,
                async (sourceRoot) => {
                    const result = await bundleConfig(resolve(context.cwd, outDir), { sourceRoot });
                    return {
                        ok: true as const,
                        sourceRoot,
                        artifacts: [
                            { path: result.target, kind: `config:${result.injected} schema directive(s)` },
                            { path: result.source, kind: 'source' },
                        ],
                        diagnostics: [],
                    };
                },
                outDir ?? '',
            );
        });

    bootFree(noun.command('bundle-web'))
        .summary('stage a checkout’s built Board assets into its CLI package tree')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[out-dir]', 'destination directory (default: <source-root>/apps/cli/web)')
        .action(async (outDir, options) => {
            await runVerb(
                context,
                options,
                async (sourceRoot) => {
                    const result = await bundleWeb({
                        sourceRoot,
                        ...(outDir !== undefined ? { target: resolve(context.cwd, outDir) } : {}),
                    });
                    return {
                        ok: true as const,
                        sourceRoot,
                        artifacts: [
                            { path: result.target, kind: 'web' },
                            { path: result.source, kind: 'source' },
                        ],
                        diagnostics: [],
                    };
                },
                outDir ?? 'bundle-web',
            );
        });

    bootFree(noun.command('verify-pack'))
        .summary('inspect a packed tarball (member safety, archive-owned versions, pruned content)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('<tgz>', 'tarball to inspect, relative to the invocation cwd')
        .action(async (tgz, options) => {
            await runVerb(
                context,
                options,
                async (cwd) => {
                    const tarball = resolve(cwd, tgz);
                    const result = await verifyPack(tarball);
                    return {
                        ok: true as const,
                        // `verify-pack` inspects an artifact, not a checkout: no source-root validation.
                        sourceRoot: cwd,
                        artifacts: [{ path: tarball, kind: `tarball:${result.version}:${result.files} files` }],
                        diagnostics: [],
                    };
                },
                tgz,
                false,
            );
        });
}

/** Register `spur builder build-binaries`. */
export function registerBuilderBuildBinariesCommand(noun: Command, context: CliContext): void {
    registerBuildVerb(
        noun,
        context,
        'build-binaries',
        'cross-compile the six release binaries and write SHA256SUMS',
        buildBinaries,
    );
}

/** Shared body for the artifact verbs: render/exit contract identical to the compile verbs. */
async function runVerb(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean; sourceRoot?: string },
    build: (sourceRoot: string) => Promise<BuildResult>,
    label: string,
    /** `false` for verbs whose subject is an artifact, not a checkout (`verify-pack <tgz>`). */
    validateSourceRoot = true,
): Promise<void> {
    try {
        const sourceRoot = validateSourceRoot ? resolveSourceRoot(options.sourceRoot, context.cwd) : context.cwd;
        const result = await build(sourceRoot);
        if (options.json === true) {
            context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            return;
        }
        for (const artifact of result.artifacts) context.output.write(`${artifact.kind}\t${artifact.path}`);
        context.output.write(`${label}: ok`);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.json === true) {
            context.output.write(
                toJson({
                    error: {
                        code: err instanceof BuildError ? 'build' : 'artifact',
                        message,
                        ...(err instanceof BuildError ? { sourceRoot: err.sourceRoot } : {}),
                    },
                }),
            );
        } else {
            context.output.error(message);
        }
        context.setExitCode(1);
    }
}

/** Shared verb body: identical flags, rendering and exit contract for all three artifacts. */
function registerBuildVerb(
    noun: Command,
    context: CliContext,
    verb: 'build-cli' | 'build-server' | 'build-binaries',
    summary: string,
    build: (options: { sourceRoot: string; cwd: string }) => Promise<BuildResult>,
): void {
    bootFree(noun.command(verb))
        .summary(summary)
        .option('--source-root <dir>', 'Spur source checkout to build (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const result = await build({ sourceRoot: options.sourceRoot ?? '.', cwd: context.cwd });
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    return;
                }
                for (const artifact of result.artifacts) context.output.write(artifact.path);
                context.output.write(`built ${result.artifacts.length} artifact(s) from ${result.sourceRoot}`);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(
                        toJson({
                            error: {
                                code: err instanceof BuildError ? 'build' : 'unknown',
                                message,
                                ...(err instanceof BuildError ? { sourceRoot: err.sourceRoot } : {}),
                            },
                        }),
                    );
                } else {
                    context.output.error(message);
                }
                context.setExitCode(1);
            }
        });
}
