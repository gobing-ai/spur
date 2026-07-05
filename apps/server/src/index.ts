import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { startServer } from './serve';

export { createApp } from './bootstrap';
export { generateOpenApiSpec } from './openapi';
export type { AppRouter } from './router';
export { createRouter } from './router';
export type { StartServerOptions } from './serve';
export { startServer } from './serve';
export { default as worker } from './worker';

/** Injectable collaborators for {@link main}. Tests pass fakes here to avoid mock.module leaks. */
export interface MainDeps {
    buildConfigFromEnv: typeof buildConfigFromEnv;
    startServer: typeof startServer;
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
        webDistPath: config.server.webDistPath,
    });
}

if (import.meta.main) {
    await main();
}

export { default } from './worker';
