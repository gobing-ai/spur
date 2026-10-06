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

type Block = Partial<Record<'type' | 'id' | 'name' | 'text' | 'tool_use_id', string>>;

export interface Row {
    type?: string;
    timestamp?: string;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    message?: { id?: string; content?: unknown; usage?: Record<string, number | undefined> };
}

/** Running measurement of one segment or window. */
export interface Acc {
    last: number;
    askMs: number;
    asks: Map<string, number>;
    toolIds: Set<string>;
    messages: Map<string, Tokens>;
}

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
/** Host tools whose call→result gap is the operator answering, not the agent working. */
const OPERATOR_TOOLS = new Set(['AskUserQuestion']);

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

/** Operator prompt text, or undefined for tool results, meta rows and compaction summaries. */
export function promptText(row: Row): string | undefined {
    if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return undefined;
    const content = row.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content) || (content as Block[]).some((b) => b.type === 'tool_result')) return undefined;
    return (content as Block[]).find((b) => b.type === 'text')?.text;
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
});

/** Fold one timestamped non-prompt record into a segment or window. */
export function accumulate(acc: Acc, row: Row, ts: number): void {
    acc.last = Math.max(acc.last, ts);
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

/** Timestamped rows in file order; malformed lines counted, timestamp-less rows dropped. */
export function parseRows(lines: string[]): { rows: [Row, number][]; skippedLines: number } {
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
    return { rows, skippedLines };
}

export type Resolved = { ok: true; path: string } | { ok: false; reason: string };

export function resolveTranscript(
    env: Record<string, string | undefined>,
    projectsRoot = join(homedir(), '.claude', 'projects'),
    override?: string,
): Resolved {
    if (override) return existsSync(override) ? { ok: true, path: override } : { ok: false, reason: 'no transcript' };
    const id = env.CLAUDE_CODE_SESSION_ID;
    if (!id) return { ok: false, reason: 'no host session id (CLAUDE_CODE_SESSION_ID); pass --transcript <path>' };
    if (!SESSION_ID.test(id)) return { ok: false, reason: 'refusing a session id with path characters' };
    if (!existsSync(projectsRoot)) return { ok: false, reason: `no transcript root ${projectsRoot}` };
    for (const dir of readdirSync(projectsRoot)) {
        const path = join(projectsRoot, dir, `${id}.jsonl`);
        if (existsSync(path)) return { ok: true, path };
    }
    return { ok: false, reason: `no transcript for session ${id}` };
}
