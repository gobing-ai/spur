import type { ApplicationRuntime, InfraEvents } from '@gobing-ai/ts-infra/application';
import { runApplication } from '@gobing-ai/ts-infra/application';
import type { Hono } from 'hono';
import { createApp, serverBootstrapConfig } from './bootstrap';

type AppRuntime = ApplicationRuntime<unknown, InfraEvents>;

/** Bootstraps the portable application from env. Overridable in tests. */
export type BootstrapFn = (env: Record<string, string | undefined>) => Promise<AppRuntime>;

const defaultBootstrap: BootstrapFn = (env) => {
    // The Cloudflare Worker `env` arg carries request bindings, not NODE_ENV.
    // Fall back to the runtime env so `bun test` (NODE_ENV=test) disables
    // logging — otherwise initializeLogger() reconfigures LogTape with a
    // console sink and leaks JSON log lines from every later app.* logger.
    const merged = env.NODE_ENV === undefined ? { ...env, NODE_ENV: process.env.NODE_ENV } : env;
    return runApplication({
        config: serverBootstrapConfig(merged),
        async start(_appRt: ApplicationRuntime) {
            // No server-level side effects — the app is created lazily on
            // first request and cached for the isolate's lifetime.
        },
    });
};

/** Cached bootstrap promise — initialized lazily on first request. */
let rtPromise: Promise<AppRuntime> | undefined;

let cachedApp: Hono | undefined;

/**
 * Lazily bootstrap the application once per isolate and cache the promise.
 *
 * A rejected bootstrap is NOT cached: the failed promise is cleared so the next
 * request retries instead of replaying a stale rejection. `bootstrap` is injectable
 * so the failure-and-retry path is unit-testable without module mocking.
 */
export function getRuntime(
    env: Record<string, string | undefined>,
    bootstrap: BootstrapFn = defaultBootstrap,
): Promise<AppRuntime> {
    if (!rtPromise) {
        rtPromise = bootstrap(env).catch((err) => {
            rtPromise = undefined;
            throw err;
        });
    }
    return rtPromise;
}

/** Reset the cached runtime and app. Test-only seam for isolating singleton state. */
export function resetRuntime(): void {
    rtPromise = undefined;
    cachedApp = undefined;
}

/** Cloudflare Worker fetch entrypoint for the server app. */
export default {
    async fetch(request: Request, env?: Record<string, string | undefined>) {
        const appRt = await getRuntime(env ?? {});
        if (!cachedApp) {
            cachedApp = createApp(appRt);
        }
        return cachedApp.fetch(request, env);
    },
};
