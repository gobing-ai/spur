import { statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { buildConfigFromEnv, DEFAULT_DATABASE_URL } from '@gobing-ai/spur-config';
import { startServer } from '@gobing-ai/spur-server';
import type { CliContext } from '../context';
import { CommandError, errorMessage } from '../errors';
import { toEnvelopeJson, writeJsonError } from '../output';
import { resolveSpurBin } from '../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from './shared-options';

/** Resolve the database URL used by `spur serve`, matching normal CLI DB defaults. */
export function resolveServeDbUrl(cwd: string, env: Record<string, string | undefined>, configuredUrl: string): string {
    return env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : configuredUrl;
}

/**
 * Resolve the `serve --cwd` project root (task 0805 R2): a relative target is
 * resolved against the invocation directory (path.resolve), and the result must
 * exist and be a directory BEFORE server startup. A missing/non-directory target
 * is a command error, not a server that silently serves the wrong root. Both the
 * canonical `self serve` spelling and the hidden `serve` alias share this path.
 */
export function resolveServeCwd(cwd: string): string {
    const resolved = resolve(cwd);
    let isDirectory = false;
    try {
        isDirectory = statSync(resolved).isDirectory();
    } catch {
        isDirectory = false;
    }
    if (!isDirectory) {
        throw new CommandError(`--cwd ${cwd} does not resolve to an existing directory (resolved: ${resolved})`, 1);
    }
    return resolved;
}

/** Options for {@link registerServeCommand}. */
export interface RegisterServeOptions {
    /** Hide the command from the top-level help listing (legacy alias). */
    hidden?: boolean;
    /**
     * Injectable `startServer` for tests (defaults to the real server entry).
     * Mirrors the server's StartServerDeps seam so the CLI startup composition
     * can be exercised with injected dependencies (task 0805 AC2).
     */
    startServer?: typeof startServer;
}

/** Register `spur serve` command (optionally hidden from the top-level help listing). */
export function registerServeCommand(program: Command, context: CliContext, options: RegisterServeOptions = {}): void {
    const launch = options.startServer ?? startServer;
    program
        .command('serve', { hidden: options.hidden === true })
        .summary('start the Spur web server (local fallback)')
        .option(...SHARED_OPTIONS.portServe, parseInt)
        .option('--host <addr>', 'Bind address (env: HOST, default: localhost)')
        .option('--no-open', 'Skip opening the browser')
        .option(...SHARED_OPTIONS.cwdServe, context.cwd)
        .option(...SHARED_OPTIONS.jsonServePortUrl)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const env = process.env as Record<string, string | undefined>;
                const config = buildConfigFromEnv(env);

                const port = options.port ?? config.server.port;
                const host = options.host ?? config.server.host;
                // 0805 R2: one coherent project root. A relative --cwd resolves against
                // the invocation directory and must exist as a directory before any
                // server startup. Through the real CLI, commander defaults --cwd to
                // context.cwd (the invocation directory), so options.cwd is always set
                // and the resolved root is always passed; the undefined branch covers
                // direct action invocation (tests/embeddings) and keeps the
                // process.cwd() fallback. The default DB still scopes to the resolved
                // root, preserving prior behavior.
                const projectRoot = options.cwd !== undefined ? resolveServeCwd(options.cwd) : undefined;
                const cwd = projectRoot ?? context.cwd;
                const dbUrl = resolveServeDbUrl(cwd, env, config.database.url);
                if (options.json) {
                    // --json is a dry machine-readable probe: no server is started, so
                    // pid would be this CLI process (misleading). Omit pid; report ready=false.
                    context.output.write(
                        toEnvelopeJson(
                            {
                                port,
                                url: `http://${host}:${port}`,
                                pid: null,
                                running: false,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                    return;
                }

                context.output.write(`Starting Spur server on http://${host}:${port} …`);

                await launch({
                    port,
                    host,
                    dbUrl,
                    openBrowser: options.open ?? true,
                    webDistPath: config.server.webDistPath,
                    // PATH-independent child invocation for queued history refreshes (task 0717).
                    spurInvocation: resolveSpurBin(),
                    ...(projectRoot !== undefined ? { cwd: projectRoot } : {}),
                });
            } catch (err) {
                // errorMessage() classifies SQLITE_BUSY (bun:sqlite: message "database is locked",
                // code SQLITE_BUSY) into the task 0805 R4 remediation — a raw message here read
                // as an opaque failure with no holder-identification hint (dogfood 2026-09-08).
                writeJsonError(context.output, options, errorMessage(err));
                if (context.env?.SPUR_DEBUG === '1' && err instanceof Error && err.stack) {
                    writeJsonError(context.output, options, err.stack, 'INTERNAL_ERROR');
                }
                context.setExitCode(1);
            }
        });
}
