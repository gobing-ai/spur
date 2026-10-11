/**
 * Host-transcript measurement primitives shared by session-timeline (session review) and
 * run-summary (dev-run / dev-runall execution summary). Reads Claude Code JSONL rows read-only;
 * tokens are counted once per message id (a response spans several records). Node builtins only.
 */
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Tokens = Record<'input' | 'cacheCreate' | 'cacheRead' | 'output', number>;

export interface Span {
    workMs: number;
    waitMs: number;
    toolCalls: number;
    tokens: Tokens;
}

export interface Block {
    type?: string;
    id?: string;
    name?: string;
    text?: string;
    tool_use_id?: string;
    /** Claude tool_result error flag (1146 R4): a failed subagent call is counted. */
    is_error?: boolean;
}

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

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
/** Host tools whose call→result gap is the operator answering, not the agent working. */
const OPERATOR_TOOLS = new Set(['AskUserQuestion', 'ask_user_question']);
const PI_ROLES = new Set(['user', 'assistant', 'toolResult']);

export const zeroTokens = (): Tokens => ({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 });

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

export function sumTokens(all: Tokens[]): Tokens {
    const total = zeroTokens();
    for (const t of all) for (const k of Object.keys(total) as (keyof Tokens)[]) total[k] += t[k];
    return total;
}

export function sumSpans(spans: Span[]): Span {
    return {
        workMs: spans.reduce((n, s) => n + s.workMs, 0),
        waitMs: spans.reduce((n, s) => n + s.waitMs, 0),
        toolCalls: spans.reduce((n, s) => n + s.toolCalls, 0),
        tokens: sumTokens(spans.map((s) => s.tokens)),
    };
}

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

/**
 * 1146 R4: a compaction boundary in either host shape — pi writes a `compaction` row, Claude a
 * `system` row with `subtype:"compact_boundary"`.
 */
export function isCompaction(row: Row): boolean {
    return row.type === 'compaction' || (row.type === 'system' && row.subtype === 'compact_boundary');
}

/** First row matching a known shape decides: `type:"message"` with a pi role → pi, else Claude. */
export function sniffFormat(rows: Row[]): 'claude' | 'pi' | 'unknown' {
    for (const row of rows) {
        if (row.type === 'message' && PI_ROLES.has(row.message?.role ?? '')) return 'pi';
        if (row.type === 'user' || row.type === 'assistant') return 'claude';
    }
    return 'unknown';
}

/** Timestamped rows in file order; malformed lines counted, timestamp-less rows dropped. */
export function parseRows(lines: string[]): {
    rows: [Row, number][];
    skippedLines: number;
    format: 'claude' | 'pi' | 'unknown';
} {
    const rows: [Row, number][] = [];
    let skippedLines = 0;
    for (const line of lines) {
        if (!line.trim()) continue;
        let row: Row;
        try {
            row = JSON.parse(line) as Row;
        } catch {
            skippedLines++;
            continue;
        }
        const ts = row.timestamp ? Date.parse(row.timestamp) : Number.NaN;
        if (!Number.isNaN(ts)) rows.push([row, ts]);
    }
    return { rows, skippedLines, format: sniffFormat(rows.map(([r]) => r)) };
}

export type Resolved = { ok: true; path: string } | { ok: false; reason: string };

export function resolveTranscript(
    env: Record<string, string | undefined>,
    projectsRoot = join(homedir(), '.claude', 'projects'),
    override?: string,
): Resolved {
    if (override) return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: 'no transcript' };
    const id = env.CLAUDE_CODE_SESSION_ID;
    if (!id) {
        // 1138 R1: pi exports PI_SESSION_FILE (an exact path) and no Claude session id. Order is
        // explicit override → Claude id → PI_SESSION_FILE; PI_SESSION_ID is never used for lookup
        // because pi's filename embeds a timestamp, so the path is not derivable from the id.
        const piFile = env.PI_SESSION_FILE;
        if (piFile !== undefined && piFile !== '') {
            return existsSync(piFile)
                ? { ok: true, path: piFile }
                : { ok: false, reason: `PI_SESSION_FILE ${piFile} does not exist` };
        }
        return {
            ok: false,
            reason:
                'no host session id; pass --transcript <path> (pi: ~/.pi/agent/sessions/<cwd-slug>/<file>.jsonl, ' +
                'or set PI_SESSION_FILE)',
        };
    }
    if (!SESSION_ID.test(id)) return { ok: false, reason: 'refusing a session id with path characters' };
    if (!existsSync(projectsRoot)) return { ok: false, reason: `no transcript root ${projectsRoot}` };
    for (const dir of readdirSync(projectsRoot)) {
        const path = join(projectsRoot, dir, `${id}.jsonl`);
        if (existsSync(path)) return { ok: true, path };
    }
    return { ok: false, reason: `no transcript for session ${id}` };
}
