/**
 * Full CLI runtime: database + merged-config boot and Commander dispatch (PR-L, lazy CLI loading).
 *
 * Loaded by `main()` through a string-literal dynamic import only for invocations that need it,
 * so `spur --version` and `spur self hook` never evaluate the DB adapter, the config loader, the
 * application runtime or the `@gobing-ai/spur-app` barrel. The body below is the former eager
 * `main()` boot verbatim; only the command tree is now built per invoked noun ({@link buildProgram}).
 */
// Force ts-db into the --compile static bundle so that dynamic
// import('@gobing-ai/ts-db') calls in ts-runtime resolve at runtime.
// Bun --compile bundles only the static import graph into bunfs;
// string-literal dynamic imports resolve from the bundled graph,
// but variable-specifier imports (ts-runtime@0.4.6 uses
// `const spec = '@gobing-ai/ts-db'; await import(spec)`) do not.
// The side-effect import below forces ts-db into the static graph
// (this module is itself reached by a string-literal import, so it is bundled).
// `spur-dev.ts build-cli` patches the variable specifier in ts-runtime's
// dist to a string literal at build time so it resolves at runtime.
import '@gobing-ai/ts-db';
import { getEnvVar, type SpurAppConfig, type SpurConfig } from '@gobing-ai/spur-config';
import { loadSpurConfig, resolveConfigFile } from '@gobing-ai/spur-config/loader';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import { runNodeApplication } from '@gobing-ai/ts-infra/application-node';
import { EMBEDDED_SPUR_SCHEMAS } from './config/embedded-schemas';
import { createCliContext, createMigratedDbAdapter } from './context';
import { errorMessage } from './errors';
import { type CommandOutput, toJson } from './output';
import { buildProgram } from './program';

/** Options for programmatic CLI execution in tests. */
export interface MainOptions {
    cwd?: string;
    env?: Record<string, string | undefined>;
    output?: CommandOutput;
    dbUrl?: string;
    /** Pre-built DB adapter. Injectable so tests can assert close-on-shutdown (ADR-018). */
    db?: DbAdapter;
    /** Database-free serve launch seam for startup tests. */
    startServer?: typeof import('@gobing-ai/spur-server').startServer;
    /** `spur self hook` I/O seams (stdin, raw stdout/stderr) for in-process tests. */
    selfHook?: import('./self-hook').SelfHookDeps;
}

/** Boot the DB and merged config, then dispatch `argv` through the noun-scoped command tree. */
export async function runFullCli(
    argv: string[],
    options: MainOptions,
    output: CommandOutput,
    cwd: string,
    env: Record<string, string | undefined>,
): Promise<number> {
    let exitCode = 0;
    // Task 0817 R1: forward `options.cwd` verbatim — which may be undefined — so the
    // loader's `SPUR_SKIP_PROJECT_CONFIG` gate can suppress the project layer for
    // unpinned programmatic runs. `cwd` stays materialized for the DB and context seams.
    const configFile = resolveConfigFile(options.cwd);
    const db = options.db ?? (await createMigratedDbAdapter(cwd, env, options.dbUrl));

    // Load the merged global+project config ONCE at the composition root (A5 /
    // ADR-082) — covering both the config-present and no-config branches — and
    // thread the result into dispatch as the only app-config source. A config-load
    // failure emits exactly one error and exits 1 (R4); the loader's message already
    // names the failing layer path and is propagated verbatim.
    let spurConfig: SpurConfig;
    try {
        // Pass the embedded schemas so the `$schema` ref resolves without
        // node_modules (dev tree and --compile binary alike).
        spurConfig = await loadSpurConfig(options.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
    } catch (err) {
        const message = errorMessage(err);
        if (argv.includes('--json')) {
            output.write(toJson({ error: { code: 'config', message } }));
        } else {
            output.error(message);
        }
        await db.close();
        return 1;
    }

    // 0799 (ADR-082): re-load accessor for the quota-update flow (R3 executor
    // refresh, drain-time binding checks). Only this composition root may call
    // the loader; commands receive the closure through CliContext.
    const loadAgentConfig = async (projectRoot: string): Promise<SpurConfig | null> => {
        try {
            return await loadSpurConfig(projectRoot, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
        } catch {
            return null;
        }
    };

    // 0858 R2/R5: the fail-loud sibling. A read surface that reports a project's
    // declared fleet state must surface a broken config (retired source, invalid
    // section) instead of degrading it to "nothing declared".
    const loadAgentConfigStrict = (projectRoot: string): Promise<SpurConfig> =>
        loadSpurConfig(projectRoot, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });

    try {
        if (configFile !== undefined) {
            // Bootstrap through runNodeApplication — standard path (R1).
            // `bootstrap` is project-shaped (0641 split); the app section comes from
            // the merged load, so the appConfig validator is dropped and
            // appRt.appConfig is never read.
            const app = await runNodeApplication<SpurAppConfig>({
                configLoader: {
                    configFile,
                    bootstrapSection: 'bootstrap',
                },
                // Under test, force logging off so initializeLogger() does not
                // reconfigure LogTape with a console sink — which would reset the
                // global mute installed in tests/setup.ts and leak JSON log lines
                // from every later app.* logger (e.g. the rule engine).
                // Outside test, enforce console off — all output goes to file.
                config:
                    getEnvVar('NODE_ENV') === 'test'
                        ? { logging: { enabled: false } }
                        : { logging: { console: false } },
                services: { db },
                async start(appRt: ApplicationRuntime<SpurAppConfig>) {
                    void appRt;
                    const context = createCliContext({
                        cwd,
                        env,
                        output,
                        db,
                        spurConfig,
                        loadAgentConfig,
                        loadAgentConfigStrict,
                    });
                    exitCode = await runCommandDispatch(argv, context, output);
                },
            });
            await app.stop('shutdown');
        } else {
            // No config file — direct path (pre-init, tests).
            const context = createCliContext({
                cwd,
                env,
                output,
                db,
                spurConfig,
                loadAgentConfig,
                loadAgentConfigStrict,
            });
            exitCode = await runCommandDispatch(argv, context, output);
        }
    } finally {
        // ADR-018: ts-infra 0.3.6 no longer closes a caller-injected services.db.
        // Spur owns the adapter it creates — close it in both bootstrap branches.
        await db.close();
    }

    return exitCode;
}

/** Build the noun-scoped Commander program and run the dispatch. Returns exit code. */
async function runCommandDispatch(
    argv: string[],
    context: ReturnType<typeof createCliContext>,
    output: CommandOutput,
): Promise<number> {
    let exitCode = 0;
    context.setExitCode = (code: number) => {
        exitCode = code;
    };
    const program = await buildProgram(context, output, argv);

    try {
        await program.parseAsync(argv, { from: 'user' });
        return exitCode;
    } catch (err) {
        if (err instanceof Error && 'exitCode' in err) {
            return (err as Error & { exitCode: number }).exitCode;
        }
        output.error(errorMessage(err));
        return exitCode !== 0 ? exitCode : 1;
    }
}
