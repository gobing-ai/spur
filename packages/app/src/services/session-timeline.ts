/**
 * `spur history timeline` — measured time and token evidence for the sp:session-review Time
 * breakdown. The visible conversation carries no timestamps or usage; the host transcript carries
 * both. Reads the active Claude Code JSONL read-only
 * (`~/.claude/projects/<slug>/<CLAUDE_CODE_SESSION_ID>.jsonl`, `PI_SESSION_FILE`, or `--transcript`),
 * one segment per operator prompt: work = prompt → last activity; wait = idle until the next prompt
 * plus time spent answering an AskUserQuestion; tokens counted once per message id and rendered
 * `<total> / <non-cached>`. `--group "1-3,4"` sums segments into stages. No transcript →
 * `{available:false}`, exit 0. Absorbed from the retired `plugins/sp/scripts/session-timeline.ts`
 * (script-absorption PR-6; argv, stdout and exit codes pinned by the PR-6 golden).
 */
import { readFileSync } from 'node:fs';
import {
    type Acc,
    accumulate,
    formatDuration,
    formatTokenSplit,
    newAcc,
    promptText,
    type Row,
    type Span,
    sumSpans,
    sumTokens,
} from '../workflow/run-summary';
import { parseTranscriptRows, resolveTranscript, sniffTranscriptFormat } from '../workflow/transcript';

/** A span plus its `M:SS` / `H:MM:SS` and token renderings, so the review table needs no arithmetic. */
export type Rendered<T> = T & { work: string; wait: string; token: string };

/** The `spur history timeline` JSON: segments, optional stages and totals (or unavailable). */
export interface Timeline {
    available: true;
    transcript?: string;
    segments: Rendered<Span & { index: number; start: string; prompt: string; compactions?: number }>[];
    stages?: Rendered<Span & { segments: string }>[];
    totals: Rendered<Span & { elapsedMs: number; elapsed: string; compactions?: number }>;
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

/** Build the per-prompt timeline from raw transcript lines, optionally grouped into stages. */
export function buildTimeline(lines: string[], group?: string): Timeline {
    const open: Open[] = [];
    const { rows, skippedLines, format } = parseTranscriptRows(lines);
    const isPi = format === 'pi';

    for (const [row, ts] of rows) {
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
    };
    if (group) {
        timeline.stages = parseGroups(group, segments.length).map(([a, b]) =>
            render({ ...sumSpans(segments.slice(a - 1, b)), segments: a === b ? `${a}` : `${a}-${b}` }),
        );
    }
    return timeline;
}

/** Usage text for `spur history timeline`. */
export const SESSION_TIMELINE_USAGE = 'usage: spur history timeline [--transcript <path>] [--group "1-3,4,..."]';

/**
 * 1138 R3: a zero-segment result must say WHAT was detected, so an unparseable-but-recognised
 * transcript can never read as an authoritative all-zero timeline. A known format names the row
 * count; an unknown one lists the top-5 row-type census. (1151 R2 removed the pi-only injected
 * count: pi injects no skill bodies, so a wrapper row is an operator prompt and the class is gone.)
 */
export function zeroSegmentReason(rows: [Row, number][]): string {
    const format = sniffTranscriptFormat(rows.map(([r]) => r));
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
    return `${format} transcript with no operator prompts (${rows.length} rows)`;
}

/** Host IO for {@link runSessionTimelineCli}; the CLI passes its output seam and environment. */
export interface SessionTimelineCliIo {
    env: Record<string, string | undefined>;
    /** stdout text, newline-terminated. */
    write: (s: string) => void;
    /** stderr text, newline-terminated. */
    writeErr: (s: string) => void;
    /** Claude Code projects root override (test hook). */
    projectsRoot?: string;
}

/** Run `spur history timeline`: resolve the transcript, print the timeline JSON, return the exit code. */
export function runSessionTimelineCli(argv: string[], io: SessionTimelineCliIo): number {
    const { env, write, writeErr, projectsRoot } = io;
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
            write(
                `${JSON.stringify({ available: false, reason: zeroSegmentReason(parseTranscriptRows(lines).rows) })}\n`,
            );
            return 0;
        }
        write(`${JSON.stringify({ ...timeline, transcript: resolved.path })}\n`);
        return 0;
    } catch (error) {
        writeErr(`spur history timeline: ${(error as Error).message}\n`);
        return 2;
    }
}
