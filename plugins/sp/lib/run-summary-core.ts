/**
 * run-summary core — the rendering and host IO behind the `run-summary` CLI (task 1146; task 1178 R2).
 *
 * Split out of `plugins/sp/scripts/run-summary.ts` when the actor split and the batch roll-up pushed
 * that script past the ADR-130 glue budget. The PURE aggregation and its types now live in
 * `packages/app/src/workflow/run-summary.ts`, reached through the generated pure plan-projection
 * entry; this module keeps only what belongs to the host: the close-step callback, the receipt read,
 * Markdown rendering and durable/scratch report writing. Node builtins plus relative imports only;
 * `import type` for the app projection it is handed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowProgressProjection } from '@gobing-ai/spur-app';
import { getEnvVars } from './env';
import {
    type ActorSplit,
    buildRunSummary,
    formatDuration,
    formatTokenSplit,
    type GateTime,
    type Progress,
    type RunSummary,
    type SummaryRow,
    sumTokens,
    zeroTokens,
} from './plan-projection.generated.mjs';
import { parseRows, resolveTranscript } from './transcript';

// Task 1178 R2: the pure aggregation moved to `packages/app/src/workflow/run-summary.ts`. Re-export
// it from here so the adapter's existing surface (the `run-summary` script and its tests) keeps one
// import path; the implementation is delegated, never duplicated.
export {
    type ActorSplit,
    actorSplit,
    buildRunSummary,
    type GateTime,
    type Progress,
    type RunSummary,
    type SummaryRow,
} from './plan-projection.generated.mjs';

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
        const { rows, skippedLines } = parseRows(readFileSync(resolved.path, 'utf8').split('\n'));
        const summary = buildRunSummary(rows, [{ progress: run.progress as unknown as Progress }], {
            since: run.startedAt,
            until: run.completedAt,
            skippedLines,
        });
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
