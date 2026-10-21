import type { Command } from '@commander-js/extra-typings';
import {
    AgentCoordinationService,
    followSystemEventsAfter,
    resolveAgentSelector,
    type SendWaitUntil,
    WaitError,
    waitForOccupant,
} from '@gobing-ai/spur-app';
import { SystemEventDao } from '@gobing-ai/spur-domain';
import { validateAgentId } from '@gobing-ai/ts-ai-runner';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import {
    DEFAULT_FROM,
    inboxOf,
    parseTimeout,
    readLatestInvokeEvent,
    resolveOrchestratorAddress,
    sendSleep,
    sendWaitFail,
    waitForMessageClaim,
} from './shared';

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

/** Register `spur message send`. */
export function registerMessageSendCommand(noun: Command, context: CliContext): void {
    noun.command('send')
        .description('Enqueue a message for an agent. Use --wait to block until the recipient reaches a state.')
        .argument('<body>', 'Message body')
        .option('--to <id>', 'Recipient agent id (mutually exclusive with --role)')
        .option(
            '--role <name>',
            'Address by Layer-1 role or executor name; must resolve to exactly one materialized instance',
        )
        .option('--from <id>', 'Sender id', DEFAULT_FROM)
        .option(
            '--request-key <key>',
            'Caller-minted idempotency key: the same key + payload replays the original receipt instead of enqueuing twice (0832)',
        )
        .option('--wait', 'Block until the recipient occupant reaches --until (default: invoke-exit)')
        .option(...SHARED_OPTIONS.untilMessage, collectSendUntil, [])
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (body, options) => {
            const svc = new AgentCoordinationService(context);
            // 0685 R6: resolve --role to exactly one materialized instance spec id
            // before anything else; the rest of the flow stays identity-pinned.
            let toId = options.to;
            if (options.role !== undefined && options.to !== undefined) {
                const message = 'message send accepts --to or --role, not both';
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            { error: { code: 'usage', message } },
                            {
                                enveloped: options.jsonEnvelope,
                                error: { code: 'INTERNAL_ERROR', message: message, details: { cliCode: 'usage' } },
                            },
                        ),
                    );
                } else {
                    context.output.error(message);
                }
                context.setExitCode(2);
                return;
            }
            if (options.role !== undefined) {
                const resolution = await resolveAgentSelector(
                    () => svc.listFleetMembers(),
                    context.agentConfig,
                    options.role,
                );
                if (!resolution.ok) {
                    if (options.json) {
                        context.output.write(
                            toEnvelopeJson(
                                { error: { code: resolution.code, message: resolution.message } },
                                {
                                    enveloped: options.jsonEnvelope,
                                    error: {
                                        code: 'INTERNAL_ERROR',
                                        message: resolution.message,
                                        details: { cliCode: resolution.code },
                                    },
                                },
                            ),
                        );
                    } else {
                        context.output.error(resolution.message);
                    }
                    context.setExitCode(resolution.code === 'unknown_selector' ? 2 : 1);
                    return;
                }
                toId = resolution.specId;
            }
            const code = await runMessageSend(context, body, {
                ...options,
                to: toId ?? '',
                requestKey:
                    typeof options.requestKey === 'string' && options.requestKey.length > 0
                        ? options.requestKey.trim()
                        : undefined,
            });
            context.setExitCode(code);
        });
}

async function runMessageSend(
    context: CliContext,
    body: string,
    options: {
        to: string;
        from: string;
        wait?: boolean;
        until: SendWaitUntil[];
        timeout?: number;
        json?: boolean;
        jsonEnvelope?: boolean;
        requestKey?: string;
    },
): Promise<number> {
    const trimmed = body.trim();
    if (trimmed === '') {
        if (options.json) {
            context.output.write(
                toEnvelopeJson(
                    { error: { code: 'usage', message: 'message send requires a non-empty body' } },
                    {
                        enveloped: options.jsonEnvelope,
                        error: {
                            code: 'INTERNAL_ERROR',
                            message: 'message send requires a non-empty body',
                            details: { cliCode: 'usage' },
                        },
                    },
                ),
            );
        } else {
            context.output.error('message send requires a non-empty body');
        }
        return 2;
    }
    if (options.requestKey !== undefined && options.requestKey.trim() === '') {
        // An idempotency key that is blank expresses no identity: it would make every send replay
        // the same row, so it is a usage error rather than a silent collapse.
        writeJsonError(context.output, options, 'message send requires a non-empty --request-key', 'VALIDATION_FAILED');
        return 2;
    }
    if (options.to === '') {
        // G11 R1: the operator's default recipient is the project's orchestrator member. A project
        // with none has no inbox to deliver to, so this is a usage error and writes no row.
        const resolved = await resolveOrchestratorAddress(context);
        if (resolved === null) {
            const message =
                'message send found no orchestrator member — pass --to <id> or --role <name>, or bind agent.fleet';
            if (options.json) {
                context.output.write(
                    toEnvelopeJson(
                        { error: { code: 'usage', message } },
                        {
                            enveloped: options.jsonEnvelope,
                            error: { code: 'INTERNAL_ERROR', message, details: { cliCode: 'usage' } },
                        },
                    ),
                );
            } else {
                context.output.error(message);
            }
            return 2;
        }
        options.to = resolved;
    }
    const from = options.from || DEFAULT_FROM;
    // Both endpoints are addresses, so both are syntax-checked before a row exists: a typo'd id
    // must surface here, not become an undeliverable message. Existence is not required — a spec
    // may be authored later — but a malformed id can never be one.
    for (const id of [from, options.to]) {
        try {
            validateAgentId(id);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            writeJsonError(context.output, options, message, 'VALIDATION_FAILED');
            return 1;
        }
    }

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

    const sent = await inboxOf(context).send({
        from,
        to: options.to,
        body: trimmed,
        ...(options.requestKey !== undefined ? { requestKey: options.requestKey } : {}),
    });
    const result = {
        msgId: sent.message.id,
        toId: sent.message.toId,
        status: sent.message.status,
        injected: false,
        ...(options.requestKey !== undefined ? { replayed: sent.replayed, requestKey: options.requestKey } : {}),
    };

    if (options.wait !== true) {
        if (options.json) {
            context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
        } else {
            context.output.write(
                result.replayed === true
                    ? `replayed ${result.msgId} → ${result.toId} (already accepted)`
                    : `queued ${result.msgId} → ${result.toId}`,
            );
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
                // G11 R2: `injected` means THIS message left `queued` — claimed, delivered or
                // failed by its recipient. An empty inbox is a different (and misleading)
                // condition: another consumer may have drained the queue without ever touching
                // this row.
                try {
                    await waitForMessageClaim(
                        context,
                        result.msgId,
                        agentService,
                        pin,
                        options.timeout,
                        controller.signal,
                    );
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
                            countPending: (id) => inboxOf(context).countQueued(id),
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
                context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope }));
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
