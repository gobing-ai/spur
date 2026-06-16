import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { startServer } from '@gobing-ai/spur-server';
import type { CliContext } from '../context';
import { toJson } from '../output';

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

                if (options.json) {
                    context.output.write(toJson({ port, url: `http://${host}:${port}`, pid: process.pid }));
                    return;
                }

                context.output.write(`Starting Spur server on http://${host}:${port} …`);

                await startServer({
                    port,
                    host,
                    openBrowser: options.open ?? true,
                    cwd: join(cwd),
                    json: false,
                });
            } catch (err) {
                context.output.error(err instanceof Error ? err.message : String(err));
                context.setExitCode(1);
            }
        });
}
