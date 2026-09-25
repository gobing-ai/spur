#!/usr/bin/env bun
/**
 * quality-gate — shared retry/bounded-findings gate behind the task-pipeline test-gate
 * wrappers (task 0823, feature I21, governance §1.2 composition budgets).
 *
 * Reproduces the former task-pipeline `test:onEnter` and `test-recheck:onEnter` shell
 * programs one-for-one so the workflow stays inside the shell-program caps while
 * writing the same `.spur/run` artifacts:
 *   - `<wbs>-test-gate.log`       merged gate attempt output + `proof-digest:` trailer
 *   - `<wbs>-test-gate.findings`  unique `file.ext:line` anchors, code-unit sorted, capped at 20
 *   - `<wbs>-test-gate.status`    `PASS`/`FAIL`
 *   - `<wbs>-test-fix-attempt`    remediation counter, reset to `0` by `run` only
 *
 * Modes:
 *   run     reset the attempt counter, truncate the log, execute the gate loop
 *   recheck truncate the log; a full-tier FAIL receipt at the current digest is a
 *           no-progress skip straight to the FAIL write (0940 R2), otherwise the probe
 *           runs first (probe failure is the gate failure, the gate loop is skipped),
 *           then the gate loop
 *   light   changed-scope tier (task 0939, ADR-124): biome on the changed files,
 *           per-workspace typecheck, and filename-mapped related tests run inside
 *           their workspace; merges rows under `tier: light`, soft-fails
 *   status  print `{reuse, reason}` for the task's receipt and exit 0
 *
 * Retry contract: a failed attempt is retried (up to 5 total attempts) only when its
 * output matches a SQLite busy/locked error; the delay defaults to 10 seconds and is
 * overridable via `SPUR_QUALITY_GATE_RETRY_DELAY_MS` (tests).
 *
 * Check receipts (task 0939, ADR-124): `run` writes `.spur/run/<wbs>-check-receipt.json`
 * (`check-receipt/v1`) when `proofDigest` is set; without a digest no receipt is written and the
 * log says why. The gate executes `qualityGateCmd` as one unit, so the full-tier receipt carries
 * a single `test` row for the whole `bun run spur-check` chain (lint | typecheck | test-pre-check
 * | test | test-post-check). `light` accumulates: a sub-check already PASS in a light receipt at
 * the same `{id, inputDigest}` is skipped, and light rows never make a receipt reusable for
 * review — `status` reuses only `PASS` + `tier: full` + matching digest. Reuse observability
 * (0940 R3): `status` reuse and light accumulation emit `check.reused`, and the no-progress
 * recheck emits `check.skipped-no-progress`, in the gate log and on stdout (the action result
 * `data`); both surfaces run this same script, so there is no surface branch.
 *
 * Standalone contract: the digest is consumed, never computed — the pipeline captures it with
 * `proof.fingerprint` into `env.proofDigest`; standalone callers use
 * `inline-run-setup.ts --fingerprint`. No `@gobing-ai/*` value imports.
 *
 * Environment: `wbs` (required), `qualityGateCmd`, `gateProbeCmd` (recheck), `proofDigest`,
 * `runId` (receipt identity; falls back to `pipeline-<wbs>`).
 * Soft-fail contract: the process always exits 0; the verdict lives in the status file.
 *
 * Node-builtin imports only; pure helpers are exported for unit testing (ADR-065).
 */

import { spawnSync } from 'node:child_process';
import {
    appendFileSync,
    closeSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    openSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export const MAX_GATE_ATTEMPTS = 5;
export const MAX_FINDINGS = 20;
export const RETRY_DELAY_MS_DEFAULT = 10_000;
export const RETRY_DELAY_MS_ENV = 'SPUR_QUALITY_GATE_RETRY_DELAY_MS';

/** Transient SQLite lock/busy markers that justify a gate retry (same as the former grep -Eq). */
export const LOCKED_PATTERN = /SQLiteError: database is locked|SQLite database .*is busy|SQLITE_BUSY/;

/** `file.ext:line` anchor extraction, mirroring the former grep -oE. */
export const FINDINGS_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;

/**
 * bun's coverage table row: `File | % Funcs | % Lines | Uncovered Line #s` (0862 R2).
 * Group 4 (uncovered line numbers) may be empty — a fully covered file has no entry.
 */
export const COVERAGE_ROW_PATTERN = /^\s*(\S+\.[A-Za-z]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*(\S*)/;

export interface QualityGateEnv {
    wbs: string;
    qualityGateCmd?: string;
    gateProbeCmd?: string;
    proofDigest?: string;
    /** Receipt run identity; `pipeline-<wbs>` when absent (task-pipeline convention). */
    runId?: string;
    [key: string]: string | undefined;
}

export interface QualityGateOptions {
    /** Base directory for `.spur/run`; defaults to the process cwd (CLI behavior). */
    cwd?: string;
}

export interface QualityGateResult {
    status: 'PASS' | 'FAIL';
    attempts: number;
    logFile: string;
    findingsFile: string;
    statusFile: string;
    attemptFile: string;
    /** Written only by `run` with `proofDigest` set (0939 R2). */
    receiptFile?: string;
}

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

export function retryMessage(attempt: number): string {
    return `quality gate: database is locked; retrying (${attempt}/${MAX_GATE_ATTEMPTS}) in 10s\n`;
}

/** Per-axis coverage floor from `bunfig.toml`; a missing key leaves that axis unchecked. */
export interface CoverageThreshold {
    functions?: number;
    lines?: number;
}

/**
 * Parse `coverageThreshold = { lines = 0.9, functions = 0.9 }` out of bunfig text.
 * `null` when the setting is absent — the caller then skips the shortfall scan entirely.
 */
export function parseCoverageThreshold(bunfigText: string): CoverageThreshold | null {
    const block = bunfigText.match(/coverageThreshold\s*=\s*\{([^}]*)\}/);
    if (!block) return null;
    const threshold: CoverageThreshold = {};
    for (const axis of ['functions', 'lines'] as const) {
        const raw = block[1]?.match(new RegExp(`\\b${axis}\\s*=\\s*([\\d.]+)`))?.[1];
        const value = raw === undefined ? Number.NaN : Number.parseFloat(raw);
        if (Number.isFinite(value)) threshold[axis] = value;
    }
    return threshold.functions === undefined && threshold.lines === undefined ? null : threshold;
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

export type ReceiptTier = 'full' | 'light';
export type CheckStatus = 'PASS' | 'FAIL';
/** Frozen non-reuse reasons of `status` mode (0939 R3). */
export type ReceiptReuseReason = 'missing' | 'failed' | 'stale' | 'light-only';

export interface CheckReceiptRow {
    id: string;
    cmd: string;
    status: CheckStatus;
    durationMs: number;
    logPath: string;
}

export interface CheckReceipt {
    schemaVersion: 'check-receipt/v1';
    wbs: string;
    runId: string;
    tier: ReceiptTier;
    inputDigest: string;
    checks: CheckReceiptRow[];
    status: CheckStatus;
    completedAt: string;
}

export interface ReceiptReadStatus {
    reuse: boolean;
    /** `'ok'` only when reuse holds; otherwise one of the frozen reasons. */
    reason: ReceiptReuseReason | 'ok';
}

export interface BuildReceiptInput {
    wbs: string;
    runId: string;
    tier: ReceiptTier;
    inputDigest: string;
    checks: CheckReceiptRow[];
    /** ISO-8601 completion timestamp; injected so receipts stay reproducible in tests. */
    completedAt: string;
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
 * Reuse verdict for `.spur/run/<wbs>-check-receipt.json` against the current proof-input digest.
 * Evaluated missing → failed → stale → light-only; reuse requires `PASS` + `tier: full` + digest
 * match, so light rows can never flip a receipt reusable (0939 invariant).
 */
export function readReceiptStatus(receiptPath: string, currentDigest: string): ReceiptReadStatus {
    const receipt = readReceipt(receiptPath);
    if (receipt === null || receipt.schemaVersion !== RECEIPT_SCHEMA_VERSION) {
        return { reuse: false, reason: 'missing' };
    }
    if (receipt.status !== 'PASS') return { reuse: false, reason: 'failed' };
    if (currentDigest.length === 0 || receipt.inputDigest !== currentDigest) {
        return { reuse: false, reason: 'stale' };
    }
    if (receipt.tier !== 'full') return { reuse: false, reason: 'light-only' };
    return { reuse: true, reason: 'ok' };
}

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

export interface LightScope {
    files: string[];
    workspaces: string[];
    tests: string[];
}

/**
 * The bun workspace a changed file belongs to: the shortest directory prefix below the repo root
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
 */
export function lightScope(changedFiles: string[], exists: (p: string) => boolean = existsSync): LightScope {
    const files: string[] = [];
    const workspaces = new Set<string>();
    const tests = new Set<string>();
    for (const file of changedFiles) {
        files.push(file);
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
    return { files, workspaces: [...workspaces].sort(), tests: [...tests].sort() };
}

export interface LightCheckPlan {
    id: string;
    cmd: string;
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
 * The light sub-checks for a scope, in run order: `format-lint:changed` (biome, repo root),
 * `typecheck:<ws>` per workspace declaring the script, `test:<ws>` per workspace with related
 * tests. Tests always run through `cd <ws> &&` — never from the repo root, whose bunfig preload
 * does not apply inside the workspace.
 */
export function planLightChecks(
    scope: LightScope,
    hasTypecheck: (workspace: string) => boolean = workspaceHasTypecheck,
): LightCheckPlan[] {
    const plans: LightCheckPlan[] = [];
    if (scope.files.length > 0) {
        plans.push({ id: 'format-lint:changed', cmd: `bunx biome check ${scope.files.join(' ')}` });
    }
    for (const workspace of scope.workspaces) {
        if (hasTypecheck(workspace)) {
            plans.push({ id: `typecheck:${workspace}`, cmd: `cd ${workspace} && bun run typecheck` });
        }
    }
    const testsByWorkspace = new Map<string, string[]>();
    for (const test of scope.tests) {
        const workspace = test.slice(0, test.indexOf('/tests/'));
        const paths = testsByWorkspace.get(workspace) ?? [];
        paths.push(test.slice(workspace.length + 1));
        testsByWorkspace.set(workspace, paths);
    }
    for (const [workspace, paths] of testsByWorkspace) {
        plans.push({ id: `test:${workspace}`, cmd: `cd ${workspace} && bun test ${paths.join(' ')}` });
    }
    return plans;
}

/** Changed paths for the light tier: `git diff --name-only HEAD` plus untracked; existing only. */
function gitChangedFiles(cwd: string | undefined): string[] {
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const changed = new Set<string>();
    for (const cmd of ['git diff --name-only HEAD', 'git ls-files --others --exclude-standard']) {
        const result = runShellCommand(cmd, cwd);
        for (const line of result.output.split('\n')) {
            const file = line.trim();
            if (file.length > 0 && existsSync(abs(file))) changed.add(file);
        }
    }
    return [...changed].sort();
}

function receiptRunId(env: QualityGateEnv): string {
    return (env.runId ?? '').length > 0 ? (env.runId as string) : `pipeline-${env.wbs}`;
}

export interface LightGateResult {
    status: CheckStatus;
    scope: LightScope;
    checks: CheckReceiptRow[];
    logFile: string;
    receiptFile: string;
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

    const digest = env.proofDigest ?? '';
    const scope = lightScope(gitChangedFiles(cwd), (p) => existsSync(abs(p)));
    // Bind the fs predicates to the gate cwd, not the process cwd (tests run gates in fixtures).
    const plans = planLightChecks(scope, (workspace) => workspaceHasTypecheck(abs(workspace)));

    const reusable = new Map<string, CheckReceiptRow>();
    let preserveFullReceipt = false;
    if (digest.length > 0) {
        try {
            const prior = JSON.parse(readFileSync(abs(receiptFile), 'utf8')) as CheckReceipt;
            if (prior?.schemaVersion === RECEIPT_SCHEMA_VERSION && prior.inputDigest === digest) {
                if (prior.tier === 'full') {
                    // A full-tier receipt at the same digest is boundary evidence read by status
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
    for (const plan of plans) {
        const priorRow = reusable.get(plan.id);
        if (priorRow !== undefined) {
            checks.push(priorRow);
            skipped++;
            // 0940 R3: accumulation reuse is observable in the gate log and on stdout (the
            // action result `data`); both surfaces run this same script.
            const line = `--- light ${plan.id}: check.reused — skipped (PASS at the same input digest)\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
            continue;
        }
        const startedAtMs = Date.now();
        const result = runShellCommand(plan.cmd, cwd);
        const durationMs = Date.now() - startedAtMs;
        const status: CheckStatus = result.code === 0 ? 'PASS' : 'FAIL';
        appendFileSync(abs(logFile), `--- light ${plan.id}: ${status} (${durationMs}ms)\n${result.output}`);
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
            '--- light receipt: not written — the full-tier receipt at the same input digest is preserved\n',
        );
        process.stdout.write(
            `light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` +
                ` skipped: ${skipped}; receipt: ${receiptFile} preserved (full tier); log: ${logFile})\n`,
        );
    } else {
        writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`);
        process.stdout.write(
            `light gate ${receipt.status} (${scope.files.length} changed files; checks: ${checks.length},` +
                ` skipped: ${skipped}; receipt: ${receiptFile}; log: ${logFile})\n`,
        );
    }
    return { status: receipt.status, scope, checks, logFile, receiptFile };
}

function retryDelayMs(env: QualityGateEnv): number {
    const raw = Number.parseInt(env[RETRY_DELAY_MS_ENV] ?? '', 10);
    return Number.isFinite(raw) && raw >= 0 ? raw : RETRY_DELAY_MS_DEFAULT;
}

function gateSleep(ms: number): void {
    if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** `sh -c <cmd> > <attempt log> 2>&1` equivalent: merged output plus exit code. */
export function runShellCommand(cmd: string, cwd: string | undefined): { output: string; code: number } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-quality-gate-'));
    const path = join(dir, 'output');
    const fd = openSync(path, 'w');
    try {
        // One file descriptor preserves stream order and avoids spawnSync's pipe buffer limit.
        const result = spawnSync('sh', ['-c', cmd], { cwd, stdio: ['ignore', fd, fd] });
        if (result.error !== undefined) {
            return { output: `sh -c failed: ${result.error.message}\n`, code: 1 };
        }
        return { output: readFileSync(path, 'utf8'), code: result.status ?? 1 };
    } finally {
        closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
    }
}

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

    // run: `echo 0 > "$ATTEMPT_FILE" && : > "$LOG_FILE"`; recheck: truncate only.
    writeFileSync(abs(logFile), '');
    if (mode === 'run') writeFileSync(abs(attemptFile), '0\n');
    const gateStartedAtMs = Date.now();

    let gateRc = 0;
    let gateAttempt = 0;

    // 0940 R2 — no-progress skip, before the probe: a full-tier FAIL receipt at the current
    // proof-input digest means the fix pass changed nothing tracked, so the full chain can only
    // reproduce the failure. The marker tees to stdout (the action result `data`) and the log,
    // then the shared FAIL path below writes findings/status/verdict exactly as a red gate does.
    // The attempt counter is pipeline-owned (only the test-fix hop increments it; `recheck` never
    // touches it), so the existing cap still bounds the loop.
    const noProgressSkip =
        mode === 'recheck' && receiptFailsAtDigest(readReceipt(abs(rel('-check-receipt.json'))), env.proofDigest ?? '');
    if (noProgressSkip) {
        const line = `check.skipped-no-progress — full-tier FAIL receipt at input digest ${env.proofDigest ?? ''}; recheck skipped\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
        gateRc = 1;
    }

    // recheck probe: a probe failure is the gate failure; the gate loop is skipped.
    if (mode === 'recheck' && !noProgressSkip && (env.gateProbeCmd ?? '').length > 0) {
        const probe = runShellCommand(env.gateProbeCmd ?? '', cwd);
        writeFileSync(abs(`${logFile}.probe`), probe.output);
        gateRc = probe.code;
        appendFileSync(abs(logFile), probe.output);
        rmSync(abs(`${logFile}.probe`), { force: true });
    }

    if (gateRc === 0) {
        const delayMs = retryDelayMs(env);
        for (gateAttempt = 1; gateAttempt <= MAX_GATE_ATTEMPTS; gateAttempt++) {
            const attemptLogPath = `${logFile}.attempt-${gateAttempt}`;
            const attempt = runShellCommand(env.qualityGateCmd ?? '', cwd);
            writeFileSync(abs(attemptLogPath), attempt.output);
            const locked = isTransientLock(attempt.output);
            appendFileSync(abs(logFile), attempt.output);
            rmSync(abs(attemptLogPath), { force: true });
            gateRc = attempt.code;
            if (gateRc === 0 || !locked || gateAttempt >= MAX_GATE_ATTEMPTS) break;
            const line = retryMessage(gateAttempt);
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
            gateSleep(delayMs);
        }
    }

    // Coverage-only failures carry no `file.ext:line` anchor, so findings extraction would hand the
    // fix hop an empty file. Name one shortfall line per under-threshold row instead (0862 R2) —
    // real test failures, an absent threshold and the exit-0 contract are untouched.
    if (gateRc !== 0) {
        const gateLog = existsSync(abs(logFile)) ? readFileSync(abs(logFile), 'utf8') : '';
        if (/^\s*0 fail\b/m.test(gateLog) && !/^\s*[1-9]\d*\s+fail\b/m.test(gateLog)) {
            const bunfigPath = cwd ? join(cwd, 'bunfig.toml') : 'bunfig.toml';
            const threshold = existsSync(bunfigPath) ? parseCoverageThreshold(readFileSync(bunfigPath, 'utf8')) : null;
            if (threshold) {
                for (const shortfall of scanCoverageShortfalls(gateLog, threshold)) {
                    process.stdout.write(`${shortfall}\n`); // tee: stdout and the log
                    appendFileSync(abs(logFile), `${shortfall}\n`);
                }
            }
        }
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
    appendFileSync(abs(logFile), `proof-digest: ${env.proofDigest ?? ''}\n`);

    // 0939 R2: only `run` writes the full-tier receipt, and only with a digest to bind it to.
    let receiptFile: string | undefined;
    if (mode === 'run') {
        if ((env.proofDigest ?? '').length > 0) {
            receiptFile = join(runDir, `${env.wbs}-check-receipt.json`);
            const receipt = buildReceipt({
                wbs: env.wbs,
                runId: receiptRunId(env),
                tier: 'full',
                inputDigest: env.proofDigest ?? '',
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
            });
            writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`);
        } else {
            appendFileSync(abs(logFile), 'check-receipt: not written — env `proofDigest` is not set\n');
        }
    }

    return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile, receiptFile };
}

export const QUALITY_GATE_USAGE =
    'usage: quality-gate.ts <run|recheck|light|status>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest, runId)';

export function main(argv: string[], env: QualityGateEnv = getEnvVars(), options: QualityGateOptions = {}): number {
    const mode = argv[0];
    if (mode !== 'run' && mode !== 'recheck' && mode !== 'light' && mode !== 'status') {
        process.stderr.write(`${QUALITY_GATE_USAGE}\n`);
        return 2;
    }
    if ((env.wbs ?? '').length === 0) {
        process.stderr.write('quality-gate: env `wbs` is required\n');
        return 2;
    }
    if (mode === 'light') {
        runLightGate(env);
    } else if (mode === 'status') {
        const runDir = join(options.cwd ?? '.', '.spur', 'run');
        const verdict = readReceiptStatus(join(runDir, `${env.wbs}-check-receipt.json`), env.proofDigest ?? '');
        if (verdict.reuse) {
            // 0940 R3: reuse is observable in the gate log and on stdout (the action result
            // `data`); the `{reuse, reason}` JSON stays the last stdout line for machine readers.
            const line = `check.reused — full-tier receipt reused for input digest ${env.proofDigest ?? ''}\n`;
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(join(runDir, `${env.wbs}-test-gate.log`), line);
        }
        process.stdout.write(`${JSON.stringify(verdict)}\n`);
    } else {
        runQualityGate(mode, env);
    }
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
