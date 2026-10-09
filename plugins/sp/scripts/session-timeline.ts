#!/usr/bin/env bun
/**
 * session-timeline — measured time and token evidence for the sp:session-review Time breakdown.
 * The visible conversation carries no timestamps or usage (so the table read `n/a`); the host
 * transcript carries both. Reads the active Claude Code JSONL read-only
 * (`~/.claude/projects/<slug>/<CLAUDE_CODE_SESSION_ID>.jsonl`, or `--transcript`), one segment per
 * operator prompt: work = prompt → last activity; wait = idle until the next prompt plus time spent
 * answering an AskUserQuestion; tokens counted once per message id and rendered `<total> /
 * <non-cached>`. `--group "1-3,4"` sums segments into stages. No transcript → `{available:false}`,
 * exit 0, and the review renders `n/a` instead of guessing. Node builtins only (standalone plugin).
 */
import { readFileSync } from 'node:fs';
import { getEnvVars } from '../lib/env';
import {
    type Acc,
    accumulate,
    formatDuration,
    formatTokenSplit,
    isInjectedPrompt,
    newAcc,
    parseRows,
    promptText,
    type Row,
    resolveTranscript,
    type Span,
    sniffFormat,
    sumSpans,
    sumTokens,
} from '../lib/transcript';

export { formatDuration, formatTokenSplit, formatTokens, resolveTranscript } from '../lib/transcript';

/** A span plus its `M:SS` / `H:MM:SS` and token renderings, so the review table needs no arithmetic. */
export type Rendered<T> = T & { work: string; wait: string; token: string };

export interface Timeline {
    available: true;
    transcript?: string;
    segments: Rendered<Span & { index: number; start: string; prompt: string; compactions?: number }>[];
    stages?: Rendered<Span & { segments: string }>[];
    totals: Rendered<Span & { elapsedMs: number; elapsed: string; compactions?: number }>;
    skippedLines: number;
    /** pi only (1138 R2): skill-injected user bodies counted as activity, never as segments. */
    injectedPrompts?: number;
}

const PROMPT_EXCERPT = 80;

const render = <T extends Span>(span: T): Rendered<T> => ({
    ...span,
    work: formatDuration(span.workMs),
    wait: formatDuration(span.waitMs),
    token: formatTokenSplit(span.tokens),
});

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

interface Open extends Acc {
    start: number;
    prompt: string;
}

export function buildTimeline(lines: string[], group?: string): Timeline {
    const open: Open[] = [];
    const { rows, skippedLines, format } = parseRows(lines);
    const isPi = format === 'pi';
    let injectedPrompts = 0;

    for (const [row, ts] of rows) {
        // 1138 R2: an injected skill body is activity, not a prompt — accumulate it into the open
        // segment (its tools and usage are real work) and count it, never open a segment.
        if (isPi && isInjectedPrompt(row)) {
            injectedPrompts++;
            const injectedSeg = open.at(-1);
            if (injectedSeg) accumulate(injectedSeg, row, ts);
            continue;
        }
        const prompt = promptText(row);
        if (prompt !== undefined) {
            open.push({ start: ts, prompt, ...newAcc(ts) });
            continue;
        }
        const seg = open.at(-1);
        if (seg) accumulate(seg, row, ts); // rows before the first prompt are session preamble
    }

    const segments = open.map(
        (seg, i): Rendered<Span & { index: number; start: string; prompt: string; compactions?: number }> => {
            const next = open[i + 1]?.start;
            const idle = next === undefined ? 0 : Math.max(0, next - seg.last);
            const oneLine = seg.prompt.replace(/\s+/g, ' ').trim();
            const span = {
                index: i + 1,
                start: new Date(seg.start).toISOString(),
                prompt: oneLine.length > PROMPT_EXCERPT ? `${oneLine.slice(0, PROMPT_EXCERPT)}…` : oneLine,
                workMs: seg.last - seg.start - seg.askMs,
                waitMs: idle + seg.askMs,
                toolCalls: seg.toolIds.size,
                tokens: sumTokens([...seg.messages.values()]),
            };
            return render(isPi ? { ...span, compactions: seg.compactions } : span);
        },
    );

    const first = open[0];
    const last = open.at(-1);
    const elapsedMs = first && last ? last.last - first.start : 0;
    const totals = { ...sumSpans(segments), elapsedMs, elapsed: formatDuration(elapsedMs) };
    const timeline: Timeline = {
        available: true,
        segments,
        totals: render(
            isPi ? { ...totals, compactions: segments.reduce((n, s) => n + (s.compactions ?? 0), 0) } : totals,
        ),
        skippedLines,
        // Emitted only for pi, as `compactions` is, so Claude output is unchanged (1138 R2).
        ...(isPi ? { injectedPrompts } : {}),
    };
    if (group) {
        timeline.stages = parseGroups(group, segments.length).map(([a, b]) =>
            render({ ...sumSpans(segments.slice(a - 1, b)), segments: a === b ? `${a}` : `${a}-${b}` }),
        );
    }
    return timeline;
}

export const SESSION_TIMELINE_USAGE = 'usage: session-timeline [--transcript <path>] [--group "1-3,4,..."]';

/**
 * 1138 R3: a zero-segment result must say WHAT was detected, so an unparseable-but-recognised
 * transcript can never read as an authoritative all-zero timeline. A known format names the
 * row count and the injected count; an unknown one lists the top-5 row-type census.
 */
export function zeroSegmentReason(rows: [Row, number][]): string {
    const format = sniffFormat(rows.map(([r]) => r));
    if (format === 'unknown') {
        const counts = new Map<string, number>();
        for (const [r] of rows) {
            const kind = typeof r.type === 'string' && r.type !== '' ? r.type : '(untyped)';
            counts.set(kind, (counts.get(kind) ?? 0) + 1);
        }
        const census = [...counts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 5)
            .map(([kind, n]) => `${kind} ${n}`)
            .join(', ');
        return `unrecognized transcript format (row types: ${census})`;
    }
    const injected = rows.filter(([r]) => isInjectedPrompt(r)).length;
    return `${format} transcript with no operator prompts (${rows.length} rows, ${injected} injected)`;
}

export function main(
    argv: string[],
    env: Record<string, string | undefined> = getEnvVars(),
    write: (s: string) => void = (s) => process.stdout.write(s),
    projectsRoot?: string,
    writeErr: (s: string) => void = (s) => process.stderr.write(s),
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
            writeErr(`${SESSION_TIMELINE_USAGE}\n`);
            return 2;
        }
    }
    const resolved = resolveTranscript(env, projectsRoot, transcript);
    if (!resolved.ok) {
        write(`${JSON.stringify({ available: false, reason: resolved.reason })}\n`);
        return 0;
    }
    try {
        const lines = readFileSync(resolved.path, 'utf8').split('\n');
        const timeline = buildTimeline(lines, group);
        if (timeline.segments.length === 0) {
            write(`${JSON.stringify({ available: false, reason: zeroSegmentReason(parseRows(lines).rows) })}\n`);
            return 0;
        }
        write(`${JSON.stringify({ ...timeline, transcript: resolved.path })}\n`);
        return 0;
    } catch (error) {
        writeErr(`session-timeline: ${(error as Error).message}\n`);
        return 2;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
