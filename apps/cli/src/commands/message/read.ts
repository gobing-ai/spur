import type { Command } from '@commander-js/extra-typings';
import { MessageNotFoundError } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { inboxOf } from './shared';

/** Register `spur message read`. */
export function registerMessageReadCommand(noun: Command, context: CliContext): void {
    noun.command('read')
        .description('Mark a message read by its recipient (the operator by default).')
        .argument('<msg-id>', 'Message id')
        .option('--reader <id>', 'Reader address', 'operator')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (msgId, options) => {
            const jsonEnvelope = options.jsonEnvelope;
            context.setExitCode(await runMessageRead(context, msgId, { ...options, jsonEnvelope }));
        });
}

async function runMessageRead(
    context: CliContext,
    msgId: string,
    options: { reader: string; json?: boolean; jsonEnvelope?: boolean },
): Promise<number> {
    try {
        const receipt = await inboxOf(context).markRead(msgId, options.reader);
        if (options.json) {
            context.output.write(toEnvelopeJson(receipt, { enveloped: options.jsonEnvelope }));
        } else {
            context.output.write(
                receipt.transitioned
                    ? `read ${msgId} by ${options.reader}`
                    : `${msgId} was already read by ${options.reader}`,
            );
        }
        return 0;
    } catch (error) {
        // Only a genuine not-found is the operator's to fix. A ledger/DB fault must not be
        // reported as "message not found" — that would tell the operator the receipt was never
        // written when it may well have been.
        if (!(error instanceof MessageNotFoundError)) throw error;
        writeJsonError(
            context.output,
            options,
            `message ${msgId} not found for ${options.reader}`,
            'VALIDATION_FAILED',
        );
        return 1;
    }
}
