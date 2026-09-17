#!/usr/bin/env bun
/**
 * feature-dev-precheck — portable identity/roster gate behind the feature-dev pipeline
 * precheck (task 0825, feature I21, governance §1.1 composition budgets).
 *
 * Ports the former `feature-dev.yaml` `precheck:onEnter:0` shell program one-for-one so the
 * workflow stays inside the shell-program caps while writing the same `.spur/run` artifacts:
 *   - `<runId>-feature-dev-feature.json`    merged `feature show` capture (stdout + stderr)
 *   - `<runId>-feature-dev-roster.json`     merged `task list --feature` capture
 *   - `<runId>-feature-dev-tasks.txt`       frozen sorted todo WBS list, comma-joined
 *   - `<runId>-feature-dev-precheck.status` `PASS`/`FAIL`
 *
 * Failure ladder (first failing check wins, message to stderr, FAIL status):
 *   1. identity/roster read failure — missing featureId/runId, unknown feature, or a
 *      non-zero rc from any of the three reads (message carries the rc triple);
 *   2. roster not a non-empty JSON array;
 *   3. roster contract breach — empty/duplicate/non-string WBS identities or a status
 *      outside todo/done/cancelled/backlog/wip/testing/blocked;
 *   4. refinement-blocking statuses present (backlog/wip/testing/blocked).
 *
 * Environment: `featureId`, `__runId` (required), `spurBin` (split on whitespace into a
 * command plus prefix args). Soft-fail contract: the process always exits 0; the verdict
 * lives in the status file. Node-builtin imports only; pure helpers are exported for unit
 * testing (ADR-065).
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/ts-utils';

/** Statuses that must be refined/resumed through their own pipelines before batching. */
export const BLOCKING_STATUSES = ['backlog', 'wip', 'testing', 'blocked'] as const;

/** Every status a roster row may carry (anything else fails the structural contract). */
export const KNOWN_STATUSES = ['todo', 'done', 'cancelled', ...BLOCKING_STATUSES] as const;

export interface FeatureDevPrecheckEnv {
    featureId?: string;
    __runId?: string;
    spurBin?: string;
    [key: string]: string | undefined;
}

export interface FeatureDevPrecheckOptions {
    /** Base directory for `.spur/run`; defaults to the process cwd (CLI behavior). */
    cwd?: string;
    /** Extra environment for the spawned CLI reads (merged over getEnvVars()). */
    env?: Record<string, string>;
}

export interface FeatureDevPrecheckResult {
    status: 'PASS' | 'FAIL';
    featureFile: string;
    rosterFile: string;
    tasksFile: string;
    statusFile: string;
    /** Frozen todo list; empty string on FAIL. */
    tasks: string;
}

export interface RosterRow {
    wbs: unknown;
    status: unknown;
}

/** Identity gate: rc 0 when featureId and __runId are both non-empty, else 1. */
export function identityRc(featureId: string | undefined, runId: string | undefined): number {
    return featureId && runId ? 0 : 1;
}

/**
 * jq `type == "object" and .id == $id` port: parsed JSON must be a non-array object whose
 * `.id` equals the supplied feature id.
 */
export function featureIdentityMatches(raw: string, featureId: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return false;
    }
    return (
        typeof parsed === 'object' &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        (parsed as { id?: unknown }).id === featureId
    );
}

/** jq roster-shape port: parsed JSON must be a non-empty array. */
export function rosterIsNonEmptyArray(raw: string): boolean {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return false;
    }
    return Array.isArray(parsed) && parsed.length > 0;
}

/** jq WBS-identity/status contract port: non-empty string wbs, unique, known statuses. */
export function rosterContractHolds(rows: RosterRow[]): boolean {
    const seen = new Set<string>();
    for (const row of rows) {
        if (row === null || typeof row !== 'object') return false;
        if (typeof row.wbs !== 'string' || row.wbs.length === 0) return false;
        if (seen.has(row.wbs)) return false;
        seen.add(row.wbs);
        if (typeof row.status !== 'string' || !(KNOWN_STATUSES as readonly string[]).includes(row.status)) {
            return false;
        }
    }
    return true;
}

/** jq blocking-status port: any backlog/wip/testing/blocked member. */
export function hasBlockingStatus(rows: RosterRow[]): boolean {
    return rows.some(
        (row) => typeof row.status === 'string' && (BLOCKING_STATUSES as readonly string[]).includes(row.status),
    );
}

/** jq `sort | join(",")` port over the todo subset: codepoint-sorted, comma-joined, no newline. */
export function freezeTodoList(rows: RosterRow[]): string {
    return rows
        .filter((row) => row.status === 'todo' && typeof row.wbs === 'string')
        .map((row) => row.wbs as string)
        .sort()
        .join(',');
}

/** `spurBin` splits on whitespace into a command plus prefix args (PATH-independent runs). */
export function spurCommand(spurBin: string | undefined): { cmd: string; prefix: string[] } {
    const parts = (spurBin ?? 'spur')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
    return { cmd: parts[0] ?? 'spur', prefix: parts.slice(1) };
}

function readFileSyncRaw(path: string): string {
    try {
        return readFileSync(path, 'utf8');
    } catch {
        return '';
    }
}

export function runFeatureDevPrecheck(
    env: FeatureDevPrecheckEnv,
    options: FeatureDevPrecheckOptions = {},
): FeatureDevPrecheckResult {
    const cwd = options.cwd;
    const runDir = join('.spur', 'run');
    mkdirSync(cwd ? join(cwd, runDir) : runDir, { recursive: true });
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    const featureFile = join(runDir, `${env.__runId ?? ''}-feature-dev-feature.json`);
    const rosterFile = join(runDir, `${env.__runId ?? ''}-feature-dev-roster.json`);
    const tasksFile = join(runDir, `${env.__runId ?? ''}-feature-dev-tasks.txt`);
    const statusFile = join(runDir, `${env.__runId ?? ''}-feature-dev-precheck.status`);
    const featureId = env.featureId ?? '';

    rmSync(abs(statusFile), { force: true });

    const { cmd, prefix } = spurCommand(env.spurBin);
    /** Spawn one CLI read; merged output into the artifact, 127 on a spawn error (exec loss). */
    const read = (args: string[], target: string): number => {
        const result = spawnSync(cmd, [...prefix, ...args], {
            cwd,
            encoding: 'utf8',
            ...(options.env ? { env: { ...getEnvVars(), ...options.env } } : {}),
        });
        if (result.error !== undefined) {
            writeFileSync(abs(target), `spawn failed: ${result.error.message}\n`);
            return 127;
        }
        writeFileSync(abs(target), `${result.stdout ?? ''}${result.stderr ?? ''}`);
        return result.status ?? 1;
    };

    const idRc = identityRc(featureId, env.__runId);
    const showRc = idRc === 0 ? read(['feature', 'show', featureId, '--json'], featureFile) : 1;
    const listRc =
        idRc === 0 && showRc === 0 && featureIdentityMatches(readFileSyncRaw(abs(featureFile)), featureId)
            ? read(['task', 'list', '--feature', featureId, '--json'], rosterFile)
            : 1;

    const fail = (message: string): FeatureDevPrecheckResult => {
        process.stderr.write(`${message}\n`);
        writeFileSync(abs(statusFile), 'FAIL\n');
        return { status: 'FAIL', featureFile, rosterFile, tasksFile, statusFile, tasks: '' };
    };

    if (idRc !== 0 || showRc !== 0 || listRc !== 0) {
        return fail(
            `feature-dev precheck: missing featureId/runId, unknown feature '${featureId}', or unreadable roster (rc ${idRc}/${showRc}/${listRc}) — supply an existing planned feature via /sp:dev-plan or /sp:dev-idea; nothing was auto-created or re-planned`,
        );
    }

    const rosterRaw = readFileSyncRaw(abs(rosterFile));
    if (!rosterIsNonEmptyArray(rosterRaw)) {
        return fail(
            `feature-dev precheck: roster at ${rosterFile} is malformed, not an array, or empty — plan the feature first via /sp:dev-plan; refusing to replan or run an empty batch`,
        );
    }
    const rows = JSON.parse(rosterRaw) as RosterRow[];
    if (!rosterContractHolds(rows)) {
        return fail(
            `feature-dev precheck: roster has empty/duplicate/mismatched WBS identities or unknown statuses at ${rosterFile} — repair the task corpus; refusing to batch a broken roster`,
        );
    }
    if (hasBlockingStatus(rows)) {
        return fail(
            'feature-dev precheck: linked task(s) are backlog/wip/testing/blocked — refine or resume them through their own task pipelines before batching; refusing to launch overlapping work',
        );
    }

    const tasks = freezeTodoList(rows);
    writeFileSync(abs(tasksFile), tasks);
    writeFileSync(abs(statusFile), 'PASS\n');
    return { status: 'PASS', featureFile, rosterFile, tasksFile, statusFile, tasks };
}

export const FEATURE_DEV_PRECHECK_USAGE =
    'usage: feature-dev-precheck.ts  (env: featureId, __runId, optional spurBin) — no subcommands';

export function main(argv: string[], env: FeatureDevPrecheckEnv = getEnvVars()): number {
    if (argv.length > 0) {
        process.stderr.write(`${FEATURE_DEV_PRECHECK_USAGE}\n`);
        return 2;
    }
    runFeatureDevPrecheck(env);
    return 0;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
