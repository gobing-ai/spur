import { join } from 'node:path';
import type { ApplicationRuntime, LoggingOptions } from '@gobing-ai/ts-infra/application';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { Hono } from 'hono';
import type { ServerContext } from './context';
import { mountMiddleware } from './middleware/pipeline';
import { registerModules } from './modules/registry';
import { generateOpenApiSpec } from './openapi';
import { createRouter } from './router';

declare module 'hono' {
    interface ContextVariableMap {
        rt: ApplicationRuntime;
        ctx: ServerContext;
        requestId: string;
    }
}

export type { ApplicationRuntime, LoggingOptions };

/**
 * Resolved server boot configuration read by the system-events tap and SSE.
 *
 * `events.retention` (task 0368 R3) is operator-facing per-prefix quota
 * resolution: `default` is the fallback quota for any catalog prefix without
 * an explicit `prefixes` override; `prefixes` is the per-prefix override map.
 * Both are optional — {@link resolveRetentionQuotas} applies the documented
 * compiled-in default when neither is set.
 */
export interface ServerBootConfig {
    logging: LoggingOptions;
    telemetry: { enabled: boolean };
    events: {
        enabled: boolean;
        diagnostic: boolean;
        retention?: { default?: number; prefixes?: Record<string, number> };
    };
    jobqueue: { enabled: boolean };
    scheduler: { enabled: boolean };
    /** Agent spec ids to autostart at serve boot (comma-separated, task 0195/0207). */
    teamAutostart: string[];
}

/**
 * Shared bootstrap configuration for the portable `runApplication` block.
 *
 * Reads environment variables to produce a resolved {@link ServerBootConfig}:
 * `NODE_ENV === 'test'` mutes logging and disables the job queue and scheduler;
 * `SPUR_DIAGNOSTIC_EVENTS=1` enables the diagnostic system-events tier;
 * `SPUR_TEAM_AUTOSTART` is a comma-separated list of agent spec ids autostarted
 * at serve boot (task 0195/0207).
 *
 * Retention (task 0368): `SPUR_EVENT_RETENTION_DEFAULT` sets the per-prefix
 * fallback quota; `SPUR_EVENT_RETENTION_<UPPER_PREFIX>` overrides a single
 * prefix (e.g. `SPUR_EVENT_RETENTION_TASK=5000`). Unset → compiled-in default.
 */
export function serverBootstrapConfig(env: Record<string, string | undefined>): ServerBootConfig {
    const isTest = env.NODE_ENV === 'test';
    const raw = env.SPUR_TEAM_AUTOSTART;
    const teamAutostart = raw
        ? raw
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0)
        : [];
    // SPUR_DIAGNOSTIC_EVENTS=1 turns on the diagnostic tier of system events
    // (`bus.*`, `workflow.guard.evaluated`, `workflow.transition.*` internals).
    // Off by default — they are noisy and recursive-prone.
    const diagnosticEvents = env.SPUR_DIAGNOSTIC_EVENTS === '1' || env.SPUR_DIAGNOSTIC_EVENTS === 'true';
    // Task 0368 R3: per-prefix retention quotas parsed from env. A prefix
    // override is only honored when it parses to a non-negative integer; a
    // malformed value is dropped (never aborts boot over a tunable).
    const retentionDefault = parseRetentionNumber(env.SPUR_EVENT_RETENTION_DEFAULT);
    const retentionPrefixes = parseRetentionPrefixes(env);
    return {
        logging: { enabled: !isTest, level: (env.SPUR_LOG_LEVEL as LoggingOptions['level']) ?? 'info', console: false },
        telemetry: { enabled: false },
        events: {
            enabled: true,
            diagnostic: diagnosticEvents,
            retention: {
                ...(retentionDefault !== undefined ? { default: retentionDefault } : {}),
                ...(Object.keys(retentionPrefixes).length > 0 ? { prefixes: retentionPrefixes } : {}),
            },
        },
        jobqueue: { enabled: !isTest },
        scheduler: { enabled: !isTest },
        teamAutostart,
    };
}

/** Parse a retention env value as a non-negative integer; drop if malformed. */
function parseRetentionNumber(raw: string | undefined): number | undefined {
    if (raw === undefined || raw.trim() === '') return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) return undefined;
    return n;
}

/** Collect `SPUR_EVENT_RETENTION_<UPPER_PREFIX>` overrides into a map. */
function parseRetentionPrefixes(env: Record<string, string | undefined>): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(env)) {
        const match = /^SPUR_EVENT_RETENTION_(.+)$/.exec(key);
        if (!match || match[1] === 'DEFAULT') continue;
        const prefix = match[1];
        if (!prefix) continue;
        const quota = parseRetentionNumber(value);
        if (quota === undefined) continue;
        // Env var suffix is the uppercased prefix; catalog prefixes are lowercase.
        out[prefix.toLowerCase()] = quota;
    }
    return out;
}
/**
 * Create the Hono app that mounts middleware, oRPC API, static assets, and SPA fallback.
 *
 * Stand-alone (no appRt): redirects / → /api/health.
 * With webDistPath: serves static files from webDistPath, with SPA fallback to index.html.
 */
export function createApp(appRt?: ApplicationRuntime, opts?: { fs?: FileSystem; ctx?: ServerContext }): Hono {
    const app = new Hono();
    mountMiddleware(app, appRt);
    app.get('/openapi.json', async (c) => c.json(await generateOpenApiSpec({})));
    const ctx: ServerContext | undefined = opts?.ctx;
    const webDistPath = ctx?.webDistPath;

    registerModules(app, ctx);

    // ── oRPC handler for /api/* ──
    const router = createRouter(ctx);
    const oapiHandler = new OpenAPIHandler(router);
    app.use('/api/*', async (c, next) => {
        if (ctx) c.set('ctx', ctx);
        const { matched, response } = await oapiHandler.handle(c.req.raw, {
            prefix: '/api',
            context: appRt ? { logger: appRt.logger, events: appRt.events, db: appRt.db } : {},
        });
        if (matched) return c.newResponse(response.body, response);
        return next();
    });

    // ── Static asset serving + SPA fallback (local Bun only) ──
    if (webDistPath) {
        // Static file serving: try exact file match BEFORE other handlers
        app.use('*', async (c, next) => {
            const pathname = c.req.path === '/' ? '/index.html' : c.req.path;
            try {
                const file = Bun.file(join(webDistPath, pathname));
                if (await file.exists()) {
                    // Bun.file().type resolves the MIME from the extension — covers
                    // js/css/svg/woff2/png/ico, not just html/json. Browsers reject
                    // ES modules served without a JS content-type, so this matters
                    // for the real Vite board build (W5).
                    const headers = new Headers({ 'content-type': file.type });
                    return new Response(file.stream(), { headers });
                }
            } catch {
                // file error — let next handlers try
            }
            await next();
        });
        // SPA fallback + /api 404: runs only when nothing matched (including static file check above)
        app.notFound(async (c) => {
            if (c.req.path.startsWith('/api')) {
                return c.json({ error: 'Not Found' }, 404);
            }
            try {
                const indexFile = Bun.file(join(webDistPath, 'index.html'));
                if (await indexFile.exists()) {
                    return new Response(indexFile.stream(), {
                        headers: { 'content-type': 'text/html; charset=utf-8' },
                    });
                }
            } catch {
                // index.html missing — fall through
            }
            return c.json({ error: 'Not Found' }, 404);
        });
    } else {
        app.get('/', (c) => c.redirect('/api/health'));
        app.notFound((c) => c.json({ error: 'Not Found' }, 404));
    }

    return app;
}
