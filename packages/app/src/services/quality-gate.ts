/**
 * Quality-gate service — the shared retry/bounded-findings gate behind the task-pipeline
 * test-gate wrappers (task 0823, feature I21, governance §1.2 composition budgets). Task 1006
 * R1 relocated the logic here from `plugins/sp/scripts/quality-gate.ts`; script-absorption PR-3
 * retired that script and moved its argv/env glue here too ({@link qualityGateMain}), reached as
 * `spur task gate <wbs> <mode>`.
 *
 * Reproduces the former task-pipeline `test:onEnter` and `test-recheck:onEnter` shell
 * pipelines:
 *
 * - bounded retry loop (`MAX_GATE_ATTEMPTS`) around `qualityGateCmd` with retry sleep
 *   `SPUR_QUALITY_GATE_RETRY_DELAY_MS` (default `RETRY_DELAY_MS_DEFAULT`)
 * - transient-failure detection (`isTransientLock`) re-runs the gate without burning an
 *   attempt, up to the same bounded loop
 * - findings extraction from the merged gate log (`extractFindings`) truncated to
 *   `MAX_FINDINGS` anchors so action payloads stay small
 * - coverage-tier scan (`scanCoverageShortfalls`) driven by `bunfig.toml` thresholds
 *   (0862 R2) parsed by `parseCoverageThreshold`
 * - host-wide lock (`acquireGateLock`, task 1127, restored by D65 1235) around the full-gate
 *   attempt loop of `run` AND `recheck`, because both execute the same `qualityGateCmd`
 *
 * Modes:
 * - `run`    full tier: the caller's `qualityGateCmd`, retried and bounded
 * - `recheck` same but skips the receipt preconditions (`receiptFailsAtDigest`)
 * - `light`  changed-scope tier (task 0939, ADR-124): the resolved lint action on the changed files,
 *            typecheck only when a workspace file changed (`planLightChecks` over
 *            `lightScope`); sub-check failures carry bounded findings
 * - `status` print `{reuse, reason}` for the task's receipt and exit 0
 *
 * Check receipts (task 0939, ADR-124; D65 1234): `run` and `recheck` write
 * `.spur/run/<wbs>-check-receipt.json` keyed by the gate's OWN git tree hash —
 * {@link captureGateGitTree}: `git read-tree HEAD`, `git add -A` minus `docs/tasks*` /
 * `docs/features*` through a throwaway alternate index, `git write-tree`. A later invocation whose
 * tree hash equals the receipt's reuses it instead of re-running the full suite, so a corpus-only
 * edit (task/feature prose) keeps the PASS while any other tracked or untracked change drops it.
 * The hash is computed here and never supplied by a caller: ADR-140 retires the `proofDigest`
 * chain, so there is no `--proof-digest` flag and no env input. `status` reports the verdict for
 * the task result without running anything.
 *
 * Merged log note: the gate command's stdout+stderr go to ONE file descriptor
 * (`sh -c "cmd" > log 2>&1`) because findings/tail extraction and the retry loop both depend on
 * stream order, which a captured-stdout+stderr seam cannot reproduce.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readdirSync,
    readFileSync,
    rmdirSync,
    rmSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BuilderConfig } from '@gobing-ai/spur-config';
import { getEnvVar, getEnvVars } from '@gobing-ai/ts-utils';
import { DEFAULT_EXCLUDE_GLOBS } from '../workflow/proof-input-fingerprint';
import { renderScoped, resolveAction, type ScopedValues } from './sdlc-actions';

/** Hard cap on lock-retry attempts before `run` gives up (the old shell `for i in 1..5`). */
export const MAX_GATE_ATTEMPTS = 5;
/** Findings cap for the bounded failure summary (0772 R1) and the findings file. */
export const MAX_FINDINGS = 20;
/** Base delay between lock retries, in milliseconds. */
export const RETRY_DELAY_MS_DEFAULT = 10_000;
/** Env var overriding the base lock-retry delay (milliseconds). */
export const RETRY_DELAY_MS_ENV = 'SPUR_QUALITY_GATE_RETRY_DELAY_MS';

/**
 * Env/var naming the per-spawn gate timeout (milliseconds). `command.gate` exports workflow vars as
 * env, so the pipeline's `gateTimeoutMs` var reaches this resolver with no new flag (1319 R1).
 */
export const GATE_TIMEOUT_MS_ENV = 'gateTimeoutMs';
/** Default per-spawn gate timeout: 15 minutes — above a healthy full gate, far below a hang. */
export const GATE_TIMEOUT_MS_DEFAULT = 900_000;

/** Result of resolving the per-spawn gate timeout: a positive bound, or the usage error to print. */
export type GateTimeoutResolution = { ok: true; ms: number } | { ok: false; error: string };

/**
 * Resolve the per-spawn gate timeout (1319 R1). Missing means the default; a malformed value is a
 * usage error (exit 2) rather than a silent default — an operator who tried to bound the gate must
 * never end up with an unbounded one.
 */
export function resolveGateTimeoutMs(env: QualityGateEnv): GateTimeoutResolution {
    const raw = env[GATE_TIMEOUT_MS_ENV];
    if (raw === undefined || raw.trim() === '') return { ok: true, ms: GATE_TIMEOUT_MS_DEFAULT };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return { ok: false, error: `quality-gate: ${GATE_TIMEOUT_MS_ENV} must be a positive number, got "${raw}"` };
    return { ok: true, ms: Math.trunc(parsed) };
}

/** The timeout one gate run uses: the option override wins, then env, then the default. */
function gateTimeoutMsFor(env: QualityGateEnv, options: QualityGateOptions): number {
    if (options.gateTimeoutMs !== undefined && options.gateTimeoutMs > 0) return options.gateTimeoutMs;
    const resolved = resolveGateTimeoutMs(env);
    return resolved.ok ? resolved.ms : GATE_TIMEOUT_MS_DEFAULT;
}

/** Transient SQLite lock/busy markers that justify a gate retry (same as the former grep -Eq). */
export const LOCKED_PATTERN = /SQLiteError: database is locked|SQLite database .*is busy|SQLITE_BUSY/;

/** `file.ext:line` anchor extraction, mirroring the former grep -oE. */
export const FINDINGS_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;

/**
 * the runner's coverage table row: `File | % Funcs | % Lines | Uncovered Line #s` (0862 R2).
 * Group 4 (uncovered line numbers) may be empty — a fully covered file has no entry.
 */
export const COVERAGE_ROW_PATTERN = /^\s*(\S+\.[A-Za-z]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\S*)/;

/** Env/argv inputs the gate runs on: the wbs-scoped commands and probe. */
export interface QualityGateEnv {
    wbs: string;
    qualityGateCmd?: string;
    gateProbeCmd?: string;
    /** Receipt run identity; `pipeline-<wbs>` when absent (task-pipeline convention). */
    runId?: string;
    /** Engine-provided run identity when command.gate forwards workflow vars. */
    __runId?: string;
    [key: string]: string | undefined;
}

/** Optional gate knobs (cwd override and the tree-capture seam for tests). */
export interface QualityGateOptions {
    /** Base directory for `.spur/run`; defaults to the process cwd (CLI behavior). */
    cwd?: string;
    /** Project action binding for the light tier (feature A92); absent means the default preset. */
    builder?: BuilderConfig;
    /**
     * Per-spawn gate timeout override (1319 R1); the CLI path resolves it from env instead. Absent
     * falls back to {@link GATE_TIMEOUT_MS_DEFAULT}.
     */
    gateTimeoutMs?: number;
    /**
     * Test seam for {@link captureGateGitTree} (the receipt identity). Only the capture is
     * injectable — the reuse decision itself always compares against the captured tree, so a
     * caller-supplied digest can never reach the receipt (1234 R2).
     */
    captureGitTree?: GitTreeCaptureFn;
}

/** The gate's own receipt identity: the git tree hash of the tracked tree. */
export type GitTreeCapture = { ok: true; tree: string } | { ok: false; error: string };

/** A tree capture (injectable for tests; {@link captureGateGitTree} is the real one). */
export type GitTreeCaptureFn = (cwd: string) => GitTreeCapture;

/** Where the gate wrote its run artifacts (log, findings, status, attempt, receipt). */
export interface QualityGateResult {
    status: 'PASS' | 'FAIL' | 'BLOCKED';
    attempts: number;
    logFile: string;
    findingsFile: string;
    statusFile: string;
    attemptFile: string;
    /** Written only when the gate could bind the receipt to a tree (0939 R2, 1234). */
    receiptFile?: string;
}

/** True when the gate attempt's output is a transient SQLite lock/busy failure (retryable). */
export function isTransientLock(attemptOutput: string): boolean {
    return LOCKED_PATTERN.test(attemptOutput);
}

/** Unique anchors, code-unit sorted, capped at MAX_FINDINGS, each followed by one space. */
export function extractFindings(logText: string): string {
    const found = new Set<string>();
    for (const match of logText.matchAll(FINDINGS_PATTERN)) found.add(match[0]);
    return [...found]
        .sort()
        .slice(0, MAX_FINDINGS)
        .map((anchor) => `${anchor} `)
        .join('');
}

/** `tail -n <count>` on POSIX text: last count lines, newline-terminated. */
export function tailLines(text: string, count: number): string {
    const lines = text.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const tail = lines.slice(Math.max(0, lines.length - count));
    return tail.length === 0 ? '' : `${tail.join('\n')}\n`;
}

/** The retry progress line appended to the gate log between lock-retry attempts. */
export function retryMessage(attempt: number): string {
    return `quality gate: database is locked; retrying (${attempt}/${MAX_GATE_ATTEMPTS}) in 10s\n`;
}

/** Per-axis coverage floor from `bunfig.toml`; a missing key leaves that axis unchecked. */
export interface CoverageThreshold {
    functions?: number;
    lines?: number;
}

/** Parse once, keeping absent settings distinct from unavailable threshold diagnostics. */
function parseCoverageThresholdResult(bunfigText: string): {
    threshold: CoverageThreshold | null;
    diagnostic: string | null;
} {
    const unavailable = 'quality gate: bunfig.toml:1 threshold diagnostics are unavailable';
    let config: object;
    try {
        config = Bun.TOML.parse(bunfigText);
    } catch {
        return { threshold: null, diagnostic: `${unavailable}; fix malformed TOML` };
    }
    // The legacy root snippet applies only when no test namespace exists.
    const namespace = 'test' in config ? config.test : config;
    if (typeof namespace !== 'object' || namespace === null || !('coverageThreshold' in namespace)) {
        return { threshold: null, diagnostic: null };
    }
    const raw = namespace.coverageThreshold;
    const invalid = `${unavailable}; set coverageThreshold functions/lines to finite numbers between 0 and 1`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { threshold: null, diagnostic: invalid };
    }
    const threshold: CoverageThreshold = {};
    let invalidAxis = false;
    for (const axis of ['functions', 'lines'] as const) {
        if (!(axis in raw)) continue;
        const value = (raw as Record<string, unknown>)[axis];
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1) {
            threshold[axis] = value;
        } else {
            invalidAxis = true;
        }
    }
    const result = threshold.functions === undefined && threshold.lines === undefined ? null : threshold;
    return { threshold: result, diagnostic: invalidAxis || result === null ? invalid : null };
}

/**
 * Read finite functions/lines floors in [0, 1] from native TOML, preferring the test namespace.
 * The legacy root snippet remains supported; absent, malformed or wholly invalid settings return null.
 */
export function parseCoverageThreshold(bunfigText: string): CoverageThreshold | null {
    return parseCoverageThresholdResult(bunfigText).threshold;
}

/**
 * One `quality gate: coverage shortfall <path>:<line> funcs=<f> lines=<l>` line per distinct table
 * row below either axis (thresholds are fractions, table numbers are percentages). `line` is the
 * first number of the uncovered column, else `1`.
 */
export function scanCoverageShortfalls(logText: string, threshold: CoverageThreshold): string[] {
    const shortfalls = new Map<string, string>();
    for (const line of logText.split('\n')) {
        const row = line.match(COVERAGE_ROW_PATTERN);
        if (!row) continue;
        const [, path, funcs, lines, uncovered] = row;
        if (!path || path === 'All files' || shortfalls.has(path)) continue;
        const belowFunctions =
            threshold.functions !== undefined && Number.parseFloat(funcs ?? '') < threshold.functions * 100;
        const belowLines = threshold.lines !== undefined && Number.parseFloat(lines ?? '') < threshold.lines * 100;
        if (!belowFunctions && !belowLines) continue;
        const firstUncovered = uncovered?.match(/\d+/)?.[0] ?? '1';
        shortfalls.set(
            path,
            `quality gate: coverage shortfall ${path}:${firstUncovered} funcs=${funcs} lines=${lines}`,
        );
    }
    return [...shortfalls.values()];
}

// ─── Check receipts + light tier (task 0939, ADR-124) ───

export const RECEIPT_SCHEMA_VERSION = 'check-receipt/v1';

/** Receipt tier: the full gate, or the light changed-file gate (0939). */
export type ReceiptTier = 'full' | 'light';
/** A single check's verdict inside a receipt. */
export type CheckStatus = 'PASS' | 'FAIL';
/** Frozen non-reuse reasons of `status` mode (0939 R3). */
export type ReceiptReuseReason = 'missing' | 'failed' | 'stale' | 'light-only';

/** One row of a check receipt: the command that ran and its verdict (0939 R1). */
export interface CheckReceiptRow {
    id: string;
    cmd: string;
    status: CheckStatus;
    durationMs: number;
    logPath: string;
}

/** A tier's check receipt: schema version, tier, verdict, and the check rows (0939 R1). */
export interface CheckReceipt {
    schemaVersion: 'check-receipt/v1';
    wbs: string;
    runId: string;
    tier: ReceiptTier;
    inputDigest: string;
    checks: CheckReceiptRow[];
    status: CheckStatus;
    completedAt: string;
    /** Host-wide lock wait before the gate started (1127 R3); omitted when the tier is lockless. */
    queueWaitMs?: number;
    /** Wall time of the gate command itself, excluding lock wait and probe (1127 R3). */
    gateRuntimeMs?: number;
}

/** How an existing receipt compares to the current input digest (0939 R2/R3). */
export interface ReceiptReadStatus {
    reuse: boolean;
    /** `'ok'` only when reuse holds; otherwise one of the frozen reasons. */
    reason: ReceiptReuseReason | 'ok';
}

/** Inputs for building a receipt: tier, per-check rows, and the bound proof digest. */
export interface BuildReceiptInput {
    wbs: string;
    runId: string;
    tier: ReceiptTier;
    inputDigest: string;
    checks: CheckReceiptRow[];
    /** ISO-8601 completion timestamp; injected so receipts stay reproducible in tests. */
    completedAt: string;
    /** Host-wide lock wait; full tier only (1127 R3). */
    queueWaitMs?: number;
    /** Gate command wall time excluding lock wait and probe; full tier only (1127 R3). */
    gateRuntimeMs?: number;
}

/** Stamp `check-receipt/v1`; the overall status derives from the rows (no rows → PASS). */
export function buildReceipt(input: BuildReceiptInput): CheckReceipt {
    return {
        schemaVersion: RECEIPT_SCHEMA_VERSION,
        wbs: input.wbs,
        runId: input.runId,
        tier: input.tier,
        inputDigest: input.inputDigest,
        checks: input.checks,
        status: input.checks.every((row) => row.status === 'PASS') ? 'PASS' : 'FAIL',
        completedAt: input.completedAt,
        // JSON.stringify drops undefined values — lockless tiers keep receipts field-free.
        queueWaitMs: input.queueWaitMs,
        gateRuntimeMs: input.gateRuntimeMs,
    };
}

/** Parse a check receipt; `null` when absent, unreadable, or corrupt. */
function readReceipt(receiptPath: string): CheckReceipt | null {
    try {
        return JSON.parse(readFileSync(receiptPath, 'utf8')) as CheckReceipt;
    } catch {
        return null;
    }
}

/**
 * 0940 R2 — no-progress recheck shape: a full-tier FAIL receipt bound to the current proof-input
 * digest, i.e. the fix pass changed nothing tracked and the full chain can only reproduce the
 * failure. `readReceiptStatus` cannot express this decision (a FAIL receipt is `reason: 'failed'`
 * at every digest), so the two fields are compared directly. Light-tier receipts and any digest
 * mismatch never skip — the probe and full gate run unchanged (anti-pattern: reusing a light
 * receipt, or comparing against a digest captured before `test-fix`).
 */
export function receiptFailsAtDigest(receipt: CheckReceipt | null, currentDigest: string): boolean {
    return (
        receipt !== null &&
        receipt.schemaVersion === RECEIPT_SCHEMA_VERSION &&
        receipt.tier === 'full' &&
        receipt.status === 'FAIL' &&
        currentDigest.length > 0 &&
        receipt.inputDigest === currentDigest
    );
}

/**
 * 1198 R1 — count the timeout-shaped failure pair in a gate log. Bun prints a per-test timeout as
 * a `(fail) <name> [<n>ms]` line followed by `^ this test timed out after <n>ms.`; an assertion
 * failure carries the `(fail)` line but no timeout line, so the two counts diverge.
 */
function countTimeoutShapedFailures(text: string): { fails: number; timeouts: number } {
    let fails = 0;
    let timeouts = 0;
    for (const line of text.split('\n')) {
        if (line.startsWith('(fail) ')) fails += 1;
        if (/this test timed out after \d+ms/.test(line)) timeouts += 1;
    }
    return { fails, timeouts };
}

/**
 * 1198 R1 — a gate log whose failures are exclusively per-test timeouts (host contention) rather
 * than deterministic defects: at least one `(fail) ` line and exactly as many timeout lines as
 * failures. Any non-timeout failure, no `(fail) ` line, or an empty/missing log is not
 * timeout-shaped (R4), so the 0940 no-progress skip is unchanged for those shapes.
 */
export function isTimeoutShapedLog(text: string): boolean {
    const { fails, timeouts } = countTimeoutShapedFailures(text);
    return fails > 0 && fails === timeouts;
}

/** 1198 R2 — the input digest whose one contended retry is already spent, or '' when never spent. */
function readContendedRetryDigest(markerPath: string): string {
    try {
        return readFileSync(markerPath, 'utf8').trim();
    } catch {
        return '';
    }
}

/**
 * Reuse verdict for `.spur/run/<wbs>-check-receipt.json` against the git tree hash the gate
 * computed for this invocation. Evaluated missing → failed → stale (digest or owner) → light-only;
 * reuse requires `PASS` + `tier: full` + the same tree + the same wbs, so light rows can never
 * flip a receipt reusable (0939 invariant) and a receipt copied from another task never binds
 * (1234).
 */
export function readReceiptStatus(receiptPath: string, currentDigest: string, wbs: string): ReceiptReadStatus {
    const receipt = readReceipt(receiptPath);
    if (receipt === null || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
        return { reuse: false, reason: 'missing' };
    }
    if (receipt.status !== 'PASS') return { reuse: false, reason: 'failed' };
    if (currentDigest.length === 0 || receipt.inputDigest !== currentDigest || receipt.wbs !== wbs) {
        return { reuse: false, reason: 'stale' };
    }
    if (receipt.tier !== 'full') return { reuse: false, reason: 'light-only' };
    if (
        !Array.isArray(receipt.checks) ||
        receipt.checks.length === 0 ||
        receipt.checks.some(
            (row) =>
                row === null ||
                typeof row !== 'object' ||
                row.status !== 'PASS' ||
                typeof row.cmd !== 'string' ||
                row.cmd.trim().length === 0,
        )
    ) {
        return { reuse: false, reason: 'failed' };
    }
    return { reuse: true, reason: 'ok' };
}

/**
 * The gate's own reuse decision (1234 R2), over the tree it captured itself.
 *
 * - no receipt file → `readReceiptStatus` alone (nothing to reuse, and no capture is paid).
 * - capture cannot run (not a git repository, unborn HEAD) → reuse refused; `refusal` names why,
 *   so the caller logs `check.reuse-refused` and runs the gate instead of trusting a receipt.
 * - otherwise → `readReceiptStatus` against that tree and this wbs.
 */
export interface ReceiptReuseDecision {
    readonly reuse: boolean;
    readonly receiptStatus: ReceiptReadStatus;
    /** Present only when the capture could not bind a tree — never a digest disagreement. */
    readonly refusal?: string;
}

/**
 * Decide whether a run may reuse its check receipt. The tree is captured by the gate and passed in,
 * so no caller-supplied digest can trigger reuse (ADR-140 retires `proofDigest`).
 */
export function resolveReceiptReuse(receiptPath: string, wbs: string, capture: GitTreeCapture): ReceiptReuseDecision {
    if (!existsSync(receiptPath)) {
        return { reuse: false, receiptStatus: { reuse: false, reason: 'missing' } };
    }
    if (!capture.ok) {
        return {
            reuse: false,
            receiptStatus: { reuse: false, reason: 'stale' },
            refusal: `git tree capture failed: ${capture.error}`,
        };
    }
    const receipt = readReceipt(receiptPath);
    if (receipt !== null && receipt.schemaVersion === RECEIPT_SCHEMA_VERSION && receipt.wbs !== wbs) {
        // A receipt at this wbs's path that belongs to another task is not this task's evidence.
        return {
            reuse: false,
            receiptStatus: { reuse: false, reason: 'stale' },
            refusal: `receipt belongs to ${String(receipt.wbs)}, not ${wbs}`,
        };
    }
    const receiptStatus = readReceiptStatus(receiptPath, capture.tree, wbs);
    return { reuse: receiptStatus.reuse, receiptStatus };
}

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Files/workspaces a light gate should check, derived from changed tracked files (0939). */
export interface LightScope {
    files: string[];
    workspaces: string[];
    tests: string[];
    /**
     * Set when affected-scope selection refuses the tier (1322 R3): the change set touches a
     * shared package with workspace dependents, or a path no workspace owns. The value is the
     * rationale; the caller falls back to the full suite (the light tier refuses to decide).
     */
    fallback?: string;
}

/** One workspace's identity plus its internal package dependencies, as read from its package.json (1322 R3). */
export interface WorkspaceInfo {
    /** Workspace directory, repo-relative (`apps/cli`). */
    dir: string;
    /** The workspace package's own name (`@scope/pkg`); absent names are ignored. */
    name: string;
    /** Package names this workspace declares (dependencies + devDependencies + peerDependencies). */
    dependencies: string[];
}

/**
 * The workspace dependency graph for affected-scope selection (1322 R3): package name → owning
 * workspace dir, and package name → the workspace dirs that depend on it. A workspace whose
 * package has dependents is *shared* — changes to it can break consumers the light tier would
 * not check, so selection falls back to the full suite.
 */
export interface WorkspaceGraph {
    byName: Map<string, string>;
    dependents: Map<string, string[]>;
    /**
     * Set when the root `workspaces` field uses a glob shape this reader cannot expand (1326):
     * any pattern containing `*` that is not the `dir/*` form. The maps are then empty not
     * because the repo has no workspaces but because the graph cannot see them — selection
     * must refuse the tier (fallback) instead of classifying nothing.
     */
    unsupported?: string;
}

/** Pure graph constructor over workspace descriptors (tests inject; the fs reader is real). */
export function workspaceGraphFrom(workspaces: WorkspaceInfo[]): WorkspaceGraph {
    const byName = new Map<string, string>();
    for (const workspace of workspaces) {
        if (workspace.name.length > 0) byName.set(workspace.name, workspace.dir);
    }
    const dependents = new Map<string, string[]>();
    for (const workspace of workspaces) {
        for (const dependency of new Set(workspace.dependencies)) {
            if (dependency === workspace.name || !byName.has(dependency)) continue;
            const dirs = dependents.get(dependency) ?? [];
            if (!dirs.includes(workspace.dir)) dirs.push(workspace.dir);
            dependents.set(dependency, dirs);
        }
    }
    return { byName, dependents };
}

/** The workspace dirs that depend on the package owned by `dir` (empty for leaf packages). */
export function dependentsOf(graph: WorkspaceGraph, dir: string): string[] {
    for (const [name, owner] of graph.byName) {
        if (owner !== dir) continue;
        return graph.dependents.get(name) ?? [];
    }
    return [];
}

function workspaceDependenciesOf(abs: (p: string) => string, dir: string): { name: string; dependencies: string[] } {
    let name = '';
    const dependencies: string[] = [];
    try {
        const pkg = JSON.parse(readFileSync(abs(`${dir}/package.json`), 'utf8')) as {
            name?: unknown;
            dependencies?: Record<string, unknown>;
            devDependencies?: Record<string, unknown>;
            peerDependencies?: Record<string, unknown>;
        };
        if (typeof pkg.name === 'string') name = pkg.name;
        for (const section of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
            if (section !== null && typeof section === 'object') dependencies.push(...Object.keys(section));
        }
    } catch {
        // unreadable package.json — the workspace contributes no identity
    }
    return { name, dependencies };
}

/**
 * fs-backed graph reader (1322 R3): the root package.json's `workspaces` globs (`apps/*`,
 * `packages/*`, or literal dirs) expand to workspace dirs; each contributes its package name and
 * internal dependency edges. Any unreadable root or workspace is skipped; a graph with no
 * workspaces classifies nothing (legacy behavior — selection never falls back on a repo the
 * graph cannot see). A glob shape the reader cannot expand (e.g. yarn-classic `packages/**`)
 * sets `unsupported` (1326) so selection refuses the tier instead of silently yielding an
 * empty graph whose shared-package fallback can never fire.
 */
export function readWorkspaceGraph(cwd: string | undefined): WorkspaceGraph {
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const info: WorkspaceInfo[] = [];
    let globs: string[] = [];
    try {
        const root = JSON.parse(readFileSync(abs('package.json'), 'utf8')) as { workspaces?: unknown };
        const declared = Array.isArray(root.workspaces)
            ? root.workspaces
            : (root.workspaces as { packages?: unknown } | undefined)?.packages;
        if (Array.isArray(declared)) globs = declared.filter((g): g is string => typeof g === 'string');
    } catch {
        return { byName: new Map(), dependents: new Map() };
    }
    const unsupported = globs.find((glob) => glob.includes('*') && (!glob.endsWith('/*') || glob === '/*'));
    if (unsupported !== undefined) {
        return {
            byName: new Map(),
            dependents: new Map(),
            unsupported: `workspaces glob ${JSON.stringify(unsupported)} is not a supported shape (only \`dir/*\` globs and literal dirs expand)`,
        };
    }
    const dirs = new Set<string>();
    for (const glob of globs) {
        if (glob.endsWith('/*')) {
            const parent = glob.slice(0, -2);
            let entries: string[] = [];
            try {
                entries = readdirSync(abs(parent));
            } catch {
                continue;
            }
            for (const entry of entries) {
                if (existsSync(abs(`${parent}/${entry}/package.json`))) dirs.add(`${parent}/${entry}`);
            }
        } else if (existsSync(abs(`${glob}/package.json`))) {
            dirs.add(glob);
        }
    }
    for (const dir of [...dirs].sort()) {
        const { name, dependencies } = workspaceDependenciesOf(abs, dir);
        info.push({ dir, name, dependencies });
    }
    return workspaceGraphFrom(info);
}

/**
 * The workspace a changed file belongs to: the shortest directory prefix below the repo root
 * that holds a package.json (`apps/*`, `packages/*`). Null for root-level files, which no
 * workspace owns. Pure via the injected `exists` predicate.
 */
function workspaceOf(file: string, exists: (p: string) => boolean): string | null {
    const segments = file.split('/');
    for (let depth = 1; depth < segments.length; depth++) {
        const prefix = segments.slice(0, depth).join('/');
        if (exists(`${prefix}/package.json`)) return prefix;
    }
    return null;
}

/**
 * Light-tier scope from changed repo-relative paths: every touched workspace plus the related
 * tests. `<ws>/src/**x.ts` maps to `<ws>/tests/**x.test.ts` by filename (refine decision —
 * deterministic and cheap; the import graph is not consulted), and a changed `*.test.ts` under a
 * workspace includes itself. The full tier stays the safety net for everything the mapping
 * misses. Unmapped-but-existing candidates are dropped by the `exists` check.
 *
 * With a `graph` (1322 R3) selection also refuses the tier — it returns a `fallback` rationale —
 * when any changed file is owned by a shared package (its package has workspace dependents) or by
 * no workspace at all (and is not a `plugins/sp/**` path, which the 1142 mapping owns). Without a
 * graph the mapping behaves exactly as before (no fallback classification), so legacy callers and
 * fixtures keep today's results.
 */
export function lightScope(
    changedFiles: string[],
    exists: (p: string) => boolean = existsSync,
    graph?: WorkspaceGraph,
): LightScope {
    const files: string[] = [];
    const workspaces = new Set<string>();
    const tests = new Set<string>();
    for (const file of changedFiles) {
        files.push(file);
        // Task 1142 R2: Plugin prose changes map to their structure tests.
        // A changed path under plugins/sp/{skills,commands,agents,references}/** adds
        // plugins/sp/tests/skill-structure.test.ts to the plugins/sp workspace's tests.
        // Under plugins/sp/commands/** it also adds scripts/commands/flag-contract-parity.test.ts (moved
        // out of plugins/sp/tests by A9 W1; colocated, so it runs from the `scripts` workspace).
        // A changed plugins/sp/scripts/<x>.ts maps to plugins/sp/tests/<x>.test.ts when that file exists.
        if (file.startsWith('plugins/sp/')) {
            const rest = file.slice('plugins/sp/'.length);
            let matched = false;
            if (
                rest.startsWith('skills/') ||
                rest.startsWith('commands/') ||
                rest.startsWith('agents/') ||
                rest.startsWith('references/')
            ) {
                const structTest = 'plugins/sp/tests/skill-structure.test.ts';
                if (exists(structTest)) {
                    tests.add(structTest);
                    matched = true;
                }
                if (rest.startsWith('commands/')) {
                    const flagTest = 'scripts/commands/flag-contract-parity.test.ts';
                    if (exists(flagTest)) {
                        tests.add(flagTest);
                        matched = true;
                    }
                }
            } else if (rest.startsWith('scripts/')) {
                const scriptBase = rest.slice('scripts/'.length).replace(/\.tsx?$/, '');
                const candidate = `plugins/sp/tests/${scriptBase}.test.ts`;
                if (exists(candidate)) {
                    tests.add(candidate);
                    matched = true;
                }
            } else if (rest.startsWith('tests/') && TEST_FILE_PATTERN.test(rest)) {
                tests.add(file);
                matched = true;
            }
            if (matched) workspaces.add('plugins/sp');
            continue;
        }
        const workspace = workspaceOf(file, exists);
        if (workspace === null) continue;
        workspaces.add(workspace);
        const rest = file.slice(workspace.length + 1);
        if (rest.startsWith('src/')) {
            const candidate = `${workspace}/tests/${rest.slice('src/'.length).replace(/\.tsx?$/, (ext) => `.test${ext}`)}`;
            if (exists(candidate)) tests.add(candidate);
        } else if (rest.startsWith('tests/') && TEST_FILE_PATTERN.test(rest)) {
            tests.add(file);
        }
    }
    let fallback: string | undefined;
    if (graph?.unsupported !== undefined) {
        // 1326: the graph cannot see this repo's workspaces — refuse the tier rather than
        // let the shared-package safety net appear to have run over an empty graph.
        fallback = `${graph.unsupported} — full suite required`;
    }
    if (fallback === undefined && graph !== undefined) {
        for (const file of changedFiles) {
            // plugins/sp has no package and no compiled dependents — the 1142 structure-test
            // mapping owns those paths, so they never trigger the shared-package fallback.
            if (file.startsWith('plugins/sp/')) continue;
            const owner = workspaceOf(file, exists);
            if (owner === null) {
                fallback = `unmapped path ${file} (no owning workspace package.json) — full suite required`;
                break;
            }
            const dependents = dependentsOf(graph, owner);
            if (dependents.length > 0) {
                fallback = `shared package ${owner} (depended on by ${dependents.join(', ')}) — full suite required`;
                break;
            }
        }
    }
    return {
        files,
        workspaces: [...workspaces].sort(),
        tests: [...tests].sort(),
        ...(fallback !== undefined ? { fallback } : {}),
    };
}

/** One planned light check: a stable id plus the shell command to run. */
export interface LightCheckPlan {
    id: string;
    cmd: string;
    /** Set when the action resolved unbound (R2): planned for visibility, never executed. */
    skipped?: 'unbound';
}

/** Does the workspace package.json declare a `typecheck` script? (fs default; tests inject.) */
export function workspaceHasTypecheck(workspace: string): boolean {
    try {
        const pkg = JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')) as {
            scripts?: { typecheck?: string };
        };
        return typeof pkg.scripts?.typecheck === 'string';
    } catch {
        return false;
    }
}

/**
 * The light sub-checks for a scope, in run order: `format-lint:changed` (repo root),
 * `typecheck:<ws>` per admitted workspace, `test:<ws>` per workspace with related tests.
 * Every command is resolved in-process from the project action map (feature A92, design
 * `docs/design/sdlc-actions.md` §3.4); an action that resolves unbound is planned with
 * `skipped: 'unbound'` and never falls back to a hard-coded command. Tests always run through
 * `cd <ws> &&` in the preset binding — never from the repo root, whose preload config does not
 * apply inside the workspace.
 */
export function planLightChecks(
    scope: LightScope,
    hasTypecheck: (workspace: string) => boolean = workspaceHasTypecheck,
    builder?: BuilderConfig,
): LightCheckPlan[] {
    const plan = (id: string, action: string, values: ScopedValues): LightCheckPlan => {
        const resolved = resolveAction(builder, action);
        if (resolved.kind === 'unbound') return { id, cmd: '', skipped: 'unbound' };
        const command = resolved.kind === 'command' ? resolved.command : resolved.steps.join(' && ');
        return { id, cmd: renderScoped(command, values) };
    };
    const plans: LightCheckPlan[] = [];
    if (scope.files.length > 0) {
        plans.push(plan('format-lint:changed', 'lint-changed', { files: scope.files }));
        // Task 1142 R1: The light tier covers the cheap failure classes.
        // Appends rules:pre and rules:post after the lint step whenever scope is non-empty.
        plans.push(plan('rules:pre', 'rules-pre', { files: scope.files }));
        plans.push(plan('rules:post', 'rules-post', { files: scope.files }));
    }
    const typecheck = resolveAction(builder, 'typecheck-changed');
    for (const workspace of scope.workspaces) {
        // The preset binding is `<ws> typecheck`; a declared binding owns its own scope, so the
        // package.json script check only gates the preset (R2).
        if (typecheck.source === 'preset' && !hasTypecheck(workspace)) continue;
        plans.push(plan(`typecheck:${workspace}`, 'typecheck-changed', { workspace }));
    }
    const testsByWorkspace = new Map<string, string[]>();
    for (const test of scope.tests) {
        // `<ws>/tests/**` for workspace suites; a colocated suite (`scripts/commands/*.test.ts`)
        // runs from its top-level directory, which carries the bunfig preload.
        const cut = test.indexOf('/tests/');
        const workspace = test.slice(0, cut >= 0 ? cut : test.indexOf('/'));
        const paths = testsByWorkspace.get(workspace) ?? [];
        paths.push(test.slice(workspace.length + 1));
        testsByWorkspace.set(workspace, paths);
    }
    for (const [workspace, paths] of testsByWorkspace) {
        plans.push(plan(`test:${workspace}`, 'test-changed', { workspace, paths }));
    }
    return plans;
}

/**
 * The change-set base for the light tier (1322 R3): `.spur/run/<wbs>-base.sha` when the caller
 * recorded a base commit, else `HEAD`. A recorded base folds commits landed since that ref into
 * the diff, so a detached recheck visit sees the same scope the implement worker verified.
 */
export function readBaseSha(path: string | undefined): string | null {
    if (path === undefined) return null;
    try {
        const line = readFileSync(path, 'utf8').trim();
        return /^[0-9a-f]{7,64}$/i.test(line) ? line : null;
    } catch {
        return null;
    }
}

/** Changed paths for the light tier: `git diff --name-only <base|HEAD>` plus untracked; existing only. */
function gitChangedFiles(cwd: string | undefined, timeoutMs?: number, baseShaPath?: string): string[] | null {
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const changed = new Set<string>();
    const base = readBaseSha(baseShaPath) ?? 'HEAD';
    for (const cmd of [`git diff --name-only ${base}`, 'git ls-files --others --exclude-standard']) {
        const result = runShellCommand(cmd, cwd, undefined, timeoutMs);
        // 1319 R1: a timed-out changed-path read cannot scope the light tier — report it as
        // undecidable so the caller exits BLOCKED instead of checking an empty scope.
        if (result.timedOut) return null;
        for (const line of result.output.split('\n')) {
            const file = line.trim();
            if (file.length > 0 && existsSync(abs(file))) changed.add(file);
        }
    }
    return [...changed].sort();
}

function receiptRunId(env: QualityGateEnv): string {
    return env.runId || env.__runId || `pipeline-${env.wbs}`;
}

/** Light-gate outcome: the verdict plus the scope it checked. */
export interface LightGateResult {
    status: CheckStatus;
    scope: LightScope;
    checks: CheckReceiptRow[];
    logFile: string;
    receiptFile: string;
    /** Set when the tier could not decide (a changed-path `git diff` timed out) — exit 2 (1319 R1). */
    blocked?: string;
    /** Set when affected-scope selection refused the tier (1322 R3) — same exit-2 surface. */
    fallback?: string;
}

/** Deferred-tier result (task 1111): the light verdict plus the status token written. */
export interface DeferredGateResult {
    /** `DEFERRED` when the light tier passed, `FAIL` when it did not — never `PASS`. */
    status: 'DEFERRED' | 'FAIL';
    light: LightGateResult;
    statusFile: string;
}

/**
 * Deferred tier (task 1111 R1): the opt-in parallel-batch gate. Runs the light tier for the
 * per-task early feedback the ADR-124 invariant exists to protect, then writes `DEFERRED`
 * (light PASS) or `FAIL` (light FAIL) to `.spur/run/<wbs>-test-gate.status`.
 *
 * It NEVER writes `PASS`: that token means "the project quality gate ran green on this tree",
 * and only the full tier may claim it (the gate-invariant comment in the task pipeline definition).
 * The batch orchestrator owes the integrated full gate on the base ref over the merged slices.
 */
export function runDeferredGate(env: QualityGateEnv, options: QualityGateOptions = {}): DeferredGateResult {
    const cwd = options.cwd;
    const light = runLightGate(env, options);
    const status: 'DEFERRED' | 'FAIL' = light.status === 'PASS' ? 'DEFERRED' : 'FAIL';
    const runDir = join('.spur', 'run');
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    mkdirSync(abs(runDir), { recursive: true });
    const statusFile = join(runDir, `${env.wbs}-test-gate.status`);
    writeFileSync(abs(statusFile), `${status}\n`);
    const note =
        status === 'DEFERRED'
            ? `deferred gate: light tier PASS — the integrated full gate is owed on the batch base ref (1111 R3)\n`
            : light.blocked !== undefined
              ? `deferred gate: light tier BLOCKED (${light.blocked}) — no scoped tier could decide; the integrated full gate stays owed (1111 R3; 1322 R3)\n`
              : `deferred gate: light tier FAIL — the task's bounded fix lane runs; the integrated full gate stays owed (1111 R3)\n`;
    appendFileSync(abs(light.logFile), note);
    process.stdout.write(`quality gate ${status} (deferred tier; log: ${light.logFile})\n`);
    return { status, light, statusFile };
}

/**
 * Light tier (0939 R1): run the planned sub-checks, merge their rows into the receipt under
 * `tier: light`, exit soft. A sub-check already PASS in a light receipt at the same
 * `{id, inputDigest}` is skipped (accumulation, AC1); prior rows whose id left the plan are
 * dropped with the rest of the old receipt.
 */
export function runLightGate(env: QualityGateEnv, options: QualityGateOptions = {}): LightGateResult {
    const cwd = options.cwd;
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const runDir = join('.spur', 'run');
    mkdirSync(abs(runDir), { recursive: true });
    const logFile = join(runDir, `${env.wbs}-light-gate.log`);
    const receiptFile = join(runDir, `${env.wbs}-check-receipt.json`);
    writeFileSync(abs(logFile), '');
    const timeoutMs = gateTimeoutMsFor(env, options);

    // 1322 R3: the change set folds commits since a recorded base ref (`.spur/run/<wbs>-base.sha`,
    // written by the caller when the visit starts from a detached/base ref) into the diff.
    const changed = gitChangedFiles(cwd, timeoutMs, abs(join(runDir, `${env.wbs}-base.sha`)));
    if (changed === null) {
        const line = `--- light gate BLOCKED: changed-path git read timed out after ${timeoutMs}ms\n`;
        appendFileSync(abs(logFile), line);
        process.stderr.write(line);
        return {
            status: 'FAIL',
            scope: { files: [], workspaces: [], tests: [] },
            checks: [],
            logFile,
            receiptFile,
            blocked: line.trim(),
        };
    }

    const capture = (options.captureGitTree ?? captureGateGitTree)(cwd ?? process.cwd());
    const digest = capture.ok ? capture.tree : '';
    if (!capture.ok) {
        appendFileSync(abs(logFile), `--- light receipt: no git tree identity — ${capture.error}\n`);
    }
    // 1322 R3: affected-scope selection over the workspace dependency graph. The rationale is the
    // log's opening lines (receipt rows point back at this path), so a light receipt always
    // carries the selection evidence — which files were in scope and why the tier refused.
    const scope = lightScope(changed, (p) => existsSync(abs(p)), readWorkspaceGraph(cwd));
    const scopeHeader =
        scope.fallback !== undefined
            ? `--- light scope: full-suite-fallback — ${scope.fallback}\n--- light scope files (${changed.length}): ${changed.join(' ')}\n`
            : `--- light scope: selected — workspaces: ${scope.workspaces.join(' ') || '(none)'}; related tests: ${scope.tests.length}; files: ${changed.length}\n--- light scope files (${changed.length}): ${changed.join(' ')}\n`;
    appendFileSync(abs(logFile), scopeHeader);
    if (scope.fallback !== undefined) {
        // The tier refuses to decide a scope it cannot cover: a shared package's dependents or an
        // unmapped root path can only be certified by the full suite (1322 R3). No checks run, no
        // receipt is written (a light receipt here would overwrite standing boundary evidence),
        // and the caller exits BLOCKED (2) naming the rationale — the fallback IS to the full gate.
        const line = `--- light gate BLOCKED: affected-scope fallback — full gate owns this tree\n`;
        appendFileSync(abs(logFile), line);
        process.stdout.write(`light gate BLOCKED — ${scope.fallback}\n`);
        return {
            status: 'FAIL',
            scope,
            checks: [],
            logFile,
            receiptFile,
            blocked: scope.fallback,
            fallback: scope.fallback,
        };
    }
    // Bind the fs predicates to the gate cwd, not the process cwd (tests run gates in fixtures).
    const plans = planLightChecks(scope, (workspace) => workspaceHasTypecheck(abs(workspace)), options.builder);

    const reusable = new Map<string, CheckReceiptRow>();
    let preserveFullReceipt = false;
    if (digest.length > 0) {
        try {
            const prior = JSON.parse(readFileSync(abs(receiptFile), 'utf8')) as CheckReceipt;
            if (prior?.schemaVersion === RECEIPT_SCHEMA_VERSION && prior.inputDigest === digest) {
                if (prior.tier === 'full') {
                    // A full-tier receipt at the same tree is boundary evidence read by status
                    // mode (0940/0943); light must never demote it to a tier-light receipt.
                    preserveFullReceipt = true;
                } else {
                    for (const row of prior.checks ?? []) if (row.status === 'PASS') reusable.set(row.id, row);
                }
            }
        } catch {
            // No prior receipt (or unreadable) — every planned sub-check runs.
        }
    }

    const checks: CheckReceiptRow[] = [];
    let skipped = 0;
    let unbound = 0;
    for (const plan of plans) {
        if (plan.skipped === 'unbound') {
            unbound++;
            const line = `--- light ${plan.id}: skipped:unbound — no action bound in builder config\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
            continue;
        }
        const priorRow = reusable.get(plan.id);
        if (priorRow !== undefined) {
            checks.push(priorRow);
            skipped++;
            // 0940 R3: accumulation reuse is observable in the gate log and on stdout (the
            // action result `data`); both surfaces run this same script.
            const line = `--- light ${plan.id}: check.reused — skipped (PASS at the same git tree)\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
            continue;
        }
        const startedAtMs = Date.now();
        const result = runShellCommand(plan.cmd, cwd, undefined, timeoutMs);
        const durationMs = Date.now() - startedAtMs;
        const status: CheckStatus = result.code === 0 && !result.timedOut ? 'PASS' : 'FAIL';
        const header = result.timedOut
            ? `--- light ${plan.id}: ${status} (timeout after ${timeoutMs}ms, ${durationMs}ms elapsed)\n`
            : `--- light ${plan.id}: ${status} (${durationMs}ms)\n`;
        appendFileSync(abs(logFile), `${header}${result.output}`);
        checks.push({ id: plan.id, cmd: plan.cmd, status, durationMs, logPath: logFile });
    }

    const receipt = buildReceipt({
        wbs: env.wbs,
        runId: receiptRunId(env),
        tier: 'light',
        inputDigest: digest,
        checks,
        completedAt: new Date().toISOString(),
    });
    if (preserveFullReceipt) {
        // Light ran for its log; the file keeps the full-tier receipt untouched.
        appendFileSync(
            abs(logFile),
            '--- light receipt: not written — the full-tier receipt at the same git tree is preserved\n',
        );
        process.stdout.write(
            `light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` +
                ` skipped: ${skipped}, unbound: ${unbound}; receipt: ${receiptFile} preserved (full tier); log: ${logFile})\n`,
        );
    } else if (!capture.ok) {
        // 0976 R1 symmetry (1322 R4): a receipt without tree identity can never be safely reused
        // (1234 — reuse is refused, never assumed) and would occupy the full-tier receipt path,
        // forging boundary state for a visit that could not bind its tree. Log why; write nothing.
        appendFileSync(abs(logFile), `--- light receipt: not written — git tree capture failed (${capture.error})\n`);
        process.stdout.write(
            `light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` +
                ` skipped: ${skipped}, unbound: ${unbound}; receipt: none (git tree capture failed); log: ${logFile})\n`,
        );
    } else {
        writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`);
        process.stdout.write(
            `light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` +
                ` skipped: ${skipped}, unbound: ${unbound}; receipt: ${receiptFile}; log: ${logFile})\n`,
        );
    }
    return { status: receipt.status, scope, checks, logFile, receiptFile };
}

function retryDelayMs(env: QualityGateEnv): number {
    const raw = Number.parseInt(env[RETRY_DELAY_MS_ENV] ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : RETRY_DELAY_MS_DEFAULT;
}

function gateSleep(ms: number): void {
    if (ms <= 0) return;
    // Bun.sleepSync is a real block; under bun workers Atomics.wait can burn CPU instead (seen
    // as a 96%-CPU wrapper during a long holder wait), so prefer it and keep Atomics as fallback.
    const bun = (globalThis as { Bun?: { sleepSync?(ms: number): void } }).Bun;
    if (typeof bun?.sleepSync === 'function') {
        bun.sleepSync(ms);
        return;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `sh -c <cmd> > <attempt log> 2>&1` equivalent: merged output, exit code and a timeout flag. */
export function runShellCommand(
    cmd: string,
    cwd: string | undefined,
    extraEnv?: Record<string, string>,
    timeoutMs?: number,
): { output: string; code: number; timedOut: boolean } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-quality-gate-'));
    const path = join(dir, 'output');
    const fd = openSync(path, 'w');
    try {
        // One file descriptor preserves stream order and avoids spawnSync's pipe buffer limit.
        // Bun does not propagate inherited-env mutations to spawned children, so the gate lock
        // token (R6 re-entrancy) must ride in explicitly.
        // ponytail: spawnSync's timeout reaches only the direct `sh` — a grandchild survives on
        // this CLI path (a pipeline `command.gate` has group ownership via ts-runtime). Upgrade to
        // runBoundedChild (bounded-child-run.ts) once the gate chain can go async. 1319 R1.
        const result = spawnSync('sh', ['-c', cmd], {
            cwd,
            stdio: ['ignore', fd, fd],
            env: extraEnv === undefined ? undefined : { ...getEnvVars(), ...extraEnv },
            ...(timeoutMs !== undefined ? { timeout: timeoutMs, killSignal: 'SIGKILL' as const } : {}),
        });
        // A SIGKILL death is how spawnSync reports its own deadline (ETIMEDOUT rides `error`).
        const timedOut =
            (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || result.signal === 'SIGKILL';
        if (result.error !== undefined && !timedOut) {
            return { output: `sh -c failed: ${result.error.message}\n`, code: 1, timedOut: false };
        }
        return { output: readFileSync(path, 'utf8'), code: result.status ?? 1, timedOut };
    } finally {
        closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
    }
}

// ─── Host-wide full-gate lock (task 1127; restored by D65 1235) ───

/** Lock-dir override for tests and shared-home operators (tests/setup.ts preloads a per-process one). */
export const GATE_LOCK_DIR_ENV = 'SPUR_GATE_LOCK_DIR';
/** Holder-poll override in milliseconds. */
export const GATE_LOCK_POLL_MS_ENV = 'SPUR_GATE_LOCK_POLL_MS';
/** Set to `off` to run without the host-wide lock (1127 AC6 escape hatch). */
export const GATE_LOCK_OFF_ENV = 'SPUR_GATE_LOCK';
/** The holder exports its marker here so the gate child's nested acquire re-enters (1127 R6). */
export const GATE_LOCK_TOKEN_ENV = 'SPUR_GATE_LOCK_TOKEN';
/** Default holder-poll interval: five seconds between liveness probes. */
export const GATE_LOCK_POLL_MS_DEFAULT = 5_000;
/**
 * Bound on the wait for a live holder, in milliseconds; `0` waits forever (the 1127 decision).
 * Two hours clears the worst queue task 1127 documented (a 20-minute gate behind three others);
 * a waiter that reaches it exits 2 naming the holder instead of hanging invisibly.
 */
export const GATE_LOCK_TIMEOUT_MS_ENV = 'SPUR_GATE_LOCK_TIMEOUT_MS';
/** Default bound on that wait: two hours, matching the worst queue task 1127 documented. */
export const GATE_LOCK_TIMEOUT_MS_DEFAULT = 2 * 60 * 60 * 1000;
/**
 * Test seam for the P2-1 ownership race (1127 review): holds the lock dir between its `mkdir`
 * and the marker write so a test can recreate the dir underneath the creator. Zero in production.
 */
export const GATE_LOCK_MKDIR_HOLD_MS_ENV = 'SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS';
/** Sleep between lost-claim retries so a pathological lost-race cannot hot-spin (1127 review P3-2). */
const GATE_LOCK_LOST_RACE_SLEEP_MS = 20;
/** Consecutive lost-claim retries after which the waiter says so once — visible, never fatal. */
const GATE_LOCK_LOST_RACE_LOG_AT = 250;

/** A live holder outlasted `SPUR_GATE_LOCK_TIMEOUT_MS`: the gate refuses to run beside it. */
export class GateLockTimeoutError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'GateLockTimeoutError';
    }
}

/** Host-wide gate lock handle: release plus the observed wait, for the receipt and the log. */
export interface GateLock {
    release(): void;
    /** Milliseconds spent waiting for prior holders; 0 when acquired immediately or lockless. */
    queueWaitMs: number;
    /** Claim marker name; re-exported to the gate child via `GATE_LOCK_TOKEN_ENV` (R6). */
    token: string;
}

/** What a holder records for the operator-facing wait line (1127 AC1). */
interface GateLockClaim {
    pid: number;
    startedAt: number;
    wbs: string;
    runId: string;
    cwd: string;
}

function gateLockDir(): string {
    const raw = getEnvVar(GATE_LOCK_DIR_ENV);
    return raw !== undefined && raw.length > 0 ? raw : join(homedir(), '.config', 'spur', 'run', 'full-gate.lock');
}

function gateLockPollMs(): number {
    const raw = Number.parseInt(getEnvVar(GATE_LOCK_POLL_MS_ENV) ?? '', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : GATE_LOCK_POLL_MS_DEFAULT;
}

function gateLockTimeoutMs(): number {
    const raw = Number.parseInt(getEnvVar(GATE_LOCK_TIMEOUT_MS_ENV) ?? '', 10);
    if (!Number.isFinite(raw) || raw < 0) return GATE_LOCK_TIMEOUT_MS_DEFAULT;
    return raw === 0 ? Number.POSITIVE_INFINITY : raw;
}

/**
 * Signal-0 existence probe; unknown failures (EPERM) fail closed as a live holder.
 *
 * Residual risk (1127 review P4, accepted): liveness is pid-based, so a pid recycled by an
 * unrelated process reads as a live holder and the lock waits until that process exits — bounded
 * now by `SPUR_GATE_LOCK_TIMEOUT_MS`, which names the holder when it expires. The alternative
 * (comparing a recorded start time against the process start time) is not portable across the
 * supported platforms.
 */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/**
 * First sorted marker with a usable claim; `null` when the dir is unreadable or claimless.
 * A marker whose JSON is unreadable (mid-write, or torn by a crashed creator) still carries its
 * creator's pid in its `<pid>-<uuid>` name, so liveness is judged from that: a live creator is
 * waited on, a dead one is reclaimed — never an indefinite wait on wreckage (1127 review P4).
 */
function readGateLockClaim(dir: string): { claim: GateLockClaim; marker: string } | null {
    let markers: string[];
    try {
        markers = readdirSync(dir).sort();
    } catch {
        return null;
    }
    for (const marker of markers) {
        try {
            const claim = JSON.parse(readFileSync(join(dir, marker), 'utf8')) as GateLockClaim;
            if (typeof claim.pid === 'number') return { claim, marker };
        } catch {
            const pid = Number.parseInt(/^(\d+)-/.exec(marker)?.[1] ?? '', 10);
            if (pid > 0) {
                return { claim: { pid, startedAt: Date.now(), wbs: '?', runId: '?', cwd: '?' }, marker };
            }
            // Not a gate marker at all: liveness falls back to the grace poll below.
        }
    }
    return null;
}

/** The holder description shared by the wait line and the timeout refusal (1127 AC1). */
function describeGateLockHolder(claim: GateLockClaim): string {
    return `wbs ${claim.wbs}, run ${claim.runId}, pid ${claim.pid}, cwd ${claim.cwd}, held ${Date.now() - claim.startedAt}ms`;
}

function gateLockTimeoutError(dir: string, startedWaitingAt: number): GateLockTimeoutError {
    const held = readGateLockClaim(dir);
    const holder = held === null ? `the claim dir ${dir} (no readable claim)` : describeGateLockHolder(held.claim);
    return new GateLockTimeoutError(
        `quality gate lock: timed out after ${Date.now() - startedWaitingAt}ms waiting for holder (${holder}); ` +
            `raise ${GATE_LOCK_TIMEOUT_MS_ENV} or set ${GATE_LOCK_OFF_ENV}=off to run without the lock\n`,
    );
}

/**
 * Serialize the full quality gate host-wide (1127 R1): one `mkdir` claim per holder, released
 * before returning. A live holder is named on exactly one operator-facing line with its wbs,
 * run id, pid, cwd and held time (AC1); a dead holder's claim is reclaimed with its pid logged
 * (AC2); the caller's own token re-enters without waiting (R6); `SPUR_GATE_LOCK=off` disables
 * the lock entirely (AC6). Polling is a blocking sleep — nothing else is scheduled while waiting.
 *
 * Re-entry is judged against the CURRENT holder only: `SPUR_GATE_LOCK_TOKEN` must equal the marker
 * found in the dir, so a token inherited from an older or foreign claim waits like any stranger.
 */
export function acquireGateLock(env: QualityGateEnv, logLine: (line: string) => void = (): void => {}): GateLock {
    if ((getEnvVar(GATE_LOCK_OFF_ENV) ?? '') === 'off') {
        return { release(): void {}, queueWaitMs: 0, token: '' };
    }
    const dir = gateLockDir();
    mkdirSync(dirname(dir), { recursive: true });
    const pollMs = gateLockPollMs();
    const deadline = Date.now() + gateLockTimeoutMs();
    const claim: GateLockClaim = {
        pid: process.pid,
        startedAt: Date.now(),
        wbs: env.wbs,
        runId: receiptRunId(env),
        cwd: process.cwd(),
    };
    const marker = `${process.pid}-${randomUUID()}`;
    const startedWaitingAt = Date.now();
    let holderLogged = false;
    let graceLogged = false;
    let lostRaces = 0;
    let lostRaceLogged = false;
    const mkdirHoldMs = Number.parseInt(getEnvVar(GATE_LOCK_MKDIR_HOLD_MS_ENV) ?? '', 10);
    for (;;) {
        if (Date.now() > deadline) throw gateLockTimeoutError(dir, startedWaitingAt);
        let dirIno: number | null = null;
        try {
            mkdirSync(dir);
            // Identity of the directory THIS call created, captured before the marker write can
            // be preempted (see the ownership check below).
            dirIno = statSync(dir).ino;
            if (Number.isFinite(mkdirHoldMs) && mkdirHoldMs > 0) gateSleep(mkdirHoldMs);
            writeFileSync(join(dir, marker), JSON.stringify(claim), { flag: 'wx' });
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code === 'ENOENT' || code === 'EINVAL') {
                // We lost the dir between mkdir and the marker write (a reclaiming waiter judged
                // our in-progress claim wreckage); just try again. Darwin reports that same losing
                // race as EINVAL from the exclusive create, not ENOENT (1127 fix hop: observed as
                // an uncaught crash under full-suite load) — treat both as the retryable case.
                // The sleep keeps a pathological streak from spinning a core (1127 review P3-2).
                lostRaces += 1;
                if (lostRaces === GATE_LOCK_LOST_RACE_LOG_AT && !lostRaceLogged) {
                    lostRaceLogged = true;
                    logLine(
                        `quality gate lock: still losing the claim race after ${lostRaces} attempts (dir ${dir})\n`,
                    );
                }
                gateSleep(GATE_LOCK_LOST_RACE_SLEEP_MS);
                continue;
            }
            if (code !== 'EEXIST') {
                throw error;
            }
            // EEXIST: fall through to the holder check below.
        }
        if (dirIno !== null) {
            // R1/AC1, 1127 review P2-1: a successful `mkdir` is NOT proof of ownership. A waiter can
            // reclaim a dir it reads as claimless and recreate it inside our mkdir→marker window, so
            // this marker can land in the waiter's dir — and then two gates hold at once, the exact
            // overlap R1 forbids. Ownership is therefore verified against the directory's identity:
            // we hold only while the dir at this path is still the one our own `mkdir` created.
            // (Inode numbers are not recycled inside that microsecond window on the supported local
            // filesystems; the cited project-server-owner.ts pattern relies on the same mkdir claim.)
            let currentIno: number | null = null;
            let entries: string[] = [];
            try {
                currentIno = statSync(dir).ino;
                entries = readdirSync(dir);
            } catch {
                // Reclaimed before we looked — same lost race as above.
            }
            if (currentIno !== dirIno || entries.length !== 1 || entries[0] !== marker) {
                try {
                    unlinkSync(join(dir, marker));
                } catch {
                    // Our marker went with the reclaimed dir, or a newer claim owns it now.
                }
                lostRaces += 1;
                gateSleep(GATE_LOCK_LOST_RACE_SLEEP_MS);
                continue;
            }
            return {
                release(): void {
                    try {
                        rmSync(join(dir, marker), { force: true });
                        rmdirSync(dir);
                    } catch {
                        // A reclaiming waiter raced the release — the dir is gone or replaced.
                    }
                },
                queueWaitMs: Date.now() - startedWaitingAt,
                token: marker,
            };
        }
        // Reached only when `mkdir` lost to EEXIST: evaluate the existing holder below.
        const held = readGateLockClaim(dir);
        if (held !== null && isProcessAlive(held.claim.pid)) {
            if (getEnvVar(GATE_LOCK_TOKEN_ENV) === held.marker) {
                // R6 re-entrancy: the gate child re-acquiring its own parent's claim — no wait,
                // no write, no release (the parent still owns the claim and releases it).
                return { release(): void {}, queueWaitMs: Date.now() - startedWaitingAt, token: held.marker };
            }
            if (!holderLogged) {
                holderLogged = true;
                logLine(`quality gate lock: waiting for holder (${describeGateLockHolder(held.claim)})\n`);
            }
            // R3: poll on the documented interval. This branch must sleep explicitly — the claim
            // dir stays in place for the whole hold, so without it the retry loop spins a core
            // (measured 3.0s sys for a 3.8s wait) and takes CPU from the very gate it waits for.
            gateSleep(pollMs);
        } else if (held !== null) {
            // AC2: dead holder — reclaim with the dead pid so the log explains the takeover.
            logLine(`quality gate lock: reclaimed stale claim (pid ${held.claim.pid})\n`);
            try {
                unlinkSync(join(dir, held.marker));
                // Empty-only removal: if other markers remain (multiple stale holders), the next
                // iteration evaluates each one's liveness — never destroy a possibly-live claim.
                rmdirSync(dir);
            } catch {
                // The holder's own release raced the reclaim — the dir is already gone or replaced.
            }
        } else {
            // Dir with no readable claim: a creator is between mkdir and its marker write (fully
            // synchronous, so one grace poll suffices) or the dir is empty wreckage (pre-created
            // or a crashed creator). Reclaim ONLY an empty dir — rmdir fails on a claimed dir, so
            // no concurrent waiter can ever destroy a live claim; junk keeps polling, visibly.
            // Empty first, sleep only when the rmdir loses: a pre-created empty dir (tests/setup.ts)
            // must not cost a full default poll (task 1127 — one grace sleep at 5s blew the suite).
            try {
                rmdirSync(dir);
                graceLogged = false;
            } catch {
                gateSleep(pollMs);
                try {
                    rmdirSync(dir);
                    graceLogged = false;
                } catch {
                    if (!graceLogged) {
                        graceLogged = true;
                        logLine('quality gate lock: dir has no readable claim and is not empty — waiting\n');
                    }
                }
            }
        }
    }
}

/**
 * Capture the gate's own receipt identity (D65 1234, design §4.8): the git tree hash of the
 * working tree with the task/feature corpus carved out, computed through a throwaway index so the
 * real index, HEAD and working tree are untouched.
 *
 * - `git read-tree HEAD` seeds the alternate index from the committed tree;
 * - `git add -A -- . :(exclude)docs/tasks* :(exclude)docs/features*` folds in every tracked
 *   change plus untracked files outside the carve-outs (a corpus edit therefore keeps the hash —
 *   task/feature prose does not change what the gate certifies);
 * - `git write-tree` prints the hash, which IS the receipt key: no hashing of a composed value,
 *   no caller-supplied digest ({@link GitTreeCapture}).
 *
 * Fails closed — a directory that is not a repository, or an unborn HEAD, returns
 * `{ ok: false }`; there is no empty-string sentinel and the caller writes no receipt.
 */
export function captureGateGitTree(cwd: string): GitTreeCapture {
    const indexFile = join(tmpdir(), `spur-gate-tree-${randomUUID()}.index`);
    try {
        const processEnv = Object.fromEntries(
            Object.entries(getEnvVars()).filter((entry): entry is [string, string] => entry[1] !== undefined),
        );
        processEnv.GIT_INDEX_FILE = indexFile;
        const opts = { cwd, env: processEnv, stdio: ['pipe', 'pipe', 'pipe'] as ('pipe' | 'ignore')[] };

        const readRes = spawnSync('git', ['read-tree', 'HEAD'], opts);
        if (readRes.status !== 0) {
            return { ok: false, error: `git read-tree HEAD failed: ${readRes.stderr?.toString() || readRes.status}` };
        }

        const excludes = DEFAULT_EXCLUDE_GLOBS.map((glob) => `:(exclude)${glob}`);
        const addRes = spawnSync('git', ['add', '-A', '--', '.', ...excludes], opts);
        if (addRes.status !== 0) {
            return { ok: false, error: `git add -A failed: ${addRes.stderr?.toString() || addRes.status}` };
        }

        const writeRes = spawnSync('git', ['write-tree'], opts);
        if (writeRes.status !== 0) {
            return { ok: false, error: `git write-tree failed: ${writeRes.stderr?.toString() || writeRes.status}` };
        }
        return { ok: true, tree: writeRes.stdout.toString().trim() };
    } catch (err) {
        return {
            ok: false,
            error: `git alternate-tree capture failed: ${err instanceof Error ? err.message : String(err)}`,
        };
    } finally {
        if (existsSync(indexFile)) {
            try {
                unlinkSync(indexFile);
            } catch {
                // Best-effort cleanup
            }
        }
    }
}

/**
 * Run the gate in `run` or `recheck` mode: execute the probe/full gate with lock retries,
 * tee output to the wbs-scoped log, write the status/findings/receipt artifacts, and return
 * the verdict (exit codes stay the script's: 0 pass, 1 fail, 2 usage).
 */
export function runQualityGate(
    mode: 'run' | 'recheck',
    env: QualityGateEnv,
    options: QualityGateOptions = {},
): QualityGateResult {
    const cwd = options.cwd;
    const runDir = join('.spur', 'run');
    mkdirSync(cwd ? join(cwd, runDir) : runDir, { recursive: true });
    const rel = (name: string): string => join(runDir, `${env.wbs}${name}`);
    const logFile = rel('-test-gate.log');
    const findingsFile = rel('-test-gate.findings');
    const statusFile = rel('-test-gate.status');
    const attemptFile = rel('-test-fix-attempt');
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);

    // 1198 R1 — capture the prior gate log BEFORE the truncation below wipes it: the
    // contended-retry predicate reads the failed log's shape, and a post-truncation read is always
    // empty (the recheck truncates before the no-progress decision runs). A missing log reads ''.
    const priorLog = mode === 'recheck' && existsSync(abs(logFile)) ? readFileSync(abs(logFile), 'utf8') : '';
    const timeoutMs = gateTimeoutMsFor(env, options);
    /** Set once a spawn hits the deadline: the visit is BLOCKED, never a red gate (1319 R1). */
    let timedOut: { cmd: string } | undefined;

    // run: `echo 0 > "$ATTEMPT_FILE" && : > "$LOG_FILE"`; recheck: truncate only.
    writeFileSync(abs(logFile), '');
    if (mode === 'run') writeFileSync(abs(attemptFile), '0\n');
    const gateStartedAtMs = Date.now();

    const commandPresent = (env.qualityGateCmd ?? '').trim().length > 0;
    let gateRc = commandPresent ? 0 : 1;
    let gateAttempt = 0;
    // 1038 R2: name the mode — the log line is the operator's only hint at which stage rejected.
    if (!commandPresent)
        appendFileSync(abs(logFile), `quality-gate: mode ${mode} requires env \`qualityGateCmd\` to be non-empty\n`);

    // 1234 R2 — the gate's receipt identity is the git tree it captures itself, once per run and
    // before any artifact write (the writes are all under `.spur/`, which the capture excludes
    // through `.gitignore`). A capture that cannot run leaves no identity: reuse is refused and no
    // receipt is written, so an unverifiable tree can never inherit a PASS.
    const tree: GitTreeCapture = commandPresent
        ? (options.captureGitTree ?? captureGateGitTree)(abs('.'))
        : { ok: false, error: 'gate command missing' };
    const treeKey = tree.ok ? tree.tree : '';

    // 1016 R1 — PASS receipt reuse, next to the 0940 no-progress skip: a full-tier PASS receipt
    // bound to this tree means these exact inputs already passed the full gate, so re-entry (run
    // or recheck) skips the probe and the gate command.
    const receiptPath = abs(rel('-check-receipt.json'));
    let reusePass = false;
    if (commandPresent) {
        const decision = resolveReceiptReuse(receiptPath, env.wbs, tree);
        if (decision.refusal !== undefined) {
            const refuseLine = `check.reuse-refused — ${decision.refusal}\n`;
            process.stdout.write(refuseLine);
            appendFileSync(abs(logFile), refuseLine);
        }
        reusePass = decision.reuse;
    }
    if (reusePass) {
        const line = `check.reused — full-tier PASS receipt at git tree ${treeKey}; gate skipped\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
        writeFileSync(abs(findingsFile), extractFindings(readFileSync(abs(logFile), 'utf8')));
        writeFileSync(abs(statusFile), 'PASS\n');
        return { status: 'PASS', attempts: 0, logFile, findingsFile, statusFile, attemptFile };
    }

    // 0940 R2 — no-progress skip, before the probe: a full-tier FAIL receipt at the current
    // git tree means the fix pass changed nothing tracked, so the full chain can only
    // reproduce the failure. The marker tees to stdout (the action result `data`) and the log,
    // then the shared FAIL path below writes findings/status/verdict exactly as a red gate does.
    // The attempt counter is pipeline-owned (only the test-fix hop increments it; `recheck` never
    // touches it), so the existing cap still bounds the loop.
    const receiptFailsNow =
        commandPresent &&
        mode === 'recheck' &&
        receiptFailsAtDigest(readReceipt(abs(rel('-check-receipt.json'))), treeKey);
    // 1198 R1/R2 — contended retry: a receipt FAIL at the current tree whose prior gate log is
    // timeout-shaped is host contention, not a deterministic defect, so the recheck re-runs the
    // chain once per tree instead of taking the sticky no-progress skip. The used tree is
    // recorded in `.spur/run/<wbs>-contended-retry` (one line) so a second recheck at that tree
    // skips exactly as today. `gateRc` stays 0, so the normal probe → full path runs: a green chain
    // earns PASS through the existing path and a red one writes FAIL there — no verdict is minted.
    const retryContended =
        receiptFailsNow &&
        isTimeoutShapedLog(priorLog) &&
        readContendedRetryDigest(abs(rel('-contended-retry'))) !== treeKey;
    const noProgressSkip = receiptFailsNow && !retryContended;
    if (retryContended) {
        writeFileSync(abs(rel('-contended-retry')), `${treeKey}\n`);
        const fails = countTimeoutShapedFailures(priorLog).fails;
        const line = `check.retry-contended — ${fails} timeout-shaped failure(s) at git tree ${treeKey}; retry 1/1\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
    } else if (noProgressSkip) {
        const line = `check.skipped-no-progress — full-tier FAIL receipt at git tree ${treeKey}; recheck skipped\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
        gateRc = 1;
    }

    // 1322 P2 — recheck visits triage through the affected-scope light tier BEFORE the probe and
    // the full chain: a first visit (`run`) stays the once-per-task full gate at the quality
    // boundary, but a recheck (post-remediation, post-review-fix) only needs to know whether the
    // bounded repair fixed what was red. When selection admits a scope and the tier goes red, the
    // gate fails here — findings/status/verdict from the merged log, no probe, no full chain, no
    // full receipt (none ran; the tier's own receipt stays the tree identity). A green tier, or a
    // full-suite fallback, falls through to the probe and full gate exactly as before.
    if (mode === 'recheck' && commandPresent && gateRc === 0) {
        const light = runLightGate(env, options);
        appendFileSync(
            abs(logFile),
            `--- gate visit ${mode}: affected-scope light tier (1322) — ${light.status}\n${readFileSync(abs(light.logFile), 'utf8')}`,
        );
        if (light.fallback === undefined) {
            if (light.status === 'FAIL') {
                writeFileSync(abs(findingsFile), extractFindings(readFileSync(abs(logFile), 'utf8')));
                writeFileSync(abs(statusFile), 'FAIL\n');
                appendFileSync(abs(logFile), `git-tree: ${tree.ok ? tree.tree : 'unbound'}\n`);
                process.stdout.write(`quality gate FAIL (light tier) — last 40 lines follow (full log: ${logFile})\n`);
                process.stdout.write(tailLines(readFileSync(abs(logFile), 'utf8'), 40));
                return {
                    status: 'FAIL',
                    attempts: 0,
                    logFile,
                    findingsFile,
                    statusFile,
                    attemptFile,
                    receiptFile: light.receiptFile,
                };
            }
        } else {
            const line = `check.scope-fallback — ${light.fallback}; probe + full gate follow\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
        }
    }

    // recheck probe: a probe failure is the gate failure; the gate loop is skipped.
    if (mode === 'recheck' && gateRc === 0 && (env.gateProbeCmd ?? '').length > 0) {
        const probe = runShellCommand(env.gateProbeCmd ?? '', cwd, undefined, timeoutMs);
        writeFileSync(abs(`${logFile}.probe`), probe.output);
        gateRc = probe.code;
        if (probe.timedOut) timedOut = { cmd: env.gateProbeCmd ?? '' };
        appendFileSync(abs(logFile), probe.output);
        rmSync(abs(`${logFile}.probe`), { force: true });
    }

    let gateRuntimeMs = 0;
    let queueWaitMs = 0;
    if (gateRc === 0 && timedOut === undefined) {
        const delayMs = retryDelayMs(env);
        const lockLine = (line: string): void => {
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
        };
        // 1127 R1/R4, restored by D65 1235: the host-wide lock wraps ONLY the full-gate attempt
        // loop — and both full tiers are inside it. `recheck` runs the same `qualityGateCmd`, so
        // leaving it lockless re-admits the cross-session contention task 1127 measured (43 of 64
        // gates overlapping on one host). Receipt reuse, the no-progress skip, the probe and the
        // light/deferred/status tiers return or skip before this block and stay lockless.
        const lock = acquireGateLock(env, lockLine);
        queueWaitMs = lock.queueWaitMs;
        lockLine(`quality gate lock: queueWaitMs=${queueWaitMs}\n`);
        const gateRuntimeStartMs = Date.now();
        try {
            for (gateAttempt = 1; gateAttempt <= MAX_GATE_ATTEMPTS; gateAttempt++) {
                const attemptLogPath = `${logFile}.attempt-${gateAttempt}`;
                // R6: the holder's marker rides the child env so a nested gate re-enters instead
                // of queueing behind its own parent.
                const attempt = runShellCommand(
                    env.qualityGateCmd ?? '',
                    cwd,
                    lock.token.length > 0 ? { [GATE_LOCK_TOKEN_ENV]: lock.token } : undefined,
                    timeoutMs,
                );
                writeFileSync(abs(attemptLogPath), attempt.output);
                const locked = isTransientLock(attempt.output);
                appendFileSync(abs(logFile), attempt.output);
                rmSync(abs(attemptLogPath), { force: true });
                gateRc = attempt.code;
                // 1319 R1: a deadline hit is BLOCKED, never a FAIL — stop the retry loop too, since
                // retrying a hang only burns the remaining attempts.
                if (attempt.timedOut) {
                    timedOut = { cmd: env.qualityGateCmd ?? '' };
                    break;
                }
                if (gateRc === 0 || !locked || gateAttempt >= MAX_GATE_ATTEMPTS) break;
                const line = retryMessage(gateAttempt);
                process.stdout.write(line); // tee: stdout and the log
                appendFileSync(abs(logFile), line);
                gateSleep(delayMs);
            }
        } finally {
            lock.release();
        }
        gateRuntimeMs = Date.now() - gateRuntimeStartMs;
        appendFileSync(abs(logFile), `quality gate lock: queueWaitMs=${queueWaitMs} gateRuntimeMs=${gateRuntimeMs}\n`);
    }

    // Coverage-only failures carry no `file.ext:line` anchor, so findings extraction would hand the
    // fix hop an empty file. Name one shortfall line per under-threshold row instead (0862 R2) —
    // real test failures, an absent threshold and the exit-0 contract are untouched.
    if (gateRc !== 0) {
        const gateLog = existsSync(abs(logFile)) ? readFileSync(abs(logFile), 'utf8') : '';
        if (/^\s*0 fail\b/m.test(gateLog) && !/^\s*[1-9]\d*\s+fail\b/m.test(gateLog)) {
            const bunfigPath = cwd ? join(cwd, 'bunfig.toml') : 'bunfig.toml';
            const { threshold, diagnostic } = existsSync(bunfigPath)
                ? parseCoverageThresholdResult(readFileSync(bunfigPath, 'utf8'))
                : { threshold: null, diagnostic: null };
            if (diagnostic) {
                process.stdout.write(`${diagnostic}\n`);
                appendFileSync(abs(logFile), `${diagnostic}\n`);
            }
            if (threshold) {
                for (const shortfall of scanCoverageShortfalls(gateLog, threshold)) {
                    process.stdout.write(`${shortfall}\n`); // tee: stdout and the log
                    appendFileSync(abs(logFile), `${shortfall}\n`);
                }
            }
        }
    }

    // 1319 R1: a spawn that hit the deadline makes this visit BLOCKED — a third status token beside
    // PASS/FAIL. It writes the findings header plus the log tail and NO receipt: a FAIL receipt keyed
    // to the tree would arm the no-progress skip, so the same tree could never be re-gated after a
    // transient hang. BLOCKED routes `gate → failed` in the pipeline and exits 2 here.
    if (timedOut !== undefined) {
        const header = `gate timeout after ${timeoutMs}ms: ${timedOut.cmd}\n`;
        const tail = tailLines(readFileSync(abs(logFile), 'utf8'), 40);
        writeFileSync(abs(findingsFile), `${header}${tail}`);
        writeFileSync(abs(statusFile), 'BLOCKED\n');
        appendFileSync(abs(logFile), `git-tree: ${tree.ok ? tree.tree : 'unbound'}\n`);
        process.stderr.write(`quality gate BLOCKED — ${header}`);
        return {
            status: 'BLOCKED',
            attempts: gateAttempt,
            logFile,
            findingsFile,
            statusFile,
            attemptFile,
            receiptFile: undefined,
        };
    }

    if (gateRc === 0) {
        const bytes = existsSync(abs(logFile)) ? statSync(abs(logFile)).size : 0;
        const attemptsLabel = gateAttempt > 0 ? String(gateAttempt) : '';
        process.stdout.write(`quality gate PASS (attempts: ${attemptsLabel}; log: ${logFile}; bytes: ${bytes})\n`);
    } else {
        process.stdout.write(`quality gate FAIL — last 40 lines follow (full log: ${logFile})\n`);
        process.stdout.write(tailLines(readFileSync(abs(logFile), 'utf8'), 40));
    }

    writeFileSync(abs(findingsFile), extractFindings(readFileSync(abs(logFile), 'utf8')));
    const status: 'PASS' | 'FAIL' = gateRc === 0 ? 'PASS' : 'FAIL';
    writeFileSync(abs(statusFile), `${status}\n`);
    appendFileSync(abs(logFile), `git-tree: ${tree.ok ? tree.tree : 'unbound'}\n`);

    // 0939 R2: the gate writes the full-tier receipt only with a tree to bind it to. 0976 R1:
    // `recheck` persists the receipt it evaluated too, so a second recheck at the same git tree can
    // take the no-progress skip. A skip leaves the FAIL receipt it matched untouched — a skip never
    // rewrites a receipt, so it can never launder FAIL into PASS.
    let receiptFile: string | undefined;
    // 1038 R3: the vacuous-`qualityGateCmd` guard rejects before any gate execution — it records
    // no receipt. The log/status/findings carry the FAIL; a pre-existing receipt stays untouched.
    if (!noProgressSkip && commandPresent) {
        if (tree.ok) {
            receiptFile = join(runDir, `${env.wbs}-check-receipt.json`);
            const receipt = buildReceipt({
                wbs: env.wbs,
                runId: receiptRunId(env),
                tier: 'full',
                inputDigest: tree.tree,
                checks: [
                    {
                        id: 'test',
                        cmd: env.qualityGateCmd ?? '',
                        status,
                        durationMs: Date.now() - gateStartedAtMs,
                        logPath: logFile,
                    },
                ],
                completedAt: new Date().toISOString(),
                queueWaitMs,
                gateRuntimeMs,
            });
            writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`);
        } else {
            appendFileSync(abs(logFile), `check-receipt: not written — git tree capture failed (${tree.error})\n`);
        }
    }

    return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile, receiptFile };
}

// ─── Mode dispatch (`spur task gate <wbs> <mode>`, script-absorption PR-3) ──────────────

/** The five gate modes, in usage order. */
export const QUALITY_GATE_MODES = ['run', 'recheck', 'light', 'deferred', 'status'] as const;

/** One gate mode. */
export type QualityGateMode = (typeof QUALITY_GATE_MODES)[number];

/** Usage line for an unknown mode or a missing `wbs` (exit 2). */
export const QUALITY_GATE_USAGE =
    'usage: spur task gate <wbs> <run|recheck|light|deferred|status>  (env: qualityGateCmd, gateProbeCmd, runId)';

/**
 * Dispatch one gate mode — the behavioral contract the retired `plugins/sp/scripts/quality-gate.ts`
 * glue carried (moved verbatim): exit 0 on PASS/reuse/DEFERRED, 1 on FAIL, 2 on usage error; in
 * `status` mode the `{reuse, reason}` JSON stays the last stdout line.
 */
export function qualityGateMain(
    argv: string[],
    rawEnv: Partial<QualityGateEnv> = getEnvVars(),
    options: QualityGateOptions = {},
): number {
    const mode = argv[0];
    if (!QUALITY_GATE_MODES.includes(mode as QualityGateMode)) {
        process.stderr.write(`${QUALITY_GATE_USAGE}\n`);
        return 2;
    }
    const wbs = rawEnv.wbs ?? '';
    if (wbs.length === 0) {
        process.stderr.write('quality-gate: env `wbs` is required\n');
        return 2;
    }
    const env: QualityGateEnv = { ...rawEnv, wbs };
    // 1319 R1: a malformed bound is a usage error before any work runs, so an operator who tried to
    // bound the gate never silently gets an unbounded one.
    const timeout = resolveGateTimeoutMs(env);
    if (!timeout.ok) {
        process.stderr.write(`${timeout.error}\n`);
        return 2;
    }
    const gateOptions: QualityGateOptions = { ...options, gateTimeoutMs: timeout.ms };
    if (mode === 'light') {
        const light = runLightGate(env, gateOptions);
        // 1319 R1: the tier could not decide (changed-path read timed out) — BLOCKED, not a pass.
        return light.blocked === undefined ? 0 : 2;
    }
    if (mode === 'deferred') {
        // 1111 R1: light tier for per-task feedback, `DEFERRED`/`FAIL` for the status token —
        // exit 0 on DEFERRED so the YAML's `; exit 0` wrapper and the action result agree.
        return runDeferredGate(env, gateOptions).status === 'DEFERRED' ? 0 : 1;
    }
    if (mode === 'status') {
        const runDir = join(options.cwd ?? '.', '.spur', 'run');
        // 1234 R2: the gate owns its reuse identity — capture the git tree itself before
        // consulting the receipt, so a caller-supplied digest can never trigger reuse.
        const tree = (options.captureGitTree ?? captureGateGitTree)(options.cwd ?? process.cwd());
        const decision = resolveReceiptReuse(join(runDir, `${env.wbs}-check-receipt.json`), env.wbs, tree);
        const verdict = decision.receiptStatus;
        if (decision.refusal !== undefined) {
            const line = `check.reuse-refused — ${decision.refusal}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        } else if (verdict.reuse) {
            // 0940 R3: reuse is observable in the gate log and on stdout (the action result
            // `data`); the `{reuse, reason}` JSON stays the last stdout line for machine readers.
            const line = `check.reused — full-tier receipt reused for git tree ${tree.ok ? tree.tree : 'unbound'}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        }
        process.stdout.write(`${JSON.stringify(verdict)}\n`);
        return 0;
    }
    try {
        const result = runQualityGate(mode as 'run' | 'recheck', env, gateOptions);
        // 1319 R1: BLOCKED is exit 2 (usage/undecidable), never a red gate's exit 1.
        if (result.status === 'PASS') return 0;
        return result.status === 'BLOCKED' ? 2 : 1;
    } catch (error) {
        // Fail closed (exit 2 = BLOCKED, never a gate verdict): the gate never runs beside a
        // holder it could not identify, and the holder is named on stderr.
        if (!(error instanceof GateLockTimeoutError)) throw error;
        process.stderr.write(error.message);
        return 2;
    }
}
