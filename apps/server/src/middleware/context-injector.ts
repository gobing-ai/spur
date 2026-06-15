import type { ApplicationRuntime } from '@gobing-ai/ts-infra/application';
import type { MiddlewareHandler } from 'hono';

/**
 * Injects `ApplicationRuntime` into the Hono context so downstream oRPC
 * procedures can access `c.var.rt` (logger, events, db).
 *
 * `c.var.ctx` (ServerContext) is wired in task 0073; this middleware only
 * sets `rt` today. The `ctx` variable is declared on the Hono
 * `ContextVariableMap` but left unset (typed as `ServerContext | undefined`)
 * until 0073 lands.
 *
 * @see design §2.2 middleware pipeline position 8
 */
export const contextInjector = (appRt: ApplicationRuntime): MiddlewareHandler =>
    async function contextInjectorMiddleware(c, next) {
        c.set('rt', appRt);
        await next();
    };
