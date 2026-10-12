#!/usr/bin/env bun
/**
 * task-diffstat — deterministic diff-evidence producer behind the task-pipeline `triage`
 * onEnter (task 0943, feature D64, ADR-125 lane routing).
 *
 * Reads the run's anchored base commit `.spur/run/<wbs>-base.sha` (written once by
 * `precheck`, F96 R1) and the current working tree, then writes:
 *   `.spur/run/<wbs>-diffstat.json`  `{ files, insertions, deletions, paths[], sensitive }`
 *
 * Counts come from `git diff --numstat -z <base>` (tracked changes; binary rows count the path
 * but no lines; NUL records carry RAW paths, so a non-ASCII or newline-bearing path reaches the
 * sensitive matchers intact) plus untracked files (`git ls-files --others --exclude-standard -z`,
 * newline-counted — # ponytail: untracked line counts are a newline scan, numstat-grade binary
 * detection is unnecessary here; switch to `--numstat --no-index` if a miscount flips a lane).
 *
 * `sensitive` is true when ANY changed path matches the exported SENSITIVE list (0943 R2c);
 * the workflow's pre-decide guard maps sensitive (or >400 changed lines) to the safety lane
 * without a model call. Fail safe: a missing/malformed base, a failing git call, or any
 * other probe problem writes `sensitive: true` (and exits 0) so the lane degrades to
 * safety, never to fast.
 *
 * The artifact is written atomically (tmp + rename), so redirecting stdout onto the artifact path
 * cannot corrupt it — the rename swaps in the real JSON after the shell's redirect truncates the
 * old inode (1067 R3); that redirect is still refused with a nonzero exit. Normal output is silent.
 *
 * Node-builtin imports only; the git lookup is a spawnable `GitRunner` so tests can fake
 * it; `main(argv, env, options)` is the same injection point the workflow wrapper and its
 * node twin exercise. Only an empty `wbs` (mis-invocation) exits nonzero.
 */

import { spawnSync } from 'node:child_process';
import { fstatSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

// Task 1176: the sensitive-path policy (0943 R2c) moved to the workflow/task owner —
// `packages/app/src/workflow/task-triage.ts`, reached through the generated pure bundle. That policy
// still forces the safety lane for any changed path under the frozen sensitive list before the
// `task-triage` decide runs, so sensitive work is never lane-negotiated with a model; this entry
// keeps git capture and the output artifact, and re-exports the policy for existing callers.
import { SENSITIVE_GLOBS, SENSITIVE_PREFIXES, sensitiveReasonForPath } from '../lib/plan-projection.generated.mjs';

export { SENSITIVE_GLOBS, SENSITIVE_PREFIXES, sensitiveReasonForPath };

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

function addCounts(add: string, del: string): [number, number] | null {
    for (const count of [add, del]) if (count !== '-' && !/^\d+$/.test(count)) return null;
    const [a, d] = [add === '-' ? 0 : Number(add), del === '-' ? 0 : Number(del)];
    return Number.isSafeInteger(a) && Number.isSafeInteger(d) ? [a, d] : null;
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
        writeArtifact(abs(relResult), row);
        return { ...row, resultFile: relResult, exitCode: 0 };
    };

    let stdoutIsArtifact = false; // 1067 R3: stdout redirected onto the artifact itself clobbered it once
    try {
        const [out, art] = [fstatSync(1), statSync(abs(relResult))];
        stdoutIsArtifact = out.dev === art.dev && out.ino === art.ino;
    } catch {
        /* artifact absent or stdout not a regular file — nothing to compare */
    }

    let base = '';
    try {
        base = readFileSync(abs(join(relRun, `${wbs}-base.sha`)), 'utf8').trim();
    } catch {
        // fall through to the shape check below
    }
    if (!/^[0-9a-f]{7,40}$/i.test(base)) return failSafe('run base .spur/run/<wbs>-base.sha missing or malformed');

    const numstat = git(['diff', '--numstat', '-z', base]);
    if (numstat.status !== 0) return failSafe(`git diff --numstat failed (status=${numstat.status})`);
    if (numstat.stdout.length > 0 && !numstat.stdout.endsWith('\u0000'))
        return failSafe('git diff --numstat -z output is not NUL-terminated (malformed framing)');
    const paths = new Set<string>();
    let insertions = 0;
    let deletions = 0;
    const records = numstat.stdout.split('\u0000').slice(0, -1); // drop the terminating NUL tail
    for (let i = 0; i < records.length; i++) {
        const header = records[i] ?? '';
        const first = header.indexOf('\t'); // first two tabs only
        const second = header.indexOf('\t', first + 1); // a raw path may itself hold more tabs
        if (first < 1 || second < first + 2) return failSafe('git diff --numstat -z record is missing counts or path');
        const counts = addCounts(header.slice(0, first), header.slice(first + 1, second));
        if (counts === null) return failSafe('git diff --numstat -z record has a malformed count');
        insertions += counts[0];
        deletions += counts[1]; // once per count header, never once per rename half
        const path = header.slice(second + 1);
        if (path !== '') {
            paths.add(path);
            continue;
        }
        // An empty path field is Git's rename/copy form: the next two records are old and new.
        const oldPath = records[++i];
        const newPath = records[++i];
        if (!oldPath || !newPath) return failSafe('git diff --numstat -z rename record has incomplete paths');
        paths.add(oldPath);
        paths.add(newPath);
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
    writeArtifact(abs(relResult), row);
    if (stdoutIsArtifact)
        process.stderr.write('task-diffstat: stdout redirected onto the artifact — kept; redirect stdout elsewhere\n');
    return { ...row, resultFile: relResult, exitCode: stdoutIsArtifact ? 1 : 0 };
}

/** Atomic artifact write (tmp + rename): a stdout redirect onto the path cannot interleave (1067 R3). */
function writeArtifact(absPath: string, row: Diffstat): void {
    const tmp = `${absPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(row)}\n`);
    renameSync(tmp, absPath);
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
