import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { buildConfigFromEnv, DEFAULT_DATABASE_URL } from '@gobing-ai/spur-config';
import { startServer } from '@gobing-ai/spur-server';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Resolve the database URL used by `spur serve`, matching normal CLI DB defaults. */
export function resolveServeDbUrl(cwd: string, env: Record<string, string | undefined>, configuredUrl: string): string {
    return env.DATABASE_URL === undefined ? join(cwd, DEFAULT_DATABASE_URL) : configuredUrl;
}

/** Register `spur serve` command. */
export function registerServeCommand(program: Command, context: CliContext): void {
    program
        .command('serve')
        .summary('start the Spur web server (local fallback)')
        .option('--port <n>', 'Server port (env: PORT, default: 3000)', parseInt)
        .option('--host <addr>', 'Bind address (env: HOST, default: localhost)')
        .option('--no-open', 'Skip opening the browser')
        .option('--cwd <path>', 'Working directory', context.cwd)
        .option('--json', 'Output { port, url, pid } and exit')
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
                        toJson({
                            port,
                            url: `http://${host}:${port}`,
                            pid: null,
                            running: false,
                        }),
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
                context.output.error(err instanceof Error ? err.message : String(err));
                if (context.env?.SPUR_DEBUG === '1' && err instanceof Error && err.stack) {
                    context.output.error(err.stack);
                }
                context.setExitCode(1);
            }
        });
}
