/**
 * run-summary core — the measurement and rendering behind the `run-summary` CLI (task 1146).
 *
 * Split out of `plugins/sp/scripts/run-summary.ts` when the actor split and the batch roll-up pushed
 * that script past the ADR-130 glue budget: the script keeps argv parsing and dispatch, this module
 * keeps the logic. `plugins/sp/lib/transcript.ts` is the same shape of shared plugin-side module.
 * Node builtins plus relative imports only; `import type` for the app projection it is handed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowProgressProjection } from '@gobing-ai/spur-app';
import {
    accumulate,
    type Block,
    formatDuration,
    formatTokenSplit,
    isCompaction,
    newAcc,
    parseRows,
    promptText,
    resolveTranscript,
    type Row,
    type Span,
    sumSpans,
    sumTokens,
    type Tokens,
    zeroTokens,
} from './transcript';
import { getEnvVars } from './env';

interface ProgressAttempt {
    startedAt?: string;
    completedAt?: string;
}

/**
 * The subset of the progress projection the summary windows over. The close path hands over the
 * full `WorkflowProgressProjection`; the extra fields are ignored here, so the reader stays a
 * narrow structural view of it rather than a second copy of the contract.
 */
export interface Progress {
    runId: string;
    workflow?: string;
    status?: string;
    states?: { state: string; visit?: number; status?: string; actions?: { attempts?: ProgressAttempt[] }[] }[];
}

/** A stage row; `toolCalls`/`tokens` are null when the window holds no host transcript record. */
export interface SummaryRow {
    stage: string;
    status: string;
    workMs: number;
    waitMs: number;
    toolCalls: number | null;
    tokens: Tokens | null;
    time: string;
    wait: string;
    token: string;
}

/** 1146 R4: how the total window is spent, by actor. Rows sum exactly to the window. */
export interface ActorSplit {
    operatorMs: number;
    /** The longest single operator wait, so a total is not read as one stall. */
    longestOperatorWaitMs: number;
    modelMs: number;
    shellMs: number;
    subagentMs: number;
    otherToolMs: number;
    idleMs: number;
    compactions: number;
    subagentErrors: number;
}

/** A gate-receipt measurement, or the reason there is none (1146 R4: never a fabricated 0). */
export type GateTime = { ms: number } | { ms: null; reason: string };

export interface RunSummary {
    available: true;
    transcript?: string;
    rows: SummaryRow[];
    total: SummaryRow;
    actors: ActorSplit;
    gate: GateTime;
    skippedLines: number;
}

/** A gap at or above this is idle, not work (1146 R4, closed decision: fixed, no flag). */
const IDLE_GAP_MS = 300_000;
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'run_command', 'command']);
const SUBAGENT_TOOLS = new Set(['agent', 'task', 'invoke_subagent', 'subagent', 'dispatch_agent']);
const OPERATOR_TOOLS = new Set(['askuserquestion', 'ask_user_question']);

type Actor = 'operator' | 'subagent' | 'shell' | 'other';
/** Overlap is counted once, and subagent outranks shell outranks other tools (1146 AC4). */
const ACTOR_PRECEDENCE: Actor[] = ['operator', 'subagent', 'shell', 'other'];

function actorOf(tool: string): Actor {
    const t = tool.toLowerCase().replace(/[^a-z_]/g, '');
    if (OPERATOR_TOOLS.has(t)) return 'operator';
    if (SUBAGENT_TOOLS.has(t)) return 'subagent';
    if (SHELL_TOOLS.has(t)) return 'shell';
    return 'other';
}

interface Call {
    id: string;
    actor: Actor;
    ts: number;
}

/** One resolved tool span: [start, end] attributed to one actor. */
interface Resolved extends Call {
    end: number;
}

/** Union length of a set of intervals, clipped to [start, end]. */
function unionMs(spans: Array<[number, number]>, start: number, end: number): number {
    const clipped = spans
        .map(([a, b]) => [Math.max(a, start), Math.min(b, end)] as [number, number])
        .filter(([a, b]) => b > a)
        .sort((x, y) => x[0] - y[0]);
    let total = 0;
    let cursor = Number.NaN;
    let openUntil = Number.NaN;
    for (const [a, b] of clipped) {
        if (!Number.isFinite(cursor)) {
            cursor = a;
            openUntil = b;
            continue;
        }
        if (a > openUntil) {
            total += openUntil - cursor;
            cursor = a;
            openUntil = b;
        } else {
            openUntil = Math.max(openUntil, b);
        }
    }
    if (Number.isFinite(cursor)) total += openUntil - cursor;
    return total;
}

/** Subtract already-claimed intervals from a candidate set, returning the still-free part. */
function subtract(spans: Array<[number, number]>, claimed: Array<[number, number]>): Array<[number, number]> {
    let free = spans;
    for (const [ca, cb] of claimed) {
        const next: Array<[number, number]> = [];
        for (const [a, b] of free) {
            if (cb <= a || ca >= b) {
                next.push([a, b]);
                continue;
            }
            if (ca > a) next.push([a, ca]);
            if (cb < b) next.push([cb, b]);
        }
        free = next;
    }
    return free;
}

/**
 * 1146 R4: partition the window [start, end] by actor. Tool calls are paired with their results
 * (either host shape); overlaps resolve by `ACTOR_PRECEDENCE`, counted once; unclaimed gaps at or
 * above IDLE_GAP_MS are idle; the remainder is model time, so the rows always sum to the window.
 */
export function actorSplit(rows: [Row, number][], start: number, end: number): ActorSplit {
    const empty: ActorSplit = {
        operatorMs: 0,
        longestOperatorWaitMs: 0,
        modelMs: 0,
        shellMs: 0,
        subagentMs: 0,
        otherToolMs: 0,
        idleMs: 0,
        compactions: 0,
        subagentErrors: 0,
    };
    const window = end - start;
    if (window <= 0) return empty;

    const calls = new Map<string, Call>();
    const results = new Map<string, { ts: number; isError: boolean }>();
    const eventTs: number[] = [];
    let compactions = 0;

    for (const [row, ts] of rows) {
        if (ts < start || ts > end) continue;
        eventTs.push(ts);
        if (isCompaction(row)) compactions++;
        const blocks = Array.isArray(row.message?.content) ? (row.message?.content as Block[]) : [];
        if (row.message?.role === 'toolResult' && row.message.toolCallId !== undefined) {
            results.set(row.message.toolCallId, { ts, isError: row.message.isError === true });
        }
        for (const b of blocks) {
            if ((b.type === 'tool_use' || b.type === 'toolCall') && b.id !== undefined && b.name !== undefined) {
                calls.set(b.id, { id: b.id, actor: actorOf(b.name), ts });
            } else if (b.type === 'tool_result' && b.tool_use_id !== undefined) {
                results.set(b.tool_use_id, { ts, isError: b.is_error === true });
            }
        }
    }

    let subagentErrors = 0;
    const resolved: Resolved[] = [];
    for (const call of calls.values()) {
        const result = results.get(call.id);
        if (result?.isError === true && call.actor === 'subagent') subagentErrors++;
        resolved.push({ ...call, end: Math.min(result?.ts ?? end, end) });
    }

    const claimed: Array<[number, number]> = [];
    const byActor = new Map<Actor, number>();
    for (const actor of ACTOR_PRECEDENCE) {
        const mine = resolved.filter((r) => r.actor === actor).map((r) => [r.ts, r.end] as [number, number]);
        const free = subtract(mine, claimed);
        for (const span of free) claimed.push(span);
        const ms = unionMs(free, start, end);
        byActor.set(actor, ms);
        if (actor === 'operator') {
            empty.longestOperatorWaitMs = Math.max(0, ...mine.map(([a, b]) => b - a));
        }
    }

    // Idle: unclaimed gaps between consecutive event boundaries, at or above the threshold.
    const boundaries = [...new Set([start, end, ...eventTs, ...claimed.flat()])].sort((a, b) => a - b);
    const claimedSorted = [...claimed].sort((a, b) => a[0] - b[0]);
    let idleMs = 0;
    for (let i = 0; i < boundaries.length - 1; i++) {
        const a = boundaries[i] as number;
        const b = boundaries[i + 1] as number;
        if (b - a < IDLE_GAP_MS) continue;
        if (claimedSorted.some(([ca, cb]) => ca < b && cb > a)) continue;
        idleMs += b - a;
    }

    const accounted =
        (byActor.get('operator') ?? 0) +
        (byActor.get('subagent') ?? 0) +
        (byActor.get('shell') ?? 0) +
        (byActor.get('other') ?? 0) +
        idleMs;
    return {
        ...empty,
        operatorMs: byActor.get('operator') ?? 0,
        subagentMs: byActor.get('subagent') ?? 0,
        shellMs: byActor.get('shell') ?? 0,
        otherToolMs: byActor.get('other') ?? 0,
        idleMs,
        modelMs: Math.max(0, window - accounted),
        compactions,
        subagentErrors,
    };
}

interface Window {
    stage: string;
    status: string;
    start: number;
    end: number;
}

function attemptWindow(attempts: ProgressAttempt[]): [number, number] | undefined {
    const starts = attempts.map((a) => Date.parse(a.startedAt ?? '')).filter((n) => !Number.isNaN(n));
    const ends = attempts.map((a) => Date.parse(a.completedAt ?? '')).filter((n) => !Number.isNaN(n));
    return starts.length && ends.length ? [Math.min(...starts), Math.max(...ends)] : undefined;
}

function summaryRow(stage: string, status: string, span: Span, measured: boolean): SummaryRow {
    return {
        stage,
        status,
        workMs: span.workMs,
        waitMs: span.waitMs,
        toolCalls: measured ? span.toolCalls : null,
        tokens: measured ? span.tokens : null,
        time: formatDuration(span.workMs),
        wait: formatDuration(span.waitMs),
        token: formatTokenSplit(measured ? span.tokens : null),
    };
}

/**
 * dev-run / dev-runall execution summary. One progress file → one row per state visit; several →
 * one row per run. Each window spans its first attempt start → last completion (inclusive) and
 * slices the host transcript; work = window − AskUserQuestion answer time.
 */
export function buildRunSummary(
    lines: string[],
    inputs: { label?: string; progress: Progress }[],
    since?: string,
    until?: string,
): RunSummary {
    const windows: Window[] = [];
    for (const { label, progress } of inputs) {
        const states = (progress.states ?? []).flatMap((s) => {
            const w = attemptWindow((s.actions ?? []).flatMap((a) => a.attempts ?? []));
            return w ? [{ s, w }] : [];
        });
        if (!states.length) throw new Error(`progress for run ${progress.runId} has no timed attempts`);
        if (inputs.length === 1) {
            for (const { s, w } of states) {
                const stage = (s.visit ?? 1) > 1 ? `${s.state} (visit ${s.visit})` : s.state;
                windows.push({ stage, status: s.status ?? '', start: w[0], end: w[1] });
            }
        } else {
            const stage = label ?? `${progress.workflow ?? 'run'} ${progress.runId.slice(0, 8)}`;
            const start = Math.min(...states.map(({ w }) => w[0]));
            windows.push({
                stage,
                status: progress.status ?? '',
                start,
                end: Math.max(...states.map(({ w }) => w[1])),
            });
        }
    }
    windows.sort((a, b) => a.start - b.start);

    const { rows, skippedLines } = parseRows(lines);
    const measure = (start: number, end: number): { span: Span; measured: boolean } => {
        const acc = newAcc(start);
        for (const [row, ts] of rows)
            if (ts >= start && ts <= end && promptText(row) === undefined) accumulate(acc, row, ts);
        const span = {
            workMs: end - start - acc.askMs,
            waitMs: acc.askMs,
            toolCalls: acc.toolIds.size,
            tokens: sumTokens([...acc.messages.values()]),
        };
        return { span, measured: acc.toolIds.size > 0 || acc.messages.size > 0 };
    };

    const sinceMs = since ? Date.parse(since) : Number.NaN;
    const totalStart = Number.isNaN(sinceMs) ? Math.min(...windows.map((w) => w.start)) : sinceMs;
    let totalEnd = Math.max(...windows.map((w) => w.end));
    // With --since the total runs to the latest host activity, so setup/close work lands in overhead.
    if (!Number.isNaN(sinceMs)) for (const [, ts] of rows) if (ts >= sinceMs) totalEnd = Math.max(totalEnd, ts);
    // 1146 R1: the close passes its own completion instant, which caps the window exactly.
    const untilMs = until ? Date.parse(until) : Number.NaN;
    if (!Number.isNaN(untilMs) && untilMs > totalStart) totalEnd = untilMs;

    const stageRows = windows.map((w) => {
        const { span, measured } = measure(w.start, w.end);
        return summaryRow(w.stage, w.status, span, measured);
    });
    const totalMeasure = measure(totalStart, totalEnd);
    const statuses = [...new Set(inputs.map((i) => i.progress.status ?? ''))].join('/');
    const total = summaryRow('Total', statuses, totalMeasure.span, totalMeasure.measured);

    // Parallel runs overlap, so their rows cannot partition the total: no overhead row then.
    const overlaps = windows.some((w, i) => i > 0 && w.start < (windows[i - 1]?.end ?? 0));
    const sum = sumSpans(
        stageRows.map((r) => ({ ...r, toolCalls: r.toolCalls ?? 0, tokens: r.tokens ?? zeroTokens() })),
    );
    const overhead: Span = {
        workMs: total.workMs - sum.workMs,
        waitMs: total.waitMs - sum.waitMs,
        toolCalls: (total.toolCalls ?? 0) - sum.toolCalls,
        tokens: Object.fromEntries(
            (Object.keys(sum.tokens) as (keyof Tokens)[]).map((k) => [k, (total.tokens?.[k] ?? 0) - sum.tokens[k]]),
        ) as Tokens,
    };
    if (!overlaps && overhead.workMs > 0)
        stageRows.push(summaryRow('driver overhead', '', overhead, totalMeasure.measured));

    return {
        available: true,
        rows: stageRows,
        total,
        actors: actorSplit(rows, totalStart, totalEnd),
        gate: { ms: null, reason: 'no matching check receipt' },
        skippedLines,
    };
}

export function renderSummaryMarkdown(summary: RunSummary): string {
    const line = (r: SummaryRow, bold = false) => {
        const stage = bold ? `**${r.stage}**` : r.stage;
        return `| ${stage} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? 'n/a'} | ${r.token} |`;
    };
    const a = summary.actors;
    const window = summary.total.workMs + summary.total.waitMs;
    const share = (ms: number): string => (window > 0 ? `${Math.round((ms / window) * 100)}%` : 'n/a');
    const gate = summary.gate.ms === null ? `n/a (${summary.gate.reason})` : formatDuration(summary.gate.ms);
    return [
        '| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        ...summary.rows.map((r) => line(r)),
        line(summary.total, true),
        '',
        '| Actor | Time | Share |',
        '| --- | ---: | ---: |',
        `| operator wait (longest ${formatDuration(a.longestOperatorWaitMs)}) | ${formatDuration(a.operatorMs)} | ${share(a.operatorMs)} |`,
        `| model | ${formatDuration(a.modelMs)} | ${share(a.modelMs)} |`,
        `| shell | ${formatDuration(a.shellMs)} | ${share(a.shellMs)} |`,
        `|   of which gate (informational) | ${gate} | — |`,
        `| subagent | ${formatDuration(a.subagentMs)} | ${share(a.subagentMs)} |`,
        `| other tools | ${formatDuration(a.otherToolMs)} | ${share(a.otherToolMs)} |`,
        `| idle / unattributed | ${formatDuration(a.idleMs)} | ${share(a.idleMs)} |`,
        '',
        `Compactions: ${a.compactions} · Subagent errors: ${a.subagentErrors}`,
    ].join('\n');
}

/** One `--rollup` input: a close-written `<runId>-summary.json` plus its label. */
export interface RollupInput {
    label: string;
    summary: {
        runId?: string;
        startedAt?: string;
        completedAt?: string;
        total: SummaryRow;
        actors: ActorSplit;
    };
}

/** Batch roll-up (1146 R3/AC5): one row per run's OWN window, then the sum, then the wall span. */
export function renderRollupMarkdown(rows: RollupInput[]): string {
    const line = (label: string, r: SummaryRow, actors: ActorSplit, bold = false): string => {
        const name = bold ? `**${label}**` : label;
        return `| ${name} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? 'n/a'} | ${r.token} | ${formatDuration(actors.operatorMs)} | ${formatDuration(actors.subagentMs)} |`;
    };
    const total = rows.reduce(
        (acc, { summary }) => ({
            workMs: acc.workMs + summary.total.workMs,
            waitMs: acc.waitMs + summary.total.waitMs,
            toolCalls: (acc.toolCalls ?? 0) + (summary.total.toolCalls ?? 0),
            tokens: sumTokens([acc.tokens, summary.total.tokens ?? zeroTokens()]),
        }),
        { workMs: 0, waitMs: 0, toolCalls: 0 as number | null, tokens: zeroTokens() },
    );
    const totalRow: SummaryRow = {
        stage: 'Batch total',
        status: '',
        workMs: total.workMs,
        waitMs: total.waitMs,
        toolCalls: total.toolCalls,
        tokens: total.tokens,
        time: formatDuration(total.workMs),
        wait: formatDuration(total.waitMs),
        token: formatTokenSplit(total.tokens),
    };
    const totalActors: ActorSplit = {
        operatorMs: 0,
        longestOperatorWaitMs: 0,
        modelMs: 0,
        shellMs: 0,
        subagentMs: 0,
        otherToolMs: 0,
        idleMs: 0,
        compactions: 0,
        subagentErrors: 0,
    };
    for (const { summary } of rows) {
        totalActors.operatorMs += summary.actors.operatorMs;
        totalActors.subagentMs += summary.actors.subagentMs;
        totalActors.compactions += summary.actors.compactions;
        totalActors.subagentErrors += summary.actors.subagentErrors;
    }
    const out = [
        '| Run | Status | Time | Wait | Tool calls | Token (total / non-cached) | Operator wait | Subagent |',
        '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
        ...rows.map(({ label, summary }) => line(label, summary.total, summary.actors)),
        line('Batch total', totalRow, totalActors, true),
    ];
    const starts = rows.map((r) => Date.parse(r.summary.startedAt ?? '')).filter((n) => !Number.isNaN(n));
    const ends = rows.map((r) => Date.parse(r.summary.completedAt ?? '')).filter((n) => !Number.isNaN(n));
    const overlaps =
        starts.length === rows.length &&
        rows.some((r, i) =>
            rows.some(
                (o, j) =>
                    i !== j &&
                    Date.parse(r.summary.startedAt ?? '') < Date.parse(o.summary.completedAt ?? '') &&
                    Date.parse(o.summary.startedAt ?? '') < Date.parse(r.summary.completedAt ?? ''),
            ),
        );
    if (overlaps && starts.length > 0 && ends.length > 0) {
        out.push(
            '',
            `Wall span: ${new Date(Math.min(...starts)).toISOString()} → ${new Date(Math.max(...ends)).toISOString()}`,
        );
    }
    return out.join('\n');
}

/** 1146 R1: the close-step summarizer's input — a structural copy of the app's interface. */
export interface CloseSummaryRun {
    readonly runId: string;
    readonly startedAt: string | undefined;
    readonly completedAt: string;
    /** The app's full projection; the summary reads only the subset above. */
    readonly progress: WorkflowProgressProjection;
}

/**
 * 1146 R1: write `.spur/run/<runId>-summary.{md,json}` and return the `.md` path (relative to cwd).
 * Never throws: any failure (unresolved transcript, no timed attempts, anything else) leaves the
 * `.md` holding exactly `Execution summary: n/a (<reason>)` and returns its path, so the close's
 * exit code and JSON verdict are untouched.
 */
export function writeCloseSummary(
    run: CloseSummaryRun,
    opts: { env?: Record<string, string | undefined>; projectsRoot?: string; cwd?: string } = {},
): string {
    const cwd = opts.cwd ?? process.cwd();
    const runDir = join(cwd, '.spur', 'run');
    const rel = join('.spur', 'run', `${run.runId}-summary.md`);
    const abs = join(cwd, rel);
    const na = (reason: string): string => {
        mkdirSync(runDir, { recursive: true });
        writeFileSync(abs, `Execution summary: n/a (${reason})\n`);
        return rel;
    };
    try {
        if (run.startedAt === undefined) return na('run row has no started_at');
        const resolved = resolveTranscript(opts.env ?? getEnvVars(), opts.projectsRoot);
        if (!resolved.ok) return na(resolved.reason);
        const lines = readFileSync(resolved.path, 'utf8').split('\n');
        const summary = buildRunSummary(
            lines,
            [{ progress: run.progress as unknown as Progress }],
            run.startedAt,
            run.completedAt,
        );
        if (summary.rows.length === 0) return na('no timed attempts');
        mkdirSync(runDir, { recursive: true });
        writeFileSync(abs, `${renderSummaryMarkdown(summary)}\n`);
        writeFileSync(
            join(runDir, `${run.runId}-summary.json`),
            JSON.stringify(
                { ...summary, runId: run.runId, startedAt: run.startedAt, completedAt: run.completedAt },
                null,
                2,
            ),
        );
        return rel;
    } catch (error) {
        return na(error instanceof Error ? error.message : String(error));
    }
}

/**
 * 1146 R4: gate time comes only from THIS run's check receipt (`receipt.runId === runId`); a
 * receipt belonging to another run is a cross-run scratch read (ADR-131) and renders n/a.
 */
export function gateFromReceipt(cwd: string, runId: string): GateTime {
    const path = join(cwd, '.spur', 'run', `${runId}-check-receipt.json`);
    if (!existsSync(path)) return { ms: null, reason: 'no matching check receipt' };
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8')) as { runId?: unknown; gateRuntimeMs?: unknown };
        if (parsed.runId !== runId) return { ms: null, reason: 'check receipt belongs to another run' };
        const ms = parsed.gateRuntimeMs;
        if (typeof ms !== 'number' || !Number.isFinite(ms))
            return { ms: null, reason: 'check receipt has no gate time' };
        return { ms };
    } catch {
        return { ms: null, reason: 'check receipt is unreadable' };
    }
}

