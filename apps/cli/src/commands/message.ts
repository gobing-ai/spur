import type { Command } from '@commander-js/extra-typings';
import { type InboxEntry, TeamService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Default sender used for operator-originated messages. */
const DEFAULT_FROM = 'operator';

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
