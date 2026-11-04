import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { inboxOf } from './shared';

/** Register `spur message reply`. */
export function registerMessageReplyCommand(noun: Command, context: CliContext): void {
    noun.command('reply')
        .description('Thread a reply to a message.')
        .argument('<msg-id>', 'Message id to reply to')
        .argument('<body>', 'Reply body')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (msgId, body, options) => {
            const code = await runMessageReply(context, msgId, body, options);
            context.setExitCode(code);
        });
}

async function runMessageReply(
    context: CliContext,
    msgId: string,
    body: string,
    options: { json?: boolean; jsonEnvelope?: boolean },
): Promise<number> {
    const trimmed = body.trim();
    if (trimmed === '') {
        writeJsonError(context.output, options, 'message reply requires a non-empty body', 'VALIDATION_FAILED');
        return 2;
    }

    const inbox = inboxOf(context);
    const original = await inbox.get(msgId);
    if (original === null) {
        writeJsonError(context.output, options, `message ${msgId} not found`, 'VALIDATION_FAILED');
        return 1;
    }
    // Reply as the original recipient: that is the peer the sender is talking to.
    const reply = await inbox.reply(msgId, original.toId, trimmed);
    if (options.json) {
        context.output.write(toEnvelopeJson(reply, { enveloped: options.jsonEnvelope }));
    } else {
        context.output.write(`replied ${reply.id} → ${reply.toId}`);
    }
    return 0;
}
