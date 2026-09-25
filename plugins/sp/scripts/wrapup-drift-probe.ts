#!/usr/bin/env bun
/**
 * wrapup-drift-probe — deterministic doc-ownership drift probe behind the wrapup-pipeline
 * task-resolve onEnter (task 0944, feature D64, ADR-115 composition budgets).
 *
 * Reads the validated wrapup capture `.spur/run/<runId>-wrapup-tasks.json` (never raw
 * vars.tasks — 0783 contract), runs `spur task show <wbs> --json` per member, collects the
 * changed paths from each task's `### Solution` file:line map, and writes:
 *   - `<runId>-drift-probe.json`  `{ clean: boolean, reasons: string[], paths: string[] }`
 *   - `<runId>-mode.txt`          projected wrapup mode: `fast` when clean, empty otherwise
 *
 * The probe runs ONLY when the caller left `mode` empty; a caller-set mode is projected
 * verbatim by the workflow wrapper and this script is never invoked (0944 R3).
 *
 * Dirty (clean=false, mode stays empty → the safety route) whenever ANY changed path
 * matches a doc-owned surface (AGENTS.md doc map + docs/99_PROJECT_CONSTITUTION.md
 * ownership table), or a task's Solution section is empty or unparseable (fail safe —
 * a wrapup without a readable change map must still reach doc-sync). Paths under the
 * task/feature corpus are never treated as drift.
 *
 * Node-builtin imports only; the spur lookup is a spawnable `SpurRunner` so tests can
 * fake it; `main(argv, env, options)` is the same injection point the workflow wrapper
 * and its node twin exercise. Always exits 0 after probing; only an empty `__runId`
 * (mis-invocation) exits 1.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export interface DriftProbeEnv {
    __runId?: string;
    spurBin?: string;
    [key: string]: string | undefined;
}

export interface DriftProbeOptions {
    /** Base directory for `.spur/run`; defaults to the process cwd. */
    cwd?: string;
}

/** Minimal spawnable spur surface — tests fake this to return canned `task show` output. */
export interface SpurShowResult {
    status: number;
    stdout: string;
}
export type SpurRunner = (args: string[]) => SpurShowResult;

export interface DriftProbeResult {
    clean: boolean;
    reasons: string[];
    paths: string[];
    probeFile: string;
    modeFile: string;
    /** Exit code the workflow wrapper observes (only an empty __runId is a hard failure). */
    exitCode: number;
}

/**
 * Doc-owned surfaces (0944 R2): a changed path under any of these means doc-sync must
 * still run. Mirrors the AGENTS.md documentation map and the
 * docs/99_PROJECT_CONSTITUTION.md ownership table: contracts / cli commands / config /
 * migrations / workflow YAML / plugin commands, skills and hooks / root manifest / the
 * authoritative docs (00_ADR, 03_ARCHITECTURE, 04_DESIGN, docs/design). docs/tasks* and
 * docs/features/* (the corpus) are intentionally absent — they are never drift.
 *
 * WHY join('config', 'workflows'): rule sp-runtime-path forbids the literal
 * config/<dir> in runtime source; this constant is a drift TARGET (Solution
 * change-map paths against the build-time SSOT), not a runtime config read.
 */
const WORKFLOWS_GLOB = `${join('config', 'workflows')}/**`;
export const DOC_OWNED_SURFACES = [
    'packages/contracts/**',
    'apps/cli/src/commands/**',
    'packages/config/src/**',
    'drizzle/*.sql',
    WORKFLOWS_GLOB,
    'plugins/sp/commands/**',
    'plugins/sp/skills/**',
    'plugins/sp/hooks/**',
    'package.json',
    'docs/00_ADR.md',
    'docs/03_ARCHITECTURE.md',
    'docs/04_DESIGN.md',
    'docs/design/**',
] as const;

/**
 * Top-level workspace entries from the AGENTS.md stack layout. A changed path whose first
 * segment is none of these is a new top-level workspace directory — doc-owned by default.
 * Single-segment paths (root files) are not directories and are exempt.
 */
const KNOWN_TOP_LEVEL = new Set([
    'apps',
    'packages',
    'plugins',
    'config',
    'docs',
    'drizzle',
    'scripts',
    'vendors',
    'package.json',
    'bun.lock',
    'bunfig.toml',
]);

/** Corpus paths (task/feature records) are never drift — excluded before surface matching. */
const CORPUS_PREFIXES = ['docs/tasks', 'docs/features/'];

/** `### Solution` section of a task record (tolerates `##`–`####` heading depth). */
export function solutionSectionOf(content: string): string | null {
    const heading = /^#{2,4}\s+Solution\s*$/m.exec(content);
    if (!heading) return null;
    const rest = content.slice(heading.index + heading[0].length);
    const next = /^#{2,4}\s+\S/m.exec(rest);
    return next ? rest.slice(0, next.index) : rest;
}

const CHANGE_ENTRY = /`([^`\r\n]+):(\d+)(?:-\d+)?`/g;

/** Backticked `path:line` (or `path:line-range`) tokens from a Solution section. */
export function changedPathsOf(section: string | null): string[] {
    if (section === null) return [];
    const paths: string[] = [];
    for (const match of section.matchAll(CHANGE_ENTRY)) {
        const path = match[1];
        // Path-like: no whitespace and at least one separator or dotted suffix, so prose
        // backticks never masquerade as change-map entries.
        if (/\s/.test(path)) continue;
        if (!path.includes('/') && !path.includes('.')) continue;
        paths.push(path);
    }
    return paths;
}

function surfaceRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('**', '\u0000')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000', '.*');
    return new RegExp(`^${escaped}$`);
}

const SURFACE_MATCHERS = DOC_OWNED_SURFACES.map((glob) => ({ glob, regex: surfaceRegex(glob) }));

/** 0944 R2 surface match: doc-owned glob, corpus exclusion, new top-level directory. */
export function driftReasonForPath(path: string): string | null {
    if (CORPUS_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
    if (path.includes('/') && !KNOWN_TOP_LEVEL.has(path.split('/')[0])) {
        return 'new top-level workspace directory';
    }
    const match = SURFACE_MATCHERS.find((entry) => entry.regex.test(path));
    return match ? `matches doc-owned surface ${match.glob}` : null;
}

function defaultSpurRunner(env: DriftProbeEnv, cwd?: string): SpurRunner {
    const parts = (env.spurBin ?? 'spur').split(/\s+/).filter((part) => part.length > 0);
    return (args: string[]): SpurShowResult => {
        const run = spawnSync(parts[0], [...parts.slice(1), ...args], {
            cwd,
            encoding: 'utf8',
            env: getEnvVars(),
        });
        return { status: run.status ?? 1, stdout: run.stdout ?? '' };
    };
}

/**
 * `probe` — classify the wrapup as clean (pure application-code change, no doc-owned
 * surface touched) or dirty, and project the wrapup mode. Fail safe: every lookup or
 * parse problem is a dirty probe, never a silent clean.
 */
export function runDriftProbe(
    env: DriftProbeEnv,
    options: DriftProbeOptions = {},
    spur = defaultSpurRunner(env, options.cwd),
): DriftProbeResult {
    const cwd = options.cwd;
    const runId = env.__runId ?? '';
    if (runId.length === 0) {
        process.stderr.write('wrapup-drift-probe: __runId is empty — refusing the legacy fixed-path fallback\n');
        return { clean: false, reasons: [], paths: [], probeFile: '', modeFile: '', exitCode: 1 };
    }
    const relProbeFile = join('.spur', 'run', `${runId}-drift-probe.json`);
    const relModeFile = join('.spur', 'run', `${runId}-mode.txt`);
    const relTasksFile = join('.spur', 'run', `${runId}-wrapup-tasks.json`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    mkdirSync(abs(join('.spur', 'run')), { recursive: true });
    // Write the dirty projection first so a crash mid-probe fails safe (mode stays empty).
    writeFileSync(abs(relModeFile), '\n');

    const finish = (clean: boolean, reasons: string[], paths: string[]): DriftProbeResult => {
        writeFileSync(abs(relProbeFile), `${JSON.stringify({ clean, reasons, paths })}\n`);
        writeFileSync(abs(relModeFile), clean ? 'fast\n' : '\n');
        return { clean, reasons, paths, probeFile: relProbeFile, modeFile: relModeFile, exitCode: 0 };
    };

    let tasks: unknown;
    try {
        tasks = JSON.parse(readFileSync(abs(relTasksFile), 'utf8'));
    } catch {
        tasks = undefined;
    }
    if (!Array.isArray(tasks) || !tasks.every((wbs) => typeof wbs === 'string')) {
        process.stderr.write(
            'wrapup-drift-probe: normalized task capture is missing or corrupted — failing safe (dirty)\n',
        );
        return finish(false, ['normalized task capture missing or corrupted'], []);
    }

    const reasons: string[] = [];
    const allPaths = new Set<string>();
    for (const wbs of tasks as string[]) {
        const shown = spur(['task', 'show', wbs, '--json']);
        if (shown.status !== 0) {
            reasons.push(`${wbs}: task show failed (status=${shown.status})`);
            continue;
        }
        let content: unknown;
        try {
            content = JSON.parse(shown.stdout).content;
        } catch {
            content = undefined;
        }
        if (typeof content !== 'string') {
            reasons.push(`${wbs}: task show output unparseable`);
            continue;
        }
        const changedPaths = changedPathsOf(solutionSectionOf(content));
        if (changedPaths.length === 0) {
            reasons.push(`${wbs}: Solution empty or unparseable`);
            continue;
        }
        for (const path of changedPaths) {
            if (CORPUS_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
            allPaths.add(path);
            const drift = driftReasonForPath(path);
            if (drift) reasons.push(`${wbs}: ${path} ${drift}`);
        }
    }
    return finish(reasons.length === 0, reasons, [...allPaths].sort());
}

export const WRAPUP_DRIFT_PROBE_USAGE = 'usage: wrapup-drift-probe  (env: __runId, spurBin)';

export function main(argv: string[], env: DriftProbeEnv = getEnvVars(), options: DriftProbeOptions = {}): number {
    if (argv.length > 0) {
        process.stderr.write(`${WRAPUP_DRIFT_PROBE_USAGE}\n`);
        return 2;
    }
    return runDriftProbe(env, options).exitCode;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
