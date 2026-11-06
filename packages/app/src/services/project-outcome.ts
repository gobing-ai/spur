/**
 * Project outcome service (task 1308). Composes {@link deriveVerifiedOutcome}
 * with {@link readWorkflowRuns} and {@link foldWorkflow} over the Summary
 * window. One history plane; no second ledger and no on-the-fly USD pricing.
 */

import type { ObservabilityOutcomes, ObservabilityVerifiedOutcome } from '@gobing-ai/spur-contracts';
import {
    ActionRunDao,
    type DbAdapter,
    RunDao,
    readWorkflowRuns,
    TaskRunLinkDao,
    TERMINAL_RUN_STATUSES,
    type VerifiedOutcomeStat,
    type WorkflowRunRow,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { foldWorkflow } from '../workflow/run-measurements';
import { deriveVerifiedOutcome, type VerifiedOutcomeTaskLocator } from './verified-outcome';

/** Evidence links returned for the selected window. Aggregates still cover every selected run. */
const EVIDENCE_CAP = 100;
/** Page size for workflow-name discovery via {@link RunDao.traceRows}. */
const NAME_PAGE = 500;
/** Hard stop so name discovery cannot scan an unbounded run history. */
const NAME_PAGES = 20;
/** Task-pipeline state id that owns the quality-gate command. */
const QUALITY_GATE_NODE = 'gate';
/** Action kind persisted for the quality-gate command. `options.id` is not stored. */
const QUALITY_GATE_KIND = 'command.gate';

/**
 * Dependencies for {@link summarizeProjectOutcome}.
 * `cwd` and `fs` are required for verified completion. Measurements still fold without them.
 */
export interface ProjectOutcomeDeps {
    db: DbAdapter;
    cwd?: string;
    fs?: FileSystem;
    locator?: VerifiedOutcomeTaskLocator;
}

/** Inclusive ISO window. Both folds use these bounds. */
export interface ProjectOutcomeWindow {
    since: string;
    until: string;
}

/** Current-window outcome block. Same shape as the optional summary `outcomes` field. */
export type ProjectOutcome = ObservabilityOutcomes;

/**
 * Summarize verified task outcomes and measured run cost for one window.
 *
 * `verified` is null when the corpus plane is absent or derivation returns null.
 * An empty link set is a zero-denominator stat, not null. Measurement failures
 * propagate so the caller can omit the block instead of inventing zeros.
 */
export async function summarizeProjectOutcome(
    deps: ProjectOutcomeDeps,
    window: ProjectOutcomeWindow,
): Promise<ProjectOutcome> {
    const { sinceMs, untilMs } = parseWindow(window);
    const names = await listWorkflowNames(deps.db, window.since);
    const runs = names.length === 0 ? [] : await readWorkflowRuns(deps.db, names, { sinceMs });
    const inWindow = runs.filter((row) => inWindowStart(row.startedAt, sinceMs, untilMs));
    const folded = foldWorkflow('project', inWindow);
    const terminal = inWindow.filter((row) => !row.dryRun && TERMINAL_RUN_STATUSES.includes(row.status));
    const gate = await sumGateSamples(deps.db, terminal);
    const evidence = await buildEvidence(deps.db, terminal);
    const verified = await readVerified(deps, window);
    const terminalReasonMix: Record<string, number> = {};
    for (const [key, count] of Object.entries(folded.terminalReasonMix)) {
        if (typeof count === 'number') terminalReasonMix[key] = count;
    }
    let unknownCostRunCount = 0;
    for (const row of terminal) {
        if (row.historyRows === 0 || row.usdRows < row.historyRows) unknownCostRunCount += 1;
    }
    return {
        verified,
        measuredUsd: folded.tokenCostUsd,
        tokens: folded.tokens,
        terminalRuns: folded.terminalRuns,
        mappedRuns: folded.mappedRuns,
        historyRows: folded.historyRows,
        usdRows: folded.usdRows,
        unknownUsdRows: folded.historyRows - folded.usdRows,
        unknownCostRunCount,
        terminalReasonMix,
        gateDurationMs: gate.durationMs,
        gateSampleCount: gate.sampleCount,
        evidence: evidence.links,
        evidenceTruncated: evidence.truncated,
    };
}

function parseWindow(window: ProjectOutcomeWindow): { sinceMs: number; untilMs: number } {
    const sinceMs = Date.parse(window.since);
    const untilMs = Date.parse(window.until);
    if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
        throw new Error('project outcome window is not a valid ISO range');
    }
    return { sinceMs, untilMs };
}

function inWindowStart(startedAt: string, sinceMs: number, untilMs: number): boolean {
    const started = Date.parse(startedAt);
    return Number.isFinite(started) && started >= sinceMs && started <= untilMs;
}

/** Distinct workflow names whose runs start at or after `since`, paged newest-first. */
async function listWorkflowNames(db: DbAdapter, since: string): Promise<string[]> {
    const dao = new RunDao(db);
    const names = new Set<string>();
    let before: { started_at: string; id: string } | undefined;
    for (let page = 0; page < NAME_PAGES; page++) {
        const rows = await dao.traceRows({ since, before, limit: NAME_PAGE });
        for (const row of rows) {
            if (row.workflow_name !== '') names.add(row.workflow_name);
        }
        if (rows.length < NAME_PAGE) break;
        const last = rows[rows.length - 1];
        if (!last) break;
        before = { started_at: last.started_at, id: last.id };
    }
    return [...names];
}

async function readVerified(
    deps: ProjectOutcomeDeps,
    window: ProjectOutcomeWindow,
): Promise<ObservabilityVerifiedOutcome | null> {
    if (!deps.cwd || !deps.fs) return null;
    const stat = await deriveVerifiedOutcome(
        { db: deps.db, cwd: deps.cwd, fs: deps.fs, locator: deps.locator },
        { since: window.since, until: window.until },
    );
    return stat === null ? null : projectVerified(stat);
}

function projectVerified(stat: VerifiedOutcomeStat): ObservabilityVerifiedOutcome {
    return {
        taskDenominator: stat.taskDenominator,
        verifiedResults: stat.verifiedResults,
        correctionCount: stat.correctionCount,
        retryExhaustedCount: stat.retryExhaustedCount,
        timeToVerified: {
            count: stat.timeToVerified.count,
            meanMs: stat.timeToVerified.meanMs,
            maxMs: stat.timeToVerified.maxMs,
        },
        excludedReasons: { ...stat.excludedReasons },
    };
}

/**
 * Sum retained quality-gate spans. A sample needs both timestamps and
 * `completed >= started`. Missing timestamps are not a sample and never fall
 * back to run wall time or `duration_ms`. Equal timestamps count as 0ms.
 */
async function sumGateSamples(
    db: DbAdapter,
    terminal: readonly WorkflowRunRow[],
): Promise<{ durationMs: number | null; sampleCount: number }> {
    const dao = new ActionRunDao(db);
    let durationMs = 0;
    let sampleCount = 0;
    for (const run of terminal) {
        const actions = await dao.actionRowsByRunId(run.runId);
        for (const action of actions) {
            const span = gateSpanMs(action);
            if (span === null) continue;
            durationMs += span;
            sampleCount += 1;
        }
    }
    return { durationMs: sampleCount === 0 ? null : durationMs, sampleCount };
}

function gateSpanMs(action: {
    node: string;
    kind: string;
    started_at: string | null;
    completed_at: string | null;
}): number | null {
    if (action.node !== QUALITY_GATE_NODE || action.kind !== QUALITY_GATE_KIND) return null;
    if (!action.started_at || !action.completed_at) return null;
    const started = Date.parse(action.started_at);
    const completed = Date.parse(action.completed_at);
    if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return null;
    return completed - started;
}

async function buildEvidence(
    db: DbAdapter,
    terminal: readonly WorkflowRunRow[],
): Promise<{ links: ProjectOutcome['evidence']; truncated: boolean }> {
    const ordered = [...terminal].sort((a, b) => {
        if (a.startedAt !== b.startedAt) return a.startedAt < b.startedAt ? -1 : 1;
        if (a.runId === b.runId) return 0;
        return a.runId < b.runId ? -1 : 1;
    });
    const shown = ordered.slice(0, EVIDENCE_CAP);
    const linkDao = new TaskRunLinkDao(db);
    const links: ProjectOutcome['evidence'] = [];
    for (const run of shown) {
        const rows = await linkDao.listByRun(run.runId, 100);
        const wbsValues = rows
            .map((row) => row.wbs)
            .filter((wbs) => wbs !== '')
            .sort();
        links.push({
            runId: run.runId,
            wbs: wbsValues[0] ?? null,
            measuredUsd: run.tokenCostUsd,
            unknownUsdRows: run.historyRows - run.usdRows,
        });
    }
    return { links, truncated: ordered.length > EVIDENCE_CAP };
}
