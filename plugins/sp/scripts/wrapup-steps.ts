#!/usr/bin/env bun
/**
 * wrapup-steps — deterministic wrap-up capture, metrics and feature sync behind the
 * wrapup-pipeline wrappers (task 0824, feature I21, governance §1.2 composition budgets).
 *
 * Reproduces the former wrapup-pipeline `task-resolve:onEnter:0`, `task-resolve:onEnter:1`
 * (route-reason writer, moved here in 0944), `metrics-record:onEnter:0` and
 * `feature-transition:onEnter:0` shell programs one-for-one so the workflow stays inside
 * the shell-program caps while writing the same `.spur/run` artifacts:
 *   - `<runId>-wrapup-tasks.json`       normalized, deduplicated WBS capture (resolve)
 *   - `<runId>-wrapup-resolve.status`   `PASS`/`FAIL` (resolve)
 *   - `<runId>-route-reason.txt`        route reason (route-reason subcommand)
 *   - `.spur/memory/wrapup-metrics.jsonl` one row per task (metrics)
 *   - `<runId>-wrapup-metrics.status`   `PASS`/`FAIL` (metrics)
 *   - `<runId>-wrapup-sync.status`      `PASS`/`FAIL` (feature-transition)
 *
 * Environment comes from the workflow vars: `__runId`, `tasks`, `feature`, `featureGateCmd`
 * and `spurBin` (split on whitespace into a command plus prefix args, so
 * `bun apps/cli/src/index.ts` works).
 *
 * Truthfulness contract (0770 + 0783): wrap-up never mutates task status; a lookup failure is
 * recorded as FAIL, never silently omitted as success; metrics rows are serialized as JSON
 * (never interpolated printf); and the required sync succeeds only for a valid matching
 * unblocked proposal whose target status is freshly observed — a gate PASS can never convert
 * a failed sync into success. The process always exits 0 after resolve/metrics/
 * feature-transition; the verdict lives in the status file (an empty `feature` is a
 * mis-invocation and exits 1).
 *
 * Node-builtin imports only; pure helpers are exported for unit testing (ADR-065).
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export interface WrapupStepsEnv {
    __runId?: string;
    tasks?: string;
    feature?: string;
    featureGateCmd?: string;
    spurBin?: string;
    [key: string]: string | undefined;
}

export interface WrapupStepsOptions {
    /** Base directory for `.spur/run` / `.spur/memory`; defaults to the process cwd. */
    cwd?: string;
}

/** jq `//` chain: first value that is neither null, undefined nor false; otherwise the fallback. */
export function jqPick(...values: unknown[]): unknown {
    for (const value of values) {
        if (value !== null && value !== undefined && value !== false) return value;
    }
    return values[values.length - 1];
}

/** `jq -r` text rendering of a JSON value (strings raw, everything else compact JSON). */
function jqText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Canonical four-digit WBS string: whitespace is rejected, not trimmed (0783 R1). */
export const WBS_PATTERN = /^[0-9]{4}$/;

/** `spurBin` splits on whitespace into a command plus prefix args (so `bun x.ts` works). */
export function spurCommand(spurBin: string | undefined): { cmd: string; prefix: string[] } {
    const parts = (spurBin ?? 'spur')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
    return { cmd: parts[0] ?? 'spur', prefix: parts.slice(1) };
}

function spur(
    env: WrapupStepsEnv,
    args: string[],
    options: { cwd?: string; stderr?: 'inherit' } = {},
): { status: number; stdout: string } {
    const { cmd, prefix } = spurCommand(env.spurBin);
    const result = spawnSync(cmd, [...prefix, ...args], {
        cwd: options.cwd,
        encoding: 'utf8',
        ...(options.stderr === 'inherit' ? { stdio: ['ignore', 'pipe', 'inherit'] as const } : {}),
    });
    if (result.error !== undefined) return { status: result.status ?? 1, stdout: '' };
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

/** jq status-chain semantics for `task show` output; null/missing status means the lookup failed. */
export function taskStatusOf(taskJson: string): { resolved: unknown; present: boolean } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(taskJson);
    } catch {
        return { resolved: null, present: false };
    }
    if (parsed === null || typeof parsed !== 'object') return { resolved: null, present: false };
    const frontmatter = (parsed as Record<string, unknown>).frontmatter;
    const fmStatus =
        frontmatter !== null && typeof frontmatter === 'object'
            ? (frontmatter as Record<string, unknown>).status
            : undefined;
    const status = (parsed as Record<string, unknown>).status;
    // jq: `.frontmatter.status // .status` is null only when frontmatter.status is null/absent
    // AND .status is null; a trailing false is kept (false != null in jq).
    if (fmStatus === null || fmStatus === undefined) {
        return { resolved: status ?? null, present: status !== undefined && status !== null };
    }
    return { resolved: fmStatus, present: true };
}

/** One truthy status display: `unresolved` when the lookup left nothing to show. */
function statusDisplay(taskJson: string): string {
    const { resolved } = taskStatusOf(taskJson);
    if (resolved === null || resolved === undefined || resolved === false) return 'unresolved';
    return jqText(resolved);
}

export interface ResolveResult {
    status: 'PASS' | 'FAIL';
    statusFile: string;
    tasksFile: string;
    /** Exit code the workflow wrapper observes (only an empty __runId is a hard failure). */
    exitCode: number;
}

/** `resolve` — parse and validate vars.tasks exactly once, then resolve every member. */
export function resolveTasks(env: WrapupStepsEnv, options: WrapupStepsOptions = {}): ResolveResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? '';
    if (runId.length === 0) {
        process.stderr.write('task-resolve: __runId is empty — refusing the legacy fixed-path fallback\n');
        return { status: 'FAIL', statusFile: '', tasksFile: '', exitCode: 1 };
    }
    mkdirSync(cwd ? join(cwd, '.spur', 'run') : join('.spur', 'run'), { recursive: true });
    const relTasksFile = join('.spur', 'run', `${runId}-wrapup-tasks.json`);
    const relReasonFile = join('.spur', 'run', `${runId}-route-reason.txt`);
    const relStatusFile = join('.spur', 'run', `${runId}-wrapup-resolve.status`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);

    const writeFail = (reason: string): ResolveResult => {
        writeFileSync(abs(relReasonFile), reason);
        writeFileSync(abs(relStatusFile), 'FAIL\n');
        return { status: 'FAIL', statusFile: relStatusFile, tasksFile: relTasksFile, exitCode: 0 };
    };

    let parsedTasks: unknown;
    try {
        parsedTasks = JSON.parse(env.tasks ?? '');
    } catch {
        parsedTasks = undefined;
    }
    const validArray =
        Array.isArray(parsedTasks) && parsedTasks.every((w) => typeof w === 'string' && WBS_PATTERN.test(w));
    if (!validArray) {
        process.stderr.write(
            'task-resolve: tasks must be a JSON array of canonical four-digit WBS strings (whitespace is rejected, not trimmed)\n',
        );
        return writeFail('failed:tasks is not a JSON array of canonical four-digit WBS strings');
    }

    // Dedupe in first-seen order (never sorted).
    const deduped: string[] = [];
    for (const wbs of parsedTasks as string[]) {
        if (!deduped.includes(wbs)) deduped.push(wbs);
    }
    writeFileSync(abs(relTasksFile), `${JSON.stringify(deduped)}\n`);

    let unresolved = false;
    for (const wbs of deduped) {
        const shown = spur(env, ['task', 'show', wbs, '--json'], { cwd });
        const status = shown.status === 0 ? statusDisplay(shown.stdout) : 'unresolved';
        if (status !== 'done' && status !== 'cancelled') {
            process.stderr.write(
                `task-resolve: task ${wbs} did not resolve to a completed status (status=${status})\n`,
            );
            unresolved = true;
        }
    }
    if (unresolved) {
        return writeFail(`failed:unresolved or non-completed task (see ${relTasksFile})`);
    }
    writeFileSync(abs(relStatusFile), 'PASS\n');
    return { status: 'PASS', statusFile: relStatusFile, tasksFile: relTasksFile, exitCode: 0 };
}

/**
 * 0944 R3 route-reason map — mirrors the former inline jq object one-for-one, plus the
 * `safety` entry (operator-forced doc-sync). `fast:drift-probe-clean` is NOT in the map:
 * it is only claimable when the drift probe itself classified the wrapup clean.
 */
const ROUTE_REASON_TABLE: Record<string, string> = {
    fast: 'fast:evidence complete+consistent',
    '': 'safety:missing evidence (mode empty)',
    unknown: 'safety:unknown evidence quality',
    conflict: 'safety:conflicting evidence',
    safety: 'safety:operator-forced doc-sync',
};

export interface RouteReasonResult {
    reason: string;
    reasonFile: string;
    exitCode: number;
}

/**
 * `route-reason` — derive the task-resolve route reason from the validated capture, the
 * projected mode and the drift probe verdict (0944). A resolve FAIL keeps its own reason
 * (nothing is written, exit 0). A missing or corrupted capture never yields a `skipped`
 * or `fast:drift-probe-clean` claim. The log line is run-attributed (0770).
 */
export function writeRouteReason(env: WrapupStepsEnv, options: WrapupStepsOptions = {}): RouteReasonResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? '';
    if (runId.length === 0) {
        process.stderr.write('task-resolve: __runId is empty — refusing to write a route reason\n');
        return { reason: '', reasonFile: '', exitCode: 1 };
    }
    mkdirSync(cwd ? join(cwd, '.spur', 'run') : join('.spur', 'run'), { recursive: true });
    mkdirSync(cwd ? join(cwd, '.spur', 'memory') : join('.spur', 'memory'), { recursive: true });
    const relReasonFile = join('.spur', 'run', `${runId}-route-reason.txt`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);

    const statusFile = join('.spur', 'run', `${runId}-wrapup-resolve.status`);
    if (readFileSyncSafe(abs(statusFile))?.trim() === 'FAIL') {
        // The failed reason stands; the failed edge already owns the run.
        return { reason: '', reasonFile: relReasonFile, exitCode: 0 };
    }

    // A missing/corrupted capture stays at -1: never 0, so no skipped claim can be invented.
    let taskCount = -1;
    try {
        const parsed: unknown = JSON.parse(
            readFileSync(abs(join('.spur', 'run', `${runId}-wrapup-tasks.json`)), 'utf8'),
        );
        if (Array.isArray(parsed)) taskCount = parsed.length;
    } catch {
        // treated as uncountable below
    }
    let probeClean = false;
    try {
        const probe: unknown = JSON.parse(readFileSync(abs(join('.spur', 'run', `${runId}-drift-probe.json`)), 'utf8'));
        probeClean = (probe as { clean?: unknown } | null)?.clean === true;
    } catch {
        // no probe verdict — the map decides
    }

    const mode = env.mode ?? '';
    let reason: string;
    if (taskCount === 0) {
        reason = 'skipped:empty task list';
    } else if (mode === 'fast' && probeClean) {
        reason = 'fast:drift-probe-clean';
    } else {
        reason = ROUTE_REASON_TABLE[mode] ?? `safety:unrecognized evidence (mode=${mode})`;
    }
    writeFileSync(abs(relReasonFile), `${reason}\n`);
    appendFileSync(abs(join('.spur', 'memory', 'wrapup-routes.log')), `${runId} ${reason}\n`);
    return { reason, reasonFile: relReasonFile, exitCode: 0 };
}

function readFileSyncSafe(path: string): string | null {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return null;
    }
}

export interface MetricsResult {
    status: 'PASS' | 'FAIL';
    statusFile: string;
}

/** `metrics` — append one JSONL row per captured task; a missing row is never silently absorbed. */
export function runMetrics(env: WrapupStepsEnv, options: WrapupStepsOptions = {}): MetricsResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? '';
    mkdirSync(cwd ? join(cwd, '.spur', 'run') : join('.spur', 'run'), { recursive: true });
    mkdirSync(cwd ? join(cwd, '.spur', 'memory') : join('.spur', 'memory'), { recursive: true });
    const relStatusFile = join('.spur', 'run', `${runId}-wrapup-metrics.status`);
    const relTasksFile = join('.spur', 'run', `${runId}-wrapup-tasks.json`);
    const relMetricsFile = join('.spur', 'memory', 'wrapup-metrics.jsonl');
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);

    const fail = (): MetricsResult => {
        writeFileSync(abs(relStatusFile), 'FAIL\n');
        return { status: 'FAIL', statusFile: relStatusFile };
    };

    let captured: unknown;
    try {
        captured = JSON.parse(readFileSync(abs(relTasksFile), 'utf8'));
    } catch {
        captured = undefined;
    }
    const validCapture = Array.isArray(captured) && captured.every((w) => typeof w === 'string' && WBS_PATTERN.test(w));
    if (!validCapture) {
        process.stderr.write(
            'metrics-record: run-scoped task capture missing, corrupted or non-canonical — refusing to record metrics\n',
        );
        return fail();
    }

    let metricsRc = 0;
    for (const wbs of captured as string[]) {
        const shown = spur(env, ['task', 'show', wbs, '--json'], { cwd });
        const lookup = shown.status === 0 ? taskStatusOf(shown.stdout) : { resolved: null, present: false };
        if (!lookup.present) {
            process.stderr.write(
                `metrics-record: task ${wbs} lookup failed or was malformed — recording FAIL instead of silently omitting its metrics row\n`,
            );
            metricsRc = 1;
            continue;
        }
        const parsed = JSON.parse(shown.stdout) as Record<string, unknown>;
        const frontmatter =
            parsed.frontmatter !== null && typeof parsed.frontmatter === 'object'
                ? (parsed.frontmatter as Record<string, unknown>)
                : {};
        const featureId = String(jqPick(frontmatter.feature_id, parsed.feature_id, ''));
        const status = String(jqPick(frontmatter.status, parsed.status, 'unknown'));

        // jq `//` semantics: null and false count as missing; an empty string result stays UNKNOWN.
        let verdict = 'UNKNOWN';
        const verdictPath = join('.spur', 'run', `${wbs}-verdict.json`);
        if (existsSync(abs(verdictPath))) {
            try {
                const raw = jqPick(JSON.parse(readFileSync(abs(verdictPath), 'utf8')).verdict, 'UNKNOWN');
                const text = raw === 'UNKNOWN' ? 'UNKNOWN' : jqText(raw);
                if (text.length > 0) verdict = text;
            } catch {
                // unreadable verdict file keeps UNKNOWN telemetry
            }
        }

        const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
        const row = { wbs, feature_id: featureId, status, verdict, timestamp };
        try {
            appendFileSync(abs(relMetricsFile), `${JSON.stringify(row)}\n`);
        } catch {
            process.stderr.write(
                `metrics-record: metrics append failed for task ${wbs} — recording FAIL instead of claiming the row landed\n`,
            );
            metricsRc = 1;
        }
    }
    const status: 'PASS' | 'FAIL' = metricsRc === 0 ? 'PASS' : 'FAIL';
    writeFileSync(abs(relStatusFile), `${status}\n`);
    return { status, statusFile: relStatusFile };
}

export interface FeatureTransitionResult {
    status: 'PASS' | 'FAIL';
    statusFile: string;
    /** Only an empty vars.feature is a hard failure (mis-invocation, not a blocked sync). */
    exitCode: number;
}

/** Classify one sync result per 0783 R4; returns the blocking reason or '' for a verified sync. */
export function classifySync(
    syncOutput: string,
    syncRc: number,
    feature: string,
    observed: string,
): { reason: string; applied: string; syncOk: boolean } {
    if (syncRc !== 0) {
        return { reason: `sync exited nonzero (rc=${syncRc})`, applied: 'unreadable', syncOk: false };
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(syncOutput);
    } catch {
        parsed = undefined;
    }
    const obj = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : undefined;
    const proposal =
        obj?.proposal !== null && typeof obj?.proposal === 'object'
            ? (obj.proposal as Record<string, unknown>)
            : undefined;
    const shapeOk =
        obj !== undefined &&
        proposal !== undefined &&
        typeof proposal.featureId === 'string' &&
        typeof proposal.from === 'string' &&
        typeof proposal.to === 'string' &&
        typeof obj.applied === 'boolean';
    if (!shapeOk) {
        return { reason: 'malformed or unreadable sync result', applied: 'unreadable', syncOk: false };
    }
    const applied = obj.applied === true ? 'true' : 'false';
    const pFrom = String(jqPick(proposal.from, ''));
    const pTo = String(jqPick(proposal.to, ''));
    if (String(jqPick(proposal.featureId, '')) !== feature) {
        return { reason: `sync proposal does not match feature ${feature}`, applied, syncOk: false };
    }
    if (proposal.gateBlocked === true) {
        return {
            reason: 'sync proposal is gate-blocked — a blocked sync is not a no-change success',
            applied,
            syncOk: false,
        };
    }
    if (proposal.requiresConfirm === true) {
        return { reason: 'sync proposal requires operator confirmation', applied, syncOk: false };
    }
    if (applied === 'true' && observed !== pTo) {
        return {
            reason: `applied sync did not land on the proposal target (observed=${observed}, to=${pTo})`,
            applied,
            syncOk: false,
        };
    }
    if (applied === 'false' && (pFrom !== pTo || observed !== pTo)) {
        return {
            reason: `sync applied nothing without a from==to observed no-op (from=${pFrom}, to=${pTo}, observed=${observed})`,
            applied,
            syncOk: false,
        };
    }
    return { reason: '', applied, syncOk: true };
}

/** `feature-transition` — required bounded sync, observation and the affected-feature gate. */
export function runFeatureTransition(env: WrapupStepsEnv, options: WrapupStepsOptions = {}): FeatureTransitionResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? '';
    const feature = env.feature ?? '';
    mkdirSync(cwd ? join(cwd, '.spur', 'run') : join('.spur', 'run'), { recursive: true });
    const relStatusFile = join('.spur', 'run', `${runId}-wrapup-sync.status`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    if (feature.length === 0) {
        process.stderr.write(
            'feature-transition: vars.feature is empty — refusing no-op feature sync (mis-invocation, not a blocked sync)\n',
        );
        return { status: 'FAIL', statusFile: relStatusFile, exitCode: 1 };
    }

    // Three branches, first that exists relative to the cwd; current arguments including --spur-bin.
    let syncOutput = '';
    let syncRc = 1;
    const boundedTs = join('plugins', 'sp', 'scripts', 'feature-sync-bounded.ts');
    const boundedArgs = [feature, '--spur-bin', env.spurBin ?? 'spur', '--json'];
    if (existsSync(cwd ? join(cwd, boundedTs) : boundedTs)) {
        const result = spawnSync('bun', [boundedTs, ...boundedArgs], { cwd, encoding: 'utf8' });
        syncOutput = result.stdout ?? '';
        syncRc = result.status ?? 1;
        if (result.stderr !== null && result.stderr.length > 0) process.stderr.write(result.stderr);
    } else {
        const probe = spawnSync('superskill', ['script', 'path', 'sp', 'feature-sync-bounded.mjs'], {
            cwd,
            encoding: 'utf8',
        });
        const twin = probe.status === 0 ? (probe.stdout ?? '').trim() : '';
        if (twin.length > 0 && existsSync(twin)) {
            const result = spawnSync('node', [twin, ...boundedArgs], { cwd, encoding: 'utf8' });
            syncOutput = result.stdout ?? '';
            syncRc = result.status ?? 1;
            if (result.stderr !== null && result.stderr.length > 0) process.stderr.write(result.stderr);
        } else {
            // Last branch: stderr streams through (visible), stdout is the JSON payload.
            const result = spur(env, ['feature', 'sync', feature, '--json'], { cwd, stderr: 'inherit' });
            syncOutput = result.stdout;
            syncRc = result.status;
        }
    }
    process.stdout.write(`${syncOutput}\n`);

    const shown = spur(env, ['feature', 'show', feature, '--json'], { cwd });
    let observed = '';
    if (shown.status === 0) {
        try {
            const parsed = JSON.parse(shown.stdout) as Record<string, unknown>;
            const frontmatter =
                parsed.frontmatter !== null && typeof parsed.frontmatter === 'object'
                    ? (parsed.frontmatter as Record<string, unknown>)
                    : {};
            const picked = jqPick(parsed.status, frontmatter.status, '');
            observed = picked === '' ? '' : jqText(picked);
        } catch {
            observed = '';
        }
    }
    if (observed.length === 0) observed = 'unreadable';

    const classified = classifySync(syncOutput, syncRc, feature, observed);
    const { reason, applied } = classified;
    const syncOk = classified.syncOk;

    let gate = 'skipped';
    if (applied === 'true' || syncRc !== 0) {
        process.stdout.write(
            `feature-transition: sync applied or failed after a possible partial transition for ${feature} — running feature gate: ${env.featureGateCmd ?? ''}\n`,
        );
        const gateResult = spawnSync('sh', ['-c', env.featureGateCmd ?? ''], { cwd, stdio: 'inherit' });
        if ((gateResult.status ?? 1) === 0) {
            gate = 'PASS';
            process.stdout.write(`feature-transition: feature gate PASS for feature ${feature}\n`);
        } else {
            gate = 'FAIL';
            process.stderr.write(
                `feature-transition: feature gate FAIL for feature ${feature} — inspect findings before reporting the transition complete\n`,
            );
        }
    } else {
        process.stdout.write(
            `feature-transition: sync did not apply a transition (rc=${syncRc}, applied=${applied}) — feature gate skipped\n`,
        );
    }

    let syncStatus: 'PASS' | 'FAIL';
    if (!syncOk || gate === 'FAIL') {
        syncStatus = 'FAIL';
        process.stderr.write(
            `feature-transition: required synchronization failed for ${feature} — ${reason}; gate=${gate}\n`,
        );
    } else if (applied === 'false') {
        syncStatus = 'PASS';
        process.stdout.write(
            `feature-transition: feature sync verified for ${feature} (from==to observed at ${observed}, gate=${gate}) — explicit no-change\n`,
        );
    } else {
        syncStatus = 'PASS';
        process.stdout.write(
            `feature-transition: feature sync verified for ${feature} (applied, observed=${observed}, gate=${gate})\n`,
        );
    }
    writeFileSync(abs(relStatusFile), `${syncStatus}\n`);
    return { status: syncStatus, statusFile: relStatusFile, exitCode: 0 };
}

export const WRAPUP_STEPS_USAGE =
    'usage: wrapup-steps.ts <resolve|route-reason|metrics|feature-transition>  (env: __runId, tasks, mode, feature, featureGateCmd, spurBin)';

export function main(argv: string[], env: WrapupStepsEnv = getEnvVars(), options: WrapupStepsOptions = {}): number {
    const sub = argv[0];
    if (sub === 'resolve') return resolveTasks(env, options).exitCode;
    if (sub === 'route-reason') return writeRouteReason(env, options).exitCode;
    if (sub === 'metrics') {
        runMetrics(env, options);
        return 0;
    }
    if (sub === 'feature-transition') return runFeatureTransition(env, options).exitCode;
    process.stderr.write(`${WRAPUP_STEPS_USAGE}\n`);
    return 2;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
