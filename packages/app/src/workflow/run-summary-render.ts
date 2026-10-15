/**
 * Close-step execution summary (task 1146 R1): render the measured per-stage table and write
 * `.spur/run/<runId>-summary.{md,json}` when `spur workflow inline close` finalizes a run.
 *
 * Script-absorption PR-4 moved the close callback out of `plugins/sp/lib/run-summary-core.ts`
 * (the plugin copy stays for the `run-summary` script until PR-6 absorbs it as `spur workflow
 * summary`). Measurement is `./run-summary.ts`; transcript IO is `./transcript.ts`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { WorkflowProgressProjection } from './progress-projection';
import { buildRunSummary, formatDuration, type Progress, type RunSummary, type SummaryRow } from './run-summary';
import { parseTranscriptRows, resolveTranscript } from './transcript';

/** The per-stage + per-actor Markdown tables of one run's measured summary. */
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

/** What the close hands the summarizer (`InlineRunCloseSummaryInput` in the inline-run service). */
export interface CloseSummaryRun {
    readonly runId: string;
    readonly startedAt: string | undefined;
    readonly completedAt: string;
    /** The full progress projection; the summary reads only the subset `Progress` declares. */
    readonly progress: WorkflowProgressProjection;
}

/**
 * Write `.spur/run/<runId>-summary.{md,json}` and return the `.md` path (relative to cwd).
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
        const { rows, skippedLines } = parseTranscriptRows(readFileSync(resolved.path, 'utf8').split('\n'));
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
