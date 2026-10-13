/**
 * Run-summary measurement owner (task 1178 R2) — the pure actor/window/token aggregation
 * previously inlined in `plugins/sp/lib/run-summary-core.ts`.
 *
 * This module is import-free and side-effect free: it never reads the host transcript or a
 * filesystem path. The plugin's `transcript.ts` adapter resolves/normalizes a host transcript once
 * (`parseRows`) and hands the normalized `[Row, timestamp]` pairs here; the plugin's
 * `run-summary-core.ts` keeps the close-summary callback, receipt read and Markdown rendering. The
 * moved module rides the generated pure plan-projection bundle entry so the plugin reaches it
 * without a second bundle or registry.
 */

// ── Normalized transcript shapes ─────────────────────────────────────────────

export type Tokens = Record<'input' | 'cacheCreate' | 'cacheRead' | 'output', number>;

/** Measured time, tool calls and tokens for one segment or window. */
export interface Span {
    workMs: number;
    waitMs: number;
    toolCalls: number;
    tokens: Tokens;
}

/** One content block of a host message (a text block, or a tool_use/tool_result pair). */
export interface Block {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
    tool_use_id?: string;
    /** Claude tool_result error flag (1146 R4): a failed subagent call is counted. */
    is_error?: boolean;
}

/** One normalized host transcript row (Claude Code or pi JSONL), host-agnostic fields only. */
export interface Row {
    type?: string;
    /** Claude `system` rows carry the compaction subtype (1146 R4). */
    subtype?: string;
    timestamp?: string;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    id?: string; // pi: the row id doubles as the once-per-message usage key
    /** pi `custom_message` body: a hook-relayed prompt's text. */
    content?: string;
    /** pi `custom_message` visibility; `false` keeps the row out of the operator-visible transcript. */
    display?: boolean;
    /** pi `custom_message` producer id (e.g. a hook), carried for diagnostics only. */
    customType?: string;
    message?: {
        id?: string;
        role?: string;
        content?: unknown;
        usage?: Record<string, number | undefined>;
        toolCallId?: string;
        /** pi toolResult rows name their tool here (1146 R4). */
        toolName?: string;
        /** pi toolResult error flag (1146 R4). */
        isError?: boolean;
    };
}

/** Running measurement of one segment or window. */
export interface Acc {
    last: number;
    askMs: number;
    asks: Map<string, number>;
    toolIds: Set<string>;
    messages: Map<string, Tokens>;
    compactions: number;
}

/** A zeroed token counter, the start of every token fold. */
export const zeroTokens = (): Tokens => ({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 });

/** `M:SS` below one hour, `H:MM:SS` at one hour or above. */
export function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Compact token units: `950`, `41k`, `28.4M`. */
export function formatTokens(n: number): string {
    if (n >= 999_500) return `${(n / 1e6).toFixed(1)}M`;
    return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/**
 * `<total> / <non-cached>`: total = every input class + output; non-cached drops cache reads, the
 * share re-served from the prompt cache, leaving the fresh input, cache writes and output.
 */
export function formatTokenSplit(t: Tokens | null): string {
    if (!t) return 'n/a';
    const nonCached = t.input + t.cacheCreate + t.output;
    return `${formatTokens(nonCached + t.cacheRead)} / ${formatTokens(nonCached)}`;
}

/** Host tools whose call→result gap is the operator answering, not the agent working. */
const OPERATOR_TOOLS = new Set(['AskUserQuestion', 'ask_user_question']);

/**
 * 1146 R4: a compaction boundary in either host shape — pi writes a `compaction` row, Claude a
 * `system` row with `subtype:"compact_boundary"`.
 */
export function isCompaction(row: Row): boolean {
    return row.type === 'compaction' || (row.type === 'system' && row.subtype === 'compact_boundary');
}

/** First `type:text` block of a pi message, or its string content. */
function firstTextContent(row: Row): string | undefined {
    const content = row.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return undefined;
    return (content as Block[]).find((b) => b.type === 'text')?.text;
}

/**
 * 1151 R1: `/X <args>` for a pi operator `/skill` invocation wrapper, undefined for anything else.
 *
 * The wrapper is `^\s*<skill name="X"` — the anchored, complete quoted name is the only signal;
 * text that merely CONTAINS `<skill` later in the body stays plain operator text. Arguments are the
 * text after the LAST `</skill>` (a body may itself quote the tag); a wrapper with no closing tag
 * renders `/X` alone rather than dumping the body as the prompt. A malformed name (no closing quote)
 * is not a wrapper.
 */
export function skillInvocationPrompt(text: string): string | undefined {
    const name = /^\s*<skill name="([^"]+)"/.exec(text)?.[1];
    if (name === undefined) return undefined;
    const close = text.lastIndexOf('</skill>');
    const args = close < 0 ? '' : text.slice(close + '</skill>'.length).trim();
    return args === '' ? `/${name}` : `/${name} ${args}`;
}

/**
 * Operator prompt text, or undefined for tool results, meta rows and compaction summaries.
 *
 * pi (1151 R1/R3): pi records the OPERATOR'S own `/skill` invocation as a user message that opens
 * with `<skill name="X" …>` and whose arguments follow the closing tag — it does not inject skill
 * bodies as user rows (a 2,452-row census of local transcripts found none; the one synthetic
 * body-only fixture row had no real counterpart). Every such row is therefore an operator prompt,
 * rendered `/X <args>`; an ARGUMENT-LESS wrapper is still an invocation and renders `/X` (the skill
 * name is the stage label the review groups by, so arguments alone would lose which command ran).
 *
 * pi (1151 follow-up): a hook-relayed `custom_message` (`display: true`) is a real operator prompt —
 * the host shows it and the agent answers it — so it opens a segment like typed text; a
 * `display: false` row is a host-only notice and stays non-segmenting activity.
 */
export function promptText(row: Row): string | undefined {
    if (row.type === 'custom_message') {
        if (row.display === false) return undefined;
        const text = typeof row.content === 'string' ? row.content.trim() : '';
        return text === '' ? undefined : text;
    }
    if (row.type === 'message') {
        // pi (1130): only a user-role message with text content is a prompt; toolResult rows are not.
        if (row.message?.role !== 'user') return undefined;
        const text = firstTextContent(row);
        if (text === undefined) return undefined;
        return skillInvocationPrompt(text) ?? text;
    }
    if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return undefined;
    const content = row.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content) || (content as Block[]).some((b) => b.type === 'tool_result')) return undefined;
    return (content as Block[]).find((b) => b.type === 'text')?.text;
}

/** Element-wise token sum across folds (the accumulator's one token total). */
export function sumTokens(all: Tokens[]): Tokens {
    const total = zeroTokens();
    for (const t of all) for (const k of Object.keys(total) as (keyof Tokens)[]) total[k] += t[k];
    return total;
}

/** Element-wise span sum: work ms, wait ms, tool calls and tokens. */
export function sumSpans(spans: Span[]): Span {
    return {
        workMs: spans.reduce((n, s) => n + s.workMs, 0),
        waitMs: spans.reduce((n, s) => n + s.waitMs, 0),
        toolCalls: spans.reduce((n, s) => n + s.toolCalls, 0),
        tokens: sumTokens(spans.map((s) => s.tokens)),
    };
}

/** A fresh segment/window accumulator anchored at epoch-ms `ts`. */
export const newAcc = (ts: number): Acc => ({
    last: ts,
    askMs: 0,
    asks: new Map(),
    toolIds: new Set(),
    messages: new Map(),
    compactions: 0,
});

/** Fold one timestamped non-prompt record into a segment or window. */
export function accumulate(acc: Acc, row: Row, ts: number): void {
    acc.last = Math.max(acc.last, ts);
    if (row.type === 'message') {
        // pi (1130): mirrors the importer's field semantics (piRole / normalizeOmpToolCall /
        // ompToolResultTiming) — toolCall blocks on assistant rows, results paired by toolCallId.
        const m = row.message;
        if (m?.role === 'assistant') {
            const blocks = Array.isArray(m.content) ? (m.content as Block[]) : [];
            for (const b of blocks) {
                if (b.type === 'toolCall' && b.id) {
                    acc.toolIds.add(b.id);
                    if (b.name && OPERATOR_TOOLS.has(b.name)) acc.asks.set(b.id, ts);
                }
            }
            const u = m.usage;
            if (u && row.id)
                acc.messages.set(row.id, {
                    input: u.input ?? 0,
                    cacheCreate: u.cacheWrite ?? 0,
                    cacheRead: u.cacheRead ?? 0,
                    output: u.output ?? 0,
                });
        } else if (m?.role === 'toolResult' && m.toolCallId && acc.asks.has(m.toolCallId)) {
            acc.askMs += ts - (acc.asks.get(m.toolCallId) ?? ts);
        }
        return;
    }
    if (row.type === 'compaction') acc.compactions++; // pi-only row type (1130 R4)
    const blocks = Array.isArray(row.message?.content) ? (row.message.content as Block[]) : [];
    for (const b of blocks) {
        if (b.type === 'tool_use' && b.id) {
            acc.toolIds.add(b.id);
            if (b.name && OPERATOR_TOOLS.has(b.name)) acc.asks.set(b.id, ts);
        } else if (b.type === 'tool_result' && b.tool_use_id && acc.asks.has(b.tool_use_id)) {
            acc.askMs += ts - (acc.asks.get(b.tool_use_id) ?? ts);
        }
    }
    const u = row.message?.usage;
    // Split records of one response repeat its usage: keyed by message id, overwrite, never add.
    if (row.type === 'assistant' && u && row.message?.id) {
        acc.messages.set(row.message.id, {
            input: u.input_tokens ?? 0,
            cacheCreate: u.cache_creation_input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
        });
    }
}

// ── Structural shapes (workflow progress projection + run summary) ───────────

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

/** The measured summary: rows, their total, the actor split and the gate receipt reading. */
export interface RunSummary {
    available: true;
    transcript?: string;
    rows: SummaryRow[];
    total: SummaryRow;
    actors: ActorSplit;
    gate: GateTime;
    skippedLines: number;
}

// ── Actor split ──────────────────────────────────────────────────────────────

/** A gap at or above this is idle, not work (1146 R4, closed decision: fixed, no flag). */
const IDLE_GAP_MS = 300_000;
const SHELL_TOOLS = new Set(['bash', 'shell', 'exec', 'exec_command', 'run_command', 'command']);
const SUBAGENT_TOOLS = new Set(['agent', 'task', 'invoke_subagent', 'subagent', 'dispatch_agent']);
/** `actorOf` lower-cases the tool name first, so its operator set is lower-case too (1146 R4). */
const LOWERCASE_OPERATOR_TOOLS = new Set(['askuserquestion', 'ask_user_question']);

type Actor = 'operator' | 'subagent' | 'shell' | 'other';
/** Overlap is counted once, and subagent outranks shell outranks other tools (1146 AC4). */
const ACTOR_PRECEDENCE: Actor[] = ['operator', 'subagent', 'shell', 'other'];

function actorOf(tool: string): Actor {
    const t = tool.toLowerCase().replace(/[^a-z_]/g, '');
    if (LOWERCASE_OPERATOR_TOOLS.has(t)) return 'operator';
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

// ── Run summary ──────────────────────────────────────────────────────────────

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
 *
 * The host transcript is normalized ONCE by the plugin adapter (`parseRows`); this owner receives
 * the timestamped rows and never re-parses lines. `opts.skippedLines` carries the adapter's
 * malformed-line count through to {@link RunSummary.skippedLines}.
 */
export function buildRunSummary(
    rows: [Row, number][],
    inputs: { label?: string; progress: Progress }[],
    opts: { since?: string; until?: string; skippedLines?: number } = {},
): RunSummary {
    const { since, until } = opts;
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
        skippedLines: opts.skippedLines ?? 0,
    };
}
