import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus } from '@gobing-ai/spur-app';
import {
    AgentCoordinationService,
    type AgentLoopDeps,
    type AgentLoopRuntime,
    type AgentRunDeps,
    AgentService,
    AgentTraceService,
    AgentUsageProducerError,
    type AgentUsageRunResult,
    DEFAULT_LOOP_POLL_MS,
    DeliveryReconciler,
    FINDING_CODES,
    FleetDispatcher,
    FleetGuestService,
    FleetService,
    followSystemEventsAfter,
    loopSleep,
    MAX_INJECT_ATTEMPTS,
    ProjectRegistry,
    type RunAgentUsageOptions,
    resolveAgentSelector,
    resolvePlanningFolders,
    runAgentLoopCore,
    runAgentUsageProducer,
    StrategyRuntime,
    type SystemEventBus,
    type TraceTree,
    type UsageSource,
    UsageSourceError,
    WaitError,
    type WaitUntil,
    waitForOccupant,
} from '@gobing-ai/spur-app';

export type { AgentLoopRuntime };

/**
 * Default `--follow` budget for `agent trace` (1076 R4): the same 10 minutes
 * `spur workflow trace --follow` uses when `--timeout` is absent.
 */
export const DEFAULT_TRACE_FOLLOW_TIMEOUT_MS = 600_000;

import { ExecutorDisabledError, resolveExecutor } from '@gobing-ai/spur-config';
import {
    CoordinationRunDao,
    InboxMessageDao,
    MEMBER_LIFECYCLE_STATES,
    type MemberLifecycleState,
    type MemberSessionObservation,
    SystemEventDao,
    type SystemEventRow,
} from '@gobing-ai/spur-domain';
import { type AgentSpec, isAgentName } from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../agent-quota-persistence';
import type { CliContext } from '../context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { CodexbarUsageSource, defaultAgentUsageSnapshotPath } from '../services/agent-usage-source';
import { attachSystemEventLedger } from '../system-event-ledger';
import { SHARED_OPTIONS } from './shared-options';
import { makeCheckService, makeService } from './task';

export type { AgentRunDeps };

// ── Injectable fetch seam for the `spur serve` supervisor calls ───────
let _testFetch: typeof fetch | undefined;

/** Replace the server fetch for the current test. Call resetAgentServerFetchForTesting in cleanup. */
export function setAgentServerFetchForTesting(fn: typeof fetch): void {
    _testFetch = fn;
}

/** Restore the platform fetch after a test. */
export function resetAgentServerFetchForTesting(): void {
    _testFetch = undefined;
}

/**
 * Fallback server API URL for agent start/stop and live `list --specs` status (requires spur
 * serve) — used only when this project has no live registry entry (1088 R1).
 */
const DEFAULT_SERVER = 'http://localhost:3000/api';

/**
 * This project's `spur serve` API URL (1088 R1). `spur serve` records its port in the project
 * registry (`ProjectRegistry.setPort`), so an entry with `port > 0` names the serve that owns
 * THIS project; the hard-coded 3000 default pointed `agent status|stop|start` at a different
 * project's serve (or nothing at all) and reported every spec `stopped` while loops ran.
 * The port is rendered on host `localhost`, never the IPv4 literal `127.0.0.1`: the server binds
 * `Bun.serve({ hostname: options.host })` with `--host` defaulting to `localhost`, which Bun
 * resolves to IPv6 `[::1]` only, so a `127.0.0.1` client has no listener (ECONNREFUSED). The
 * name form resolves the same address family the server bound.
 * An explicit `--server` always wins, which is why the commander options declare no default.
 * A stale entry self-heals to 0 inside `getByPath` (`healStale`), so a dead serve falls back.
 */
export async function resolveAgentServer(cwd: string, explicit?: string): Promise<string> {
    if (explicit !== undefined && explicit !== '') return explicit;
    try {
        const entry = await new ProjectRegistry().getByPath(cwd);
        if (entry !== undefined && entry.port > 0) return `http://localhost:${entry.port}/api`;
    } catch {
        // An unreadable/unlockable registry means "no live entry", not a failed command: fall
        // back to the default port so the existing unreachable-server warning still fires.
    }
    return DEFAULT_SERVER;
}

/** Injectable seams for `runAgentUsage` tests (source stub, snapshot override). */
export interface AgentUsageDeps {
    source?: UsageSource;
    snapshotPath?: string;
}

// ── Injectable usage-source seam for the `agent usage` command tests ──
let _testUsageDeps: AgentUsageDeps | undefined;

/** Replace the usage source + snapshot path for the current test (reset in cleanup). */
export function setAgentUsageSourceForTesting(deps: AgentUsageDeps | undefined): void {
    _testUsageDeps = deps;
}

/** Restore the default codexbar source after a test. */
export function resetAgentUsageSourceForTesting(): void {
    _testUsageDeps = undefined;
}

/**
 * Run the `spur agent usage` producer once (B6 0892 R1–R3). Fail-closed
 * capture/parse/config errors exit 1 with the cause on stderr and change
 * nothing; per-provider error entries are listed while healthy entries still
 * apply. `--dry-run` prints would-be changes and writes nothing.
 */
export async function runAgentUsage(
    context: CliContext,
    flags: { dryRun: boolean; source: string; json: boolean; enveloped?: boolean },
    deps?: AgentUsageDeps,
): Promise<number> {
    if (flags.source !== 'codexbar') {
        const message = `unknown usage source "${flags.source}" — only "codexbar" is implemented`;
        if (flags.json) {
            context.output.write(
                toEnvelopeJson(
                    { error: { code: 'unknown_source', message } },
                    {
                        enveloped: flags.enveloped,
                        error: {
                            code: 'VALIDATION_FAILED',
                            message,
                            details: { source: flags.source, reason: 'unknown_source' },
                        },
                    },
                ),
            );
        } else {
            context.output.error(`agent usage: ${message}`);
        }
        return 2;
    }
    const options: RunAgentUsageOptions = {
        // Spawn-capable source + HOME-derived snapshot default live in this (CLI) layer.
        source: deps?.source ?? _testUsageDeps?.source ?? new CodexbarUsageSource(),
        snapshotPath: deps?.snapshotPath ?? _testUsageDeps?.snapshotPath ?? defaultAgentUsageSnapshotPath(),
        // 0892 R2: the CLI flag must reach the producer or --dry-run silently
        // degrades to a full run (snapshot write + drain).
        dryRun: flags.dryRun === true,
    };
    let result: AgentUsageRunResult;
    try {
        result = await runAgentUsageProducer(
            {
                getDb: () => context.getDb(),
                projectRoot: context.cwd,
                loadAgentConfig: context.loadAgentConfig,
                warn: (message) => context.output.error(`Warning: ${message}`),
            },
            options,
        );
    } catch (error) {
        if (!(error instanceof UsageSourceError) && !(error instanceof AgentUsageProducerError)) throw error;
        const message = error.message;
        if (flags.json) {
            context.output.write(
                toEnvelopeJson(
                    { error: { code: 'usage_capture_failed', message } },
                    {
                        enveloped: flags.enveloped,
                        error: { code: 'INTERNAL_ERROR', message, details: { reason: 'usage_capture_failed' } },
                    },
                ),
            );
        } else {
            context.output.error(`agent usage: ${message}`);
        }
        return 1;
    }
    if (flags.json) {
        context.output.write(
            toEnvelopeJson(result, {
                enveloped: flags.enveloped,
                error: { code: 'INTERNAL_ERROR', message: 'unreachable' },
            }),
        );
    } else {
        const applied = result.changes.filter((c) => c.action !== 'no-op');
        const snapshotNote =
            result.snapshotPath !== null ? `\nSnapshot: ${result.snapshotPath}` : '\nDry run: nothing written';
        context.output.write(
            [
                `Usage captured ${result.capturedAt} via ${result.source} (${applied.length} change${applied.length === 1 ? '' : 's'}).`,
                // 0907 R5: every decision is listed; skipped/pending name the requested
                // target as intent — completion is unconfirmed, not proven persisted.
                ...result.changes.map((c) => {
                    const target =
                        c.action === 'skipped' || c.action === 'pending'
                            ? `${c.from} → ${c.to} (requested target — completion unconfirmed)`
                            : `${c.from} → ${c.to}`;
                    return `  ${c.executor}: ${target} [${c.action}] — ${c.reason}`;
                }),
                ...(result.erroredProviders.length > 0
                    ? [
                          `Errored providers (skipped, never treated as recovery): ${result.erroredProviders
                              .map((e) => e.provider)
                              .join(', ')}`,
                      ]
                    : []),
                ...(result.unmappedProviders.length > 0
                    ? [`Unmapped providers (never guessed): ${result.unmappedProviders.join(', ')}`]
                    : []),
                ...(result.drain !== null
                    ? [
                          `Drain: ${result.drain.applied} applied, ${result.drain.skippedOperatorOwned} operator-skipped, ${result.drain.failed} failed.`,
                      ]
                    : []),
                snapshotNote,
            ].join('\n'),
        );
    }
    return 0;
}

/** Register `spur agent` commands on the CLI program. */
export function registerAgentCommand(program: Command, context: CliContext): void {
    const agent = program.command('agent').summary('run and inspect supported coding agents');

    agent
        .command('list')
        .description('List detected coding agents, or agent specs with --specs.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--specs', 'List agent specs instead of detected agents')
        .option('--server <url>', 'Server API URL for live run status (with --specs)')
        .action(async (options) => {
            const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
            const code = await runAgentList(svc, context, {
                json: options.json,
                jsonEnvelope: options.jsonEnvelope,
                specs: options.specs,
                server: options.server,
            });
            context.setExitCode(code);
        });

    agent
        .command('status')
        .description('Show agent specs with live process status and member session (requires spur serve).')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--server <url>', 'Server API URL for live run status and member session')
        .action(async (options) => {
            const code = await runAgentStatus(context, {
                json: options.json,
                jsonEnvelope: options.jsonEnvelope,
                server: options.server,
            });
            context.setExitCode(code);
        });

    agent
        .command('usage')
        .description(
            'Run-once provider usage capture (codexbar) that refreshes quota-owned executor availability. Schedule it externally (cron/launchd); spur serve never runs it.',
        )
        .option(...SHARED_OPTIONS.dryRunAgentUsage)
        .option(...SHARED_OPTIONS.sourceAgentUsage)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentUsage(context, {
                dryRun: options.dryRun === true,
                source: options.source ?? 'codexbar',
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });

    agent
        .command('doctor')
        .description('Check agent readiness.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[agent]', 'Agent to check')
        .option('--probe-health', 'Opt into model health probing (liveness questions are never cached)')
        .option('--force-refresh', 'Bypass the detection cache, re-run, and rewrite it')
        .action(async (agentName, options) => {
            const svc = context.agentService();
            const code = await svc.doctor(
                {
                    json: options.json === true,
                    enveloped: options.jsonEnvelope,
                    agent: agentName,
                    probeHealth: options.probeHealth === true,
                    forceRefresh: options.forceRefresh === true,
                    // 0893 R2: report the producer snapshot (optional — missing renders `usage: none`).
                    usageSnapshotPath: defaultAgentUsageSnapshotPath(context.env),
                },
                undefined,
            );
            context.setExitCode(code);
        });

    agent
        .command('report')
        .description('Report a fleet member lifecycle state (working|idle|blocked) from a host hook.')
        .requiredOption('--state <state>', 'Lifecycle state: working, idle, or blocked')
        .requiredOption('--seq <ns>', 'Monotonic report sequence (wall-clock nanoseconds); must increase')
        .option('--spec <id>', 'Member spec id (defaults to SPUR_SPEC_ID)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentReport(context, {
                state: options.state,
                seq: options.seq,
                ...(options.spec !== undefined ? { spec: options.spec } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });

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

    // Supervisor-internal (`supervisor-service.ts` spawns `agent loop --spec <id>`): hidden from help.
    agent
        .command('loop', { hidden: true })
        .description('Run the persistent self-draining loop for a supervised agent spec.')
        .option('--spec <id>', 'Agent spec id / message recipient')
        .option(...SHARED_OPTIONS.pollAgent, String(DEFAULT_LOOP_POLL_MS))
        .action(async (options) => {
            const controller = new AbortController();
            const onSignal = () => controller.abort();
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);
            // 1088 R2: the parent watch bounds the loop's lifetime to its parent serve. A plain
            // SIGKILLed serve can send no signal at all, so the loop would outlive it forever.
            const stopParentWatch = startParentWatch(controller, parseLoopPoll(options.poll));
            try {
                const flags = commanderOptionsToFlags(options);
                const code = await runAgentLoop(context, flags, { signal: controller.signal });
                context.setExitCode(code);
            } finally {
                stopParentWatch();
                process.off('SIGINT', onSignal);
                process.off('SIGTERM', onSignal);
            }
        });

    agent
        .command('join')
        .description('Join the fleet as a guest occupant (a live session that pulls its own work).')
        .requiredOption('--role <name>', 'Layer-1 role the guest occupies (scribe | coder | reviewer | planner)')
        .option('--id <id>', 'Guest id (defaults to <role>-g<n>)')
        .option('--session-id <sid>', 'Host session id (defaults to CLAUDE_CODE_SESSION_ID)')
        .option('--pid <n>', 'Process id to record (defaults to this process)')
        .option('--executor <name>', 'Executor name to record (informational; a guest is never dispatched to)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const code = await runAgentJoin(context, {
                role: options.role,
                ...(options.id !== undefined ? { id: options.id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                ...(options.pid !== undefined ? { pid: Number(options.pid) } : {}),
                ...(options.executor !== undefined ? { executor: options.executor } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });

    agent
        .command('leave')
        .description('Leave the fleet: release a guest occupant lease and retire its record.')
        .argument('[id]', 'Guest id (defaults to the guest joined by this session)')
        .option('--session-id <sid>', 'Host session id (defaults to CLAUDE_CODE_SESSION_ID)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const code = await runAgentLeave(context, {
                ...(id !== undefined ? { id } : {}),
                ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
                json: options.json === true,
                enveloped: options.jsonEnvelope,
            });
            context.setExitCode(code);
        });

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

    // Per-spec process lifecycle through the `spur serve` supervisor
    // ── agent trace (1076 R4, ADR-132) ────────────────────────────────────────────
    // The execution record, read as one lineage. Logic lives in `@gobing-ai/spur-app`
    // (`AgentTraceService`); this transport only renders it (ADR-130).
    agent
        .command('trace')
        .description('Print one execution record: the run, its dispatch lineage, session ids and streams.')
        .argument('<runId>', 'Run id to trace (a workflow run or an agent run)')
        .option('--follow', 'Poll until every run in the lineage reaches a terminal status')
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option(...SHARED_OPTIONS.json)
        .action(async (runId: string, options: { follow?: boolean; timeout?: number; json?: boolean }) => {
            const service = new AgentTraceService({ projectPath: context.cwd, openDb: () => context.getDb() });
            const render = (tree: TraceTree): void => {
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(tree));
                    return;
                }
                context.output.write(
                    [`lineage ${tree.rootRunId} (${tree.nodes.length} run${tree.nodes.length === 1 ? '' : 's'})`]
                        .concat(
                            tree.nodes.map((node) => {
                                const sessions =
                                    node.sessionIds.length > 0 ? ` sessions=${node.sessionIds.join(',')}` : '';
                                const log = node.logPath !== null ? ` stream=${node.logPath}` : '';
                                const parent = node.parentRunId !== null ? ` parent=${node.parentRunId}` : '';
                                return `${node.kind}\t${node.runId}\t${node.status}${parent}${sessions}${log}`;
                            }),
                        )
                        .join('\n'),
                );
            };
            if (options.follow === true) {
                const { tree, timedOut } = await service.follow(runId, {
                    timeoutMs: options.timeout ?? DEFAULT_TRACE_FOLLOW_TIMEOUT_MS,
                });
                render(tree);
                if (timedOut) {
                    // One checkpoint line, exit 1, the runs continue — `spur workflow trace --follow` parity.
                    context.output.error(`checkpoint: lineage ${runId} still running at the follow timeout`);
                    context.setExitCode(1);
                }
                return;
            }
            render(await service.trace(runId));
        });

    // (POST /api/agents/:id/{start,stop}).
    agent
        .command('start')
        .description('Start a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // 0697 AC4: the advertised flag's decision rides visibly on the delegated options.
            // 1088 R1: the default server is resolved from this project's registry entry.
            const code = await runAgentLifecycle(
                'start',
                specId,
                {
                    server: await resolveAgentServer(context.cwd, options.server),
                    json: options.json,
                    jsonEnvelope: options.jsonEnvelope,
                },
                context,
            );
            context.setExitCode(code);
        });

    agent
        .command('stop')
        .description('Stop a supervised agent process (requires spur serve).')
        .argument('<spec-id>', 'Agent spec id')
        .option('--server <url>', 'Server API URL')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (specId, options) => {
            // Same threading contract as `agent start` (0697 AC4); same default-server
            // resolution (1088 R1).
            const code = await runAgentLifecycle(
                'stop',
                specId,
                {
                    server: await resolveAgentServer(context.cwd, options.server),
                    json: options.json,
                    jsonEnvelope: options.jsonEnvelope,
                },
                context,
            );
            context.setExitCode(code);
        });
}

/**
 * Run `spur agent report` (G73 R1, task 1080) — the host hooks' only CLI call.
 *
 * Thin by design: validation, the member-id default (`--spec`, else `SPUR_SPEC_ID`)
 * and the monotonic guard all resolve here or in the domain; the service call is one
 * hop. A missing member id is a usage error (exit 2), never a silent no-op, so a
 * misconfigured hook surfaces instead of dropping reports.
 */
export async function runAgentReport(
    context: CliContext,
    flags: {
        state?: string;
        seq?: string;
        spec?: string;
        json: boolean;
        enveloped?: boolean;
    },
): Promise<number> {
    const state = flags.state;
    if (state === undefined || !MEMBER_LIFECYCLE_STATES.includes(state as MemberLifecycleState)) {
        return agentReportUsageError(
            context,
            flags,
            `--state must be one of ${MEMBER_LIFECYCLE_STATES.join('|')} (got ${state ?? 'nothing'})`,
        );
    }
    const seq = flags.seq === undefined || flags.seq.trim() === '' ? Number.NaN : Number(flags.seq);
    if (!Number.isFinite(seq)) {
        return agentReportUsageError(
            context,
            flags,
            `--seq must be a number in nanoseconds (got ${flags.seq ?? 'nothing'})`,
        );
    }
    const memberId = flags.spec !== undefined && flags.spec !== '' ? flags.spec : context.env.SPUR_SPEC_ID;
    if (memberId === undefined || memberId === '') {
        return agentReportUsageError(context, flags, 'no member id (set SPUR_SPEC_ID or --spec)');
    }
    const result = await new AgentCoordinationService(context).reportLifecycle(
        memberId,
        state as MemberLifecycleState,
        seq,
    );
    if (flags.json) {
        context.output.write(
            toEnvelopeJson(
                { member: memberId, state, seq, accepted: result.accepted, observation: result.observation ?? null },
                { enveloped: flags.enveloped },
            ),
        );
    } else {
        context.output.write(
            result.accepted
                ? `agent ${memberId}: ${state} (seq ${seq})`
                : `agent ${memberId}: ignored stale report (seq ${seq} <= ${result.observation?.seq ?? 'last'})`,
        );
    }
    return 0;
}

/** Shared usage-error shape for `agent report` — exit 2, JSON or plain. */
function agentReportUsageError(
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
                    error: { code: 'VALIDATION_FAILED', message, details: { cliCode: 'usage' } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/**
 * Build the guest service over this CLI context (G73, task 1081). Declared member ids come
 * from the same fleet listing `--role` resolves against, so a guest can never shadow a
 * declared member and role lookup never sees a guest.
 */
function guestService(context: CliContext): FleetGuestService {
    return new FleetGuestService({
        cwd: context.cwd,
        fs: context.fs,
        getDb: () => context.getDb(),
        declaredMemberIds: async () =>
            (await new AgentCoordinationService(context).listFleetMembers()).map((m) => m.instanceId),
    });
}

/** Host session id this process belongs to, when the host exports one (Claude Code does). */
function hostSessionId(context: CliContext, explicit?: string): string | undefined {
    if (explicit !== undefined && explicit !== '') return explicit;
    const fromEnv = context.env.CLAUDE_CODE_SESSION_ID;
    return fromEnv !== undefined && fromEnv !== '' ? fromEnv : undefined;
}

/** Shared guest usage-error shape: exit 2, JSON or plain. */
function guestUsageError(
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
                    error: { code: 'VALIDATION_FAILED', message, details: { cliCode: 'usage' } },
                },
            ),
        );
    } else {
        context.output.error(message);
    }
    return 2;
}

/**
 * `spur agent join` (G73 R2/R3, task 1081). Registers a guest occupant with a heartbeat
 * lease; the guest is never supervised and never a stage target. Expired guests are
 * retired first, so a stale record can never block a re-join with the same id.
 */
export async function runAgentJoin(
    context: CliContext,
    flags: {
        role: string;
        id?: string;
        sessionId?: string;
        pid?: number;
        executor?: string;
        json: boolean;
        enveloped?: boolean;
    },
): Promise<number> {
    const service = guestService(context);
    await service.expire();
    const result = await service.join({
        role: flags.role,
        ...(flags.id !== undefined ? { id: flags.id } : {}),
        ...(hostSessionId(context, flags.sessionId) !== undefined
            ? { sessionId: hostSessionId(context, flags.sessionId) }
            : {}),
        pid: flags.pid ?? process.pid,
        ...(flags.executor !== undefined ? { executor: flags.executor } : {}),
    });
    if (!result.ok) {
        return guestUsageError(context, flags, result.message);
    }
    const { guest } = result;
    if (flags.json) {
        context.output.write(toEnvelopeJson({ guest }, { enveloped: flags.enveloped }));
    } else {
        context.output.write(
            `guest ${guest.id} joined as ${guest.role}${guest.sessionId !== null ? ` (session ${guest.sessionId})` : ''}`,
        );
    }
    return 0;
}

/**
 * `spur agent leave [id]` (G73 R2). Defaults to the guest joined by this host session,
 * so a host Stop hook (or the operator) can leave without knowing the generated id.
 */
export async function runAgentLeave(
    context: CliContext,
    flags: { id?: string; sessionId?: string; json: boolean; enveloped?: boolean },
): Promise<number> {
    const service = guestService(context);
    let id = flags.id;
    if (id === undefined || id === '') {
        const sessionId = hostSessionId(context, flags.sessionId);
        if (sessionId === undefined) {
            return guestUsageError(
                context,
                flags,
                'no guest id (pass one, or set CLAUDE_CODE_SESSION_ID / --session-id)',
            );
        }
        const joined = (await service.list()).find((guest) => guest.sessionId === sessionId);
        if (joined === undefined) {
            return guestUsageError(context, flags, `no guest joined by session ${sessionId}`);
        }
        id = joined.id;
    }
    const left = await service.leave(id);
    if (!left) {
        return guestUsageError(context, flags, `no joined guest "${id}"`);
    }
    if (flags.json) {
        context.output.write(toEnvelopeJson({ left: id }, { enveloped: flags.enveloped }));
    } else {
        context.output.write(`guest ${id} left the fleet`);
    }
    return 0;
}

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

/** Map commander-style camelCase option keys to kebab-case flags internal handlers expect. */
function commanderOptionsToFlags(options: Record<string, unknown>): Record<string, string | boolean> {
    const flags: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(options)) {
        if (v === undefined) continue;
        // commander camelCase → kebab-case (e.g. systemPrompt → system-prompt)
        const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        // --no-* flags: commander strips "no" prefix and sets value=false; restore.
        if (v === false && /^[a-z]/.test(k)) flags[`no-${key}`] = true;
        else flags[key] = v as string | boolean;
    }
    return flags;
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

/** Shorten a session id for human rendering — 8 chars is enough to tell sessions apart. */
function shortSessionId(id: string): string {
    return id.slice(0, 8);
}

/** Human session column: `resume id=3f9c2a1d` / `one-shot`; `-` when the member has no session. */
function formatSessionColumn(session: MemberSessionObservation | undefined): string {
    if (session === undefined) return '-';
    return session.id === undefined ? session.mode : `${session.mode} id=${shortSessionId(session.id)}`;
}

/** `spur agent list [--json] [--specs]` — optionally list fleet agent specs instead of detection. */
async function runAgentList(
    svc: AgentService,
    context: CliContext,
    opts: { json?: boolean; jsonEnvelope?: boolean; specs?: boolean; server?: string },
): Promise<number> {
    if (!opts.specs) {
        return svc.list({ json: opts.json ?? false, enveloped: opts.jsonEnvelope });
    }
    const specs = await new AgentCoordinationService(context).listAgentSpecs();
    if (specs.length === 0) {
        if (opts.json) {
            context.output.write(toEnvelopeJson({ specs: [] }, { enveloped: opts.jsonEnvelope }));
            return 0;
        }
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    // The CLI process never owns the supervisor — specs are spawned by `spur serve` —
    // so the local listing is only the desired state until the server's process table
    // overrides it. Unreachable server ⇒ every spec `stopped` plus a stderr warning,
    // so offline listing still works.
    const server = await resolveAgentServer(context.cwd, opts.server);
    const live = await fetchServerProcesses(server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${server} — showing local specs as stopped. Is spur serve running?`,
        );
    }
    const specFacts = (id: string): { status: string; pid?: number; session?: MemberSessionObservation } => {
        const proc = live?.get(id);
        if (proc === undefined) return { status: 'stopped' };
        return {
            status: proc.status,
            ...(proc.pid !== null ? { pid: proc.pid } : {}),
            ...(proc.session !== undefined ? { session: proc.session } : {}),
        };
    };
    if (opts.json) {
        context.output.write(
            toEnvelopeJson(
                {
                    specs: specs.map((spec) => ({
                        id: spec.id,
                        type: spec.type,
                        purpose: spec.purpose,
                        // 0544 R2: role and executor are DISTINCT fields — never merged.
                        ...(typeof spec.config?.role === 'string' && spec.config.role.length > 0
                            ? { role: spec.config.role }
                            : {}),
                        ...(spec.executor !== undefined ? { executor: spec.executor } : {}),
                        ...specFacts(spec.id),
                        path: `.spur/agents/${spec.id}.yaml`,
                    })),
                },
                { enveloped: opts.jsonEnvelope },
            ),
        );
        return 0;
    }
    // 0544 R2/R4: role and executor are distinct columns; undeclared renders `unset`.
    // Live run status is the trailing column (`running pid=<n>` / `stopped`), then the
    // member session (0897): mode + shortened resume id, `-` when none.
    context.output.write(
        specs
            .map((spec) => {
                const role =
                    typeof spec.config?.role === 'string' && spec.config.role.length > 0 ? spec.config.role : 'unset';
                const executor = spec.executor ?? 'unset';
                const { status, pid, session } = specFacts(spec.id);
                const pidSuffix = pid === undefined ? '' : ` pid=${pid}`;
                return `${spec.id}\t${spec.type}\t${role}\t${executor}\t${spec.purpose}\t${status}${pidSuffix}\t${formatSessionColumn(session)}`;
            })
            .join('\n'),
    );
    return 0;
}

/**
 * `spur agent status [--json] [--server <url>]` — live status + member session per
 * agent spec (0897). The CLI never owns the supervisor: liveness and session come
 * from `GET /api/processes`; an unreachable server reports every spec `stopped`
 * with no session (same fallback as `list --specs`).
 */
async function runAgentStatus(
    context: CliContext,
    opts: { json?: boolean; jsonEnvelope?: boolean; server?: string },
): Promise<number> {
    const specs = await new AgentCoordinationService(context).listAgentSpecs();
    if (specs.length === 0) {
        if (opts.json) {
            context.output.write(toEnvelopeJson({ agents: [] }, { enveloped: opts.jsonEnvelope }));
            return 0;
        }
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    const server = await resolveAgentServer(context.cwd, opts.server);
    const live = await fetchServerProcesses(server);
    if (live === null) {
        context.output.error(
            `Cannot reach server at ${server} — showing local specs as stopped. Is spur serve running?`,
        );
    }
    const rows = specs.map((spec) => {
        const proc = live?.get(spec.id);
        return {
            id: spec.id,
            name: spec.name,
            type: spec.type,
            status: proc === undefined ? ('stopped' as const) : proc.status,
            ...(proc?.pid !== undefined && proc.pid !== null ? { pid: proc.pid } : {}),
            ...(proc?.session !== undefined ? { session: proc.session } : {}),
            path: `.spur/agents/${spec.id}.yaml`,
        };
    });
    if (opts.json) {
        context.output.write(toEnvelopeJson({ agents: rows }, { enveloped: opts.jsonEnvelope }));
        return 0;
    }
    context.output.write(
        rows
            .map((row) => {
                const pidSuffix = 'pid' in row && row.pid !== undefined ? ` pid=${row.pid}` : '';
                return `${row.id}\t${row.type}\t${row.status}${pidSuffix}\t${formatSessionColumn(row.session)}`;
            })
            .join('\n'),
    );
    return 0;
}

/**
 * Fetch live run status from the server supervisor (`GET /api/processes`).
 * Returns a `Map<agentId, { status, pid }>`, or `null` when the server is
 * unreachable / returns a non-OK response — callers fall back to local specs.
 */
/** Live facts the server supervisor reports for one agent id (`GET /api/processes`). */
interface LiveProcess {
    status: FleetProcessStatus;
    pid: number | null;
    /** Member session state (0897) when the served project's ledger has one. */
    session?: MemberSessionObservation;
}

async function fetchServerProcesses(server: string): Promise<Map<string, LiveProcess> | null> {
    try {
        const res = await (_testFetch ?? fetch)(`${server}/processes`, {
            method: 'GET',
            signal: AbortSignal.timeout(1500),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as {
            processes?: Array<{
                agentId: string;
                pid: number | null;
                status: string;
                session?: MemberSessionObservation;
            }>;
        };
        const map = new Map<string, LiveProcess>();
        for (const proc of body.processes ?? []) {
            map.set(proc.agentId, {
                status: mapServerStatus(proc.status),
                pid: proc.pid ?? null,
                ...(proc.session !== undefined ? { session: proc.session } : {}),
            });
        }
        return map;
    } catch {
        return null;
    }
}

/**
 * The process-status union `spur agent status` projects (1078 R1). The retired team-era status row
 * carried it; `packages/contracts` has no fleet process-status union, so it lives here locally
 * rather than becoming a new `packages/app` export (1078 Q&A).
 */
export type FleetProcessStatus = 'running' | 'stopped' | 'errored' | 'unknown';

/** Map a `SupervisorService` process status onto {@link FleetProcessStatus}. */
function mapServerStatus(status: string): FleetProcessStatus {
    switch (status) {
        case 'running':
            return 'running';
        case 'errored':
            return 'errored';
        case 'stopped':
        case 'exited':
            return 'stopped';
        default:
            return 'unknown';
    }
}

/** Narrow an untrusted server `error` field to a single human line (0699 R1). */
function errorText(raw: unknown): string | undefined {
    if (typeof raw === 'string') return raw;
    if (raw !== null && typeof raw === 'object' && 'message' in raw) {
        const message = (raw as { message?: unknown }).message;
        if (typeof message === 'string' && message !== '') return message;
        if ('code' in raw && typeof (raw as { code?: unknown }).code === 'string') {
            return (raw as { code: string }).code;
        }
    }
    return raw === undefined ? undefined : JSON.stringify(raw);
}

/** `spur agent start|stop <spec-id> [--server <url>] [--json]` — POST to the serve supervisor. */
async function runAgentLifecycle(
    action: 'start' | 'stop',
    agentId: string,
    options: { server: string; json?: boolean; jsonEnvelope?: boolean },
    context: CliContext,
): Promise<number> {
    let res: Response;
    let body: { ok?: boolean; error?: unknown; pid?: number; status?: string };
    try {
        const url = `${options.server}/agents/${encodeURIComponent(agentId)}/${action}`;
        res = await (_testFetch ?? fetch)(url, {
            method: 'POST',
            // The server's hono `csrf()` middleware admits only a same-origin request: a bare
            // Bun fetch sends no `Origin`/`Sec-Fetch-Site`, is read as `text/plain`, and is
            // answered 403 — so `agent start|stop` could never reach the supervisor, no matter
            // how the server URL was resolved. The CLI is a same-origin local client, so it
            // sends the `Origin` such a caller would send.
            headers: { Origin: new URL(options.server).origin },
            signal: AbortSignal.timeout(3000),
        });
        body = (await res.json()) as typeof body;
    } catch (err) {
        writeJsonError(
            context.output,
            options,
            `Cannot reach server at ${options.server} — is spur serve running? (${err instanceof Error ? err.message : String(err)})`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (!res.ok) {
        // The server's JSON `error` is untrusted input (0699 R1): take an envelope's
        // message rather than serializing it — the server attaches a stack with
        // absolute paths, which has no business on the CLI's stdout.
        writeJsonError(
            context.output,
            options,
            errorText(body.error) ?? `${action} failed: ${res.status}`,
            'INTERNAL_ERROR',
        );
        return 1;
    }
    if (options.json) {
        context.output.write(toEnvelopeJson(body, { enveloped: options.jsonEnvelope }));
    } else if (action === 'start') {
        context.output.write(`started ${agentId} (pid=${body.pid}, status=${body.status ?? '?'})`);
    } else {
        context.output.write(`stopped ${agentId}`);
    }
    return 0;
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

/**
 * Settle messages claimed by a drain (0831): a claimed row ends in exactly one of
 * `delivered` (invocation accepted — seen `agent.invoke.start` on the run bus),
 * `queued` (released for redelivery — the invocation never started and the row
 * still has attempt budget), or `failed` (never started AND the budget is
 * exhausted). The exit code is irrelevant to delivery: a run that started is
 * delivered (0831 R2), and delivery failure is never inferred from the exit
 * code (0831 R5). Called from a `finally` so an abort still settles.
 */
export async function settleClaimedMessages(
    context: CliContext,
    claimed: string[],
    outcome: 'accepted' | 'not-started',
): Promise<void> {
    if (claimed.length === 0) return;
    const coordination = new AgentCoordinationService(context);
    if (outcome === 'accepted') {
        await coordination.settleDelivered(claimed);
        return;
    }
    // Not started: release within the claim budget, else a queryable terminal failure.
    const dao = new InboxMessageDao(await context.getDb());
    const releasable: string[] = [];
    const exhausted: string[] = [];
    for (const id of claimed) {
        const row = await dao.getById(id);
        // Already settled on another path (e.g. the live stdin-injection delivery)
        // or gone — never re-settle someone else's row.
        if (row?.status !== 'injected') continue;
        if (row.injectAttempts >= MAX_INJECT_ATTEMPTS) exhausted.push(id);
        else releasable.push(id);
    }
    if (releasable.length > 0) await coordination.releasePending(releasable);
    for (const id of exhausted) {
        await coordination.settleFailed(
            [id],
            `delivery not accepted: invocation never started after ${MAX_INJECT_ATTEMPTS} inject attempts`,
        );
    }
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

/**
 * Drain pending inbox messages for the addressed agent spec and prepend them to
 * the prompt — or, with `--spec` alone, just address the occupant without
 * touching the inbox. Returns possibly-rewritten flags (with `--agent` mapped
 * from spec id to the spec's executor name — or coding-agent type when the spec
 * carries no executor field — when a spec is found).
 *
 * R1 (0542): the spec id is read from `--spec <id>` (canonical). A spec id
 * passed to the legacy `--agent <spec-id>` is still accepted as fallback
 * addressing; the deprecation warning was retired by 0849 once the flag-spec-id
 * scan proved no caller remains. `spec-id` is
 * set BEFORE the rewrite so AgentService.executeRun can persist an occupant pin
 * (ADR-057 wave 1 R1) — the flag survives even when the inbox is empty, because
 * runAgentLoop relies on it.
 */
async function drainIntoPrompt(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<{
    prompt: string | undefined;
    flags: Record<string, string | boolean>;
    claimed: string[];
    /** Claimed rows' request keys (G71 R1) — a `fleet:task:*` key selects the keyed drain path. */
    requestKeys?: Array<string | null>;
}> {
    const specFlag = typeof flags.spec === 'string' ? flags.spec : '';
    const agentFlag = typeof flags.agent === 'string' ? flags.agent : '';
    const recipient = specFlag !== '' ? specFlag : agentFlag;
    if (recipient === '' || recipient === 'auto') {
        context.output.error('--drain requires an explicit --spec <id> matching a message recipient');
        return { prompt, flags, claimed: [] };
    }

    const coordination = new AgentCoordinationService(context);
    const spec = (await coordination.listAgentSpecs()).find((entry) => entry.id === recipient);
    const flagsOut =
        spec === undefined ? flags : { ...flags, 'spec-id': spec.id, agent: drainAgentSelector(spec, context) };

    // `--spec` without `--drain`: address the occupant, leave the inbox alone.
    if (flags.drain !== true) return { prompt, flags: flagsOut, claimed: [] };

    const inbox = await coordination.drainPending(recipient);
    if (inbox.count === 0) return { prompt, flags: flagsOut, claimed: [] };

    const header = inbox.messages.map((m) => `- ${m.fromId ?? 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    const claimed = inbox.messages.map((m) => m.id);
    // G71 R1: a claimed fleet dispatch names its task, so the run's completion receipt
    // (`coordination_runs.task_id`) is attributable and the strategy's freshness read
    // sees the attempt. A keyless drain leaves `task` untouched.
    const fleetTask = inbox.messages
        .map((message) => /^fleet:task:([^:]+):[1-9][0-9]*$/.exec(message.requestKey ?? '')?.[1])
        .find((wbs) => wbs !== undefined);
    // 1076 R3 (ADR-132): a workflow dispatch key `<runId>/<state>` names the run that dispatched
    // this turn, which is the lineage edge `spur agent trace` walks. The fleet's own
    // `fleet:task:<wbs>:<n>` keys are retry attempts, not lineage, so they are excluded.
    const parentRunId = inbox.messages
        .map((message) => /^([^:/][^/]*)\/[^/]+$/.exec(message.requestKey ?? '')?.[1])
        .find((runId) => runId !== undefined);
    // 0833: the same ids ride into executeRun as the requestMessage flag (comma-
    // joined, dual spelling per the sessionDir convention) so the exit sink can
    // persist the run↔message receipt.
    const requestMessage = claimed.join(',');
    // G71 R1: the loop decides between the stdin path and the run path from the batch's
    // request keys, so the claimed rows' keys ride out with the drain result.
    const requestKeys = inbox.messages.map((message) => message.requestKey ?? null);
    return {
        prompt: merged,
        flags: {
            ...flagsOut,
            requestMessage,
            'request-message': requestMessage,
            ...(fleetTask !== undefined ? { task: fleetTask } : {}),
            ...(parentRunId !== undefined ? { parentRunId, 'parent-run-id': parentRunId } : {}),
        },
        claimed,
        requestKeys,
    };
}

/**
 * Resolve the `--agent` selector for a drained spec (0537, feature B2).
 *
 * A spec materialized with an `executor` name routes through that executor so the
 * operator's model + tier binding survives drain (R2). A dangling executor —
 * renamed or removed from `agent.executors` — fails loudly instead of silently
 * falling back to a bare binary on the default model (R5): the error names the
 * spec and the missing executor, and no process spawns. Pre-existing specs with
 * no executor field keep today's `spec.type` behavior.
 */
function drainAgentSelector(spec: AgentSpec, context: CliContext): string {
    // @transition-shim(spec-without-executor-field) — legacy specs carry only `type`, no executor binding
    if (spec.executor === undefined) return spec.type;
    try {
        resolveExecutor(spec.executor, context.agentConfig, { isCanonicalAgent: isAgentName });
    } catch (error) {
        // 111 R4: a spec pinned to a profile disabled AFTER materialization fails
        // before spawn with the enable-fix — never relabeled as a dangling ref.
        if (error instanceof ExecutorDisabledError) {
            throw new Error(
                `Spec "${spec.id}" pins disabled executor "${spec.executor}" — enable it via agent.executors.${spec.executor}.disabled: false or repin the spec before drain`,
            );
        }
        throw new Error(
            `Spec "${spec.id}" references unknown executor "${spec.executor}" — define it under agent.executors or remove the reference (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    return spec.executor;
}

// ── Member session re-exports (task 0967, ADR-021) ─────────────────────────────

export type {
    MemberAgentProcess,
    MemberSessionDeps,
    MemberSessionMode,
    MemberSessionResetReason,
} from '@gobing-ai/spur-app';
// The G66 member-session mechanics (mode resolution, process lifecycle, reset
// ledger, failed-drain budget) now live in `@gobing-ai/spur-app`
// (`packages/app/src/services/member-session.ts`). These names stay re-exported
// from this module so imports from the base revision keep resolving.
export { MAX_CONSECUTIVE_FAILED_DRAINS, MemberSession, selectsPersistentStdinDispatch } from '@gobing-ai/spur-app';

/** Default wakeup-backstop timeout for `spur agent loop` (ms) — `--poll` (0839 R5). */
/** Parse the `--poll` backstop timeout; falls back to the default for non-positive/non-numeric input. */
function parseLoopPoll(raw: string | boolean | undefined): number {
    if (typeof raw !== 'string') return DEFAULT_LOOP_POLL_MS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOP_POLL_MS;
}

/**
 * Bound a supervised `agent loop`'s lifetime to its parent serve (1088 R2).
 *
 * Graceful shutdown already reaps loops (`supervisor().stopAll()`), but a SIGKILLed or crashed
 * serve sends its children nothing, so the loop kept draining against a dead serve forever.
 * `process.ppid` is re-read live (Bun reports `N` → `1` after a SIGKILL), so the loop can detect
 * the reparent alone: no daemon, no marker file, and no signal from the dying parent. The abort
 * ends the loop through its normal shutdown (claim release, member-session reset).
 *
 * The returned stop function clears the watch — the caller's `finally`. `readPpid` is a test seam.
 */
export function startParentWatch(
    controller: AbortController,
    intervalMs: number,
    readPpid: () => number = () => process.ppid,
): () => void {
    const parent = readPpid();
    const timer = setInterval(() => {
        if (readPpid() !== parent) controller.abort();
    }, intervalMs);
    // Never hold the loop process open on this watch alone.
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
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

/** Parse the `--timeout` flag as a positive-integer ms value, or undefined. */
function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

async function makeFleetRuntime(context: CliContext): Promise<StrategyRuntime> {
    const coordination = new AgentCoordinationService(context);
    return new StrategyRuntime({
        openDb: () => context.getDb(),
        tasks: await makeService(context, undefined, true),
        fleet: new FleetService({
            spurConfig: await context.loadAgentConfig(context.cwd),
            roles: context.agentRoles,
            fs: context.fs,
            openDb: () => context.getDb(),
        }),
        // G71 R1: the one fleet dispatch primitive the strategy enqueues through —
        // without it a tick has decisions but no dispatch path, so it refuses loudly.
        dispatcher: new FleetDispatcher({
            coordination,
            runs: {
                listByMessageId: async (messageId: string) =>
                    new CoordinationRunDao(await context.getDb()).listByMessageId(messageId),
            },
        }),
        ready: async (candidate) => {
            const check = await makeCheckService(context);
            const result = await check.check(candidate.filePath, candidate.wbs, { asStatus: 'wip', strict: true });
            return !result.findings.some(
                (finding) => finding.severity === 'error' && finding.code !== FINDING_CODES.L4_PREREQUISITE_NOT_DONE,
            );
        },
        dependencyBlocked: async (_projectPath, wbs) => {
            const { foldersConfig } = await resolvePlanningFolders(context.fs);
            const check = await makeCheckService(context);
            return await check.firstBlockingPrerequisite(context.fs.resolve(foldersConfig.active_folder), wbs);
        },
    });
}

/**
 * `spur agent loop --spec <id> [--poll <ms>]` — the self-draining wrapper the supervisor
 * spawns (0258 R6). The loop itself lives in `@gobing-ai/spur-app`
 * (`services/agent-loop-service.ts`, task 0968); this transport keeps the `--spec`
 * validation, `--poll` parsing, and the CLI-only collaborator bindings.
 */
export async function runAgentLoop(
    context: CliContext,
    flags: Record<string, string | boolean>,
    runtime: AgentLoopRuntime = {},
    deps?: AgentRunDeps,
): Promise<number> {
    const recipient = typeof flags.spec === 'string' ? flags.spec : '';
    if (recipient === '' || recipient === 'auto') {
        context.output.error('agent loop requires an explicit --spec <id> matching a fleet agent spec');
        return 2;
    }
    const pollMs = parseLoopPoll(flags.poll);
    const fleet = new FleetService({
        fs: context.fs,
        spurConfig: await context.loadAgentConfig(context.cwd),
        roles: context.agentRoles,
        openDb: () => context.getDb(),
    });
    const loopDeps: AgentLoopDeps = {
        cwd: context.cwd,
        getDb: () => context.getDb(),
        write: (text) => context.output.write(text),
        error: (text) => context.output.error(text),
        agentService: (bus) => context.agentService({ events: bus }),
        fleet,
        makeStrategyRuntime: () => makeFleetRuntime(context),
        listAgentSpecs: () => new AgentCoordinationService(context).listAgentSpecs(),
        reconciler: new DeliveryReconciler(context),
        drain: (drainFlags) => drainIntoPrompt(undefined, context, { ...drainFlags, drain: true }),
        settle: (claimed, outcome) => settleClaimedMessages(context, claimed, outcome),
        attachLedger: (bus) => attachSystemEventLedger(bus, context),
        memberSession: {
            executors: context.agentConfig?.executors ?? [],
            env: context.env,
            getDb: () => context.getDb(),
            warn: (message) => context.output.error(message),
        },
    };
    return runAgentLoopCore(loopDeps, { recipient, pollMs, flags, runtime, runDeps: deps });
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
