import { randomUUID } from 'node:crypto';
import { CLAIM_TTL_MS, CoordinationRunDao, ProjectClaimDao, SystemEventDao } from '@gobing-ai/spur-domain';
import type { AgentProcessOptions, AgentSpec } from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import type { AgentRunDeps, AgentService } from './agent-service';
import type { DeliveryReconciler } from './delivery-reconciler';
import type { FleetService } from './fleet-service';
import type { MemberAgentProcess, MemberSessionDeps } from './member-session';
import { MemberSession } from './member-session';
import { normalizeProjectPath } from './project-registry';
import type { StrategyRuntime } from './strategy-runtime';
import { FLEET_TASK_KEY_PREFIX } from './strategy-runtime';
import { FOLLOW_POLL_INTERVAL_MS } from './system-event-follow';
import type { SystemEventBus } from './system-event-tap';
import { WRITE_SLOT_TTL_MS } from './write-slot-service';

/**
 * G71 R2: while a KEYED dispatch's run is live, the MEMBER keeps the write slot claimed for it
 * alive — the orchestrator's standby heartbeat (1073) stops once the receipt row is `running`.
 * Fenced by holder identity: if someone else holds the slot this member is fenced out, so it
 * stops heartbeating and lets the run finish. Returns the stop function.
 *
 * Exported because it is the one piece of the keyed drain path that cannot be exercised through
 * the loop itself: the loop's wake wait owns the clock, so a fake-timer test would deadlock in
 * `waitForWake` rather than reach the interval.
 */
export function createWriteSlotHeartbeat(input: {
    projectPath: string;
    recipient: string;
    getDb: () => Promise<Awaited<ReturnType<MemberSessionDeps['getDb']>>>;
}): () => void {
    const timer = setInterval(() => {
        void (async () => {
            const dao = new ProjectClaimDao(await input.getDb());
            const row = await dao.get(input.projectPath, 'write');
            if (row === null || row.holderId !== input.recipient) {
                // Fenced out (someone else holds the slot) or released: stop heartbeating and
                // let the run finish — the holder identity is the fence, not a guess.
                clearInterval(timer);
                return;
            }
            await dao.heartbeat(input.projectPath, 'write', input.recipient, WRITE_SLOT_TTL_MS, row.ownerEpoch);
        })().catch(() => undefined);
    }, WRITE_SLOT_TTL_MS / 3);
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
}

/**
 * The self-draining agent loop (task 0968, feature G67): `spur agent loop --spec <id>`
 * used to own this orchestration inside the CLI command module. It moves here so the
 * application layer owns the loop and a future non-CLI surface can run it; the CLI
 * keeps flag parsing and injects its collaborators through {@link AgentLoopDeps}.
 */

/** Backstop drain cadence when `--poll` is absent or malformed. */
export const DEFAULT_LOOP_POLL_MS = 2000;

/**
 * G71 R4 / decision D2: the orchestrator answers its inbox in prose and leaves dispatch to the
 * deterministic strategy tick. Appended to the orchestrator's drained prompt only.
 */
export const ORCHESTRATOR_REPLY_INSTRUCTION =
    'Answer each message with `spur message reply <id> <answer>`; do not dispatch or edit tasks.';

/** Injectable knobs for {@link runAgentLoopCore} — tests pass maxIterations/signal to bound runs. */
export interface AgentLoopRuntime {
    /** Aborting ends the loop cleanly (SIGINT/SIGTERM in the CLI action). */
    signal?: AbortSignal;
    /** Hard cap on iterations (tests only); undefined = run until aborted. */
    maxIterations?: number;
    /**
     * G66 test seam: overrides the `TeamAgentProcess` persistent member mode
     * spawns (never invoked in `resume`/`one-shot` modes). Production uses the
     * runner's process class directly.
     */
    memberProcessFactory?: (options: AgentProcessOptions) => MemberAgentProcess;
}

/**
 * Structural collaborator set for the loop (task 0968 R2). Every CLI-only
 * collaborator is injected as a function so no module under `packages/app/src`
 * imports from `apps/`.
 */
export interface AgentLoopDeps {
    cwd: string;
    getDb(): Promise<Awaited<ReturnType<MemberSessionDeps['getDb']>>>;
    /** stdout sink — the reconcile report. */
    write(text: string): void;
    /** stderr sink — warnings, delivery failures, idle-hold failures. */
    error(text: string): void;
    /** Per-loop bus-bound agent service. */
    agentService(bus: SystemEventBus): Pick<AgentService, 'run' | 'runTraced'>;
    fleet: FleetService;
    /** Strategy runtime factory (the CLI builds one bound to its `./task` services). */
    makeStrategyRuntime(): Promise<StrategyRuntime>;
    /** The recipient's agent spec listing. */
    listAgentSpecs(): Promise<AgentSpec[]>;
    reconciler: Pick<DeliveryReconciler, 'reconcile'>;
    drain(flags: Record<string, string | boolean>): Promise<{
        prompt?: string;
        flags: Record<string, string | boolean>;
        claimed: string[];
        /** The claimed rows' request keys (G71 R1) — a `fleet:task:*` key marks a keyed dispatch. */
        requestKeys?: Array<string | null | undefined>;
    }>;
    settle(claimed: string[], outcome: 'accepted' | 'not-started'): Promise<void>;
    attachLedger(bus: SystemEventBus): Promise<{ flush(): Promise<void>; unsubscribe(): void }>;
    /**
     * 1076 R2: name the run a member's live frames belong to, for the duration of a keyed drain.
     * Optional — a host without a supervisor simply keeps untagged frames.
     */
    setSupervisorRun?(agentId: string, runId: string | undefined): void;
    memberSession: MemberSessionDeps;
}

/** Already-validated loop input (flag parsing stays in the transport). */
export interface AgentLoopRunInput {
    recipient: string;
    pollMs: number;
    flags: Record<string, string | boolean>;
    runtime?: AgentLoopRuntime;
    runDeps?: AgentRunDeps;
}

/** Cancellable sleep; resolves immediately if the signal is already aborted. */
export function loopSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/** Render a reconcile report as run-log lines (0834 R2): summary, then one line per held message. */
function formatReconcileReport(report: {
    unresolved: Array<{ messageId: string; reason: string; injectAttempts: number; runId?: string }>;
    exhausted: string[];
    scanned: number;
}): string {
    const lines = [
        `reconcile: scanned=${report.scanned} unresolved=${report.unresolved.length} exhausted=${report.exhausted.length}`,
    ];
    for (const u of report.unresolved) {
        const run = u.runId !== undefined ? ` run=${u.runId}` : '';
        lines.push(`  ${u.messageId} ${u.reason} attempts=${u.injectAttempts}${run}`);
    }
    return lines.join('\n');
}

/**
 * The four wake sources (0839 R1): a human request (a ledgered `message.sent`
 * — Board/server senders persist it), a strategy change (`strategy.changed`,
 * emitted by StrategyRuntime.setStrategy), a task or capacity change
 * (`fleet.capacity.changed`, emitted by WriteSlotService claim/release), and a
 * completion receipt (`agent.invoke.exit`, persisted by every ledger-attached
 * run — 0833 writes the receipt in the same exit sink). Nothing else wakes the
 * loop; an unfiltered follow would re-create the hot loop with extra steps.
 */
const WAKE_EVENT_NAMES = [
    'message.sent', // human request / orchestrator order   (existing)
    'message.replied',
    'task.created',
    'task.updated',
    'strategy.changed', // strategy change                      (new)
    'fleet.capacity.changed', // task or capacity change        (new)
    'agent.invoke.exit', // completion receipt (0833 writes it in the same sink)
] as const;
type WakeSource = (typeof WAKE_EVENT_NAMES)[number] | 'backstop-timeout';

/** What ended one wait: the wake event consumed, or the `--poll` backstop timeout. */
interface WakeResult {
    source: WakeSource;
    /** The ledger cursor the loop resumes from — never replays a seen row. */
    sequence: number;
}

/** Batch size for the wake poll — mirrors the shared follower's query batch. */
const WAKE_FOLLOW_BATCH = 512;

/**
 * Wait for the next wake event on the `system_events` ledger (0839 R4/R5):
 * keyset-follows `sequence > afterSequence` at the shared follower cadence
 * ({@link FOLLOW_POLL_INTERVAL_MS}), returning on the first wake event, or
 * `{ source: 'backstop-timeout' }` after `timeoutMs` (R5's `--poll`), or on
 * abort. The cursor only ever moves forward: non-matching rows are consumed,
 * and the timeout/abort snapshot is `latestSequence()` — a wake never replays
 * an event the loop has already seen. Built on `dao.follow` (the same query
 * `followSystemEventsAfter` tails) because the frozen signature passes a dao,
 * not a getDb factory; the ledger — not a second transport — stays the source.
 */
export async function waitForWake(
    dao: SystemEventDao,
    afterSequence: number,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<WakeResult> {
    const deadline = Date.now() + timeoutMs;
    let cursor = afterSequence;
    for (;;) {
        if (signal?.aborted === true) {
            return { source: 'backstop-timeout', sequence: cursor };
        }
        const rows = await dao.follow(cursor, WAKE_FOLLOW_BATCH);
        for (const row of rows) {
            const sequence = row.sequence;
            if (sequence === null || sequence <= cursor) continue;
            cursor = sequence;
            if ((WAKE_EVENT_NAMES as readonly string[]).includes(row.event_name)) {
                return { source: row.event_name as WakeSource, sequence };
            }
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            return { source: 'backstop-timeout', sequence: cursor };
        }
        await loopSleep(Math.min(FOLLOW_POLL_INTERVAL_MS, remaining), signal);
    }
}

/** Ledger event name for the recorded idle hold (0839 R3; rendered by G63 0844). */
const IDLE_HOLD_EVENT = 'fleet.idle-hold';

/**
 * Record the operator-readable hold reason when nothing is runnable (0839 R3),
 * sourced from 0838's StrategyRuntime.selectNext — one `system_events` row
 * ONLY when the hold key changes (a steadily idle orchestrator writes one row,
 * not one per wake; a run that did work resets the caller's key via the loop
 * body). The loop's cwd is the project: strategy/claims/corpus/fleet resolve
 * against it, and the hold lands in the same ledger the loop follows. A
 * selectNext failure (no corpus, unmigrated db) is logged, never fatal — the
 * hold row is advisory, and silence must not wedge a consuming loop.
 */
export async function recordIdleHold(
    deps: AgentLoopDeps,
    recipient: string,
    source: WakeSource,
    lastHoldKey: string,
): Promise<string> {
    const projectPath = normalizeProjectPath(deps.cwd);
    let holds: Array<{ wbs: string; reason: string }>;
    try {
        // Construction is inside the try on purpose: a bare project (no corpus,
        // no agent config) must degrade to "no hold row", never wedge the loop.
        const runtime = await deps.makeStrategyRuntime();
        holds = (await runtime.selectNext(projectPath)).holds;
    } catch (error) {
        deps.error(`idle-hold: strategy selectNext failed: ${error instanceof Error ? error.message : String(error)}`);
        return lastHoldKey;
    }
    const holdKey =
        holds.length === 0
            ? 'idle'
            : holds
                  .map((h) => `${h.wbs}:${h.reason}`)
                  .sort()
                  .join(',');
    if (holdKey === lastHoldKey) return lastHoldKey;
    await new SystemEventDao(await deps.getDb()).insert({
        id: randomUUID(),
        event_name: IDLE_HOLD_EVENT,
        occurred_at: new Date().toISOString(),
        actor: recipient,
        payload_json: JSON.stringify({ projectPath, source, holdKey, holds }),
    });
    return holdKey;
}

/**
 * `spur agent loop --spec <id> [--poll <ms>]` — the persistent self-draining wrapper
 * the supervisor spawns (0258 R6). Each iteration WAITS for a wake on the
 * `system_events` ledger (0839: a human request, a strategy change, a capacity
 * change, or a completion receipt) and only then drains the inbox via
 * `drainPending`; an empty drain records the idle hold reason instead of a
 * silent sleep (R3). `--poll` is the backstop timeout — with no wake event the
 * loop still drains every `--poll` ms (R5, no migration for promoted loops).
 * Idle wakes cost no model call and no dispatch (R2). This is the long-lived,
 * attachable process — the member no longer dies after one successful drain.
 * Exits cleanly on abort (SIGINT/SIGTERM); crash-restart is the supervisor's
 * job.
 *
 * G66 (task 0896): the member keeps ONE coding-agent session for the loop's
 * lifetime, in the warmest mode its agent supports — `persistent` (one
 * `TeamAgentProcess`, prompts injected via stdin), `resume` (each drain passes
 * the previous drain's session id), or `one-shot` (today's behavior, with one
 * `member-no-session` warning per member lifetime). The mode comes from the
 * executor's capability record. Sessions reset deliberately — reason-named in
 * the run record — on persistent-process exit (`restart`), loop shutdown
 * (`operator`), or {@link MAX_CONSECUTIVE_FAILED_DRAINS} consecutive failed
 * drains (`failed-drains`). Delivery state stays in the DB: a resumed session
 * never redelivers a settled message (0831/0834 guarantees untouched).
 */
export async function runAgentLoopCore(deps: AgentLoopDeps, input: AgentLoopRunInput): Promise<number> {
    const { recipient, pollMs, flags, runtime = {}, runDeps } = input;
    // 0831 R4: the loop shares runAgentRun's acceptance rule — a per-process bus so
    // `agent.invoke.start` (via the agent runner) marks the invocation accepted.
    const bus = new EventBus() as SystemEventBus;
    const svc = deps.agentService(bus);

    const fleet = deps.fleet;
    const declaration = await fleet.load(deps.cwd);
    const claims = new ProjectClaimDao(await deps.getDb());
    const projectPath = normalizeProjectPath(deps.cwd);
    const binding = declaration === null ? null : await fleet.resolveOrchestrator(projectPath);
    const owner =
        binding?.instanceId === recipient
            ? await (async () => {
                  await fleet.assertLaunchGroundTruth(projectPath);
                  return claims.claim(projectPath, 'orchestrator', recipient, CLAIM_TTL_MS);
              })()
            : null;
    if (binding?.instanceId === recipient && owner === null) {
        deps.error(`Orchestrator ${recipient} already has a live owner`);
        return 2;
    }
    let ownershipLost = false;
    let renewal = Promise.resolve();
    const ownerTimer =
        owner === null
            ? undefined
            : setInterval(() => {
                  renewal = renewal
                      .then(async () => {
                          if (
                              !(await claims.heartbeat(
                                  projectPath,
                                  'orchestrator',
                                  recipient,
                                  CLAIM_TTL_MS,
                                  owner.ownerEpoch,
                              ))
                          ) {
                              ownershipLost = true;
                          }
                      })
                      .catch(() => {
                          ownershipLost = true;
                      });
              }, CLAIM_TTL_MS / 3);
    // G66: loop-lifetime member session state — declared before the try so the
    // shutdown path can name the operator reset on the way out. The session
    // service (task 0967) owns the mode, resume id, live process, and
    // failed-drain budget; the loop only drives it.
    // G71 R1: ONE strategy-runtime instance for the loop's lifetime. It owns the
    // standby write-slot heartbeat, so re-creating it per wake would leak a timer per
    // iteration and leave the lease unheartbeated between them.
    let strategyRuntime: StrategyRuntime | undefined;
    const memberSession = new MemberSession(
        {
            ...deps.memberSession,
            ...(runtime.memberProcessFactory !== undefined ? { processFactory: runtime.memberProcessFactory } : {}),
        },
        recipient,
    );
    try {
        // G71 R2 (1091): finalize this spec's orphaned runs BEFORE the first drain — and before
        // the reconcile below reads them — so a killed turn has a definite receipt instead of
        // staying `running` forever. A loop that died ungracefully (SIGKILL/OOM/crash) never
        // reaches `AgentService.run`'s exit sink; the supervisor runs at most one loop per spec,
        // so every `running` row for this spec at loop start is an orphan.
        const reaped = await new CoordinationRunDao(await deps.getDb()).reapOrphanedRunning(
            recipient,
            new Date().toISOString(),
        );
        if (reaped.length > 0) {
            // Wake the orchestrator for each finalized run so re-dispatch does not wait for the
            // backstop poll (the killed turn's own exit event was never written).
            const events = new SystemEventDao(await deps.getDb());
            for (const row of reaped) {
                await events.insert({
                    id: randomUUID(),
                    event_name: 'agent.invoke.exit',
                    occurred_at: new Date().toISOString(),
                    actor: recipient,
                    payload_json: JSON.stringify({
                        agent: recipient,
                        operation: 'orphan-reap',
                        exitCode: 137,
                        runId: row.run_id,
                    }),
                });
            }
            deps.error(
                `reaped ${reaped.length} orphaned run(s) left running by a previous ${recipient} loop: ${reaped
                    .map((row) => row.run_id)
                    .join(', ')}`,
            );
        }
        // 0834 R2: reconcile unfinished requests and runs BEFORE the first drain —
        // ambiguous work is named (outcome-unknown, never requeued) and budget-
        // exhausted rows are marked failed, so the loop never re-dispatches them.
        // The report is operator information in the run log; a non-empty unresolved
        // list does NOT gate the loop (blocking dispatch is G62's 0838 decision).
        const report = await deps.reconciler.reconcile(recipient);
        deps.write(formatReconcileReport(report));
        if (owner) {
            strategyRuntime = await deps.makeStrategyRuntime();
            await strategyRuntime.resume(projectPath);
        }

        let invocationStarted = false;
        bus.on('agent.invoke.start', (event) => {
            if (event && typeof event === 'object' && 'operation' in event && event.operation === 'prompt') {
                invocationStarted = true;
            }
        });

        // 0839 R4 wake-then-drain: the drain runs only AFTER a wake (a wake event on
        // the ledger, or the `--poll` backstop timeout — R5 keeps `--poll` as the
        // backstop so a promoted loop keeps consuming at the same worst-case latency
        // with no migration). The cursor starts at the current ledger tail so a
        // long-idle ledger fires no spurious immediate wake, and never replays a
        // seen row (waitForWake owns the forward-only guarantee).
        const wakeDao = new SystemEventDao(await deps.getDb());
        let cursor = await wakeDao.latestSequence();
        let lastHoldKey = '';

        // G66 R1: the member's session mode resolves ONCE per loop lifetime from
        // the executor's runner capability record — the drain path below has no
        // per-agent branches. Orchestrator loops dispatch instead of draining and
        // keep no member session state; a member with no spec file cannot resolve
        // an agent binary and silently keeps one-shot behavior.
        let memberSpec: AgentSpec | undefined;
        if (binding?.instanceId !== recipient) {
            memberSpec = (await deps.listAgentSpecs()).find((entry) => entry.id === recipient);
            if (memberSpec !== undefined) {
                await memberSession.start(memberSpec);
            }
        }
        // G66 R1 (resume): the run id of the drain's invoke exit keys the run→session
        // mapping the observer writes, so the NEXT drain can resume that session.
        let lastExitRunId: string | undefined;
        bus.on('agent.invoke.exit', (event) => {
            if (event === null || typeof event !== 'object') return;
            const record = event as { correlation?: { runId?: string }; runId?: string };
            const runId = record.correlation?.runId ?? record.runId;
            if (runId !== undefined) lastExitRunId = runId;
        });

        let iteration = 0;

        /**
         * One drain → execute → settle pass (G71 R1/R4). Returns whether anything ran, so the
         * caller can decide between a fresh idle hold and a reset one.
         *
         * A batch carrying a `fleet:task:*` dispatch key runs through `svc.run` even for a
         * persistent member: that is the only path that writes the `coordination_runs` receipt
         * 1073's dispatcher waits on — a stdin-accepted send writes none. Unkeyed
         * conversational traffic keeps the stdin path (0831's acceptance-is-delivery contract).
         */
        const runDrain = async (opts: { replyInstruction?: boolean } = {}): Promise<boolean> => {
            const { prompt, flags: rewritten, claimed, requestKeys } = await deps.drain({ ...flags, drain: true });
            if (prompt === undefined) return false;
            // Reset per iteration: each drain is an independent delivery attempt.
            invocationStarted = false;
            lastExitRunId = undefined;
            const keyed = (requestKeys ?? []).some(
                (key) => typeof key === 'string' && key.startsWith(FLEET_TASK_KEY_PREFIX),
            );
            const body = opts.replyInstruction === true ? `${prompt}\n\n${ORCHESTRATOR_REPLY_INSTRUCTION}` : prompt;
            const ledger = await deps.attachLedger(bus);
            let drainFailed: boolean;
            let stopHeartbeat: (() => void) | undefined;
            try {
                if (!keyed && memberSession.mode === 'persistent' && memberSpec !== undefined) {
                    // G66 R2: one long-lived member process for the loop's
                    // lifetime — each drained prompt is injected through its
                    // stdin. A successful send IS the delivery acceptance
                    // (0831): the prompt reached the agent, so the claimed
                    // rows settle delivered, never redelivered (R5).
                    try {
                        const process = await memberSession.ensureProcess(memberSpec);
                        const sent = await process.send(body);
                        if (!sent.ok) {
                            // 0831: a not-accepted send is a never-started
                            // delivery — report it like the one-shot path
                            // reports a failed spawn, then release below.
                            deps.error('member session: drain delivery failed: stdin send not accepted');
                        }
                        invocationStarted = sent.ok;
                        drainFailed = !sent.ok;
                    } catch (error) {
                        drainFailed = true;
                        deps.error(
                            `member session: drain delivery failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                } else {
                    // R2: a keyed run holds the write slot, so the member heartbeats it
                    // for the run's duration. An unkeyed batch claims no slot.
                    if (keyed) stopHeartbeat = createWriteSlotHeartbeat({ projectPath, recipient, getDb: deps.getDb });
                    // 1076 R2/R3 (ADR-132): a keyed run OWNS its id, so the durable record, the
                    // coordination row, the lineage edge and the live frame tags all name the same
                    // run. AgentService reads `run-id` from the flags; the supervisor is told the
                    // same id for as long as the run is live.
                    const runId = keyed ? randomUUID() : undefined;
                    if (runId !== undefined) deps.setSupervisorRun?.(recipient, runId);
                    try {
                        // G66 R1: resume mode re-opens the previous drain's session;
                        // one-shot keeps today's fresh process (R3's warning already
                        // fired once at loop start).
                        const baseFlags = { ...rewritten, ...(runId !== undefined ? { 'run-id': runId } : {}) };
                        const drainFlags =
                            memberSession.mode === 'resume' && memberSession.id !== undefined
                                ? { ...baseFlags, 'session-id': memberSession.id }
                                : baseFlags;
                        const exitCode = await svc.run(body, drainFlags, runDeps);
                        drainFailed = exitCode !== 0 || !invocationStarted;
                    } finally {
                        if (runId !== undefined) deps.setSupervisorRun?.(recipient, undefined);
                    }
                }
            } finally {
                stopHeartbeat?.();
                // 0831 R4: settle even on abort; the loop keeps iterating either
                // way — a released row redelivers on the next drain.
                await deps.settle(claimed, invocationStarted ? 'accepted' : 'not-started');
                await ledger.flush();
                ledger.unsubscribe();
            }
            // G66 R4/R7: the service owns the consecutive-failed-drain budget
            // (poisoned-session reset) and the resume-id capture (R1).
            await memberSession.recordDrain(drainFailed, lastExitRunId);
            return true;
        };

        while (
            !ownershipLost &&
            !runtime.signal?.aborted &&
            (runtime.maxIterations === undefined || iteration < runtime.maxIterations)
        ) {
            const wake = await waitForWake(wakeDao, cursor, pollMs, runtime.signal);
            cursor = wake.sequence;
            if (runtime.signal?.aborted) break;
            const fleetDeclared = (await fleet.load(deps.cwd)) !== null;
            if (fleetDeclared && owner !== null) {
                strategyRuntime ??= await deps.makeStrategyRuntime();
                const ledger = await deps.attachLedger(bus);
                try {
                    // G71 R4: the orchestrator converses before it dispatches. Its own drain
                    // runs the same path as a member's — answer through the inbox, then the
                    // DETERMINISTIC strategy tick decides dispatch (D2: the LLM never does).
                    //
                    // A throwing drain (inbox DB error) must not take the orchestrator down:
                    // before this drain existed the owner branch could not fail here, and an
                    // orchestrator outage stops dispatch for the whole project. Log and keep the
                    // wake loop alive — the tick still runs, and the next wake retries the drain.
                    try {
                        await runDrain({ replyInstruction: true });
                    } catch (error) {
                        deps.error(
                            `orchestrator drain failed: ${error instanceof Error ? error.message : String(error)}`,
                        );
                    }
                    // G71 R1/R3: settle, then dispatch — both non-blocking. Member work
                    // never runs in the orchestrator process; the receipt is completion.
                    await strategyRuntime.observe(projectPath, { ownerEpoch: owner.ownerEpoch });
                    const ticked = await strategyRuntime.tick(projectPath, {
                        ownerEpoch: owner.ownerEpoch,
                        orchestratorId: recipient,
                    });
                    // Only a wake that dispatched nothing is an idle hold; a dispatch is
                    // work, and the next idle stretch records its own hold row.
                    lastHoldKey =
                        ticked.dispatched.length === 0
                            ? await recordIdleHold(deps, recipient, wake.source, lastHoldKey)
                            : '';
                } finally {
                    await ledger.flush();
                    ledger.unsubscribe();
                }
                iteration++;
                continue;
            }
            // G71 R1: EVERY member loop drains. The fleet bypass that only recorded an idle
            // hold (C1) is deleted, so messages addressed to a member are actually consumed;
            // the hold describes an idle stretch, never a skipped inbox (R3).
            const drained = await runDrain();
            lastHoldKey = drained ? '' : await recordIdleHold(deps, recipient, wake.source, lastHoldKey);
            iteration++;
        }
        return ownershipLost ? 2 : 0;
    } finally {
        // G66 R4 / G71 R3: a persistent member's process IS its session, so loop shutdown
        // resets it (the next start opens a fresh one). A RESUME member keeps its id — the
        // whole point of `resume` is that a restart re-opens the same conversation, and the
        // id is seeded back from the ledger on the next start.
        if (memberSession.mode === 'persistent' && memberSession.hasLiveState()) {
            await memberSession.reset('operator').catch(() => undefined);
        }
        // G71 R1: no orphan standby heartbeat outlives the loop that owns the lease.
        strategyRuntime?.stop();
        if (ownerTimer !== undefined) clearInterval(ownerTimer);
        await renewal;
        if (owner) await claims.release(projectPath, 'orchestrator', recipient, owner.ownerEpoch);
    }
}
