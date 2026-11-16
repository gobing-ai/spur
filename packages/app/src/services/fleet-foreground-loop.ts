import type { SystemEventRow } from '@gobing-ai/spur-domain';
import { normalizeProjectPath } from './project-registry';
import type { DispatchHoldReason, StrategyRuntime, TickReport } from './strategy-runtime';

/**
 * The foreground fleet loop (G76 task 1343, ADR-149): `/sp:dev-runall --mode parallel` is a thin
 * client of the same fenced tick the fleet serves, not a second implementation of lanes, landing
 * or evidence. It ticks until the frozen set is done, the fence moves, or the idle budget runs out.
 */

/** Holds that mean work is still in progress, so a dispatchless tick is not idleness. */
const WORKING_HOLDS: ReadonlySet<DispatchHoldReason> = new Set<DispatchHoldReason>([
    'dispatch-in-flight',
    'writer-cap',
    'file-overlap',
    'awaiting-integration',
    'integration-conflict',
    'member-busy',
    'rest-after-drain',
]);

/** One tick's outcome plus the loop's own bookkeeping. */
export interface ForegroundTick {
    tick: number;
    report: TickReport;
    /** Tasks seen dispatched so far — the report names them without re-reading the corpus. */
    dispatched: string[];
}

/** How the loop runs: its fence binding, its stop conditions and its tick cadence. */
export interface ForegroundLoopOptions {
    /** Aborting stops the loop at the next boundary; the run is never cancelled mid-tick. */
    signal?: AbortSignal;
    /**
     * Stop after this many consecutive ticks that dispatched nothing. A batch client ticks a
     * fixed set, so an idle streak means the set finished or is stuck — never a reason to spin.
     */
    maxIdleTicks?: number;
    /** The orchestrator binding the fence checks (`spur agent`/`serve` owns it otherwise). */
    ownerEpoch: number;
    orchestratorId: string;
    /** Verify the orchestrator claim still belongs to this host; false ends the loop. */
    healthy?: () => Promise<boolean>;
    /** Hard bound on ticks, so a project that never settles cannot hold the client forever. */
    maxTicks?: number;
    /** Pause between ticks; 0 in tests. */
    tickIntervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
}

/** Why the loop ended — one line, never a stack trace. */
export type ForegroundLoopEnd = 'fence-lost' | 'idle' | 'aborted' | 'bounded' | 'dispatched';

/** One yielded iteration: the tick plus the loop's end reason on the final entry. */
export type ForegroundIteration = ForegroundTick & { end?: ForegroundLoopEnd };

/**
 * Tick the fenced strategy in the foreground (design §"Client loop"). Yields one entry per tick;
 * ends when the idle budget is exhausted, an abort arrives, or the fence moves to another host.
 */
export async function* runForegroundTicks(
    projectPath: string,
    runtime: Pick<StrategyRuntime, 'tick' | 'observe'>,
    options: ForegroundLoopOptions,
): AsyncIterable<ForegroundTick & { end?: ForegroundLoopEnd }> {
    const normalized = normalizeProjectPath(projectPath);
    const maxIdle = options.maxIdleTicks ?? 3;
    const maxTicks = options.maxTicks ?? 1_000;
    const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    const dispatched: string[] = [];
    let idle = 0;
    for (let tick = 1; tick <= maxTicks; tick++) {
        if (options.signal?.aborted === true) {
            yield { tick, report: { dispatched: [], holds: [] }, dispatched, end: 'aborted' };
            return;
        }
        // The fence is checked BEFORE the tick, so a host that lost it never dispatches.
        if (options.healthy !== undefined && !(await options.healthy())) {
            yield { tick, report: { dispatched: [], holds: [] }, dispatched, end: 'fence-lost' };
            return;
        }
        const report = await runtime.tick(normalized, {
            ownerEpoch: options.ownerEpoch,
            orchestratorId: options.orchestratorId,
        });
        for (const decision of report.dispatched) if (decision.taskId !== undefined) dispatched.push(decision.taskId);
        // A receipt settles the previous dispatch; observing here keeps the loop self-contained.
        await runtime.observe(normalized, { ownerEpoch: options.ownerEpoch });
        // A dispatchless tick is only idle when nothing is still working: a busy member, a lane at
        // the cap or a pending landing all dispatch nothing yet keep the batch alive, and counting
        // them as idle would end a batch client while its pipelines still run.
        const working = report.holds.some((hold) => WORKING_HOLDS.has(hold.reason));
        idle = report.dispatched.length === 0 && !working ? idle + 1 : 0;
        // The hard bound wins over a still-working set: a client must never own the process forever.
        const end = idle >= maxIdle ? 'idle' : tick >= maxTicks ? 'bounded' : undefined;
        yield { tick, report, dispatched, ...(end !== undefined ? { end } : {}) };
        if (end !== undefined) return;
        if (options.tickIntervalMs !== undefined && options.tickIntervalMs > 0) await sleep(options.tickIntervalMs);
    }
}

/**
 * The fleet-less refusal (R3). Parallel mode needs an enabled fleet with at least one coder
 * member and `maxWriters`; without one it refuses and names the fix instead of falling back to a
 * serial run or inventing ephemeral members.
 */
export function parallelRefusal(
    fleet: {
        enabled?: boolean;
        maxWriters?: number;
        members?: Array<{ role?: string }>;
    } | null,
): string | null {
    if (fleet === null || fleet.enabled !== true) {
        return 'parallel mode needs an enabled fleet (agent.fleet.enabled, agent.fleet.members); declare one, or run --mode sequential';
    }
    if ((fleet.members ?? []).filter((member) => member.role === undefined || member.role === 'coder').length === 0) {
        return 'parallel mode needs at least one coder member in agent.fleet.members; declare one, or run --mode sequential';
    }
    if (fleet.maxWriters === undefined) {
        return 'parallel mode needs agent.fleet.maxWriters (1 = one lane, 2+ = concurrent lanes); set it, or run --mode sequential';
    }
    return null;
}

/** One rendered row of the fleet batch report, projected from the event ledger. */
export interface FleetReportRow {
    at: string;
    event: string;
    wbs: string;
    detail: string;
}

/**
 * Project `fleet.*` events into the batch report's rows (R2). The ledger is the evidence: a
 * landed slice, a retained lane and a conflict all read the same way, and a dispatch that produced
 * no event cannot appear as progress.
 */
export function fleetReportRows(events: SystemEventRow[]): FleetReportRow[] {
    const rows: FleetReportRow[] = [];
    for (const event of events) {
        const payload = JSON.parse(event.payload_json ?? '{}') as {
            wbs?: unknown;
            attempt?: unknown;
            reason?: unknown;
            baseAfter?: unknown;
            path?: unknown;
        };
        if (typeof payload.wbs !== 'string') continue;
        const attempt = typeof payload.attempt === 'number' ? payload.attempt : null;
        const detail =
            event.event_name === 'fleet.task.integrated'
                ? `landed${typeof payload.baseAfter === 'string' ? ` at ${payload.baseAfter.slice(0, 7)}` : ''}`
                : typeof payload.reason === 'string'
                  ? payload.reason
                  : typeof payload.path === 'string'
                    ? payload.path
                    : '';
        rows.push({
            at: event.occurred_at,
            event: event.event_name,
            wbs: typeof attempt === 'number' ? `${payload.wbs} #${attempt}` : payload.wbs,
            detail,
        });
    }
    return rows.sort((a, b) => a.at.localeCompare(b.at) || a.wbs.localeCompare(b.wbs));
}

/** The batch report's markdown body: one line per ledger row, no prose summary of its own. */
export function renderFleetBatchReport(rows: FleetReportRow[]): string {
    if (rows.length === 0) return 'No fleet events were recorded for this batch.\n';
    const lines = rows.map(
        (row) => `- ${row.at} ${row.event} ${row.wbs}${row.detail === '' ? '' : ` — ${row.detail}`}`,
    );
    return `${lines.join('\n')}\n`;
}
