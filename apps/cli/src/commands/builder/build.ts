import { resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    BINARY_TARGETS,
    BuildError,
    type BuildResult,
    buildBinaries,
    buildCli,
    buildServer,
    bundleConfig,
    bundleLayaWorker,
    bundlePlugins,
    bundleWeb,
    checkDeps,
    emitBoardDeclarations,
    emitKitDeclarations,
    emitMigrationSql,
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

/** Register the artifact verbs: `bundle-config`, `bundle-web`, `bundle-plugins`, `bundle-laya-worker`, `emit-board-types`, `emit-migration-sql`, `verify-pack`. */
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

    bootFree(noun.command('bundle-plugins'))
        .summary('stage the checkout’s plugins/ and .claude-plugin/ trees into its CLI package tree')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            await runVerb(context, options, async (sourceRoot) => bundlePlugins({ sourceRoot }), 'bundle-plugins');
        });

    bootFree(noun.command('bundle-laya-worker'))
        .summary('stage the installed laya-local Python worker beside the bundled config root')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[out-dir]', 'destination directory (default: <source-root>/apps/cli/worker)')
        .action(async (outDir, options) => {
            await runVerb(
                context,
                options,
                async (sourceRoot) =>
                    bundleLayaWorker({
                        sourceRoot,
                        ...(outDir !== undefined ? { target: resolve(context.cwd, outDir) } : {}),
                    }),
                outDir ?? 'bundle-laya-worker',
            );
        });

    bootFree(noun.command('emit-board-types'))
        .summary('emit the board declaration and the module-kit declaration mirror for the CLI package')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            await runVerb(
                context,
                options,
                async (sourceRoot) => {
                    const board = await emitBoardDeclarations({ sourceRoot });
                    const kit = await emitKitDeclarations({ sourceRoot });
                    return { ...board, artifacts: [...board.artifacts, ...kit.artifacts] };
                },
                'emit-board-types',
            );
        });

    bootFree(noun.command('emit-migration-sql'))
        .summary('emit the embedded migration SQL module from its released .sql authoring source')
        .option('--source-root <dir>', 'Spur source checkout (default: the current directory)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            await runVerb(
                context,
                options,
                async (sourceRoot) => emitMigrationSql({ sourceRoot }),
                'emit-migration-sql',
            );
        });

    bootFree(noun.command('verify-pack'))
        .summary('inspect a packed tarball (member safety, archive-owned version, required members)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--require <member>', 'member that must ship at package/<member> (repeatable)', collect, [])
        .argument('<tgz>', 'tarball to inspect, relative to the invocation cwd')
        .action(async (tgz, options) => {
            await runVerb(
                context,
                options,
                async (cwd) => {
                    const tarball = resolve(cwd, tgz);
                    const result = await verifyPack(tarball, { requires: options.require });
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

/**
 * Register `spur builder build-binaries`.
 *
 * Two contracts in one verb, because the artifact is the same:
 *  - the release build (no `--entry`): the checkout's six `spur` assets into `dist/cli` plus
 *    `SHA256SUMS`, unchanged from the route A93 shipped;
 *  - the generic build (`--entry`): one entry compiled for the requested targets into `--out`,
 *    with no Spur source-root validation (A94 1411).
 */
export function registerBuilderBuildBinariesCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('build-binaries'))
        .summary('cross-compile release binaries and write SHA256SUMS (or one entry for chosen targets)')
        .option('--source-root <dir>', 'Spur source checkout to build (default: the current directory)')
        .option('--entry <file>', 'compile this entry instead of the Spur release build')
        .option('--name <bin>', 'asset base name (default: the entry basename without its extension)')
        .option('--targets <csv>', `comma-separated targets (default: all of ${BINARY_TARGETS.join(',')})`)
        .option('--out <dir>', 'output directory in --entry mode (default: dist/bin)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const targets =
                options.targets === undefined
                    ? undefined
                    : options.targets
                          .split(',')
                          .map((target) => target.trim())
                          .filter(Boolean);
            await runVerb(
                context,
                options,
                async (sourceRoot) =>
                    buildBinaries({
                        sourceRoot,
                        cwd: context.cwd,
                        ...(options.entry !== undefined ? { entry: options.entry } : {}),
                        ...(options.name !== undefined ? { name: options.name } : {}),
                        ...(targets !== undefined ? { targets } : {}),
                        ...(options.out !== undefined ? { out: options.out } : {}),
                    }),
                'build-binaries',
                // `--entry` compiles an arbitrary project, so it must not require a Spur checkout.
                options.entry === undefined,
            );
        });
}

/**
 * Register `spur builder check-deps` (A94 1411): stale linked dist + lockfile drift, scoped by
 * `builder.dependencyScope` or `--scope`, exiting 0 clean / 1 findings / 2 usage-or-input error.
 */
export function registerBuilderCheckDepsCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('check-deps'))
        .summary('report stale bun-linked dist and lockfile drift for the configured package scope')
        .option('--scope <glob>', 'package glob to check (repeatable; replaces builder.dependencyScope)', collect, [])
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            // `builder` verbs are boot-free routes, so the composition root did not load the project
            // config; this verb is the one that needs `builder.dependencyScope`, so it loads it once
            // here rather than forcing a full (DB-initializing) boot for a read-only check.
            const config = context.spurConfig ?? (await context.loadAgentConfig(context.cwd));
            const configured = config?.builder?.dependencyScope ?? [];
            const scope: readonly string[] = options.scope.length > 0 ? options.scope : configured;
            const emit = (payload: unknown): void => {
                context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope === true }));
            };
            if (scope.length === 0) {
                if (options.json === true) {
                    emit({ ok: true, findings: [], skipped: 'no dependencyScope configured' });
                } else {
                    context.output.write('check-deps: no dependencyScope configured — skipped');
                }
                return;
            }
            try {
                const findings = checkDeps({ cwd: context.cwd, scope });
                if (options.json === true) {
                    emit({ ok: findings.length === 0, findings });
                } else if (findings.length === 0) {
                    context.output.write(`check-deps OK — ${scope.join(',')} in step with source and lockfile.`);
                } else {
                    for (const finding of findings) {
                        context.output.error(`${finding.kind}\t${finding.package}\t${finding.detail}`);
                    }
                }
                if (findings.length > 0) context.setExitCode(1);
            } catch (error) {
                const raw = error instanceof Error ? error.message : String(error);
                const message = raw.startsWith('check-deps') ? raw : `check-deps: ${raw}`;
                if (options.json === true) {
                    emit({ ok: false, findings: [], error: message });
                } else {
                    context.output.error(message);
                }
                context.setExitCode(2);
            }
        });
}

/** Accumulate a repeatable option into an array. */
function collect(value: string, previous: string[]): string[] {
    return [...previous, value];
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
