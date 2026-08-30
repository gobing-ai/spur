import { basename, dirname, join } from 'node:path';
import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { startServer } from './serve';

export { createApp } from './bootstrap';
export { generateOpenApiSpec } from './openapi';
export type { AppRouter } from './router';
export { createRouter } from './router';
export type { StartServerOptions } from './serve';
export { resolveWebDistPath, startServer } from './serve';
export { default as worker } from './worker';

/** Injectable collaborators for {@link main}. Tests pass fakes here to avoid mock.module leaks. */
export interface MainDeps {
    buildConfigFromEnv: typeof buildConfigFromEnv;
    startServer: typeof startServer;
}

/** Resolve the companion CLI shipped beside the standalone server binary. */
export function resolveStandaloneSpurInvocation(execPath: string, sourceDir = import.meta.dir): string {
    const runtime = basename(execPath)
        .toLowerCase()
        .replace(/\.exe$/, '');
    if (runtime === 'bun' || runtime === 'node') {
        return `${execPath} ${join(sourceDir, '../../cli/src/index.ts')}`;
    }
    return join(dirname(execPath), '../cli', process.platform === 'win32' ? 'spur.exe' : 'spur');
}

/** Entry-point logic extracted for testability. Called by the import.meta.main block. */
export async function main(
    env: Record<string, string | undefined> = process.env,
    deps: MainDeps = { buildConfigFromEnv, startServer },
): Promise<void> {
    const config = deps.buildConfigFromEnv(env);
    await deps.startServer({
        port: config.server.port,
        host: config.server.host,
        openBrowser: false,
        dbUrl: config.database.url,
        webDistPath: config.server.webDistPath,
        spurInvocation: resolveStandaloneSpurInvocation(process.execPath),
    });
}

if (import.meta.main) {
    await main();
}

export { default } from './worker';
