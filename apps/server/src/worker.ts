import type { ApplicationRuntime, InfraEvents } from '@gobing-ai/ts-infra/application';
import { runApplication } from '@gobing-ai/ts-infra/application';
import type { Hono } from 'hono';
import { serverBootstrapConfig } from './server-config';
import { createWorkerApp } from './worker-app';

type AppRuntime = ApplicationRuntime<unknown, InfraEvents>;

/** Bootstraps the portable application from env. Overridable in tests. */
export type BootstrapFn = (env: Record<string, string | undefined>) => Promise<AppRuntime>;

const defaultBootstrap: BootstrapFn = (env) => {
    return runApplication({
        config: serverBootstrapConfig(env),
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
        await getRuntime(env ?? {});
        if (!cachedApp) {
            cachedApp = createWorkerApp(env);
        }
        return cachedApp.fetch(request, env);
    },
};
