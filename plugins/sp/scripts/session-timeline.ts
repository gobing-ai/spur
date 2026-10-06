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
    newAcc,
    parseRows,
    promptText,
    resolveTranscript,
    type Span,
    sumSpans,
    sumTokens,
} from '../lib/transcript';

export { formatDuration, formatTokenSplit, formatTokens, resolveTranscript } from '../lib/transcript';

/** A span plus its `M:SS` / `H:MM:SS` and token renderings, so the review table needs no arithmetic. */
export type Rendered<T> = T & { work: string; wait: string; token: string };

export interface Timeline {
    available: true;
    transcript?: string;
    segments: Rendered<Span & { index: number; start: string; prompt: string }>[];
    stages?: Rendered<Span & { segments: string }>[];
    totals: Rendered<Span & { elapsedMs: number; elapsed: string }>;
    skippedLines: number;
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
    const { rows, skippedLines } = parseRows(lines);

    for (const [row, ts] of rows) {
        const prompt = promptText(row);
        if (prompt !== undefined) {
            open.push({ start: ts, prompt, ...newAcc(ts) });
            continue;
        }
        const seg = open.at(-1);
        if (seg) accumulate(seg, row, ts); // rows before the first prompt are session preamble
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

export const SESSION_TIMELINE_USAGE = 'usage: session-timeline [--transcript <path>] [--group "1-3,4,..."]';

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
        const timeline = buildTimeline(readFileSync(resolved.path, 'utf8').split('\n'), group);
        write(`${JSON.stringify({ ...timeline, transcript: resolved.path })}\n`);
        return 0;
    } catch (error) {
        writeErr(`session-timeline: ${(error as Error).message}\n`);
        return 2;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
