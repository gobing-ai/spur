import type { Command } from '@commander-js/extra-typings';
import {
    AgentCoordinationService,
    followSystemEventsAfter,
    loopSleep,
    resolveAgentSelector,
    WaitError,
    type WaitUntil,
    waitForOccupant,
} from '@gobing-ai/spur-app';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { DEFAULT_TRACE_FOLLOW_TIMEOUT_MS, guestService, parseTimeout } from './shared';

/**
 * `spur agent wait --inbox <id>` (G73 R4). The guest pull primitive: return 0 as soon as
 * queued work exists for the guest, heartbeating the lease on every tick and retiring
 * expired guests. Exit 1 on timeout or a guest that is gone — never a silent hang.
 */
export async function runAgentWaitInbox(
    context: CliContext,
    flags: { id: string; timeoutMs: number; json: boolean; enveloped?: boolean; pollMs?: number },
): Promise<number> {
    const service = guestService(context);
    const pollMs = flags.pollMs ?? 1000;
    const deadline = Date.now() + flags.timeoutMs;
    for (;;) {
        const guest = await service.read(flags.id);
        if (guest === null) {
            const message = `guest "${flags.id}" is not joined (spur agent join --role <role>)`;
            if (flags.json) {
                context.output.write(
                    toEnvelopeJson(
                        { error: { code: 'not-joined', message } },
                        { enveloped: flags.enveloped, error: { code: 'NOT_FOUND', message } },
                    ),
                );
            } else {
                context.output.error(message);
            }
            return 1;
        }
        const alive = await service.heartbeat(flags.id);
        if (!alive) {
            const message = `guest "${flags.id}" lease was released — re-join before waiting`;
            if (flags.json) {
                context.output.write(
                    toEnvelopeJson(
                        { error: { code: 'lease-released', message } },
                        { enveloped: flags.enveloped, error: { code: 'CONFLICT', message } },
                    ),
                );
            } else {
                context.output.error(message);
            }
            return 1;
        }
        const pending = await service.pendingCount(flags.id);
        if (pending > 0) {
            if (flags.json) {
                context.output.write(toEnvelopeJson({ id: flags.id, pending }, { enveloped: flags.enveloped }));
            } else {
                context.output.write(`guest ${flags.id}: ${pending} pending message(s)`);
            }
            return 0;
        }
        if (Date.now() >= deadline) {
            const message = `no inbox work for guest "${flags.id}" within ${flags.timeoutMs}ms`;
            if (flags.json) {
                context.output.write(
                    toEnvelopeJson(
                        { error: { code: 'timeout', message } },
                        { enveloped: flags.enveloped, error: { code: 'LOCK_TIMEOUT', message } },
                    ),
                );
            } else {
                context.output.error(message);
            }
            return 1;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(1, deadline - Date.now()))));
    }
}

/** Valid `agent wait --until` states. */
const WAIT_UNTIL_STATES = new Set<WaitUntil>(['idle', 'working', 'invoke-exit', 'blocked']);

/** Commander reducer: accumulate repeatable `--until` values into an array. */
function collectUntil(value: string, acc: WaitUntil[]): WaitUntil[] {
    if (!WAIT_UNTIL_STATES.has(value as WaitUntil)) {
        throw new Error(`invalid --until "${value}" (expected one of: ${[...WAIT_UNTIL_STATES].join(', ')})`);
    }
    return [...acc, value as WaitUntil];
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
 * `spur agent wait <specId> [--run <runId>] [--until ...] [--timeout <ms>] [--json]`.
 * Identity-pinned wait on an occupant run (G4 wave 2, task 0530 R4). Pins the
 * occupant's specId+runId+generation and waits for the first satisfied
 * `--until` (OR), failing with a typed error on replacement / stall / timeout.
 */
async function runAgentWait(
    context: CliContext,
    specId: string,
    options: { run?: string; until: WaitUntil[]; timeout?: number; json?: boolean; jsonEnvelope?: boolean },
): Promise<number> {
    const untilList = options.until;
    if (untilList.length === 0) untilList.push('idle');
    // `blocked` has no first-class signal in wave 2 → reject at usage time.
    if (untilList.length === 1 && untilList[0] === 'blocked') {
        return waitUsageError(
            context,
            options,
            '--until blocked has no first-class signal in this wave; use idle|working|invoke-exit',
        );
    }

    const agentService = context.agentService();
    const coordination = new AgentCoordinationService(context);
    const eventDao = new SystemEventDao(await context.getDb());

    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        // Snapshot once to resolve the default runId + initial pin before waiting.
        const occupant = await agentService.getOccupant({ specId });
        if (occupant === null) {
            return waitFail(context, options, 'occupant_gone', `no occupant for specId "${specId}"`);
        }
        const runId = options.run ?? occupant.runId;
        if (options.run !== undefined && options.run !== occupant.runId) {
            // Pin an explicit (possibly completed) run; read its own events.
        }
        const pin = { specId, runId, generation: occupant.generation };

        // First satisfied `--until` wins (OR semantics). Errors from the first
        // failing target surface as the wait result.
        let result: { pin: typeof pin; satisfied: WaitUntil } | null = null;
        let firstError: WaitError | null = null;
        for (const until of untilList) {
            try {
                result = await waitForOccupant(
                    {
                        getOccupant: (id) => agentService.getOccupant({ specId: id }),
                        countPending: (id) => coordination.countPending(id),
                        latestInvokeEvent: (r) => readLatestInvokeEvent(eventDao, r),
                        // Snapshot-then-follow over the shared ledger (G4 R8):
                        // only the pinned run's invoke events are followed.
                        follow: (afterSequence) =>
                            followSystemEventsAfter(context.getDb, {
                                afterSequence,
                                match: (row) =>
                                    row.run_id === runId &&
                                    (row.event_name === 'agent.invoke.start' || row.event_name === 'agent.invoke.exit'),
                                signal: controller.signal,
                            }),
                        now: () => Date.now(),
                        sleep: (ms) => loopSleep(ms, controller.signal),
                    },
                    {
                        pin,
                        until,
                        timeoutMs: options.timeout,
                        signal: controller.signal,
                    },
                );
                break;
            } catch (error) {
                if (error instanceof WaitError) {
                    firstError = error;
                    // `timeout`/`occupant_gone`/`run_replaced` are terminal — no point
                    // trying the next `--until`; only `wait_stalled` might differ.
                    if (error.code !== 'wait_stalled') break;
                } else {
                    throw error;
                }
            }
        }

        if (result !== null) {
            const payload = { satisfied: result.satisfied, pin: result.pin };
            if (options.json) {
                context.output.write(toEnvelopeJson(payload, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(`${pin.specId}/${pin.runId} reached ${result.satisfied}`);
            }
            return 0;
        }
        const err = firstError ?? new WaitError('wait_stalled', 'no --until target satisfied');
        return waitFail(context, options, err.code, err.message);
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}

/** Emit a usage error (exit 2) for `agent wait`. */
function waitUsageError(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    message: string,
): number {
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
    return 2;
}

/** Emit a typed wait failure (exit 1) with the `--json` error envelope. */
function waitFail(
    context: CliContext,
    options: { json?: boolean; jsonEnvelope?: boolean },
    code: string,
    message: string,
): number {
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code, message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'INTERNAL_ERROR', message: message, details: { cliCode: code } },
                },
            ),
        );
    } else {
        context.output.error(`${code}: ${message}`);
    }
    return 1;
}

/** Register `spur agent wait`. */
export function registerAgentWaitCommand(agent: Command, context: CliContext): void {
    agent
        .command('wait')
        .description('Wait for a pinned occupant run to reach a lifecycle state. Address by spec id or --role.')
        .argument('[specId]', 'Agent spec id whose occupant to wait on (mutually exclusive with --role)')
        .option(
            '--role <name>',
            'Address by Layer-1 role or executor name; must resolve to exactly one materialized instance',
        )
        .option(...SHARED_OPTIONS.runAgentPin)
        .option(...SHARED_OPTIONS.untilAgent, collectUntil, [])
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option('--inbox <id>', 'Guest id to wait on for pending inbox work (pulls; exclusive with a spec id/--role)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // G73 R4 (1081): `--inbox <id>` is the guest pull primitive — return when work
            // is pending for a joined guest, heartbeating its lease while it waits. It is
            // exclusive with the occupant-wait addressing (spec id / --role).
            if (options.inbox !== undefined) {
                if (specId !== undefined || options.role !== undefined) {
                    context.setExitCode(
                        waitUsageError(
                            context,
                            options,
                            'agent wait --inbox takes a guest id, not a spec id or --role',
                        ),
                    );
                    return;
                }
                const code = await runAgentWaitInbox(context, {
                    id: options.inbox,
                    timeoutMs: options.timeout ?? DEFAULT_TRACE_FOLLOW_TIMEOUT_MS,
                    json: options.json === true,
                    enveloped: options.jsonEnvelope,
                });
                context.setExitCode(code);
                return;
            }
            // 0685 R6: --role resolves to exactly one materialized instance spec id;
            // the wait itself stays identity-pinned on the resolved id.
            if (options.role !== undefined && specId !== undefined) {
                context.setExitCode(
                    waitUsageError(context, options, 'agent wait accepts a spec id or --role, not both'),
                );
                return;
            }
            let targetId = specId;
            if (options.role !== undefined) {
                const resolution = await resolveAgentSelector(
                    () => new AgentCoordinationService(context).listFleetMembers(),
                    context.agentConfig,
                    options.role,
                );
                if (!resolution.ok) {
                    context.setExitCode(resolution.code === 'unknown_selector' ? 2 : 1);
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
                    return;
                }
                targetId = resolution.specId;
            }
            if (targetId === undefined) {
                context.setExitCode(waitUsageError(context, options, 'agent wait requires a spec id or --role <name>'));
                return;
            }
            const code = await runAgentWait(context, targetId, options);
            context.setExitCode(code);
        });
}
