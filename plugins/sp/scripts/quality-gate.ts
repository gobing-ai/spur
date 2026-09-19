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
 *   recheck truncate the log, execute the probe first (probe failure is the gate
 *           failure, the gate loop is skipped), then execute the gate loop
 *
 * Retry contract: a failed attempt is retried (up to 5 total attempts) only when its
 * output matches a SQLite busy/locked error; the delay defaults to 10 seconds and is
 * overridable via `SPUR_QUALITY_GATE_RETRY_DELAY_MS` (tests).
 *
 * Environment: `wbs` (required), `qualityGateCmd`, `gateProbeCmd` (recheck), `proofDigest`.
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

    let gateRc = 0;
    let gateAttempt = 0;

    // recheck probe: a probe failure is the gate failure; the gate loop is skipped.
    if (mode === 'recheck' && (env.gateProbeCmd ?? '').length > 0) {
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

    return { status, attempts: gateAttempt, logFile, findingsFile, statusFile, attemptFile };
}

export const QUALITY_GATE_USAGE =
    'usage: quality-gate.ts <run|recheck>  (env: wbs, qualityGateCmd, gateProbeCmd, proofDigest)';

export function main(argv: string[], env: QualityGateEnv = getEnvVars()): number {
    const mode = argv[0];
    if (mode !== 'run' && mode !== 'recheck') {
        process.stderr.write(`${QUALITY_GATE_USAGE}\n`);
        return 2;
    }
    if ((env.wbs ?? '').length === 0) {
        process.stderr.write('quality-gate: env `wbs` is required\n');
        return 2;
    }
    runQualityGate(mode, env);
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
