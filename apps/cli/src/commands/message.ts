import { type InboxEntry, TeamService } from '@gobing-ai/spur-app';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Default sender used for operator-originated messages. */
const DEFAULT_FROM = 'operator';

/** Render detailed usage for `spur message`. */
export function helpText(): string {
    return [
        'spur message - send and inspect durable inter-agent messages',
        '',
        'Usage: spur message <command> [options]',
        '',
        'Commands:',
        '  send --to <id> <body> [--from <id>] [--json]',
        '      Enqueue a message for an agent.',
        '  inbox --agent <id> [--json]',
        '      List messages addressed to an agent.',
        '  reply <msg-id> <body> [--json]',
        '      Thread a reply to a message.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --to <id>          Recipient agent id for send',
        '  --from <id>        Sender agent id for send (default: operator)',
        '  --agent <id>       Recipient agent id for inbox',
        '  --json             Output machine-readable JSON',
        '  -h, --help         Show this help',
        '',
        'Examples:',
        '  spur message send --to planner "review task 0012"',
        '  spur message inbox --agent planner',
        '  spur message reply msg_123 "done"',
    ].join('\n');
}

/** Execute `spur message` commands backed by TeamService. */
export async function runMessageCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const svc = new TeamService(context);
    try {
        switch (subcommand) {
            case 'send':
                return await runMessageSend(svc, context, flags, positionals);
            case 'inbox':
                return await runMessageInbox(svc, context, flags);
            case 'reply':
                return await runMessageReply(svc, context, flags, positionals);
            default:
                context.output.error(`Unknown message command: ${subcommand ?? '(none)'}`);
                return 1;
        }
    } catch (error) {
        // Surface validation (bad agent id) and lookup (unknown msg id) errors as a
        // clean exit rather than an uncaught throw bubbling to the top-level handler.
        context.output.error(error instanceof Error ? error.message : String(error));
        return 2;
    }
}

/** `spur message send --to <agent-id> <body> [--from <agent-id>] [--json]` */
async function runMessageSend(
    svc: TeamService,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const json = booleanFlag(flags, 'json');
    const to = stringFlag(flags, 'to', '');
    if (to === '') {
        context.output.error('message send requires --to <agent-id>');
        return 2;
    }
    const body = positionals.join(' ').trim();
    if (body === '') {
        context.output.error('message send requires a non-empty body');
        return 2;
    }
    const from = stringFlag(flags, 'from', DEFAULT_FROM);

    const result = await svc.sendMessage(from, to, body);
    if (json) {
        context.output.write(toJson(result));
    } else {
        context.output.write(`queued ${result.msgId} → ${result.toId}`);
    }
    return 0;
}

/** `spur message inbox [--agent <id>] [--json]` */
async function runMessageInbox(
    svc: TeamService,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    const json = booleanFlag(flags, 'json');
    const agent = stringFlag(flags, 'agent', '');
    if (agent === '') {
        context.output.error('message inbox requires --agent <id>');
        return 2;
    }

    const inbox = await svc.getInbox(agent);
    if (json) {
        context.output.write(toJson(inbox));
        return 0;
    }
    if (inbox.count === 0) {
        context.output.write(`No messages for ${agent}`);
        return 0;
    }
    context.output.write(inbox.messages.map(formatInboxLine).join('\n'));
    return 0;
}

/** `spur message reply <msg-id> <body> [--json]` */
async function runMessageReply(
    svc: TeamService,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const json = booleanFlag(flags, 'json');
    const msgId = positionals[0];
    if (msgId === undefined) {
        context.output.error('message reply requires <msg-id>');
        return 2;
    }
    const body = positionals.slice(1).join(' ').trim();
    if (body === '') {
        context.output.error('message reply requires a non-empty body');
        return 2;
    }

    const result = await svc.replyToMessage(msgId, body);
    if (json) {
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
