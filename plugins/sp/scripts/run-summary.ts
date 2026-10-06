#!/usr/bin/env bun
/**
 * run-summary — the measured execution summary `/sp:dev-run` and `/sp:dev-runall` print by default
 * (`--no-summary` skips it). Inputs: one or more `spur workflow progress <run-id> --json` files
 * (`--progress [<label>=]<file>`) and the host Claude Code transcript (resolved like session-timeline,
 * or `--transcript`). One file → one row per state visit; several → one row per run. Each row is
 * windowed by its attempt timestamps and slices the transcript: work, operator wait, tool calls and
 * tokens rendered `<total> / <non-cached>`. A driver-overhead row makes rows sum to the total;
 * `--since <iso>` starts the total at the command's invocation. A window with no host transcript
 * record (a subprocess stage) reads `n/a`, never 0. `--markdown` prints the table. Reporting only:
 * no transcript → `{available:false}` (or one `n/a` line), exit 0. Node builtins only.
 */
import { readFileSync } from 'node:fs';
import { getEnvVars } from '../lib/env';
import {
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
    type Tokens,
    zeroTokens,
} from '../lib/transcript';

interface ProgressAttempt {
    startedAt?: string;
    completedAt?: string;
}

/** The subset of `spur workflow progress <run-id> --json` the summary reads. */
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

export interface RunSummary {
    available: true;
    transcript?: string;
    rows: SummaryRow[];
    total: SummaryRow;
    skippedLines: number;
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

    return { available: true, rows: stageRows, total, skippedLines };
}

export function renderSummaryMarkdown(summary: RunSummary): string {
    const line = (r: SummaryRow, bold = false) => {
        const stage = bold ? `**${r.stage}**` : r.stage;
        return `| ${stage} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? 'n/a'} | ${r.token} |`;
    };
    return [
        '| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        ...summary.rows.map((r) => line(r)),
        line(summary.total, true),
    ].join('\n');
}

export const RUN_SUMMARY_USAGE =
    'usage: run-summary --progress [<label>=]<file> [--progress ...] [--transcript <path>] [--since <iso>] [--markdown]';

export function main(
    argv: string[],
    env: Record<string, string | undefined> = getEnvVars(),
    write: (s: string) => void = (s) => process.stdout.write(s),
    projectsRoot?: string,
): number {
    let transcript: string | undefined;
    let since: string | undefined;
    let markdown = false;
    const progressArgs: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--transcript' && argv[i + 1]) transcript = argv[++i];
        else if (arg === '--progress' && argv[i + 1]) progressArgs.push(argv[++i] as string);
        else if (arg === '--since' && argv[i + 1]) since = argv[++i];
        else if (arg === '--markdown') markdown = true;
        else if (arg === '--spur-bin' && argv[i + 1])
            i++; // 0482 R2: accepted, unused (no spur calls)
        else {
            process.stderr.write(`${RUN_SUMMARY_USAGE}\n`);
            return 2;
        }
    }
    if (!progressArgs.length) {
        process.stderr.write(`${RUN_SUMMARY_USAGE}\n`);
        return 2;
    }
    const resolved = resolveTranscript(env, projectsRoot, transcript);
    if (!resolved.ok) {
        const out = markdown
            ? `Execution summary: n/a (${resolved.reason})`
            : JSON.stringify({ available: false, reason: resolved.reason });
        write(`${out}\n`);
        return 0;
    }
    try {
        const inputs = progressArgs.map((arg) => {
            const eq = arg.indexOf('=');
            const [label, file] = eq > 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [undefined, arg];
            return { label, progress: JSON.parse(readFileSync(file, 'utf8')) as Progress };
        });
        const summary = buildRunSummary(readFileSync(resolved.path, 'utf8').split('\n'), inputs, since);
        write(
            `${markdown ? renderSummaryMarkdown(summary) : JSON.stringify({ ...summary, transcript: resolved.path })}\n`,
        );
        return 0;
    } catch (error) {
        process.stderr.write(`run-summary: ${(error as Error).message}\n`);
        return 2;
    }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
