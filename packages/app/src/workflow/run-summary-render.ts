/**
 * Close-step execution summary (task 1146 R1): render the measured per-stage table and write
 * `.spur/run/<runId>-summary.{md,json}` when the engine finalizes a run.
 *
 * Script-absorption PR-4 moved the close callback out of `plugins/sp/lib/run-summary-core.ts`;
 * PR-6 moved the rest (batch roll-up, receipt read) when `spur workflow summary` absorbed the
 * `run-summary` script. Measurement is `./run-summary.ts`; transcript IO is `./transcript.ts`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { RunDao } from '@gobing-ai/spur-domain';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { projectWorkflowProgress, type WorkflowProgressProjection } from './progress-projection';
import { SAFE_RUN_ID_RE } from './run-citation';
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
} from './run-summary';
import { parseTranscriptRows, resolveTranscript } from './transcript';
import { resolveWorkflowDefinition } from './workflow-resolver';

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
    const stages = [
        '| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |',
        '| --- | --- | ---: | ---: | ---: | ---: |',
        ...summary.rows.map((r) => line(r)),
        line(summary.total, true),
        '',
    ];
    if (summary.transcript === undefined && summary.total.toolCalls === null) {
        return [...stages, 'Actor timing: n/a (no measured host transcript activity)', `Gate time: ${gate}`].join('\n');
    }
    return [
        ...stages,
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
        return `| ${name} | ${r.status} | ${r.time} | ${r.wait} | ${r.toolCalls ?? 'n/a'} | ${r.token} | ${r.toolCalls === null ? 'n/a' : formatDuration(actors.operatorMs)} | ${r.toolCalls === null ? 'n/a' : formatDuration(actors.subagentMs)} |`;
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
        toolCalls: rows.every(({ summary }) => summary.total.toolCalls !== null) ? total.toolCalls : null,
        tokens: rows.every(({ summary }) => summary.total.tokens !== null) ? total.tokens : null,
        time: formatDuration(total.workMs),
        wait: formatDuration(total.waitMs),
        token: formatTokenSplit(rows.every(({ summary }) => summary.total.tokens !== null) ? total.tokens : null),
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
 * Missing transcripts retain engine timings. Never throws: any failure (no timed attempts, invalid input) leaves the
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
        const { rows, skippedLines } = parseTranscriptRows(
            resolved.ok ? readFileSync(resolved.path, 'utf8').split('\n') : [],
        );
        const summary = buildRunSummary(rows, [{ progress: run.progress as unknown as Progress }], {
            since: run.startedAt,
            until: run.completedAt,
            skippedLines,
        });
        if (resolved.ok) summary.transcript = resolved.path;
        if (summary.rows.length === 0) return na('no timed attempts');
        // D65 1237 R1: the close summary is what an operator reads, so it resolves the gate time
        // here too — not only in the `spur workflow summary` CLI path.
        summary.gate = gateFromReceipt(cwd, run.runId);
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
 * 1448 R1: the engine's terminal close (`spur workflow run` / `continue` settling `done`/`failed`) writes the
 * run's summary over the persisted `started_at` → `completed_at` window, into the run's launch project
 * (`definitionSource.workdir`; legacy rows fall back to `cwd`). Restores the producer 1242 orphaned when it
 * deleted `inline close`. `undefined` when the id is unsafe or the row is missing or unsettled; I/O errors
 * propagate to the caller's guard.
 */
export async function writeRunCloseSummary(
    runId: string,
    opts: { db: DbAdapter; cwd: string; env?: Record<string, string | undefined>; projectsRoot?: string },
): Promise<string | undefined> {
    if (!SAFE_RUN_ID_RE.test(runId) || runId.includes('..')) return undefined;
    const row = await new RunDao(opts.db).traceRowById(runId);
    if (row === undefined || row.completed_at === null || row.completed_at === undefined) return undefined;
    const source = launchSource(row.metadata_json);
    const cwd = source.workdir ?? opts.cwd;
    let workflowDef: WorkflowDef | undefined;
    if (source.path !== undefined) {
        // The run row stores only the workflow name; an ad-hoc file path is not name-resolvable.
        workflowDef = await resolveWorkflowDefinition(cwd, source.path, { validateSchema: true })
            .then((resolved) => resolved.workflow)
            .catch(() => undefined);
    }
    const progress = await projectWorkflowProgress(runId, {
        db: opts.db,
        projectRoot: cwd,
        ...(workflowDef !== undefined ? { workflowDef } : {}),
    });
    return writeCloseSummary(
        { runId, startedAt: isoTime(row.started_at), completedAt: isoTime(row.completed_at), progress },
        {
            cwd,
            ...(opts.env ? { env: opts.env } : {}),
            ...(opts.projectsRoot ? { projectsRoot: opts.projectsRoot } : {}),
        },
    );
}

function launchSource(metadataJson: string): { path?: string; workdir?: string } {
    try {
        const source = (JSON.parse(metadataJson) as { definitionSource?: { path?: unknown; workdir?: unknown } })
            .definitionSource;
        return {
            ...(typeof source?.path === 'string' ? { path: source.path } : {}),
            ...(typeof source?.workdir === 'string' ? { workdir: source.workdir } : {}),
        };
    } catch {
        return {};
    }
}

/** Run timestamps are ISO text on engine rows and epoch ms on some fixtures; normalize to ISO. */
function isoTime(value: string | number): string {
    return typeof value === 'number' ? new Date(value).toISOString() : value;
}

/**
 * 1146 R4 + D65 1237 R1: gate time comes only from THIS run's check receipt
 * (`receipt.runId === runId`); a receipt belonging to another run is a cross-run scratch read
 * (ADR-131) and renders n/a.
 *
 * The gate names its receipt by the task WBS (`.spur/run/<wbs>-check-receipt.json`) and records the
 * run identity INSIDE it, so a run-id-only path lookup found nothing and every summary rendered a
 * null gate time. The identity in the file is the authority: try the run-id path first, then take
 * the first receipt in the run dir whose recorded `runId` is this run. Never read a foreign one.
 */
export function gateFromReceipt(cwd: string, runId: string): GateTime {
    const dir = join(cwd, '.spur', 'run');
    const direct = join(dir, `${runId}-check-receipt.json`);
    const candidates = [direct, ...siblingReceipts(dir, direct)];
    let sawReceipt = false;
    let sawUnreadable = false;
    for (const path of candidates) {
        if (!existsSync(path)) continue;
        sawReceipt = true;
        try {
            const parsed = JSON.parse(readFileSync(path, 'utf8')) as { runId?: unknown; gateRuntimeMs?: unknown };
            if (parsed.runId !== runId) continue;
            const ms = parsed.gateRuntimeMs;
            if (typeof ms !== 'number' || !Number.isFinite(ms))
                return { ms: null, reason: 'check receipt has no gate time' };
            return { ms };
        } catch {
            sawUnreadable = true;
        }
    }
    if (sawReceipt && sawUnreadable && runId !== '') return { ms: null, reason: 'check receipt is unreadable' };
    return {
        ms: null,
        reason: sawReceipt ? 'check receipt belongs to another run' : 'no matching check receipt',
    };
}

/** Every other `*-check-receipt.json` in the run dir (the gate's WBS-named receipts). */
function siblingReceipts(dir: string, exclude: string): string[] {
    if (!existsSync(dir)) return [];
    try {
        return readdirSync(dir)
            .filter((name) => name.endsWith('-check-receipt.json'))
            .map((name) => join(dir, name))
            .filter((path) => path !== exclude);
    } catch {
        return [];
    }
}
