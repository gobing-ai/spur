import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus, AgentRunDeps, SystemEventBus } from '@gobing-ai/spur-app';
import { isAgentName } from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../../agent-quota-persistence';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { SHARED_OPTIONS } from '../shared-options';
import { commanderOptionsToFlags, drainIntoPrompt, guestService, settleClaimedMessages } from './shared';

/**
 * Refuse a guest id as a stage target (G73 R3, task 1081). A guest carries no executor
 * attestation, so a `requiresCapabilities` stage could never be satisfied by one; the
 * refusal is explicit rather than a silent downgrade to "no attestation, allow anyway".
 * Returns the refusal code, or null when the spec id is not a guest.
 */
export async function refuseGuestStageTarget(
    context: CliContext,
    specId: string,
    options: { json?: boolean; jsonEnvelope?: boolean } = {},
): Promise<number | null> {
    const guest = await guestService(context).read(specId);
    if (guest === null) return null;
    const message = `"${specId}" is a guest occupant (joined ${guest.joinedAt}) — guests are addressed by message, never dispatched a stage: they carry no executor attestation for requiresCapabilities`;
    if (options.json) {
        context.output.write(
            toEnvelopeJson(
                { error: { code: 'guest-stage-refused', message } },
                {
                    enveloped: options.jsonEnvelope,
                    error: { code: 'GUARD_DENIED', message, details: { specId } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/**
 * Validate an `--agent` value at the flag boundary, before any agent process
 * spawns (0536 R3). Omitted, `auto`, and `inline` pass; AgentService substitutes
 * tier resolution with a warning when `inline` reaches a headless surface (0687
 * R3 / ADR-087). A role, configured executor, or bare coding-agent binary name
 * also passes; the service warns once for a registered bare-binary shim.
 * Returns an error message, or null to proceed. Exported as a test seam.
 */
export function validateAgentSelector(flags: Record<string, string | boolean>, context: CliContext): string | null {
    const raw = typeof flags.agent === 'string' ? flags.agent : undefined;
    if (raw === undefined || raw === 'auto') return null;
    if (raw === 'inline') return null; // 0687 R3: valid selector on every surface
    if (context.agentRoles.has(raw)) return null;
    if ((context.agentConfig?.executors ?? []).some((e) => e.name === raw)) return null;
    if (isAgentName(raw)) return null;
    const roleList = [...context.agentRoles.keys()].join(', ');
    const executors = (context.agentConfig?.executors ?? []).map((e) => e.name);
    const executorList = executors.length > 0 ? executors.join(', ') : '(none configured)';
    return `Unknown agent: '${raw}'. Accepted: role (${roleList}), configured executor (${executorList}), 'inline', or 'auto'.`;
}

/**
 * The `--json` / `--json-envelope` pair, read out of the kebab-cased flags record the
 * agent verbs pass around (0699 R1). `runAgentRun` never sees the raw commander
 * `options`, so its failure paths need this to reach `writeJsonError`.
 * `jsonEnvelope` stays tri-state: absent defers to `SPUR_JSON_ENVELOPE`.
 */
function jsonFlags(flags: Record<string, string | boolean>): { json?: boolean; jsonEnvelope?: boolean } {
    const envelope = flags.jsonEnvelope ?? flags['json-envelope'];
    return {
        json: flags.json === true,
        jsonEnvelope: typeof envelope === 'boolean' ? envelope : undefined,
    };
}

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    // Task 0370: direct `spur agent run` emits cataloged `agent.invoke.*` on a
    // CLI-local bus with a SystemEventDao tap — the EventBus dual of task 0249's
    // SystemEventEmitter for planning. Workflow-dispatched agent.run stays on the
    // workflow path (`workflow.agent` series only) so a nested execution never
    // double-counts (R4). Route through context.agentService({ events }) so the
    // validated agentConfig (0126) is still threaded into resolution.
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    // 0799 R1: quota events from this run persist into `agent_executor_updates`
    // so the server can apply them even if it was offline during the run.
    // SAFETY: the ledger's SystemEventBus and AgentQuotaEventBus are nominal
    // names over one structural ts-infra EventBus instance (ADR-044 event
    // bridge, same crossing the ledger attach performs above).
    const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
    const svc = context.agentService({ events: bus });
    // 0831: acceptance is detected from the `agent.invoke.start` lifecycle event —
    // never from an exit code (exit 2 is both a pre-spawn validation failure and a
    // legitimate agent exit). The sync listener flips before `svc.run` resolves.
    let invocationStarted = false;
    bus.on('agent.invoke.start', (event) => {
        if (event && typeof event === 'object' && 'operation' in event && event.operation === 'prompt') {
            invocationStarted = true;
        }
    });
    let claimed: string[] = [];
    try {
        // `--spec <id>` (canonical, 0542 R1) or the legacy `--agent <spec-id>`
        // names the occupant address; `--drain` is DB-backed, so it is resolved in
        // the command layer (where getDb lives) rather than in the app service.
        // The addressed id names a message recipient (an agent spec id), which is
        // a different namespace from the coding-agent type the runner resolves.
        // When a matching spec exists we rewrite `--agent` to the spec's underlying
        // executor/type so resolution still works; in Phase 1-3 there is no live
        // stdin, so prepending is how deferred messages reach the agent.
        if (flags.drain === true || typeof flags.spec === 'string') {
            const {
                prompt: drained,
                flags: rewritten,
                claimed: drainedIds,
            } = await drainIntoPrompt(prompt, context, flags);
            // Track the claim immediately: a validation failure BEFORE the run
            // must still settle (release) the rows, not strand them at injected.
            claimed = drainedIds;
            // R1 (0542): an explicit --spec must resolve to a real fleet spec — a
            // typo'd id must not silently fall through to auto resolution.
            if (typeof flags.spec === 'string' && flags.spec !== '' && rewritten['spec-id'] !== flags.spec) {
                writeJsonError(
                    context.output,
                    jsonFlags(flags),
                    `--spec "${flags.spec}" does not match a fleet agent spec`,
                    'VALIDATION_FAILED',
                );
                return 2;
            }
            const invalid = validateAgentSelector(rewritten, context);
            if (invalid !== null) {
                writeJsonError(context.output, jsonFlags(flags), invalid, 'VALIDATION_FAILED');
                return 2;
            }
            return await svc.run(drained, rewritten, deps);
        }
        // R3 (0536): reject a value that is neither a role, a configured executor,
        // nor auto at the flag boundary — before any agent process spawns.
        // Explicit `inline` is rejected here too (G5 / ADR-047 amendment): exit 2
        // with the frozen headless-surface message, zero spawn, no fallback.
        const invalid = validateAgentSelector(flags, context);
        if (invalid !== null) {
            writeJsonError(context.output, jsonFlags(flags), invalid, 'VALIDATION_FAILED');
            return 2;
        }
        return await svc.run(prompt, flags, deps);
    } finally {
        // Settle AFTER the run attempt (0831 R1/R3): in a finally so an abort or
        // early validation failure still settles the claim. Only the drained path
        // (drainIntoPrompt above) claims messages — the released ids go back to
        // `queued` for redelivery; rows whose invocation started settle `delivered`.
        await settleClaimedMessages(context, claimed, invocationStarted ? 'accepted' : 'not-started');
        await ledger.flush();
        ledger.unsubscribe();
        // 0799 R1: flush recorded quota observations before process exit.
        await quotaPersistence.flush();
        quotaPersistence.unsubscribe();
    }
}

/** Register `spur agent run`. */
export function registerAgentRunCommand(agent: Command, context: CliContext): void {
    agent
        .command('run')
        .description('Execute a prompt or slash command via a coding agent.')
        .option(
            '--agent <name>',
            'Role, executor, agent binary, auto, or inline (host-session; on headless surfaces a role/tier fallback resolves with one warning)',
        )
        .option('--spec <id>', 'Agent spec id (occupant addressing; pairs with --drain)')
        .option('--continue', 'Resume the previous agent session')
        .option('--model <name>', 'Agent model argument')
        .option(...SHARED_OPTIONS.modeAgent)
        .option(...SHARED_OPTIONS.cwdAgent)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--drain', 'Prepend pending inbox messages for --spec <id>')
        .argument('<prompt>', 'The prompt or slash command to execute')
        .action(async (prompt, options) => {
            const flags = commanderOptionsToFlags(options);
            // G73 R3 (1081): a guest occupant is a message recipient, never a stage target —
            // refuse it here, before any dispatch, with the reason.
            if (typeof flags.spec === 'string' && flags.spec !== '') {
                const refused = await refuseGuestStageTarget(context, flags.spec, {
                    json: options.json === true,
                    ...(options.jsonEnvelope !== undefined ? { jsonEnvelope: options.jsonEnvelope } : {}),
                });
                if (refused !== null) {
                    context.setExitCode(refused);
                    return;
                }
            }
            // ADR-091: `--json-envelope` is tri-state on the run path — thread the
            // explicit value under the camelCase key the service reads (the kebab-case
            // conversion above would drop it); absent stays undefined so the service
            // defers to SPUR_JSON_ENVELOPE.
            if (options.jsonEnvelope !== undefined) flags.jsonEnvelope = options.jsonEnvelope;
            const code = await runAgentRun(prompt, context, flags);
            context.setExitCode(code);
        });
}
