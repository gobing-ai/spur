#!/usr/bin/env bun
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * history-latency-measure (0745 R4-R7) — the measurement protocol + no-regression
 * gate for the History board's six tabs.
 *
 * The protocol is frozen before measuring: each tab's latency is the median of
 * LATENCY_SAMPLE_COUNT runs, and a tab regresses when its post-change median
 * exceeds its baseline median by more than LATENCY_NOISE_TOLERANCE_RATIO. A
 * single sample plus a bare no-regression rule guarantees spurious failures,
 * which trains people to ignore the gate; the median-of-N statement is the
 * protocol.
 *
 * Measurements run through the source-local CLI and record the CLI binary path
 * plus the resolved importer package version alongside each run (R8). See
 * docs/report/ for the recorded baseline and the PARTIAL residual risk.
 *
 * Internal self-development tooling: scripts/commands/ surface (ADR-051). It is
 * NOT a public `spur` noun or verb.
 */

export const HISTORY_TAB_IDS = ['summary', 'timeline', 'tool-using', 'sessions', 'insights', 'sources'] as const;
export type HistoryTabId = (typeof HISTORY_TAB_IDS)[number];

/** Stated N for the median-of-N measurement protocol (R6). */
export const LATENCY_SAMPLE_COUNT = 5;

/**
 * Declared no-regression tolerance (R7). A tab regresses when post > baseline *
 * (1 + tolerance). Set from the observed corpus variance: the Background's own
 * re-GROUP BY figure spans 0.087-0.112 s (~29%), so a stated tolerance below
 * the measured noise band would fail spuriously.
 */
export const LATENCY_NOISE_TOLERANCE_RATIO = 0.3;

/**
 * Pre-change per-tab baseline latency in milliseconds, derived from the E91
 * Background corpus figures (1,791,462 messages / 494,215 tool calls).
 *
 * NOTE — provenance. The E91 changes (0741/0743/0744) were already landed when
 * 0745 ran, so a genuine live pre-change baseline could not be captured. These
 * figures are the Background's recorded reference values, NOT a live median. The
 * Sources entry maps the Background's corpus-scale refresh figure (43.9 s); the
 * Sources read-path figure was not separately recorded in Background. Both are
 * documented in docs/report/ and in the residual-risk note below.
 */
export const HISTORY_TAB_BASELINE: Record<HistoryTabId, number> = {
    summary: 1, // rollup point read ~0.001 s
    timeline: 1290, // consolidated toolSequenceQuery 1.29 s
    'tool-using': 4170, // byTool 4.17 s
    sessions: 2300, // bySession 2.30 s
    insights: 100, // rollup re-GROUP BY 0.087-0.112 s (midpoint)
    sources: 43900, // full refreshHistoryRollups 43.9 s (see provenance note)
};

export interface TabRegression {
    tab: HistoryTabId;
    baselineMs: number;
    postMs: number;
    ratio: number;
    regressed: boolean;
    /** false when the tab has no usable post measurement (needs live corpus). */
    measured: boolean;
}

export interface RegressionResult {
    ok: boolean;
    results: TabRegression[];
}

/** Median of an even/odd sample set. */
export function median(values: number[]): number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid] ?? Number.NaN;
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export interface TabLatencySample {
    tab: HistoryTabId;
    samplesMs: number[];
    medianMs: number;
    sampleCount: number;
}

/**
 * Time a single runnable per tab LATENCY_SAMPLE_COUNT times and return the median.
 * `runOne` is the source-local CLI invocation for the tab's read path; the caller
 * supplies it so the harness stays decoupled from the (live-corpus) CLI wiring.
 */
export async function measureTabLatency(
    tab: HistoryTabId,
    runOne: () => Promise<unknown>,
    sampleCount: number = LATENCY_SAMPLE_COUNT,
): Promise<TabLatencySample> {
    const samplesMs: number[] = [];
    for (let i = 0; i < sampleCount; i++) {
        const start = performance.now();
        await runOne();
        samplesMs.push(performance.now() - start);
    }
    return { tab, samplesMs, medianMs: median(samplesMs), sampleCount: samplesMs.length };
}

export interface MeasurementProvenance {
    binaryPath: string;
    importerVersion: string | null;
}

/** Record the source-local CLI binary path + resolved importer package version (R8). */
export function resolveMeasurementProvenance(
    cwd: string,
    binaryPath: string = 'bun run apps/cli/src/index.ts',
): MeasurementProvenance {
    // Walk up from cwd so the harness resolves the importer package whether it
    // runs from the repo root or a nested workspace directory.
    let importerVersion: string | null = null;
    let dir = cwd;
    for (let i = 0; i < 6 && !importerVersion; i++) {
        try {
            const pkg = readFileSync(
                join(dir, 'node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json'),
                'utf8',
            ) as string;
            importerVersion = (JSON.parse(pkg) as { version?: string }).version ?? null;
        } catch {
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    return { binaryPath, importerVersion };
}

/**
 * Compare post-change medians against the baseline. A tab regresses when its
 * post median exceeds the baseline by more than the declared tolerance; the
 * gate is strict — a tab that regresses beyond tolerance is the finding, not an
 * obstacle to be weakened around.
 */
export function assertNoRegression(
    postMs: Partial<Record<HistoryTabId, number>>,
    baseline: Record<HistoryTabId, number> = HISTORY_TAB_BASELINE,
    tolerance: number = LATENCY_NOISE_TOLERANCE_RATIO,
): RegressionResult {
    const results: TabRegression[] = HISTORY_TAB_IDS.map((tab) => {
        const base = baseline[tab];
        const post = postMs[tab];
        if (base == null || post == null) {
            return {
                tab,
                baselineMs: base ?? 0,
                postMs: post ?? 0,
                ratio: 1,
                regressed: false,
                measured: false,
            };
        }
        const ratio = base <= 0 ? Number.POSITIVE_INFINITY : post / base;
        return { tab, baselineMs: base, postMs: post, ratio, regressed: ratio > 1 + tolerance, measured: true };
    });
    return { ok: results.every((r) => !r.regressed), results };
}

if (import.meta.main) {
    const cwd = process.cwd();
    const provenance = resolveMeasurementProvenance(cwd);
    console.log(`History tab latency baseline (derived from E91 Background figures):`);
    for (const tab of HISTORY_TAB_IDS) {
        console.log(`  ${tab.padEnd(10)} ${HISTORY_TAB_BASELINE[tab]} ms`);
    }
    console.log(
        `Protocol: median of ${LATENCY_SAMPLE_COUNT} runs; no-regression tolerance ${LATENCY_NOISE_TOLERANCE_RATIO}.`,
    );
    console.log(`Provenance: binary=${provenance.binaryPath} importer=${provenance.importerVersion ?? 'unknown'}`);
    console.log(
        'NOTE: post-change measurements require the live 1.79M-row corpus; not computed here (see docs/report/).',
    );
    process.exit(0);
}
