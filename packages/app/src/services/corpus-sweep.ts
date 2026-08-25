/**
 * corpus-sweep — measured durable-evidence corpus sweep (feature F93, task 0673).
 *
 * Run: `bun run packages/app/src/services/corpus-sweep.ts [--json]`
 *
 * Runs the completion-gate fallback across every `done` task that lacks a
 * verdict artifact: parses the tracked `## Testing` section with the canonical
 * parser (`parseTesting`) and classifies each task into one of three buckets:
 *
 *   verified                 — no artifact, recoverable rows that aggregate to
 *                              PASS with at least one MET row (the gate's
 *                              definition of verified evidence)
 *   recovered-not-pass       — no artifact, recoverable rows, but not PASS+MET
 *   evidence-not-recoverable — no artifact, no parseable coverage evidence
 *
 * Determinism (task 0673 R2): reads only tracked task files and the run
 * directory — no timestamps, no ordering-dependent aggregation, no network.
 * Re-running on an unchanged tree yields identical counts.
 *
 * Measurement surface, NOT a `spur` CLI noun/verb/flag (ADR-051; task 0673
 * anti-patterns name a test or a one-off script as the surface). It lives in
 * the app package so it uses the canonical fallback parser instead of a
 * reimplementation — the whole point of the measurement (task 0673 R6).
 */
import { join } from 'node:path';
import { resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import { echo } from '@gobing-ai/ts-utils';
import { parseTesting } from './task-record';
import { aggregateVerifyVerdict, type ParseVerdictOutcome } from './verify-verdict';

/** One of the three task-level evidence buckets the fallback classifies into. */
export type SweepBucket = 'verified' | 'recovered-not-pass' | 'evidence-not-recoverable';

/** Per-task fallback classification outcome (one entry per done task without a verdict artifact). */
export interface SweepTaskOutcome {
    wbs: string;
    bucket: SweepBucket;
    /** parseTesting outcome kind. */
    kind: ParseVerdictOutcome['kind'];
    /** Aggregate verdict when the section parsed validly (PASS|PARTIAL|FAIL|UNKNOWN). */
    verdict?: string;
    hasMet: boolean;
}

/** Deterministic aggregate counts plus the per-task outcomes (identical across runs on an unchanged tree). */
export interface CorpusSweepResult {
    doneTasks: number;
    withArtifact: number;
    withoutArtifact: number;
    verified: number;
    recoveredNotPass: number;
    evidenceNotRecoverable: number;
    /** One outcome per done task lacking a verdict artifact, sorted by WBS. */
    outcomes: SweepTaskOutcome[];
}

/**
 * Classify a fallback parse into the task-level evidence buckets (0673 R1).
 *
 * `verified` mirrors `FeatureCheckService.isScenarioVerified` at task level:
 * the stored verdict AND the canonically recomputed aggregate must both be PASS
 * and at least one requirement/AC row must be MET. Any other valid parse is
 * recovered evidence that does not verify; any non-valid parse is the named
 * unrecoverable-evidence state.
 */
export function classifyFallback(parsed: ParseVerdictOutcome): Omit<SweepTaskOutcome, 'wbs'> {
    if (parsed.kind !== 'valid') {
        return { bucket: 'evidence-not-recoverable', kind: parsed.kind, hasMet: false };
    }
    const { verdict } = parsed;
    const rows = [...verdict.requirements, ...verdict.acceptanceCriteria];
    const computed = aggregateVerifyVerdict({
        requirements: verdict.requirements,
        acceptanceCriteria: verdict.acceptanceCriteria,
    });
    const hasMet = rows.some((r) => r.status === 'MET');
    if (verdict.verdict === 'PASS' && computed === 'PASS' && hasMet) {
        return { bucket: 'verified', kind: 'valid', verdict: verdict.verdict, hasMet };
    }
    return { bucket: 'recovered-not-pass', kind: 'valid', verdict: verdict.verdict, hasMet };
}

/** Sweep every done task lacking a verdict artifact, classifying each (0673 R1/R2). */
export async function runCorpusSweep(fs: FileSystem): Promise<CorpusSweepResult> {
    const planning = await resolvePlanningFolders(fs);
    const taskDirs = Object.keys(planning.foldersConfig.folders).map((dir) => fs.resolve(dir));
    const activeTasksDir = fs.resolve(planning.foldersConfig.active_folder);
    if (!taskDirs.includes(activeTasksDir)) taskDirs.unshift(activeTasksDir);

    const outcomes: SweepTaskOutcome[] = [];
    let doneTasks = 0;
    let withArtifact = 0;
    let withoutArtifact = 0;
    const seen = new Set<string>();

    for (const dir of taskDirs) {
        const entries = await fs.readDir(dir);
        for (const fileName of [...entries].sort()) {
            const wbs = fileName.match(/^(\d{4})_.+\.md$/)?.[1];
            if (wbs === undefined) continue;
            if (seen.has(wbs)) continue; // duplicate ids across folders — count once
            seen.add(wbs);
            const path = join(dir, fileName);
            const raw = await fs.readFile(path);
            const doc = MarkdownDocument.parse(raw, 'task');
            const status = (doc.frontmatterData?.status as string | undefined) ?? '';
            if (status !== 'done') continue;
            doneTasks += 1;
            if (await fs.exists(join(fs.resolve('.spur/run'), `${wbs}-verdict.json`))) {
                withArtifact += 1;
                continue;
            }
            withoutArtifact += 1;
            outcomes.push({ wbs, ...classifyFallback(parseTesting(raw, wbs)) });
        }
    }
    outcomes.sort((a, b) => a.wbs.localeCompare(b.wbs));

    return {
        doneTasks,
        withArtifact,
        withoutArtifact,
        verified: outcomes.filter((o) => o.bucket === 'verified').length,
        recoveredNotPass: outcomes.filter((o) => o.bucket === 'recovered-not-pass').length,
        evidenceNotRecoverable: outcomes.filter((o) => o.bucket === 'evidence-not-recoverable').length,
        outcomes,
    };
}

/**
 * Render the sweep result through the output seam (ts-utils `echo`).
 * Separated from the `import.meta.main` entry so it is testable (0673 R1/R6).
 */
export function printSweepResult(result: CorpusSweepResult, json: boolean): void {
    if (json) {
        echo(JSON.stringify(result, null, 2));
        return;
    }
    echo('corpus-sweep (durable-evidence fallback, deterministic):');
    echo(`  done tasks:                 ${result.doneTasks}`);
    echo(`  with verdict artifact:      ${result.withArtifact}`);
    echo(`  without artifact:           ${result.withoutArtifact}`);
    echo(`    verified (PASS+MET):      ${result.verified}`);
    echo(`    recovered, not PASS+MET:  ${result.recoveredNotPass}`);
    echo(`    evidence-not-recoverable: ${result.evidenceNotRecoverable}`);
}

if (import.meta.main) {
    const fs = createNodeFileSystem(process.cwd());
    const result = await runCorpusSweep(fs);
    printSweepResult(result, process.argv.includes('--json'));
}
