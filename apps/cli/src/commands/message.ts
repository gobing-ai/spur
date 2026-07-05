import type { Command } from '@commander-js/extra-typings';
import { type InboxEntry, TeamService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Default sender used for operator-originated messages. */
const DEFAULT_FROM = 'operator';

/** Default poll interval for `spur message watch` (ms). */
const DEFAULT_WATCH_INTERVAL_MS = 2000;

/** Register `spur message` commands. */
export function registerMessageCommand(program: Command, context: CliContext): void {
    const noun = program.command('message').summary('send and inspect durable inter-agent messages');

    noun.command('send')
        .description('Enqueue a message for an agent.')
        .argument('<body>', 'Message body')
        .requiredOption('--to <id>', 'Recipient agent id')
        .option('--from <id>', 'Sender id', DEFAULT_FROM)
        .option('--json', 'Output machine-readable JSON')
        .action(async (body, options) => {
            const svc = new TeamService(context);
            const code = await runMessageSend(svc, context, body, options);
            context.setExitCode(code);
        });

    noun.command('inbox')
        .description('List messages addressed to an agent.')
        .requiredOption('--agent <id>', 'Agent id')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const svc = new TeamService(context);
            const code = await runMessageInbox(svc, context, options);
            context.setExitCode(code);
        });

    noun.command('reply')
        .description('Thread a reply to a message.')
        .argument('<msg-id>', 'Message id to reply to')
        .argument('<body>', 'Reply body')
        .option('--json', 'Output machine-readable JSON')
        .action(async (msgId, body, options) => {
            const svc = new TeamService(context);
            const code = await runMessageReply(svc, context, msgId, body, options);
            context.setExitCode(code);
        });

    noun.command('watch')
        .description('Follow an agent inbox — surface new messages as they arrive (Ctrl-C to exit).')
        .requiredOption('--agent <id>', 'Agent id to watch')
        .option('--interval <ms>', 'Poll interval in milliseconds', String(DEFAULT_WATCH_INTERVAL_MS))
        .option('--json', 'Output one JSON object per new message (machine-consumable)')
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

/** `spur message send --to <agent-id> <body> [--from <agent-id>] [--json]` */
async function runMessageSend(
    svc: TeamService,
    context: CliContext,
    body: string,
    options: { to: string; from: string; json?: boolean },
): Promise<number> {
    const trimmed = body.trim();
    if (trimmed === '') {
        context.output.error('message send requires a non-empty body');
        return 2;
    }
    const from = options.from || DEFAULT_FROM;

    const result = await svc.sendMessage(from, options.to, trimmed);
    if (options.json) {
        context.output.write(toJson(result));
    } else {
        context.output.write(`queued ${result.msgId} → ${result.toId}`);
    }
    return 0;
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
