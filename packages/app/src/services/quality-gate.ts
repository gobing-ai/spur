/**
 * Quality-gate service — the shared retry/bounded-findings gate behind the task-pipeline
 * test-gate wrappers (task 0823, feature I21, governance §1.2 composition budgets). Task 1006
 * R1 relocated the logic here from `plugins/sp/scripts/quality-gate.ts`; the plugin script is
 * ADR-130 glue (argv/env) over the bundled core (see scripts/commands/bundle-plugin-lib.ts).
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
 *
 * Modes:
 * - `run`    full tier: the caller's `qualityGateCmd`, retried and bounded
 * - `recheck` same but skips the receipt preconditions (`receiptFailsAtDigest`)
 * - `light`  changed-scope tier (task 0939, ADR-124): biome on the changed files,
 *            typecheck only when a workspace file changed (`planLightChecks` over
 *            `lightScope`); sub-check failures carry bounded findings
 * - `status` print `{reuse, reason}` for the task's receipt and exit 0
 *
 * Check receipts (task 0939, ADR-124): `run` and `recheck` write `.spur/run/<wbs>-check-receipt.json`
 * only when the env carries a `proofDigest` (0862 R3 proof P1). The receipt binds the run to the
 * proof-input digest (same fingerprint `inline-run-setup.ts --fingerprint` prints, 0862 R5), so a
 * later gate invocation with an unchanged digest can short-circuit to reuse instead of re-running
 * the full suite. `status` reports the verdict for the task result without running anything.
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
import { getEnvVar, getEnvVars, setEnvVar } from '@gobing-ai/ts-utils';

/** Hard cap on lock-retry attempts before `run` gives up (the old shell `for i in 1..5`). */
export const MAX_GATE_ATTEMPTS = 5;
/** Findings cap for the bounded failure summary (0772 R1) and the findings file. */
export const MAX_FINDINGS = 20;
/** Base delay between lock retries, in milliseconds. */
export const RETRY_DELAY_MS_DEFAULT = 10_000;
/** Env var overriding the base lock-retry delay (milliseconds). */
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

/** Env/argv inputs the gate runs on: the wbs-scoped commands, probe, and proof digest. */
export interface QualityGateEnv {
    wbs: string;
    qualityGateCmd?: string;
    gateProbeCmd?: string;
    proofDigest?: string;
    /** Receipt run identity; `pipeline-<wbs>` when absent (task-pipeline convention). */
    runId?: string;
    [key: string]: string | undefined;
}

/** Optional gate knobs (cwd override for tests). */
export interface QualityGateOptions {
    /** Base directory for `.spur/run`; defaults to the process cwd (CLI behavior). */
    cwd?: string;
}

/** Where the gate wrote its run artifacts (log, findings, status, attempt, receipt). */
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

const TEST_FILE_PATTERN = /\.test\.tsx?$/;

/** Files/workspaces a light gate should check, derived from changed tracked files (0939). */
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

/**
 * Quote one argument for `sh -c`. Changed-file names come from the working tree (untracked files
 * included), so an unquoted `x$(cmd).ts` would run `cmd` and a space would split the argument.
 * Plain paths pass through unchanged to keep receipts readable.
 */
export function shQuote(arg: string): string {
    return /^[\w./@+-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** One planned light check: a stable id plus the shell command to run. */
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
        plans.push({ id: 'format-lint:changed', cmd: `bunx biome check ${scope.files.map(shQuote).join(' ')}` });
    }
    for (const workspace of scope.workspaces) {
        if (hasTypecheck(workspace)) {
            plans.push({ id: `typecheck:${workspace}`, cmd: `cd ${shQuote(workspace)} && bun run typecheck` });
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
        plans.push({
            id: `test:${workspace}`,
            cmd: `cd ${shQuote(workspace)} && bun test ${paths.map(shQuote).join(' ')}`,
        });
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

//** Light-gate outcome: the verdict plus the scope it checked. */
export interface LightGateResult {
    status: CheckStatus;
    scope: LightScope;
    checks: CheckReceiptRow[];
    logFile: string;
    receiptFile: string;
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

/** `sh -c <cmd> > <attempt log> 2>&1` equivalent: merged output plus exit code. */
export function runShellCommand(
    cmd: string,
    cwd: string | undefined,
    extraEnv?: Record<string, string>,
): { output: string; code: number } {
    const dir = mkdtempSync(join(tmpdir(), 'spur-quality-gate-'));
    const path = join(dir, 'output');
    const fd = openSync(path, 'w');
    try {
        // One file descriptor preserves stream order and avoids spawnSync's pipe buffer limit.
        // Bun does not propagate inherited-env mutations to spawned children, so the gate lock
        // token (R6 re-entrancy) must ride in explicitly.
        const result = spawnSync('sh', ['-c', cmd], {
            cwd,
            stdio: ['ignore', fd, fd],
            env: extraEnv === undefined ? undefined : { ...getEnvVars(), ...extraEnv },
        });
        if (result.error !== undefined) {
            return { output: `sh -c failed: ${result.error.message}\n`, code: 1 };
        }
        return { output: readFileSync(path, 'utf8'), code: result.status ?? 1 };
    } finally {
        closeSync(fd);
        rmSync(dir, { recursive: true, force: true });
    }
}

// ─── Host-wide full-gate lock (task 1127) ───

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
 * Test seam for the P2-1 ownership race (1127 review): holds the lock dir between its `mkdir`
 * and the marker write so a test can recreate the dir underneath the creator. Zero in production.
 */
export const GATE_LOCK_MKDIR_HOLD_MS_ENV = 'SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS';
/** Sleep between lost-claim retries so a pathological lost-race cannot hot-spin (1127 review P3-2). */
const GATE_LOCK_LOST_RACE_SLEEP_MS = 20;
/** Consecutive lost-claim retries after which the waiter says so once — visible, never fatal. */
const GATE_LOCK_LOST_RACE_LOG_AT = 250;

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

/**
 * Signal-0 existence probe; unknown failures (EPERM) fail closed as a live holder.
 *
 * Residual risk (1127 review P4, accepted): liveness is pid-based, so a pid recycled by an
 * unrelated process reads as a live holder and the lock waits until that process exits. The
 * alternative (comparing a recorded start time against the process start time) is not portable
 * across the supported platforms, and a wedged queue is visible via the holder line + queueWaitMs.
 */
function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code !== 'ESRCH';
    }
}

/** First sorted marker with a readable claim; `null` when the dir is unreadable or claimless. */
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
            // Unreadable claim: liveness falls back to a grace poll below — never a hot spin.
        }
    }
    return null;
}

/**
 * Serialize the full quality gate host-wide (1127 R1): one `mkdir` claim per holder, released
 * before returning. A live holder is named on exactly one operator-facing line with its wbs,
 * run id, pid, cwd and held time (AC1); a dead holder's claim is reclaimed with its pid logged
 * (AC2); the caller's own token re-enters without waiting (R6); `SPUR_GATE_LOCK=off` disables
 * the lock entirely (AC6). Polling is a blocking sleep — nothing else is scheduled while waiting.
 */
export function acquireGateLock(env: QualityGateEnv, logLine: (line: string) => void = (): void => {}): GateLock {
    if ((getEnvVar(GATE_LOCK_OFF_ENV) ?? '') === 'off') {
        return { release(): void {}, queueWaitMs: 0, token: '' };
    }
    const dir = gateLockDir();
    mkdirSync(dirname(dir), { recursive: true });
    const pollMs = gateLockPollMs();
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
            try {
                currentIno = statSync(dir).ino;
            } catch {
                // Reclaimed before we looked — same lost race as above.
            }
            if (currentIno !== dirIno) {
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
                logLine(
                    `quality gate lock: waiting for holder (wbs ${held.claim.wbs}, run ${held.claim.runId}, pid ${held.claim.pid}, cwd ${held.claim.cwd}, held ${Date.now() - held.claim.startedAt}ms)\n`,
                );
            }
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

    // 1016 R1 — PASS receipt reuse, next to the 0940 no-progress skip: a full-tier PASS receipt
    // bound to the current proof-input digest means these exact inputs already passed the full
    // gate, so re-entry (run or recheck) skips the probe and the gate command. `readReceiptStatus`
    // fails closed — missing, failed, stale, light-only or an empty digest never reuse — and the
    // skip leaves the receipt untouched, so a FAIL can never be laundered into a reusable PASS.
    const reusePass = commandPresent && readReceiptStatus(abs(rel('-check-receipt.json')), env.proofDigest ?? '').reuse;
    if (reusePass) {
        const line = `check.reused — full-tier PASS receipt at input digest ${env.proofDigest ?? ''}; gate skipped\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
        writeFileSync(abs(findingsFile), extractFindings(readFileSync(abs(logFile), 'utf8')));
        writeFileSync(abs(statusFile), 'PASS\n');
        return { status: 'PASS', attempts: 0, logFile, findingsFile, statusFile, attemptFile };
    }

    // 0940 R2 — no-progress skip, before the probe: a full-tier FAIL receipt at the current
    // proof-input digest means the fix pass changed nothing tracked, so the full chain can only
    // reproduce the failure. The marker tees to stdout (the action result `data`) and the log,
    // then the shared FAIL path below writes findings/status/verdict exactly as a red gate does.
    // The attempt counter is pipeline-owned (only the test-fix hop increments it; `recheck` never
    // touches it), so the existing cap still bounds the loop.
    const noProgressSkip =
        commandPresent &&
        mode === 'recheck' &&
        receiptFailsAtDigest(readReceipt(abs(rel('-check-receipt.json'))), env.proofDigest ?? '');
    if (noProgressSkip) {
        const line = `check.skipped-no-progress — full-tier FAIL receipt at input digest ${env.proofDigest ?? ''}; recheck skipped\n`;
        process.stdout.write(line); // tee: stdout and the log
        appendFileSync(abs(logFile), line);
        gateRc = 1;
    }

    // recheck probe: a probe failure is the gate failure; the gate loop is skipped.
    if (mode === 'recheck' && gateRc === 0 && (env.gateProbeCmd ?? '').length > 0) {
        const probe = runShellCommand(env.gateProbeCmd ?? '', cwd);
        writeFileSync(abs(`${logFile}.probe`), probe.output);
        gateRc = probe.code;
        appendFileSync(abs(logFile), probe.output);
        rmSync(abs(`${logFile}.probe`), { force: true });
    }

    // 1127 R1/R4: the host-wide lock wraps only the full-gate attempt loop — reuse, the
    // no-progress skip, the probe, and the light/deferred/status tiers stay lockless.
    let queueWaitMs = 0;
    let gateRuntimeMs = 0;
    if (gateRc === 0) {
        const delayMs = retryDelayMs(env);
        const lockLine = (line: string): void => {
            process.stdout.write(line); // tee: stdout and the log
            appendFileSync(abs(logFile), line);
        };
        const lock = acquireGateLock(env, lockLine);
        queueWaitMs = lock.queueWaitMs;
        lockLine(`quality gate lock: queueWaitMs=${queueWaitMs}\n`);
        const gateRuntimeStartMs = Date.now();
        const previousToken = getEnvVar(GATE_LOCK_TOKEN_ENV);
        if (lock.token.length > 0) setEnvVar(GATE_LOCK_TOKEN_ENV, lock.token); // R6: child re-enters
        try {
            for (gateAttempt = 1; gateAttempt <= MAX_GATE_ATTEMPTS; gateAttempt++) {
                const attemptLogPath = `${logFile}.attempt-${gateAttempt}`;
                const attempt = runShellCommand(
                    env.qualityGateCmd ?? '',
                    cwd,
                    lock.token.length > 0 ? { [GATE_LOCK_TOKEN_ENV]: lock.token } : undefined,
                );
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
        } finally {
            setEnvVar(GATE_LOCK_TOKEN_ENV, previousToken); // undefined deletes: absence restored exactly
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

    // 0939 R2: the gate writes the full-tier receipt only with a digest to bind it to. 0976 R1:
    // `recheck` persists the receipt it evaluated too, so a second recheck at the same digest can
    // take the no-progress skip. A skip leaves the FAIL receipt it matched untouched — a skip never
    // rewrites a receipt, so it can never launder FAIL into PASS.
    let receiptFile: string | undefined;
    // 1038 R3: the vacuous-`qualityGateCmd` guard rejects before any gate execution — it records
    // no receipt. The log/status/findings carry the FAIL; a pre-existing receipt stays untouched.
    if (!noProgressSkip && commandPresent) {
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
                queueWaitMs,
                gateRuntimeMs,
            });
            writeFileSync(abs(receiptFile), `${JSON.stringify(receipt, null, 2)}\n`);
        } else {
            appendFileSync(abs(logFile), 'check-receipt: not written — env `proofDigest` is not set\n');
        }
    }

    return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile, receiptFile };
}
