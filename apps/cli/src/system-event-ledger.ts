/**
 * CLI EventBus → `system_events` ledger bridge (task 0370).
 *
 * Task 0249 closed the CLI gap for `task.*` / `feature.*` by wiring a durable
 * {@link SystemEventEmitter} (direct DAO write) into the planning mutation path.
 * Workflow and agent execution emit on a process-local {@link EventBus} instead,
 * so the dual of that pattern is {@link registerSystemEventTap} against the same
 * shared {@link SystemEventDao} — one canonical serialization (normalize + actor
 * + correlation), failure isolation (log + swallow), and diagnostic-tier gating.
 *
 * Wired on CLI execution verbs (`spur workflow run` / `continue`,
 * `spur agent run`) and team lifecycle verbs (`spur team up` / `down` /
 * `assign` — task 0371). Read-only verbs never open the ledger path here; the
 * planning emitter remains separately lazy for task/feature mutations.
 */

import {
    configuredSecretValues,
    registerSystemEventTap,
    type SystemEventBus,
    type SystemEventTap,
    systemEventProjectContext,
} from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import type { CliContext } from './context';

/** Handle returned by {@link attachSystemEventLedger}. */
export interface CliSystemEventLedger {
    /** Detach every catalog handler; safe to call more than once. */
    unsubscribe: () => void;
    /** Await in-flight inserts so tests / shutdown never race the process exit. */
    flush: () => Promise<void>;
}

/**
 * Attach a durable system-event tap to a CLI-local bus.
 *
 * Opens the shared SQLite ledger via {@link CliContext.getDb}, registers the
 * catalog tap (default tier always; diagnostic tier only when
 * `diagnosticEnabled` is true), and routes sink failures to the CLI error
 * stream without throwing — a ledger outage must never abort a workflow or
 * agent run (R5).
 *
 * DB open failures are also logged and swallowed: the returned handle is a
 * no-op so the caller can still `flush`/`unsubscribe` in a `finally` without
 * branching on attach success.
 */
export async function attachSystemEventLedger(
    bus: SystemEventBus,
    context: CliContext,
    options: { diagnosticEnabled?: boolean } = {},
): Promise<CliSystemEventLedger> {
    // CLI has no debug sink; cast so we only implement `warn` (persist failures
    // already go through warn). Same pattern as the planning emitter.
    const logger = {
        warn: (msg: string, data?: Record<string, unknown>): void => {
            context.output.error(`${msg}${data ? ` ${JSON.stringify(data)}` : ''}`);
        },
    } as {
        warn: (msg: string, data?: Record<string, unknown>) => void;
        debug: (msg: string, data?: Record<string, unknown>) => void;
    };

    let tap: SystemEventTap | undefined;
    try {
        const dao = new SystemEventDao(await context.getDb());
        tap = registerSystemEventTap(bus, dao, logger, {
            diagnosticEnabled: options.diagnosticEnabled === true,
            secretValues: configuredSecretValues(context.env ?? {}),
            projectContext: systemEventProjectContext(context.cwd),
        });
    } catch (error) {
        // Unmigrated workspace / locked DB / missing table: log + continue.
        // Producers still emit on the in-process bus (human progress, trace
        // writer); only the durable ledger path is absent.
        context.output.error(`system_events ledger attach: ${error instanceof Error ? error.message : String(error)}`);
        return {
            unsubscribe: () => {},
            flush: async () => {},
        };
    }

    return {
        unsubscribe: () => {
            tap?.unsubscribe();
            tap = undefined;
        },
        flush: async () => {
            await tap?.flush();
        },
    };
}
