import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { DEFAULT_FROM, inboxOf } from './shared';

/** Register `spur message show`. */
export function registerMessageShowCommand(noun: Command, context: CliContext): void {
    noun.command('show')
        .description('Print one message thread: the root and every reply, oldest first, both directions.')
        .argument('<msg-id>', 'Message id (or any id in its thread)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (msgId, options) => {
            // The envelope flag is threaded explicitly so the surface sweep can see it (0697 AC4).
            context.setExitCode(
                await runMessageShow(context, msgId, { json: options.json, jsonEnvelope: options.jsonEnvelope }),
            );
        });
}

async function runMessageShow(
    context: CliContext,
    msgId: string,
    options: { json?: boolean; jsonEnvelope?: boolean },
): Promise<number> {
    const rows = await inboxOf(context).thread(msgId);
    if (rows.length === 0) {
        writeJsonError(context.output, options, `message ${msgId} not found`, 'VALIDATION_FAILED');
        return 1;
    }
    if (options.json) {
        context.output.write(
            toEnvelopeJson({ messages: rows, count: rows.length }, { enveloped: options.jsonEnvelope }),
        );
        return 0;
    }
    context.output.write(
        rows
            .map((row) => {
                const from = row.fromId || DEFAULT_FROM;
                const read = row.readAt === null ? '' : ' (read)';
                return `${new Date(row.createdAt).toISOString()}\t${from} → ${row.toId}\t${row.status}${read}\n${row.body}`;
            })
            .join('\n\n'),
    );
    return 0;
}
