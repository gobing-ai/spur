import type { Command } from '@commander-js/extra-typings';
import {
    type AgentService,
    DEFAULT_STALL_MS,
    followSystemEventsAfter,
    type InboxEntry,
    type SendWaitUntil,
    TeamService,
    WaitError,
    waitForOccupant,
} from '@gobing-ai/spur-app';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Default sender used for operator-originated messages. */
const DEFAULT_FROM = 'operator';

/** Default poll interval for `spur message watch` (ms). */
const DEFAULT_WATCH_INTERVAL_MS = 2000;

/** Register `spur message` commands. */
export function registerMessageCommand(program: Command, context: CliContext): void {
    const noun = program.command('message').summary('send and inspect durable inter-agent messages');

    noun.command('send')
        .description('Enqueue a message for an agent. Use --wait to block until the recipient reaches a state.')
        .argument('<body>', 'Message body')
        .requiredOption('--to <id>', 'Recipient agent id')
        .option('--from <id>', 'Sender id', DEFAULT_FROM)
        .option('--wait', 'Block until the recipient occupant reaches --until (default: invoke-exit)')
        .option(...SHARED_OPTIONS.untilMessage, collectSendUntil, [])
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option(...SHARED_OPTIONS.json)
        .action(async (body, options) => {
            const svc = new TeamService(context);
            const code = await runMessageSend(svc, context, body, options);
            context.setExitCode(code);
        });

    noun.command('inbox')
        .description('List messages addressed to an agent.')
        .requiredOption(...SHARED_OPTIONS.agentIdMessage)
        .option(...SHARED_OPTIONS.json)
        .action(async (options) => {
            const svc = new TeamService(context);
            const code = await runMessageInbox(svc, context, options);
            context.setExitCode(code);
        });

    noun.command('reply')
        .description('Thread a reply to a message.')
        .argument('<msg-id>', 'Message id to reply to')
        .argument('<body>', 'Reply body')
        .option(...SHARED_OPTIONS.json)
        .action(async (msgId, body, options) => {
            const svc = new TeamService(context);
            const code = await runMessageReply(svc, context, msgId, body, options);
            context.setExitCode(code);
        });

    noun.command('watch')
        .description('Follow an agent inbox — surface new messages as they arrive (Ctrl-C to exit).')
        .requiredOption(...SHARED_OPTIONS.agentIdWatch)
        .option('--interval <ms>', 'Poll interval in milliseconds', String(DEFAULT_WATCH_INTERVAL_MS))
        .option(...SHARED_OPTIONS.jsonMessageStream)
        .action(async (options) => {
            const svc = new TeamService(context);
            const intervalMs = parseInterval(options.interval);
            if (intervalMs === null) {
                context.output.error(`invalid --interval "${options.interval}" (expected a positive integer ms)`);
                context.setExitCode(2);
                return;
            }
            const controller = new AbortController();
            const onSigInt = () => controller.abort();
            process.on('SIGINT', onSigInt);
            try {
                await runMessageWatch(
                    svc,
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

/** `spur message send --to <agent-id> <body> [--from <agent-id>] [--wait] [--until injected|invoke-exit] [--timeout <ms>] [--json]` */
async function runMessageSend(
    svc: TeamService,
    context: CliContext,
    body: string,
    options: {
        to: string;
        from: string;
        wait?: boolean;
        until: SendWaitUntil[];
        timeout?: number;
        json?: boolean;
    },
): Promise<number> {
    const trimmed = body.trim();
    if (trimmed === '') {
        if (options.json) {
            context.output.write(
                toJson({ error: { code: 'usage', message: 'message send requires a non-empty body' } }),
            );
        } else {
            context.output.error('message send requires a non-empty body');
        }
        return 2;
    }
    const from = options.from || DEFAULT_FROM;

    // `--wait`: snapshot the occupant BEFORE enqueue so the wait pins the run
    // that will process this message. A later occupant cannot satisfy it.
    // (R5) Enqueue is NOT rolled back if the wait later fails.
    let pinnedBeforeSend: { specId: string; runId: string; generation: number } | null = null;
    if (options.wait === true) {
        const agentService = context.agentService();
        const occupant = await agentService.getOccupant({ specId: options.to });
        if (occupant === null) {
            return sendWaitFail(context, options, 'occupant_gone', `no occupant for specId "${options.to}"`);
        }
        pinnedBeforeSend = { specId: options.to, runId: occupant.runId, generation: occupant.generation };
    }

    const result = await svc.sendMessage(from, options.to, trimmed);

    if (options.wait !== true) {
        if (options.json) {
            context.output.write(toJson(result));
        } else {
            context.output.write(`queued ${result.msgId} → ${result.toId}`);
        }
        return 0;
    }

    // Wait resolved on the pin captured before send (R5). The early-return
    // above guarantees we only reach here when --wait snapped a pin.
    if (pinnedBeforeSend === null) {
        return sendWaitFail(context, options, 'occupant_gone', `no occupant for specId "${options.to}"`);
    }
    const pin = pinnedBeforeSend;
    const untilList = options.until;
    if (untilList.length === 0) untilList.push('invoke-exit');

    const agentService = context.agentService();
    const eventDao = new SystemEventDao(await context.getDb());
    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        let satisfied: string | null = null;
        let firstError: WaitError | null = null;
        for (const until of untilList) {
            if (until === 'injected') {
                // `injected`: wait until the recipient's inbox drains the message.
                // Poll countPending returning to zero (or a status change). For wave
                // 2 this is satisfied when pending drops to 0 after send.
                try {
                    await waitForPendingDrain(agentService, svc, pin, options.timeout, controller.signal);
                    satisfied = 'injected';
                    break;
                } catch (error) {
                    if (error instanceof WaitError) {
                        firstError = error;
                        if (error.code !== 'wait_stalled') break;
                    } else throw error;
                }
            } else {
                // `invoke-exit`: wait for an agent.invoke.exit on the pinned run.
                try {
                    const res = await waitForOccupant(
                        {
                            getOccupant: (id) => agentService.getOccupant({ specId: id }),
                            countPending: (id) => svc.countPending(id),
                            latestInvokeEvent: (r) => readLatestInvokeEvent(eventDao, r),
                            // Snapshot-then-follow over the shared ledger (G4 R8):
                            // only the pinned run's invoke events are followed.
                            follow: (afterSequence) =>
                                followSystemEventsAfter(context.getDb, {
                                    afterSequence,
                                    match: (row) =>
                                        row.run_id === pin.runId &&
                                        (row.event_name === 'agent.invoke.start' ||
                                            row.event_name === 'agent.invoke.exit'),
                                    signal: controller.signal,
                                }),
                            now: () => Date.now(),
                            sleep: (ms) => sendSleep(ms, controller.signal),
                        },
                        {
                            pin: pin,
                            until: 'invoke-exit',
                            timeoutMs: options.timeout,
                            signal: controller.signal,
                        },
                    );
                    satisfied = res.satisfied;
                    break;
                } catch (error) {
                    if (error instanceof WaitError) {
                        firstError = error;
                        if (error.code !== 'wait_stalled') break;
                    } else throw error;
                }
            }
        }

        if (satisfied !== null) {
            const payload = { msgId: result.msgId, toId: result.toId, status: result.status, wait: { satisfied } };
            if (options.json) {
                context.output.write(toJson(payload));
            } else {
                context.output.write(`queued ${result.msgId} → ${result.toId} (wait: ${satisfied})`);
            }
            return 0;
        }
        const err = firstError ?? new WaitError('wait_stalled', 'no --until target satisfied');
        return sendWaitFail(context, options, err.code, err.message);
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}

/** `spur message inbox --agent <id> [--json]` */
async function runMessageInbox(
    svc: TeamService,
    context: CliContext,
    options: { agent: string; json?: boolean },
): Promise<number> {
    const inbox = await svc.getInbox(options.agent);
    if (options.json) {
        context.output.write(toJson(inbox));
        return 0;
    }
    if (inbox.count === 0) {
        context.output.write(`No messages for ${options.agent}`);
        return 0;
    }
    context.output.write(inbox.messages.map(formatInboxLine).join('\n'));
    return 0;
}

/** `spur message reply <msg-id> <body> [--json]` */
async function runMessageReply(
    svc: TeamService,
    context: CliContext,
    msgId: string,
    body: string,
    options: { json?: boolean },
): Promise<number> {
    const trimmed = body.trim();
    if (trimmed === '') {
        context.output.error('message reply requires a non-empty body');
        return 2;
    }

    const result = await svc.replyToMessage(msgId, trimmed);
    if (options.json) {
        context.output.write(toJson(result));
    } else {
        context.output.write(`replied ${result.msgId} → ${result.toId}`);
    }
    return 0;
}

/** Format a single inbox row for plain-text listing (body truncated). */
function formatInboxLine(entry: InboxEntry): string {
    const from = entry.fromId ?? DEFAULT_FROM;
    const body = entry.body.length > 60 ? `${entry.body.slice(0, 57)}...` : entry.body;
    return `${entry.id}\t${entry.status}\t${from}\t${body}\t${entry.createdAt}`;
}

/** Options for the watch core loop. */
export interface WatchOptions {
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
 * SURFACES, never CONSUMES: it never marks messages read/delivered (read-marking
 * stays with `--drain`/explicit reads), which makes watch safe beside drain loops.
 * `--json` emits one JSON object per new message line; plain mode prints the inbox
 * row. Exits cleanly on signal abort or after `maxIterations` (test cap).
 */
export async function runMessageWatch(
    svc: TeamService,
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

        const inbox = await svc.getInbox(options.agent);
        // Newest-first ordering from the DAO — iterate in reverse so older-arrived
        // messages surface before newer ones when multiple land between polls.
        for (let i = inbox.messages.length - 1; i >= 0; i--) {
            const msg = inbox.messages[i];
            if (!msg || seen.has(msg.id)) continue;
            seen.add(msg.id);
            if (options.json) {
                output.write(toJson(msg));
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

/** Parse the --interval flag; returns null for non-positive/non-numeric input. */
export function parseInterval(raw: string): number | null {
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
}

/** Valid `send --until` states. */
const SEND_UNTIL_STATES = new Set<SendWaitUntil>(['injected', 'invoke-exit']);

/** Commander reducer: accumulate repeatable `--until` values for send-wait. */
function collectSendUntil(value: string, acc: SendWaitUntil[]): SendWaitUntil[] {
    if (!SEND_UNTIL_STATES.has(value as SendWaitUntil)) {
        throw new Error(
            `invalid --until "${value}" for send --wait (expected one of: ${[...SEND_UNTIL_STATES].join(', ')})`,
        );
    }
    return [...acc, value as SendWaitUntil];
}

/** Parse the `--timeout` flag as a positive-integer ms value, or undefined. */
function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

/** Cancellable sleep; resolves immediately if the signal is already aborted. */
function sendSleep(ms: number, signal?: AbortSignal): Promise<void> {
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

/** Emit a typed send-wait failure (exit 1) with the `--json` error envelope. */
function sendWaitFail(context: CliContext, options: { json?: boolean }, code: string, message: string): number {
    if (options.json) {
        context.output.write(toJson({ error: { code, message } }));
    } else {
        context.output.error(`${code}: ${message}`);
    }
    return 1;
}

/** Read the latest cataloged invoke event for a runId from the system_events ledger. */
async function readLatestInvokeEvent(
    dao: SystemEventDao,
    runId: string,
): Promise<{ eventName: string; sequence: number | null } | null> {
    const rows: SystemEventRow[] = await dao.query({
        run_id: runId,
        names: ['agent.invoke.start', 'agent.invoke.exit'],
        limit: 1,
    });
    const row = rows[0];
    if (row === undefined) return null;
    return { eventName: row.event_name, sequence: row.sequence };
}

/**
 * `--until injected`: wait until the recipient's queued inbox drains to zero on
 * the pinned occupant run. Reuses the wait identity + stall/timeout contract.
 */
async function waitForPendingDrain(
    agentService: AgentService,
    teamService: TeamService,
    pin: { specId: string; runId: string; generation: number },
    timeoutMs: number | undefined,
    signal?: AbortSignal,
): Promise<void> {
    const start = Date.now();
    const deadline = timeoutMs === undefined ? Number.POSITIVE_INFINITY : start + timeoutMs;
    const stallMs = Math.min(timeoutMs ?? DEFAULT_STALL_MS, DEFAULT_STALL_MS);
    let lastPending = -1; // -1 = not yet sampled
    for (;;) {
        if (signal?.aborted) throw new WaitError('timeout', 'wait aborted');
        const clock = Date.now();
        if (clock >= deadline) throw new WaitError('timeout', `wait timed out after ${timeoutMs}ms`);
        const occupant = await agentService.getOccupant({ specId: pin.specId });
        if (occupant === null) throw new WaitError('occupant_gone', `occupant for specId "${pin.specId}" is gone`);
        if (occupant.runId !== pin.runId) throw new WaitError('run_replaced', `run ${pin.runId} replaced`);
        if (occupant.generation > pin.generation) throw new WaitError('run_replaced', `generation bumped`);
        const pending = await teamService.countPending(pin.specId);
        // Progress = the queued count moved (a drain or a new inject). A
        // non-moving count from an idle occupant is a stall, not a wait.
        const progressed = lastPending >= 0 && pending !== lastPending;
        if (pending === 0) return;
        if (lastPending >= 0 && !progressed && clock - start >= stallMs) {
            throw new WaitError('wait_stalled', `inbox not draining within ${stallMs}ms`);
        }
        lastPending = pending;
        await sendSleep(100, signal);
    }
}
