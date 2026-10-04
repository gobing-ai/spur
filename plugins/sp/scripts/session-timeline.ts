#!/usr/bin/env bun
/**
 * session-timeline — measured time and token evidence for the sp:session-review Time breakdown.
 * The visible conversation carries no timestamps or usage (so the table read `n/a`); the host
 * transcript carries both. Reads the active Claude Code JSONL read-only
 * (`~/.claude/projects/<slug>/<CLAUDE_CODE_SESSION_ID>.jsonl`, or `--transcript`), one segment per
 * operator prompt: work = prompt → last activity; wait = idle until the next prompt plus time spent
 * answering an AskUserQuestion; tokens counted once per message id (a response spans several
 * records). `--group "1-3,4"` sums segments into stages. No transcript → `{available:false}`,
 * exit 0, and the review renders `n/a` instead of guessing. Node builtins only (standalone plugin).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export type Tokens = Record<'input' | 'cacheCreate' | 'cacheRead' | 'output', number>;

export interface Span {
    workMs: number;
    waitMs: number;
    toolCalls: number;
    tokens: Tokens;
}

/** A span plus its `M:SS` / `H:MM:SS` renderings, so the review table needs no arithmetic. */
export type Rendered<T> = T & { work: string; wait: string };

export interface Timeline {
    available: true;
    transcript?: string;
    segments: Rendered<Span & { index: number; start: string; prompt: string }>[];
    stages?: Rendered<Span & { segments: string }>[];
    totals: Rendered<Span & { elapsedMs: number; elapsed: string }>;
    skippedLines: number;
}

type Block = Partial<Record<'type' | 'id' | 'name' | 'text' | 'tool_use_id', string>>;

interface Row {
    type?: string;
    timestamp?: string;
    isMeta?: boolean;
    isCompactSummary?: boolean;
    message?: { id?: string; content?: unknown; usage?: Record<string, number | undefined> };
}

const SESSION_ID = /^[A-Za-z0-9_-]+$/;
const PROMPT_EXCERPT = 80;
/** Host tools whose call→result gap is the operator answering, not the agent working. */
const OPERATOR_TOOLS = new Set(['AskUserQuestion']);

const zeroTokens = (): Tokens => ({ input: 0, cacheCreate: 0, cacheRead: 0, output: 0 });

export function formatDuration(ms: number): string {
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

const render = <T extends Span>(span: T): Rendered<T> => ({
    ...span,
    work: formatDuration(span.workMs),
    wait: formatDuration(span.waitMs),
});

/** Operator prompt text, or undefined for tool results, meta rows and compaction summaries. */
function promptText(row: Row): string | undefined {
    if (row.type !== 'user' || row.isMeta || row.isCompactSummary) return undefined;
    const content = row.message?.content;
    if (typeof content === 'string') return content;
    if (!Array.isArray(content) || (content as Block[]).some((b) => b.type === 'tool_result')) return undefined;
    return (content as Block[]).find((b) => b.type === 'text')?.text;
}

function sumTokens(all: Tokens[]): Tokens {
    const total = zeroTokens();
    for (const t of all) for (const k of Object.keys(total) as (keyof Tokens)[]) total[k] += t[k];
    return total;
}

function sumSpans(spans: Span[]): Span {
    return {
        workMs: spans.reduce((n, s) => n + s.workMs, 0),
        waitMs: spans.reduce((n, s) => n + s.waitMs, 0),
        toolCalls: spans.reduce((n, s) => n + s.toolCalls, 0),
        tokens: sumTokens(spans.map((s) => s.tokens)),
    };
}

/** "1-3,4" → [[1,3],[4,4]]; 1-based, ascending, in range, non-overlapping. */
export function parseGroups(spec: string, count: number): [number, number][] {
    let next = 1;
    return spec.split(',').map((part) => {
        const [a = Number.NaN, b = a] = part.trim().split('-').map(Number);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < next || b < a || b > count) {
            throw new Error(`invalid --group "${part}" (segments 1-${count}, ascending, no overlap)`);
        }
        next = b + 1;
        return [a, b] as [number, number];
    });
}

interface Open {
    start: number;
    prompt: string;
    last: number;
    askMs: number;
    asks: Map<string, number>;
    toolIds: Set<string>;
    messages: Map<string, Tokens>;
}

export function buildTimeline(lines: string[], group?: string): Timeline {
    const open: Open[] = [];
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
        if (Number.isNaN(ts)) continue;
        const prompt = promptText(row);
        if (prompt !== undefined) {
            const fresh = { asks: new Map(), toolIds: new Set<string>(), messages: new Map() };
            open.push({ start: ts, prompt, last: ts, askMs: 0, ...fresh });
            continue;
        }
        const seg = open.at(-1);
        if (!seg) continue; // session preamble before the first prompt
        seg.last = Math.max(seg.last, ts);
        const blocks = Array.isArray(row.message?.content) ? (row.message.content as Block[]) : [];
        for (const b of blocks) {
            if (b.type === 'tool_use' && b.id) {
                seg.toolIds.add(b.id);
                if (b.name && OPERATOR_TOOLS.has(b.name)) seg.asks.set(b.id, ts);
            } else if (b.type === 'tool_result' && b.tool_use_id && seg.asks.has(b.tool_use_id)) {
                seg.askMs += ts - (seg.asks.get(b.tool_use_id) ?? ts);
            }
        }
        const u = row.message?.usage;
        // Split records of one response repeat its usage: keyed by message id, overwrite, never add.
        if (row.type === 'assistant' && u && row.message?.id) {
            seg.messages.set(row.message.id, {
                input: u.input_tokens ?? 0,
                cacheCreate: u.cache_creation_input_tokens ?? 0,
                cacheRead: u.cache_read_input_tokens ?? 0,
                output: u.output_tokens ?? 0,
            });
        }
    }

    const segments = open.map((seg, i) => {
        const next = open[i + 1]?.start;
        const idle = next === undefined ? 0 : Math.max(0, next - seg.last);
        const oneLine = seg.prompt.replace(/\s+/g, ' ').trim();
        return render({
            index: i + 1,
            start: new Date(seg.start).toISOString(),
            prompt: oneLine.length > PROMPT_EXCERPT ? `${oneLine.slice(0, PROMPT_EXCERPT)}…` : oneLine,
            workMs: seg.last - seg.start - seg.askMs,
            waitMs: idle + seg.askMs,
            toolCalls: seg.toolIds.size,
            tokens: sumTokens([...seg.messages.values()]),
        });
    });

    const first = open[0];
    const last = open.at(-1);
    const elapsedMs = first && last ? last.last - first.start : 0;
    const timeline: Timeline = {
        available: true,
        segments,
        totals: render({ ...sumSpans(segments), elapsedMs, elapsed: formatDuration(elapsedMs) }),
        skippedLines,
    };
    if (group) {
        timeline.stages = parseGroups(group, segments.length).map(([a, b]) =>
            render({ ...sumSpans(segments.slice(a - 1, b)), segments: a === b ? `${a}` : `${a}-${b}` }),
        );
    }
    return timeline;
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

export const SESSION_TIMELINE_USAGE = 'usage: session-timeline [--transcript <path>] [--group "1-3,4,..."]';

export function main(
    argv: string[],
    env: Record<string, string | undefined> = getEnvVars(),
    write: (s: string) => void = (s) => process.stdout.write(s),
    projectsRoot?: string,
): number {
    let transcript: string | undefined;
    let group: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--transcript' && argv[i + 1]) transcript = argv[++i];
        else if (arg === '--group' && argv[i + 1]) group = argv[++i];
        else if (arg === '--spur-bin' && argv[i + 1])
            i++; // 0482 R2: accepted, unused (no spur calls)
        else {
            process.stderr.write(`${SESSION_TIMELINE_USAGE}\n`);
            return 2;
        }
    }
    const resolved = resolveTranscript(env, projectsRoot, transcript);
    if (!resolved.ok) {
        write(`${JSON.stringify({ available: false, reason: resolved.reason })}\n`);
        return 0;
    }
    try {
        const timeline = buildTimeline(readFileSync(resolved.path, 'utf8').split('\n'), group);
        write(`${JSON.stringify({ ...timeline, transcript: resolved.path })}\n`);
        return 0;
    } catch (error) {
        process.stderr.write(`session-timeline: ${(error as Error).message}\n`);
        return 2;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
