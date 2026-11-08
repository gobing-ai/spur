/**
 * Verdict evidence replay (task 1319 R4).
 *
 * A derived `PASS` is only as good as the evidence behind it, and until now nothing re-read that
 * evidence: `spur task verdict` trusted the reviewer's prose. The credit-sentry post-mortem showed
 * the cost — 7 of 7 already-`done` tasks failed an independent re-verification.
 *
 * Replay is deliberately narrow: it executes the *test files* the verdict rows cite (backticked
 * `path:line` anchors, the grammar `spur task migrate-anchors` qualifies), never arbitrary prose
 * commands. That keeps it deterministic, cheap (≤5 files, 120 s each, run from the owning workspace
 * through the `test-changed` binding; a coverage-threshold workspace is skipped, not run) and impossible to turn into a second full gate — the
 * host-contention failure mode task 1127 measured.
 */
import type { BuilderConfig } from '@gobing-ai/spur-config';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
} from '@gobing-ai/ts-runtime';
import { renderScoped, resolveAction } from './sdlc-actions';
import { extractBacktickLineAnchors } from './task-check';

/** Most cited files a single replay will execute (1319 R4). */
export const REPLAY_MAX_FILES = 5;
/** Per-file bound; a cited suite that cannot finish in two minutes is not evidence (1319 R4). */
export const REPLAY_TIMEOUT_MS = 120_000;

/** The part of a verdict row replay reads. */
export interface ReplayRow {
    id?: string;
    evidence?: string;
}

/** One cited file that failed to hold up its claim. */
export interface ReplayFinding {
    anchor: string;
    file: string;
    exitCode?: number | null;
    timedOut?: boolean;
    missing?: boolean;
}

/** Replay outcome: the files it ran, the files it deliberately skipped, and its findings. */
export interface ReplayResult {
    files: string[];
    ran: Array<{ file: string; exitCode: number | null }>;
    /** Files that cannot be replayed honestly here (e.g. a per-file coverage threshold). */
    skipped: Array<{ file: string; reason: string }>;
    findings: ReplayFinding[];
}

/** Options for {@link replayCitedTests}. */
export interface VerdictReplayOptions {
    /** Repo root the anchors are relative to; defaults to the process cwd. */
    cwd?: string;
    /** Project action binding; the `test-changed` binding is rendered from it (A92). */
    builder?: BuilderConfig;
    /** Executor seam (tests inject one); defaults to the real node executor. */
    executor?: Pick<ProcessExecutor, 'run'>;
    /** Filesystem seam (cited-file existence, workspace bunfig read); defaults to the node backend. */
    fs?: Pick<FileSystem, 'exists' | 'readFile'>;
    /** Per-file bound override. */
    timeoutMs?: number;
    /** File-cap override (tests). */
    maxFiles?: number;
}

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const COVERAGE_THRESHOLD_PATTERN = /^\s*coverageThreshold\s*=/m;

/** Distinct cited test files mapped to their first citing anchor, in first-cited order, capped. */
function citedTestAnchors(rows: ReadonlyArray<ReplayRow>, max: number): Map<string, string> {
    const seen = new Map<string, string>();
    for (const row of rows) {
        for (const anchor of extractBacktickLineAnchors(row.evidence ?? '')) {
            if (!TEST_FILE_PATTERN.test(anchor.path) || seen.has(anchor.path)) continue;
            seen.set(anchor.path, anchor.raw);
        }
    }
    return new Map([...seen].slice(0, max));
}

/** Distinct cited test files, in first-cited order, capped (1319 R4). */
export function citedTestFiles(rows: ReadonlyArray<ReplayRow>, max: number = REPLAY_MAX_FILES): string[] {
    return [...citedTestAnchors(rows, max).keys()];
}

/**
 * The workspace owning a cited path: `apps/<x>`, `packages/<x>`, or `.` for root-level files.
 * Root-level suites (`scripts/**`) run from the repo root, whose bunfig supplies the preload.
 */
export function replayWorkspace(file: string): string {
    const parts = file.split('/');
    if (parts.length >= 3 && (parts[0] === 'apps' || parts[0] === 'packages')) return `${parts[0]}/${parts[1]}`;
    return '.';
}

/**
 * Execute the verdict's cited test files and report every file that does not hold up.
 * Sequential on purpose: at most five files, so parallelism buys nothing but contention.
 */
export async function replayCitedTests(
    rows: ReadonlyArray<ReplayRow>,
    options: VerdictReplayOptions = {},
): Promise<ReplayResult> {
    const cwd = options.cwd ?? process.cwd();
    const timeoutMs = options.timeoutMs ?? REPLAY_TIMEOUT_MS;
    const anchors = citedTestAnchors(rows, options.maxFiles ?? REPLAY_MAX_FILES);
    const files = [...anchors.keys()];
    const executor = options.executor ?? new NodeProcessExecutor();
    const fileSystem = options.fs ?? createNodeFileSystem();
    const resolved = resolveAction(options.builder, 'test-changed');
    const template =
        resolved.kind === 'command'
            ? resolved.command
            : resolved.kind === 'composite'
              ? resolved.steps.join(' && ')
              : '';
    const ran: Array<{ file: string; exitCode: number | null }> = [];
    const skipped: Array<{ file: string; reason: string }> = [];
    const findings: ReplayFinding[] = [];
    const thresholdByWorkspace = new Map<string, boolean>();

    for (const file of files) {
        const anchor = anchors.get(file) ?? file;
        const exists = await fileSystem.exists(`${cwd}/${file}`);
        if (!exists) {
            findings.push({ anchor, file, missing: true });
            continue;
        }
        // No `test-changed` binding for this project means the file cannot be replayed at all — that
        // is a capability gap, not evidence against the verdict, so it is neither a finding nor a
        // silent pass: the file simply does not appear in `ran`.
        if (template.length === 0) continue;
        const workspace = replayWorkspace(file);
        // Bun applies `coverageThreshold` per measured file, so a passing suite run under it can
        // exit 1 with `0 fail` (the root bunfig does). That exit is not evidence against the verdict,
        // and Bun 1.4 has no CLI switch to turn coverage off — skip it visibly instead.
        let threshold = thresholdByWorkspace.get(workspace);
        if (threshold === undefined) {
            threshold = await declaresCoverageThreshold(fileSystem, `${cwd}/${workspace}/bunfig.toml`);
            thresholdByWorkspace.set(workspace, threshold);
        }
        if (threshold) {
            skipped.push({ file, reason: `coverageThreshold in ${workspace}/bunfig.toml` });
            continue;
        }
        const path = workspace === '.' ? file : file.slice(workspace.length + 1);
        const command = renderScoped(template, { workspace, paths: [path] });
        const result = await executor.run({
            command: 'sh',
            args: ['-c', command],
            cwd,
            forceBuffered: true,
            rejectOnError: false,
            timeout: timeoutMs,
        });
        const exitCode = result.exitCode ?? null;
        ran.push({ file, exitCode });
        if (result.outcome === 'timeout') findings.push({ anchor, file, timedOut: true, exitCode });
        else if (exitCode !== 0) findings.push({ anchor, file, exitCode });
    }

    return { files, ran, skipped, findings };
}

/** True when the bunfig exists and declares a coverage threshold; unreadable counts as no. */
async function declaresCoverageThreshold(
    fileSystem: Pick<FileSystem, 'exists' | 'readFile'>,
    bunfigPath: string,
): Promise<boolean> {
    try {
        if (!(await fileSystem.exists(bunfigPath))) return false;
        return COVERAGE_THRESHOLD_PATTERN.test(await fileSystem.readFile(bunfigPath));
    } catch {
        return false;
    }
}

/**
 * The verdict command's replay report: one summary line plus one line per finding. Lives here (not
 * in the command) so the wording is unit-tested and the command stays a thin caller (1319 R4).
 */
export function formatReplayReport(replay: ReplayResult): { summary: string; findings: string[] } {
    return {
        summary: `Replay: ${replay.files.length} cited test file(s), ${replay.findings.length} finding(s)${
            replay.skipped.length > 0 ? `, ${replay.skipped.length} skipped` : ''
        }`,
        findings: replay.findings.map(
            (finding) =>
                `  ${finding.anchor}: ${
                    finding.missing
                        ? 'missing'
                        : finding.timedOut
                          ? 'timed out'
                          : `exit ${finding.exitCode ?? 'unknown'}`
                }`,
        ),
    };
}
