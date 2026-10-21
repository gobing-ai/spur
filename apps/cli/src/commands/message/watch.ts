import type { Command } from '@commander-js/extra-typings';
import type { InboxService } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { DEFAULT_WATCH_INTERVAL_MS, formatInboxLine, inboxOf, parseInterval } from './shared';

/** Options for the watch core loop. */
export interface WatchOptions {
    jsonEnvelope?: boolean;
    agent: string;
    intervalMs: number;
    json: boolean;
}

/** Injectable knobs for {@link runMessageWatch} (tests pass maxIterations/sleep to avoid real waits). */
export interface WatchRuntime {
    /** AbortSignal — aborting ends the loop cleanly (SIGINT in the CLI action). */
    signal?: AbortSignal;
    /** Hard cap on poll iterations (tests only); undefined = run until aborted. */
    maxIterations?: number;
    /** Sleep override (ms) — defaults to a cancellable setTimeout. Tests inject a no-op. */
    sleep?: (ms: number) => Promise<void>;
}

/** Output sink needed by the watch loop — just `write`. */
export interface WatchOutput {
    write(message: string): void;
}

/**
 * Core watch loop — polls the inbox and surfaces each NEW message exactly once.
 *
 * SURFACES, never CONSUMES: it never marks messages read or delivered, which makes watch safe
 * beside drain loops. Exits cleanly on signal abort or after `maxIterations` (test cap).
 */
export async function runMessageWatch(
    svc: Pick<InboxService, 'list'>,
    output: WatchOutput,
    options: WatchOptions,
    runtime: WatchRuntime = {},
): Promise<void> {
    const sleep = runtime.sleep ?? ((ms: number) => defaultSleep(ms, runtime.signal));
    const seen = new Set<string>();
    let iteration = 0;
    while (true) {
        if (runtime.signal?.aborted) return;
        if (runtime.maxIterations !== undefined && iteration >= runtime.maxIterations) return;

        const page = await svc.list(options.agent, 'in');
        // Newest-first ordering from the DAO — iterate in reverse so older-arrived
        // messages surface before newer ones when multiple land between polls.
        for (let i = page.messages.length - 1; i >= 0; i--) {
            const msg = page.messages[i];
            if (!msg || seen.has(msg.id)) continue;
            seen.add(msg.id);
            if (options.json) {
                output.write(toEnvelopeJson(msg, { enveloped: options.jsonEnvelope }));
            } else {
                output.write(formatInboxLine(msg));
            }
        }

        iteration++;
        await sleep(options.intervalMs);
    }
}

/** Cancellable sleep; resolves immediately if the signal is already aborted. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/** Register `spur message watch`. */
export function registerMessageWatchCommand(noun: Command, context: CliContext): void {
    noun.command('watch')
        .description('Follow an agent inbox — surface new messages as they arrive (Ctrl-C to exit).')
        .requiredOption('--agent <id>', 'Agent id to watch')
        .option('--interval <ms>', 'Poll interval in milliseconds', String(DEFAULT_WATCH_INTERVAL_MS))
        .option(...SHARED_OPTIONS.jsonMessageStream)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const intervalMs = parseInterval(options.interval);
            if (intervalMs === null) {
                writeJsonError(
                    context.output,
                    options,
                    `invalid --interval "${options.interval}" (expected a positive integer ms)`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const controller = new AbortController();
            const onSigInt = () => controller.abort();
            process.on('SIGINT', onSigInt);
            try {
                await runMessageWatch(
                    inboxOf(context),
                    context.output,
                    {
                        agent: options.agent,
                        intervalMs,
                        json: options.json ?? false,
                    },
                    {
                        signal: controller.signal,
                    },
                );
            } finally {
                process.off('SIGINT', onSigInt);
            }
        });
}
