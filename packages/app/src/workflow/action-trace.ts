/**
 * Surface-agnostic action trace writer (ADR-117, task 0868).
 *
 * The structured action trace — an `action_runs` row per executed action plus the run
 * row's terminal closure — is owed by whichever surface executes the action, engine
 * subprocess or inline host-session driver alike. This module is the ONE emission path
 * both surfaces call: a thin `WorkflowPersistenceAdapter` decorator that routes the
 * action boundary (`saveActionStart` / `saveActionFinalize`) and the run-row closure
 * (`finalizeRun`) through the engine's own persistence methods. Only the action
 * boundary is best-effort; the run-row closure is bookkeeping, not trace emission,
 * so it propagates its error.
 *
 * Why a decorator and not a second writer: the engine's `runActionStep` calls
 * `persistence.saveActionStart` / `saveActionFinalize` and its lifecycle calls
 * `finalizeRun`. Wrapping that adapter interface is the seam the app already uses for
 * observability (`ObservableWorkflowAdapter`), so the inline driver emits through the
 * exact same calls the engine runner does — a parallel SQL writer would drift and
 * reintroduce the gap under a new name.
 *
 * Best-effort applies to the action boundary only (ADR-117, R3/R12): a
 * `saveActionStart` / `saveActionFinalize` / `recordAction` persistence failure is
 * handed to the injected recorder and never thrown, so observation never wedges the
 * thing observed — the inline driver runs in the operator's own session where a throw
 * is maximally disruptive. The run-row closure (`finalizeRun`) is NOT best-effort: it
 * is the engine's terminal closure and the lifecycle adapter's parking write, and a
 * swallowed failure there leaves a stale `running` row that `spur workflow clean`
 * reaps as `failed`.
 */

import { join } from 'node:path';
import { ActionRunDao, type DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ActionRedactor,
    DbWorkflowPersistenceAdapter,
    type ResumeOwnership,
    type WorkflowPersistenceAdapter,
    type WorkflowRunRecord,
    type WorkflowStatus,
} from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';

/** The engine does not export its reseed-result type; derive it from the interface. */
type ReseedResult = Awaited<ReturnType<WorkflowPersistenceAdapter['reseedRun']>>;

/** One completed action boundary the inline driver reports after the action ran. */
export interface ActionTraceBoundary {
    readonly runId: string;
    /** The state (node) the action ran in — the FSM state id, never a display label. */
    readonly node: string;
    /** The action kind (e.g. `agent.run`, `shell`, `note`). */
    readonly kind: string;
    /** Final action status. */
    readonly status: WorkflowStatus;
    /** Whether the action succeeded. */
    readonly ok: boolean;
    /** Wall-clock duration in milliseconds, measured at the action boundary. */
    readonly durationMs: number;
    /** Optional action result; redacted by the adapter before persistence. */
    readonly result?: unknown;
    readonly redactor?: ActionRedactor;
}

/** Which trace write failed. */
export type ActionTraceOperation = 'action.start' | 'action.finish' | 'run.close' | 'action.backdate';

/** A recorded emission failure — never thrown, always surfaced to the recorder. */
export interface ActionTraceFailure {
    readonly operation: ActionTraceOperation;
    readonly runId: string;
    readonly node?: string;
    readonly kind?: string;
    readonly error: string;
    /** ISO-8601 timestamp the failure was observed. */
    readonly at: string;
}

/** Sink for emission failures. Must not throw — the writer guards it anyway. */
export type ActionTraceFailureRecorder = (failure: ActionTraceFailure) => void;

/** Outcome of one best-effort trace write. */
export type ActionTraceResult =
    | { readonly ok: true; readonly actionId?: string }
    | { readonly ok: false; readonly failure: ActionTraceFailure };

/** Synthetic action id returned when the start row could not be persisted. */
const UNPERSISTED_PREFIX = 'trace-unpersisted:';

/**
 * Named error thrown by {@link WorkflowActionTraceWriter.closeRun} when the run row
 * targeted by `--close` has no persisted row — a blind `UPDATE` cannot tell zero
 * matched rows from success, so the closure checks existence and fails loudly
 * (review finding #4) rather than report a false `{"ok":true}`.
 */
export class RunRowNotFoundError extends Error {
    readonly runId: string;
    constructor(runId: string) {
        super(`run row not found: ${runId}`);
        this.name = 'RunRowNotFoundError';
        this.runId = runId;
    }
}

/**
 * Wraps a `WorkflowPersistenceAdapter`: the action boundary (`saveActionStart` /
 * `saveActionFinalize` / `recordAction`) is best-effort, the run-row closure
 * (`finalizeRun`) propagates. Every other method passes straight through — read paths
 * and non-lifecycle writes are untouched.
 */
export class WorkflowActionTraceWriter implements WorkflowPersistenceAdapter {
    /** action-row id → its boundary identity, so a finalize failure can name the run. */
    private readonly boundaries = new Map<string, { runId: string; node: string; kind: string }>();

    constructor(
        private readonly inner: WorkflowPersistenceAdapter,
        private readonly recordFailure?: ActionTraceFailureRecorder,
        private readonly db?: DbAdapter,
    ) {}

    /**
     * Best-effort variant of the engine's `saveActionStart`. On a persistence failure the
     * failure is recorded and a synthetic id is returned, so the caller's control loop
     * continues — the engine treats the row id as an opaque correlation handle.
     */
    async saveActionStart(
        runId: string,
        node: string,
        kind: string,
        options?: Record<string, unknown>,
    ): Promise<string> {
        const outcome = await this.guard('action.start', { runId, node, kind }, () =>
            this.inner.saveActionStart(runId, node, kind, options),
        );
        if (!outcome.ok) {
            // Remember the boundary identity keyed by the synthetic id so a follow-up
            // `saveActionFinalize` (the engine passes the id back) still names the run in
            // its failure record (review finding #3) instead of falling back to `runId: ''`.
            const syntheticId = `${UNPERSISTED_PREFIX}${crypto.randomUUID()}`;
            this.boundaries.set(syntheticId, { runId, node, kind });
            this.lastStart = { runId, node, kind };
            return syntheticId;
        }
        this.boundaries.set(outcome.value, { runId, node, kind });
        this.lastStart = { runId, node, kind };
        return outcome.value;
    }

    /** Last started action identity — attribution fallback when the boundary map misses (0868 #2). */
    private lastStart?: { runId: string; node?: string; kind?: string };

    /** Best-effort variant of the engine's `saveActionFinalize`. */
    async saveActionFinalize(
        actionId: string,
        status: WorkflowStatus,
        durationMs: number,
        ok: boolean,
        kind: string,
        result?: unknown,
        redactor?: ActionRedactor,
    ): Promise<void> {
        const boundary = this.boundaries.get(actionId);
        // 0868 finding #2: an unobserved finalize (boundary already gone) keeps its run-id
        // attribution via the remembered last-start identity instead of degrading to ''.
        const origin = boundary ?? this.lastStart;
        await this.guard('action.finish', { runId: origin?.runId ?? '', node: origin?.node, kind }, () =>
            this.inner.saveActionFinalize(actionId, status, durationMs, ok, kind, result, redactor),
        );
        this.boundaries.delete(actionId);
    }

    /**
     * The shared run-row closure path — the engine's terminal closure and the lifecycle
     * adapter's parking call. NOT best-effort: the closure is bookkeeping, not trace
     * emission, so a persistence failure propagates to the caller exactly as it did
     * before the writer existed (review finding #1). R5/R7 keep the path shared; the
     * error just passes through. Only the action boundary stays best-effort (R3/R12).
     */
    async finalizeRun(runId: string, status: WorkflowStatus, completedAt: string): Promise<void> {
        // Engine 0.5.5 widens `finalizeRun` to `Promise<boolean | void>` (fenced ownership
        // CAS). This decorator's contract is the 3-arg pass-through, so the flag is
        // discarded — same shape as ObservableWorkflowAdapter.finalizeRun.
        await this.inner.finalizeRun(runId, status, completedAt);
    }

    /** Ownership/interruption CAS — straight pass-through per the class contract (ADR-025). */
    async claimRunOwnership(
        runId: string,
        owner: ResumeOwnership,
        expectedStatuses: readonly ('paused' | 'interrupted')[],
    ): Promise<WorkflowRunRecord | undefined> {
        return this.inner.claimRunOwnership(runId, owner, expectedStatuses);
    }

    async interruptRun(runId: string, reason: string): Promise<WorkflowRunRecord | undefined> {
        return this.inner.interruptRun(runId, reason);
    }

    /**
     * Convenience for a surface that observes a completed action after the fact (the inline
     * driver): emit the start row and its finalize in one call. Both halves go through the
     * same best-effort methods the engine calls.
     */
    async recordAction(boundary: ActionTraceBoundary): Promise<ActionTraceResult> {
        const start = await this.guard(
            'action.start',
            { runId: boundary.runId, node: boundary.node, kind: boundary.kind },
            () => this.inner.saveActionStart(boundary.runId, boundary.node, boundary.kind),
        );
        if (!start.ok) return start;
        const finish = await this.guard(
            'action.finish',
            { runId: boundary.runId, node: boundary.node, kind: boundary.kind },
            () =>
                this.inner.saveActionFinalize(
                    start.value,
                    boundary.status,
                    boundary.durationMs,
                    boundary.ok,
                    boundary.kind,
                    boundary.result,
                    boundary.redactor,
                ),
        );
        if (!finish.ok) return finish;
        await this.backdateStart(start.value, boundary);
        return { ok: true, actionId: start.value };
    }

    /**
     * Back-date the persisted `started_at` from the row's own `completed_at` so that
     * `completed_at - started_at == duration_ms` exactly (task 0887 R8). The engine stamps
     * `started_at = now` at insert and `completed_at = now` at finalize; `recordAction` runs
     * both back-to-back after the real span was already measured, so the stored interval
     * collapses to ~0 while `duration_ms` carries the true wall clock. Anchoring the
     * subtraction on the stored `completed_at` (not a fresh timestamp) keeps the equality
     * exact by construction. Best-effort: a failure is recorded as `action.backdate` and
     * never affects the recorded boundary.
     */
    private async backdateStart(actionId: string, boundary: ActionTraceBoundary): Promise<void> {
        const db = this.db;
        if (db === undefined || boundary.durationMs <= 0) return;
        await this.guard(
            'action.backdate',
            { runId: boundary.runId, node: boundary.node, kind: boundary.kind },
            async () => {
                // Raw action_runs SQL lives in the domain DAO (sole ts-db consumer, ADR); the
                // completed_at anchor keeps the reconstructed started_at exact by construction.
                const dao = new ActionRunDao(db);
                const completedAt = await dao.completedAtById(actionId);
                if (completedAt === null) return;
                const startedAt = new Date(new Date(completedAt).getTime() - boundary.durationMs).toISOString();
                await dao.setStartedAt(actionId, startedAt);
            },
        );
    }

    /**
     * Close the run row at its declared terminal state. `completedAt` defaults to now —
     * the inline driver reaches a terminal state in the same breath as the call.
     *
     * Unlike the action boundary, the run-row closure is not best-effort: a missing run
     * row raises {@link RunRowNotFoundError} (review finding #4 — a blind `UPDATE` cannot
     * distinguish zero matched rows) and a persistence failure propagates, so the
     * delegate never reports a false `{"ok":true}`.
     */
    async closeRun(runId: string, status: WorkflowStatus, completedAt?: string): Promise<{ ok: true }> {
        const existing = await this.inner.loadRun(runId);
        if (existing === undefined) {
            throw new RunRowNotFoundError(runId);
        }
        await this.inner.finalizeRun(runId, status, completedAt ?? new Date().toISOString());
        return { ok: true };
    }

    private async guard<T>(
        operation: ActionTraceOperation,
        context: { runId: string; node?: string; kind?: string },
        emit: () => Promise<T>,
    ): Promise<{ ok: true; value: T } | { ok: false; failure: ActionTraceFailure }> {
        try {
            return { ok: true, value: await emit() };
        } catch (error) {
            const failure: ActionTraceFailure = {
                operation,
                runId: context.runId,
                ...(context.node !== undefined ? { node: context.node } : {}),
                ...(context.kind !== undefined ? { kind: context.kind } : {}),
                error: error instanceof Error ? error.message : String(error),
                at: new Date().toISOString(),
            };
            try {
                this.recordFailure?.(failure);
            } catch {
                // A failing recorder must not turn best-effort emission into a throw.
            }
            return { ok: false, failure };
        }
    }

    // ── pass-through (non-action lifecycle / read paths) ──

    createRun(record: WorkflowRunRecord): Promise<void> {
        return this.inner.createRun(record);
    }
    savePhase(runId: string, phase: string, status: WorkflowStatus): Promise<void> {
        return this.inner.savePhase(runId, phase, status);
    }
    saveTransition(runId: string, from: string, to: string, trigger: string | null): Promise<void> {
        return this.inner.saveTransition(runId, from, to, trigger);
    }
    saveWorkflowState(runId: string, state: string, data: Record<string, unknown>): Promise<void> {
        return this.inner.saveWorkflowState(runId, state, data);
    }
    commitTransition(
        runId: string,
        from: string,
        to: string,
        trigger: string | null,
        state: string,
        data: Record<string, unknown>,
        phase?: { phase: string; status: WorkflowStatus },
    ): Promise<void> {
        return this.inner.commitTransition(runId, from, to, trigger, state, data, phase);
    }
    loadRun(runId: string): Promise<WorkflowRunRecord | undefined> {
        return this.inner.loadRun(runId);
    }
    listRuns(): Promise<readonly WorkflowRunRecord[]> {
        return this.inner.listRuns();
    }
    findRunByKey(workflowName: string, externalKey: string): Promise<WorkflowRunRecord | undefined> {
        return this.inner.findRunByKey(workflowName, externalKey);
    }
    createOrAttachRun(record: WorkflowRunRecord): Promise<WorkflowRunRecord> {
        return this.inner.createOrAttachRun(record);
    }
    reseedRun(runId: string, newState: string): Promise<ReseedResult> {
        return this.inner.reseedRun(runId, newState);
    }
    loadCurrentState(runId: string): Promise<string | undefined> {
        return this.inner.loadCurrentState(runId);
    }
    loadLatestStateSnapshot(runId: string): Promise<{ state: string; data: Record<string, unknown> } | undefined> {
        return this.inner.loadLatestStateSnapshot(runId);
    }
    listPausedRuns(options?: { workflowName?: string; limit?: number }): Promise<readonly WorkflowRunRecord[]> {
        return this.inner.listPausedRuns(options);
    }
}

/** Wrap a raw adapter so its action boundary and run closure become best-effort. */
export function withActionTrace(
    persistence: WorkflowPersistenceAdapter,
    recordFailure?: ActionTraceFailureRecorder,
): WorkflowActionTraceWriter {
    return new WorkflowActionTraceWriter(persistence, recordFailure);
}

/**
 * The shared construction both surfaces use: engine persistence for the project DB,
 * wrapped in the trace writer. Callers pass the SAME recorder they want for failures.
 */
export function createWorkflowActionTraceWriter(
    db: DbAdapter,
    recordFailure?: ActionTraceFailureRecorder,
): WorkflowActionTraceWriter {
    // The db reference enables the started_at back-date in recordAction; without it the
    // writer still traces, but intervals stay engine-stamped (start≈finish).
    return new WorkflowActionTraceWriter(new DbWorkflowPersistenceAdapter(db), recordFailure, db);
}

/**
 * Recorder that appends one line per emission failure to `.spur/run/<runId>.log` — the
 * run log the inline driver already owns (ADR-117: the text log stays, demoted to a
 * human convenience). Best-effort and fire-and-forget: the append never throws and never
 * blocks the run.
 */
export function createRunLogTraceFailureRecorder(cwd: string): ActionTraceFailureRecorder {
    const fileSystem = createNodeFileSystem();
    return (failure) => {
        const safeRunId = failure.runId.replace(/[^A-Za-z0-9._-]/g, '_');
        const dir = join(cwd, '.spur', 'run');
        const location = [
            failure.node !== undefined ? `node=${failure.node}` : '',
            failure.kind !== undefined ? `kind=${failure.kind}` : '',
        ]
            .filter((part) => part !== '')
            .join(' ');
        const line = `[${failure.at.replace(/\.\d{3}Z$/, 'Z')}] trace-emission-failed operation=${failure.operation} run=${failure.runId}${location === '' ? '' : ` ${location}`}: ${failure.error}\n`;
        void (async () => {
            await fileSystem.ensureDir(dir);
            await fileSystem.appendFile(join(dir, `${safeRunId}.log`), line);
        })().catch(() => undefined);
    };
}
