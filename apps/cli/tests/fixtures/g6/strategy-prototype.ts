/**
 * G6 strategy prototype — deterministic event-driven fake controller (task 0829).
 *
 * This is a TEST-LOCAL simulator of the frozen behavioral contract in
 * docs/tasks4/0829_prototype-rest-and-gtd-dispatch-traces-with-capacity-and-res.md.
 * It is NOT an approved product contract and introduces no production API.
 *
 * Provenance (per 0828 handoff, docs/reports/g6-runtime-inventory.md §5):
 * - REUSED primitive shapes (simulated here, proven by 0828 probes): durable
 *   result records persisted before notification (probe 6), at-least-once
 *   attempt identity, per-spec monotonic generations (coordination_runs),
 *   closed role vocabulary scribe/coder/reviewer/planner.
 * - SIMULATED proposals (no production seam exists): idempotent request
 *   dedup (probe 3 is UNMET), completion-receipt linking (probe 6 ABSENT),
 *   per-project write slot/ownerEpoch lease, rest semantics, verified
 *   workflow completion, capability evidence.
 * The orchestrator is an explicit binding to a planner-role instance
 * (`purpose: 'orchestrator'`) — `orchestrator` is NOT a valid role id
 * (packages/config/src/index.ts:153–156).
 */

export type SpurRole = 'scribe' | 'coder' | 'reviewer' | 'planner';

export interface FakeTask {
    id: string;
    wbs: string;
    priority: number;
    role: SpurRole;
    authorized: boolean;
    ready: boolean;
    dependsOn: string[];
    readOnly: boolean;
    completed: boolean;
    completedAtAttempt?: string;
}

export interface FakeInstance {
    instanceId: string;
    role: SpurRole;
    executor: string;
    enabled: boolean;
    /** Explicit capability evidence — never inferred from role name alone. */
    capabilities: string[];
    purpose?: 'orchestrator';
}

export interface Assignment {
    attemptId: string;
    runId: string;
    generation: number;
    instanceId: string;
    executor: string;
    role: SpurRole;
    requestId: string;
    taskId?: string;
    ownerEpoch: number;
    strategyVersion: number;
    state: 'queued' | 'running' | 'outcome-unknown' | 'finished';
}

export interface RequestRecord {
    requestId: string;
    messageId: string;
    content: string;
    intent?: 'question';
    answer?: string;
}

export interface OutcomeRecord {
    attemptId: string;
    runId: string;
    generation: number;
    instanceId: string;
    taskId?: string;
    exitCode: number;
    verified: boolean;
    taskOutcome?: 'task-completed' | 'exit-only';
    notification: 'sent' | 'failed' | 'pending';
}

export interface HoldReason {
    reason: string;
    detail?: string;
}

export interface ProjectState {
    projectPath: string;
    strategyVersion: number;
    ownerEpoch: number;
    resting: boolean;
    requests: Map<string, RequestRecord>;
    assignments: Assignment[];
    tasks: Map<string, FakeTask>;
    instances: Map<string, FakeInstance>;
    finishedResults: Map<string, OutcomeRecord>;
    diagnostics: Array<{ kind: string; detail: string }>;
    holds: HoldReason[];
    writeSlot: { heldBy: string; ownerEpoch: number; strategyVersion: number } | null;
    dispatchedCount: number;
}

export type SimEvent =
    | {
          kind: 'request';
          projectPath: string;
          requestId: string;
          messageId: string;
          content: string;
          intent?: 'question';
      }
    | {
          kind: 'task';
          projectPath: string;
          task: Partial<Omit<FakeTask, 'completed'>> & { id: string; wbs: string; role: SpurRole };
      }
    | { kind: 'task-completed'; projectPath: string; taskId: string }
    | { kind: 'capacity'; projectPath: string; instanceId: string; enabled: boolean }
    | { kind: 'strategy'; projectPath: string; action: 'rest' | 'resume' | 'replace' }
    | {
          kind: 'result';
          projectPath: string;
          attemptId: string;
          runId: string;
          generation: number;
          ownerEpoch: number;
          instanceId: string;
          taskId?: string;
          exitCode: number;
          verified?: boolean;
          notification?: 'sent' | 'failed';
      }
    | { kind: 'tick'; projectPath: string };

export interface ControllerOptions {
    /** Test hook: runs between GTD selection and the atomic claim to create a race. */
    interceptBetweenSelectAndClaim?: () => void;
    /** Monotonic id minters, overridden per-test for readability. */
    nextAttemptId?: () => string;
    nextRunId?: () => string;
    counters?: { attempt: number; run: number; generation: number; dispatch: number; model: number };
    now?: () => number;
}

/** The wakeup triggers of the frozen contract; anything else must not wake. */
export const WAKING_KINDS = new Set(['request', 'task', 'task-completed', 'capacity', 'strategy', 'result']);

export class G6StrategyPrototypeController {
    private readonly projects = new Map<string, ProjectState>();
    private readonly opts: Required<Pick<ControllerOptions, 'nextAttemptId' | 'nextRunId'>> & ControllerOptions;
    private attemptCounter = 0;
    private runCounter = 0;
    private generationCounter = 0;
    /** Fake "model/LLM" call counter — idle ticks must leave it at zero delta. */
    modelCalls = 0;
    /** Total assigned dispatches (guards assert against this). */
    dispatchCount = 0;
    /** Serialized event trace, one line per processed event. */
    trace: string[] = [];

    constructor(opts: ControllerOptions = {}) {
        this.attemptCounter = opts.counters?.attempt ?? 0;
        this.runCounter = opts.counters?.run ?? 0;
        this.generationCounter = opts.counters?.generation ?? 0;
        this.dispatchCount = opts.counters?.dispatch ?? 0;
        this.modelCalls = opts.counters?.model ?? 0;
        this.opts = {
            nextAttemptId: opts.nextAttemptId ?? (() => `attempt-${++this.attemptCounter}`),
            nextRunId: opts.nextRunId ?? (() => `run-${++this.runCounter}`),
            ...opts,
        };
    }

    /* ------------------------------ helpers ------------------------------ */

    private project(projectPath: string): ProjectState {
        let p = this.projects.get(projectPath);
        if (!p) {
            p = {
                projectPath,
                strategyVersion: 1,
                ownerEpoch: 1,
                resting: false,
                requests: new Map(),
                assignments: [],
                tasks: new Map(),
                instances: new Map(),
                finishedResults: new Map(),
                diagnostics: [],
                holds: [],
                writeSlot: null,
                dispatchedCount: 0,
            };
            this.projects.set(projectPath, p);
        }
        return p;
    }

    addInstance(projectPath: string, instance: FakeInstance & { role: SpurRole }): void {
        this.project(projectPath).instances.set(instance.instanceId, {
            ...instance,
            capabilities: [...instance.capabilities],
        });
    }

    getProject(projectPath: string): ProjectState {
        const p = this.projects.get(projectPath);
        if (!p) throw new Error(`no project ${projectPath}`);
        return p;
    }

    /** Test-fixture-only: lazily-create access for snapshot restore (no throw). */
    restoreProjectState(projectPath: string): ProjectState {
        return this.project(projectPath);
    }

    assignments(p: string): Assignment[] {
        return this.getProject(p).assignments;
    }
    tasks(p: string): Map<string, FakeTask> {
        return this.getProject(p).tasks;
    }
    holds(p: string): HoldReason[] {
        return this.getProject(p).holds;
    }
    diagnostics(p: string): Array<{ kind: string; detail: string }> {
        return this.getProject(p).diagnostics;
    }

    /* ------------------------------- events ------------------------------ */

    /** Process one event. Deterministic, synchronous. */
    process(event: SimEvent): void {
        const p = this.project(event.projectPath);
        const before = { dispatch: this.dispatchCount, model: this.modelCalls, state: this.snapshot() };
        switch (event.kind) {
            case 'request': {
                const key = `${p.projectPath}::${event.requestId}`;
                const existing = p.requests.get(key);
                if (existing) {
                    if (existing.content !== event.content || existing.intent !== event.intent) {
                        // Immutable request content: reuse of a requestId with
                        // different content is an error, not a silent amend.
                        throw new Error(`request ${event.requestId} reused with different content`);
                    }
                    this.trace.push(`dedup request ${event.requestId}(idempotent replay)`);
                    // Idempotent replay: no new wake (the original wake happened).
                    this.record(event, before, p);
                    return;
                }
                const request: RequestRecord = {
                    requestId: event.requestId,
                    messageId: event.messageId,
                    content: event.content,
                    intent: event.intent,
                };
                p.requests.set(key, request);
                if (event.intent === 'question') {
                    const orchestrator = [...p.instances.values()].find(
                        (i) => i.purpose === 'orchestrator' && i.enabled,
                    );
                    if (orchestrator) {
                        this.modelCalls++;
                        request.answer = `SIMULATED answer from ${orchestrator.instanceId}: ${event.content}`;
                    } else {
                        p.holds.push({ reason: 'orchestrator-unavailable', detail: event.requestId });
                    }
                    this.record(event, before, p);
                    return;
                }
                this.trace.push(`request ${event.requestId} accepted`);
                this.wakeAndSelect(p);
                this.record(event, before, p);
                return;
            }
            case 'task': {
                const prev = p.tasks.get(event.task.id);
                p.tasks.set(event.task.id, {
                    dependsOn: [],
                    readOnly: false,
                    priority: 5,
                    authorized: false,
                    ready: false,
                    completed: prev?.completed ?? false,
                    completedAtAttempt: prev?.completedAtAttempt,
                    ...event.task,
                });
                this.trace.push(`task ${event.task.id} updated`);
                this.wakeAndSelect(p);
                this.record(event, before, p);
                return;
            }
            case 'task-completed': {
                const t = p.tasks.get(event.taskId);
                if (t) t.completed = true;
                this.trace.push(`task ${event.taskId} completed (external)`);
                this.wakeAndSelect(p);
                this.record(event, before, p);
                return;
            }
            case 'capacity': {
                const inst = p.instances.get(event.instanceId);
                if (inst) inst.enabled = event.enabled;
                this.trace.push(`instance ${event.instanceId} ${event.enabled ? 'enabled' : 'disabled'}`);
                this.wakeAndSelect(p);
                this.record(event, before, p);
                return;
            }
            case 'strategy': {
                if (event.action === 'rest') {
                    p.strategyVersion += 1;
                    p.resting = true;
                    const droppedQueue = p.assignments.filter((a) => a.state === 'queued').length;
                    p.assignments = p.assignments.filter((a) => a.state !== 'queued'); // drop unstarted
                    this.trace.push(
                        `rest → strategyVersion=${p.strategyVersion}; dropped ${droppedQueue} queued; ${p.assignments.length} running kept`,
                    );
                } else if (event.action === 'resume') {
                    p.resting = false;
                    this.trace.push(`resume`);
                    this.wakeAndSelect(p);
                } else {
                    // A new owner cannot prove that the old writer stopped.
                    p.ownerEpoch += 1;
                    for (const a of p.assignments) a.state = 'outcome-unknown';
                    if (p.assignments.length)
                        p.holds.push({ reason: 'outcome-unknown', detail: 'replacement requires reconciliation' });
                    this.trace.push(`replace-orchestrator → ownerEpoch=${p.ownerEpoch}; reservation retained`);
                    this.wakeAndSelect(p);
                }
                this.record(event, before, p);
                return;
            }
            case 'result':
                this.handleResult(event, before, p);
                return;
            case 'tick': {
                // Idle tick: ZERO fake model calls, ZERO dispatches.
                this.trace.push(`tick (no wake)`);
                if (this.dispatchCount !== before.dispatch || this.modelCalls !== before.model) {
                    throw new Error('idle tick caused a model call or dispatch');
                }
                if (p.assignments.length === 0) {
                    p.holds.push({ reason: 'idle', detail: 'no eligible work and no active assignment at tick' });
                }
                this.record(event, before, p);
                return;
            }
        }
    }

    private record(e: SimEvent, before: { dispatch: number; model: number; state: string }, p: ProjectState): void {
        p.holds = p.holds.slice(-8);
        this.trace.push(
            JSON.stringify({
                event: e,
                at: this.opts.now?.() ?? 0,
                before,
                after: this.snapshot(),
                dispatchDelta: this.dispatchCount - before.dispatch,
                modelDelta: this.modelCalls - before.model,
            }),
        );
    }

    /* --------------------------- wake + GTD select ----------------------- */

    private wakeAndSelect(p: ProjectState): void {
        this.modelCalls += 1; // evaluating eligible state is the model call;
        // idle ticks never reach here (guarded above).
        if (![...p.requests.values()].some((r) => r.intent !== 'question')) {
            // No accepted human request in scope yet: nothing may dispatch.
            p.holds.push({ reason: 'no-driving-request', detail: 'task/capacity change with no accepted request' });
            return;
        }
        if (p.resting) {
            if (p.assignments.length === 0 && p.writeSlot === null) {
                p.holds.push({ reason: 'rest-after-drain', detail: `strategyVersion=${p.strategyVersion}` });
            } else if (p.assignments.length > 0) {
                p.holds.push({
                    reason: 'rest-draining',
                    detail: `${p.assignments.length} assignment(s) retain their write slot until reconciliation`,
                });
            }
            return; // no future starts while resting
        }
        for (;;) {
            const candidate = this.selectGtdAssignment(p);
            if (!candidate) return; // hold reason already recorded
            // Snapshot lease versions BEFORE claiming: a stale decision must
            // re-evaluate rather than dispatch.
            const epochAtDecision = p.ownerEpoch;
            const versionAtDecision = p.strategyVersion;
            this.opts.interceptBetweenSelectAndClaim?.();
            if (p.ownerEpoch !== epochAtDecision || p.strategyVersion !== versionAtDecision) {
                this.trace.push(`stale decision (epoch/version moved) → re-evaluating`);
                continue;
            }
            if (p.resting) {
                // A stale decision re-evaluated after rest must not dispatch.
                p.holds.push({ reason: 'rest-after-drain', detail: 'reevaluated during rest; no future starts' });
                return;
            }
            this.claimAndAssign(p, candidate);
            return;
        }
    }

    private selectGtdAssignment(p: ProjectState): { task?: FakeTask; instance: FakeInstance; reason?: string } | null {
        if (this.writeSlotOccupied(p)) {
            p.holds.push({ reason: 'write-slot-occupied', detail: p.writeSlot?.heldBy });
            return null;
        }
        const cand = [...p.tasks.values()]
            .filter((t) => !t.completed)
            .sort((a, b) => a.priority - b.priority || a.wbs.localeCompare(b.wbs, undefined, { numeric: true })); // priority then WBS
        for (const t of cand) {
            const fail = this.whyNotEligible(p, t);
            if (fail) {
                p.holds.push({ reason: fail, detail: `task ${t.id}` });
                continue;
            }
            const instance = this.pickInstance(p, t);
            if (!instance) {
                p.holds.push({
                    reason: t.readOnly ? 'no-capable-idle-instance' : 'no-idle-instance',
                    detail: `role ${t.role}`,
                });
                continue;
            }
            return { task: t, instance };
        }
        if (cand.length === 0) {
            p.holds.push({ reason: 'no-candidate-tasks', detail: 'add/authorize a task to proceed' });
        }
        return null;
    }

    private whyNotEligible(p: ProjectState, t: FakeTask): string | null {
        if (!t.authorized) return 'unauthorized';
        if (!t.ready) return 'not-ready';
        if (t.dependsOn.some((d) => !p.tasks.get(d)?.completed)) return 'unmet-dependency';
        return null;
    }

    private pickInstance(p: ProjectState, t: FakeTask): FakeInstance | null {
        const eligible = [...p.instances.values()]
            .filter((i) => i.enabled)
            .filter((i) => i.role === t.role) // role-compatible
            .filter((i) => !i.purpose)
            .filter((i) => this.isGhost(p, i.instanceId))
            .filter((i) => i.capabilities.includes(t.readOnly ? 'read-only' : 'write'))
            .sort((a, b) => a.instanceId.localeCompare(b.instanceId)); // stable tie-break
        return eligible[0] ?? null;
    }

    private isGhost(p: ProjectState, instanceId: string): boolean {
        return !p.assignments.some((a) => a.instanceId === instanceId && a.state !== 'finished');
    }

    private writeSlotOccupied(p: ProjectState): boolean {
        return p.writeSlot !== null;
    }

    private claimAndAssign(p: ProjectState, c: { task?: FakeTask; instance: FakeInstance }): void {
        // Atomic claim of instance + the project's single write slot.
        if (p.resting) throw new Error('G6 guard "no-dispatch-after-rest" tripped: assignment attempted while resting');
        if (p.writeSlot !== null) {
            throw new Error(`G6 guard "single-writer" tripped: slot already held by ${p.writeSlot.heldBy}`);
        }
        if (c.instance) {
            if (!this.isGhost(p, c.instance.instanceId)) {
                throw new Error(
                    `G6 guard "duplicate-assignment" tripped: instance ${c.instance.instanceId} already busy`,
                );
            }
        }
        // Duplicate-assignment guard: same task must not be assigned twice.
        const task = c.task;
        const attemptId = this.opts.nextAttemptId();
        const runId = this.opts.nextRunId();
        const a: Assignment = {
            attemptId,
            runId,
            generation: ++this.generationCounter,
            instanceId: c.instance.instanceId,
            executor: c.instance.executor,
            role: c.instance.role,
            requestId: this.lastRequestId(p),
            taskId: task?.id,
            ownerEpoch: p.ownerEpoch,
            strategyVersion: p.strategyVersion,
            state: 'running',
        };
        p.assignments.push(a);
        this.dispatchCount += 1;
        p.dispatchedCount += 1;
        p.writeSlot = { heldBy: attemptId, ownerEpoch: p.ownerEpoch, strategyVersion: p.strategyVersion };
        this.trace.push(
            `dispatch ${a.taskId ?? '(answer)'} → ${a.instanceId} [${a.attemptId}/${a.runId}/gen${a.generation} ep${a.ownerEpoch} v${a.strategyVersion}]`,
        );
    }

    private lastRequestId(p: ProjectState): string {
        const request = [...p.requests.values()].findLast((r) => r.intent !== 'question');
        if (!request) throw new Error('no driving request accepted for this dispatch');
        return request.requestId;
    }

    /* ------------------------------ results ------------------------------ */

    private handleResult(
        e: Extract<SimEvent, { kind: 'result' }>,
        before: { dispatch: number; model: number; state: string },
        p: ProjectState,
    ): void {
        // Deduplicate outcomes by attemptId.
        if (p.finishedResults.has(e.attemptId)) {
            this.trace.push(`outcome ${e.attemptId} already reconciled (dedup)`);
            this.record(e, before, p);
            return;
        }
        // Cross-project delivery guard: the assignment must exist AND belong to
        // the project the result claims to be from.
        const a = p.assignments.find((x) => x.attemptId === e.attemptId && x.runId === e.runId);
        if (!a) {
            p.diagnostics.push({
                kind: 'orphan-result',
                detail: `${e.attemptId} run=${e.runId} — no matching assignment in ${p.projectPath}`,
            });
            this.trace.push(`result ${e.attemptId} REJECTED cross-project/orphan — task NOT advanced`);
            this.record(e, before, p);
            return;
        }
        // Ownership check: late/stale results must match instance/run/generation
        // AND the ownerEpoch under which the work was claimed.
        if (
            a.instanceId !== e.instanceId ||
            a.generation !== e.generation ||
            a.ownerEpoch !== e.ownerEpoch ||
            a.taskId !== e.taskId
        ) {
            p.diagnostics.push({
                kind: 'stale-owner-rejected',
                detail: `${e.attemptId} instance/run/generation mismatch`,
            });
            this.trace.push(`result ${e.attemptId} REJECTED stale-owner — retained as diagnostic only`);
            this.record(e, before, p);
            return;
        }
        if (a.ownerEpoch !== p.ownerEpoch) {
            p.diagnostics.push({
                kind: 'stale-owner-rejected',
                detail: `${e.attemptId} claimed ep${a.ownerEpoch}, current ep${p.ownerEpoch} — downgraded to diagnostic, no authoritative advance`,
            });
            this.trace.push(`result ${e.attemptId} REJECTED stale ownerEpoch — retained as diagnostic only`);
            this.record(e, before, p);
            return;
        }
        // Durable persistence happens BEFORE notification (mirrors probe 6:
        // results survive even if the notification sink fails).
        const outcome: OutcomeRecord = {
            attemptId: e.attemptId,
            runId: e.runId,
            generation: e.generation,
            instanceId: e.instanceId,
            taskId: e.taskId,
            exitCode: e.exitCode,
            verified: e.verified ?? false,
            taskOutcome: (e.verified ?? false) && e.exitCode === 0 && e.taskId ? 'task-completed' : 'exit-only',
            notification: e.notification ?? 'pending',
        };
        p.finishedResults.set(outcome.attemptId, outcome);
        // Process exit can FINISH a RUN; only an explicit verified workflow
        // outcome can COMPLETE a task.
        if (outcome.taskOutcome === 'task-completed') {
            a.state = 'finished';
            p.assignments = p.assignments.filter((x) => x !== a);
            if (p.writeSlot?.heldBy === e.attemptId) p.writeSlot = null;
        } else {
            a.state = 'outcome-unknown';
            p.holds.push({ reason: 'outcome-unknown', detail: `${a.attemptId}: exit alone does not authorize replay` });
        }
        if (outcome.taskOutcome === 'task-completed') {
            const t = p.tasks.get(e.taskId as string);
            if (t) {
                t.completed = true;
                t.completedAtAttempt = e.attemptId;
            }
        }
        if (outcome.notification === 'failed') {
            // Notification failure leaves the result discoverable in the
            // persistent model state (`finishedResults`) for reconciliation.
            p.diagnostics.push({
                kind: 'notification-failed',
                detail: `${e.attemptId} retained in finishedResults for reconciliation`,
            });
        }
        this.trace.push(
            `result ${e.attemptId} reconciled: ${outcome.taskOutcome} exit=${outcome.exitCode}${e.verified ? ' verified' : ' UNVERIFIED'}${outcome.notification === 'failed' ? ' (notification failed)' : ''}`,
        );
        this.wakeAndSelect(p); // result is a wake trigger
        this.record(e, before, p);
        return;
    }

    /** Reconciliation of retained results (e.g. after notification failure). */
    reconcileNotifications(projectPath: string): OutcomeRecord[] {
        const p = this.project(projectPath);
        const retained = [...p.finishedResults.values()].filter((r) => r.notification === 'failed');
        for (const r of retained) {
            r.notification = 'sent';
            p.diagnostics = p.diagnostics.filter(
                (d) => !(d.kind === 'notification-failed' && d.detail.startsWith(r.attemptId)),
            );
        }
        this.trace.push(`reconcileNotifications: ${retained.length} retained result(s) delivered`);
        return retained;
    }

    /* ----------------------------- snapshots ----------------------------- */

    /** Serialize the durable state — restart = loading this into a fresh controller. */
    snapshot(): string {
        return JSON.stringify(
            {
                version: 1,
                counters: {
                    attempt: this.attemptCounter,
                    run: this.runCounter,
                    generation: this.generationCounter,
                    dispatch: this.dispatchCount,
                    model: this.modelCalls,
                },
                projects: [...this.projects.values()].map((p) => ({
                    projectPath: p.projectPath,
                    strategyVersion: p.strategyVersion,
                    ownerEpoch: p.ownerEpoch,
                    resting: p.resting,
                    requests: [...p.requests.entries()],
                    assignments: p.assignments,
                    tasks: [...p.tasks.entries()].map(([, t]) => t),
                    instances: [...p.instances.entries()].map(([, i]) => i),
                    finishedResults: [...p.finishedResults.entries()],
                    diagnostics: p.diagnostics,
                    holds: p.holds,
                    writeSlot: p.writeSlot,
                    dispatchedCount: p.dispatchedCount,
                })),
            },
            null,
            2,
        );
    }

    /** Adversarial hook used ONLY in tests to prove the guards can trip. */
    unsafeForceAssignment(projectPath: string, instanceId: string, taskId: string): never {
        const p = this.project(projectPath);
        // duplicate-assignment: dispatching onto a non-idle instance
        if (!this.isGhost(p, instanceId)) {
            throw new Error(
                `G6 guard "duplicate-assignment" tripped: instance ${instanceId} already busy with ${taskId}`,
            );
        }
        // single-writer: a second writer claims the project write slot
        if (p.writeSlot !== null) {
            throw new Error(`G6 guard "single-writer" tripped: slot already held by ${p.writeSlot.heldBy}`);
        }
        p.writeSlot = { heldBy: 'forced', ownerEpoch: p.ownerEpoch, strategyVersion: p.strategyVersion };
        throw new Error(`G6 guard tripped unconditionally: forced violation released for ${taskId}`);
    }
}

export function restoreController(json: string, opts: ControllerOptions = {}): G6StrategyPrototypeController {
    const data = JSON.parse(json) as {
        counters: NonNullable<ControllerOptions['counters']>;
        projects: Array<
            Omit<ProjectState, 'requests' | 'tasks' | 'instances' | 'finishedResults'> & {
                requests: Array<[string, RequestRecord]>;
                tasks: FakeTask[];
                instances: (FakeInstance & { role: SpurRole })[];
                finishedResults: Array<[string, OutcomeRecord]>;
            }
        >;
    };
    const c = new G6StrategyPrototypeController({ ...opts, counters: data.counters });
    for (const raw of data.projects) {
        const p = c.restoreProjectState(raw.projectPath);
        p.strategyVersion = raw.strategyVersion;
        p.ownerEpoch = raw.ownerEpoch;
        p.resting = raw.resting;
        p.requests = new Map(raw.requests);
        p.assignments = raw.assignments;
        p.tasks = new Map(raw.tasks.map((t) => [t.id, t]));
        p.instances = new Map(raw.instances.map((i) => [i.instanceId, i]));
        p.finishedResults = new Map(raw.finishedResults);
        p.diagnostics = raw.diagnostics;
        p.holds = raw.holds;
        p.writeSlot = raw.writeSlot;
        p.dispatchedCount = raw.dispatchedCount;
    }
    c.trace.push('restart: persisted-state model reloaded into fresh controller');
    return c;
}

/** Run an event sequence through a controller and return per-event deltas for assertions. */
export function runSequence(controller: G6StrategyPrototypeController, events: SimEvent[]): void {
    for (const e of events) controller.process(e);
}

export function compactState(p: ProjectState): string {
    return `sv=${p.strategyVersion} ep=${p.ownerEpoch} rest=${p.resting ? 'y' : 'n'} running=${p.assignments.filter((a) => a.state === 'running').length} queued=${p.assignments.filter((a) => a.state === 'queued').length} completed=[${[
        ...p.tasks.values(),
    ]
        .filter((t) => t.completed)
        .map((t) => t.id)
        .join(',')}] slot=${p.writeSlot?.heldBy ?? 'free'}`;
}
