#!/usr/bin/env bun
/**
 * task-diffstat — deterministic diff-evidence producer behind the task-pipeline `triage`
 * onEnter (task 0943, feature D64, ADR-125 lane routing).
 *
 * Reads the run's anchored base commit `.spur/run/<wbs>-base.sha` (written once by
 * `precheck`, F96 R1) and the current working tree, then writes:
 *   `.spur/run/<wbs>-diffstat.json`  `{ files, insertions, deletions, paths[], sensitive }`
 *
 * Counts come from `git diff --numstat <base>` (tracked changes; binary rows count the
 * path but no lines) plus untracked files (`git ls-files --others --exclude-standard`,
 * newline-counted — # ponytail: untracked line counts are a newline scan, numstat-grade
 * binary detection is unnecessary for a lane heuristic; switch to `--numstat --no-index`
 * if a miscount ever flips a lane).
 *
 * `sensitive` is true when ANY changed path matches the exported SENSITIVE list (0943 R2c);
 * the workflow's pre-decide guard maps sensitive (or >400 changed lines) to the safety lane
 * without a model call. Fail safe: a missing/malformed base, a failing git call, or any
 * other probe problem writes `sensitive: true` (and exits 0) so the lane degrades to
 * safety, never to fast.
 *
 * Node-builtin imports only; the git lookup is a spawnable `GitRunner` so tests can fake
 * it; `main(argv, env, options)` is the same injection point the workflow wrapper and its
 * node twin exercise. Only an empty `wbs` (mis-invocation) exits nonzero.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export interface DiffstatEnv {
    wbs?: string;
    [key: string]: string | undefined;
}

export interface DiffstatOptions {
    /** Base directory for `.spur/run` and the git probes; defaults to the process cwd. */
    cwd?: string;
}

/** Minimal spawnable git surface — tests fake this to return canned probe output. */
export interface GitRunResult {
    status: number;
    stdout: string;
}
export type GitRunner = (args: string[]) => GitRunResult;

/** Diffstat row written to `.spur/run/<wbs>-diffstat.json` (0943 R2a, frozen shape). */
export interface Diffstat {
    files: number;
    insertions: number;
    deletions: number;
    paths: string[];
    sensitive: boolean;
}

export interface DiffstatResult extends Diffstat {
    resultFile: string;
    /** Exit code the workflow wrapper observes (only an empty wbs is a hard failure). */
    exitCode: number;
}

/**
 * Sensitive paths (0943 R2c): any changed path under one of these forces the safety lane
 * before the `task-triage` decide runs — sensitive work is never lane-negotiated with a
 * model. Frozen list: `drizzle/`, `packages/config/`, auth-prefixed basenames anywhere
 * under the server src tree, `*secret*` basenames, `.github/`, `plugins/sp/hooks/`, and
 * any `*.sql` — spelled out in SENSITIVE_PREFIXES / SENSITIVE_GLOBS below (kept as data,
 * not prose, so the `*` / `/` sequences survive the doc comment).
 */
export const SENSITIVE_PREFIXES = ['drizzle/', 'packages/config/', '.github/', 'plugins/sp/hooks/'] as const;
export const SENSITIVE_GLOBS = ['apps/server/src/**/auth*', '**/*secret*', '**/*.sql'] as const;

// Glob → RegExp: `**` + `/` matches any-or-no directories, bare `**` any characters, `*` within one segment.
function globToRegex(glob: string): RegExp {
    const escaped = glob
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replaceAll('**/', '\u0000')
        .replaceAll('**', '\u0001')
        .replaceAll('*', '[^/]*')
        .replaceAll('\u0000', '(?:.*/)?')
        .replaceAll('\u0001', '.*');
    return new RegExp(`^${escaped}$`);
}

const SENSITIVE_MATCHERS: Array<{ label: string; test: (path: string) => boolean }> = [
    ...SENSITIVE_PREFIXES.map((prefix) => ({
        label: prefix,
        test: (path: string): boolean => path.startsWith(prefix),
    })),
    ...SENSITIVE_GLOBS.map((glob) => {
        const regex = globToRegex(glob);
        return { label: glob, test: (path: string): boolean => regex.test(path) };
    }),
];

/** Sensitive-pattern match for one path, or null — mirrors wrapup-drift-probe's driftReasonForPath. */
export function sensitiveReasonForPath(path: string): string | null {
    const match = SENSITIVE_MATCHERS.find((entry) => entry.test(path));
    return match ? `matches sensitive pattern ${match.label}` : null;
}

function defaultGitRunner(cwd?: string): GitRunner {
    return (args: string[]): GitRunResult => {
        const run = spawnSync('git', args, { cwd, encoding: 'utf8' });
        return { status: run.status ?? 1, stdout: run.stdout ?? '' };
    };
}

/** Newline count (wc -l semantics) — untracked files have no numstat row. */
function countNewlines(path: string, cwd?: string): number {
    let content: string;
    try {
        content = readFileSync(cwd ? join(cwd, path) : path, 'utf8');
    } catch {
        return 0;
    }
    let lines = 0;
    for (const ch of content) if (ch === '\n') lines += 1;
    return lines;
}

/**
 * git renders renames in --numstat paths as `old => new` (full) or `head{old => new}tail`
 * (partial). The sensitive matchers anchor on single paths, so both rename halves must be
 * surfaced — otherwise a rename INTO a sensitive path (review 0943 P3#1) classified clean.
 */
export function expandDiffPath(raw: string): string[] {
    const arrow = raw.indexOf(' => ');
    if (arrow === -1) return [raw];
    const open = raw.indexOf('{');
    const close = raw.lastIndexOf('}');
    if (open !== -1 && close > open && open < arrow && arrow < close) {
        const inner = raw.slice(open + 1, close);
        const innerArrow = inner.indexOf(' => ');
        if (innerArrow !== -1) {
            const head = raw.slice(0, open);
            const tail = raw.slice(close + 1);
            return [head + inner.slice(0, innerArrow) + tail, head + inner.slice(innerArrow + 4) + tail];
        }
    }
    return [raw.slice(0, arrow), raw.slice(arrow + 4)];
}

/**
 * `probe` — write `.spur/run/<wbs>-diffstat.json`. Always exits 0 after probing; every
 * probe problem fails safe (empty diff, sensitive true), never to a fast lane.
 */
export function runDiffstat(
    env: DiffstatEnv,
    options: DiffstatOptions = {},
    git: GitRunner = defaultGitRunner(options.cwd),
): DiffstatResult {
    const cwd = options.cwd;
    const wbs = env.wbs ?? '';
    if (wbs.length === 0) {
        process.stderr.write('task-diffstat: wbs is empty — refusing to guess the run artifact path\n');
        return { files: 0, insertions: 0, deletions: 0, paths: [], sensitive: true, resultFile: '', exitCode: 1 };
    }
    const relRun = join('.spur', 'run');
    const relResult = join(relRun, `${wbs}-diffstat.json`);
    const abs = (p: string): string => (cwd ? join(cwd, p) : p);
    mkdirSync(abs(relRun), { recursive: true });

    const failSafe = (reason: string): DiffstatResult => {
        process.stderr.write(`task-diffstat: ${reason} — failing safe (sensitive)\n`);
        const row: Diffstat = { files: 0, insertions: 0, deletions: 0, paths: [], sensitive: true };
        writeFileSync(abs(relResult), `${JSON.stringify(row)}\n`);
        return { ...row, resultFile: relResult, exitCode: 0 };
    };

    let base = '';
    try {
        base = readFileSync(abs(join(relRun, `${wbs}-base.sha`)), 'utf8').trim();
    } catch {
        // fall through to the shape check below
    }
    if (!/^[0-9a-f]{7,40}$/i.test(base)) return failSafe('run base .spur/run/<wbs>-base.sha missing or malformed');

    const numstat = git(['diff', '--numstat', base]);
    if (numstat.status !== 0) return failSafe(`git diff --numstat failed (status=${numstat.status})`);
    const paths = new Set<string>();
    let insertions = 0;
    let deletions = 0;
    for (const line of numstat.stdout.split('\n')) {
        // Binary rows report `-` for both counts; the path still counts as changed.
        const row = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
        if (!row) continue;
        for (const p of expandDiffPath(row[3] ?? '')) paths.add(p);
        if (row[1] !== '-') insertions += Number(row[1]);
        if (row[2] !== '-') deletions += Number(row[2]);
    }
    const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (others.status !== 0) return failSafe(`git ls-files failed (status=${others.status})`);
    for (const path of others.stdout.split('\u0000')) {
        // Pipeline bookkeeping (the run's own .spur state) is not product work — skip it.
        if (path.length === 0 || path === '.spur' || path.startsWith('.spur/')) continue;
        paths.add(path);
        insertions += countNewlines(path, cwd);
    }

    const all = [...paths].filter((p) => p.length > 0).sort();
    const sensitive = all.some((p) => sensitiveReasonForPath(p) !== null);
    const row: Diffstat = { files: all.length, insertions, deletions, paths: all, sensitive };
    writeFileSync(abs(relResult), `${JSON.stringify(row)}\n`);
    return { ...row, resultFile: relResult, exitCode: 0 };
}

export const TASK_DIFFSTAT_USAGE = 'usage: task-diffstat  (env: wbs)';

export function main(argv: string[], env: DiffstatEnv = getEnvVars(), options: DiffstatOptions = {}): number {
    // 0482 R2: the workflow hands every plugin script `--spur-bin` for PATH-independence.
    // task-diffstat shells only git (never spur), so the flag is accepted and unused;
    // any other argv stays a usage error.
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--spur-bin') {
            i++;
            continue;
        }
        process.stderr.write(`${TASK_DIFFSTAT_USAGE}\n`);
        return 2;
    }
    return runDiffstat(env, options).exitCode;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
