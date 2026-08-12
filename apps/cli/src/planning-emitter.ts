/**
 * Lazy planning-event emitter factory for the CLI mutation path (task 0249).
 *
 * The server wires `registerSystemEventTap` against a live EventBus; the CLI
 * mutation path (`spur task` / `spur feature`) has no bus, so we install a
 * durable {@link SystemEventEmitter} that persists `task.*` / `feature.*`
 * rows straight into the shared `system_events` ledger the tabview reads.
 *
 * DB resolution is deferred to the first `emit()` call so read-only verbs
 * (`spur task list`, `spur feature show`) never open the SQLite file — the
 * emitter is only paid for on a mutating verb (design: "Keep the DB
 * resolution lazy"). Sink failures are routed to the CLI output stream and
 * swallowed so the file mutation still succeeds (R5).
 */

import {
    configuredSecretValues,
    type EventEmitter,
    type PlanningEvent,
    SystemEventEmitter,
    systemEventProjectContext,
} from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import type { CliContext } from './context';

/** Minimal warn logger that routes sink failures to the CLI error stream. */
function makeWarnLogger(context: CliContext): { warn: (msg: string, data?: Record<string, unknown>) => void } {
    return {
        warn: (msg: string, data?: Record<string, unknown>): void => {
            context.output.error(`${msg}${data ? ` ${JSON.stringify(data)}` : ''}`);
        },
    };
}

/**
 * Build a lazy planning emitter around {@link SystemEventEmitter}. The shared
 * SQLite adapter and the {@link SystemEventDao} are constructed on the first
 * emit; any error in that path (or in the dao insert) is logged and swallowed
 * so callers — the {@link PlanningWriteService} 9-step pipeline — never abort
 * or roll back the file mutation on a sink failure (R5).
 */
export function makePlanningEmitter(context: CliContext): EventEmitter {
    let cached: SystemEventEmitter | undefined;
    const logger = makeWarnLogger(context);
    return {
        async emit(event: PlanningEvent): Promise<void> {
            try {
                cached ??= new SystemEventEmitter(
                    new SystemEventDao(await context.getDb()),
                    logger,
                    {},
                    configuredSecretValues(context.env ?? {}),
                    systemEventProjectContext(context.cwd),
                );
                await cached.emit(event);
            } catch (error) {
                // Lazy DB resolution can itself fail (e.g. unmigrated workspace);
                // treat the same as a sink failure — log + swallow, never throw.
                context.output.error(
                    `system_events emitter: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        },
    };
}
