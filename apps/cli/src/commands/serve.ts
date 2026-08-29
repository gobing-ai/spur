import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { buildConfigFromEnv, DEFAULT_DATABASE_URL } from '@gobing-ai/spur-config';
import { startServer } from '@gobing-ai/spur-server';
import type { CliContext } from '../context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Resolve the database URL used by `spur serve`, matching normal CLI DB defaults. */
export function resolveServeDbUrl(cwd: string, env: Record<string, string | undefined>, configuredUrl: string): string {
    return env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : configuredUrl;
}

/** Register `spur serve` command (optionally hidden from the top-level help listing). */
export function registerServeCommand(program: Command, context: CliContext, options: { hidden?: boolean } = {}): void {
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
                const cwd = options.cwd ?? context.cwd;
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

                await startServer({
                    port,
                    host,
                    dbUrl,
                    openBrowser: options.open ?? true,
                    webDistPath: config.server.webDistPath,
                });
            } catch (err) {
                writeJsonError(context.output, options, err instanceof Error ? err.message : String(err));
                if (context.env?.SPUR_DEBUG === '1' && err instanceof Error && err.stack) {
                    writeJsonError(context.output, options, err.stack, 'INTERNAL_ERROR');
                }
                context.setExitCode(1);
            }
        });
}
