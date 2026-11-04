import type { Command } from '@commander-js/extra-typings';
import { DeliveryReconciler, type UnresolvedDelivery } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { formatInboxLine, inboxOf, widenInboxRow } from './shared';

/** Register `spur message inbox`. */
export function registerMessageInboxCommand(noun: Command, context: CliContext): void {
    noun.command('inbox')
        .description('List messages addressed to an agent.')
        .requiredOption('--agent <id>', 'Agent id')
        .option(
            '--unresolved',
            'Only messages the 0834 reconciler holds (delivery-failed | attempts-exhausted | outcome-unknown | run-exit-only)',
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runMessageInbox(context, options);
            context.setExitCode(code);
        });
}

async function runMessageInbox(
    context: CliContext,
    options: { agent: string; json?: boolean; jsonEnvelope?: boolean; unresolved?: boolean },
): Promise<number> {
    const classify = options.json === true || options.unresolved === true;
    let holds = new Map<string, UnresolvedDelivery>();
    if (classify) {
        // G11 R3: `spur message inbox` writes NOTHING. `classify` is the pure pass; the
        // reconciler's write (settling an expired claim) belongs to the orchestrator's tick, so a
        // listing can never fail a message as a side effect of being read.
        const reconciler = new DeliveryReconciler(context);
        holds = new Map((await reconciler.classify(options.agent)).map((u) => [u.messageId, u]));
    }
    const page = await inboxOf(context).list(options.agent, 'in');
    const messages = options.unresolved === true ? page.messages.filter((m) => holds.has(m.id)) : page.messages;
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                {
                    messages: messages.map((m) => widenInboxRow(m, holds.get(m.id))),
                    count: messages.length,
                },
                { enveloped: options.jsonEnvelope },
            ),
        );
        return 0;
    }
    if (messages.length === 0) {
        context.output.write(`No messages for ${options.agent}`);
        return 0;
    }
    context.output.write(messages.map(formatInboxLine).join('\n'));
    return 0;
}
