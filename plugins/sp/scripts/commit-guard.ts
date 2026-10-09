#!/usr/bin/env bun
/**
 * commit-guard — refuse a driver commit that would sweep a *foreign* writer's working-tree changes
 * (task 1129, feature H1). Incidents: `a94f9f431` (a batch pipeline commit swept another session's
 * uncommitted files) and `36f274590` (a close-out commit swept two other tasks' files through
 * `git add -A`). The runbooks already said "stage only what the batch wrote"; nothing enforced it.
 *
 * Read/write `.spur/run/<id>-tree-start.json`; stage only the listed paths this run wrote; report
 * the ones it did not. "Written by this run" = "changed since base" (task-diffstat semantics) minus
 * start-dirty paths whose content still matches the start snapshot — a path dirty at start and
 * untouched by the run belongs to another writer. Exit codes: 0 = staged all requested · 2 = some
 * refused as foreign · 3 = conflict or unmerged target (nothing staged) · 1 = mis-invocation, or a
 * missing start snapshot (`start` first).
 *
 * `node:*` builtins and relative imports only (sp-plugin-standalone); `options.git` is the test
 * seam; `.spur/` is excluded from both sets (run bookkeeping is not product work — task-diffstat).
 *
 * shortcut: a foreign edit to a path that was CLEAN at `start` is indistinguishable from this run's
 * own write — git records content, not authorship — so it is caught only once it is dirty in the
 * start snapshot. Upgrade path: a per-run write journal if that case ever recurs.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Base directory for the probes; `git` is the test seam (a fake runner instead of spawning). */
export interface GuardOptions {
    cwd?: string;
    base?: string;
    git?: GitRunner;
}
/** Minimal spawnable git surface — tests fake this to return canned probe output. */
export interface GitRunResult {
    status: number;
    stdout: string;
}
export type GitRunner = (args: string[]) => GitRunResult;
export interface TreeStart {
    head: string;
    /** Working-file blob hashes at start; `sha` is null when the path did not exist. */
    dirty: Array<{ path: string; sha: string | null }>;
}
/** `exitCode` is what `main` returns: 0 all staged · 2 some refused · 3 conflict · 1 usage. */
export type StageResult = { staged: string[]; foreign: string[]; exitCode: number };

export const COMMIT_GUARD_USAGE =
    'usage: commit-guard start --run <id> | stage --run <id> [--base <sha>] -- <paths…> | check --run <id>';

/** Run bookkeeping is not product work — neither set may contain it (task-diffstat's rule). */
function isBookkeeping(path: string): boolean {
    return path === '.spur' || path.startsWith('.spur/');
}
/** Probe/artifact paths are repo-relative; `cwd` only anchors them for tests and callers. */
function at(options: GuardOptions, rel: string): string {
    return options.cwd ? join(options.cwd, rel) : rel;
}
function artifactPath(run: string): string {
    return join('.spur', 'run', `${run}-tree-start.json`);
}
function gitOf(options: GuardOptions): GitRunner {
    if (options.git) return options.git;
    return (args: string[]): GitRunResult => {
        const run = spawnSync('git', args, { cwd: options.cwd, encoding: 'utf8' });
        return { status: run.status ?? 1, stdout: run.stdout ?? '' };
    };
}
/** Working-file blob hash, or null when the path is absent (`git hash-object` failed). */
function hashPath(path: string, git: GitRunner): string | null {
    const run = git(['hash-object', '--', path]);
    return run.status === 0 ? run.stdout.trim() : null;
}
/** Paths from `git status --porcelain=v1 -z` (`XY <path>` entries; a rename's source token is
 * consumed, not registered). */
export function parsePorcelainZ(stdout: string): string[] {
    const tokens = stdout.split('\u0000');
    const paths: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const entry = tokens[i] ?? '';
        if (entry.length < 4) continue;
        const path = entry.slice(3);
        if (!isBookkeeping(path)) paths.push(path);
        if (/[RC]/.test(entry.slice(0, 2))) i++;
    }
    return paths;
}
/** An unresolved conflict marker: an opener or closer line, or a `=======` between them — a `===`
 * setext underline in prose is not a marker without an opener. */
export function conflictMarkerLine(content: string): boolean {
    let opener = false;
    for (const line of content.split('\n')) {
        if (/^<{7}( |$)/.test(line)) opener = true;
        else if (/^={7}(\s|$)/.test(line) && opener) return true;
        else if (/^>{7}( |$)/.test(line)) return true;
    }
    return opener;
}
/** "Changed since base" (task-diffstat semantics): tracked changes + untracked, minus bookkeeping. */
function changedSinceBase(base: string, git: GitRunner): Set<string> {
    const tracked = git(['diff', '--name-only', base]);
    const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (tracked.status !== 0 || others.status !== 0) return new Set();
    const clean = (out: string, sep: string): string[] =>
        out
            .split(sep)
            .map((p) => p.trim())
            .filter((p) => p.length > 0 && !isBookkeeping(p));
    return new Set([...clean(tracked.stdout, '\n'), ...clean(others.stdout, '\u0000')]);
}
function readTreeStart(run: string, options: GuardOptions): TreeStart | null {
    try {
        const parsed = JSON.parse(readFileSync(at(options, artifactPath(run)), 'utf8')) as TreeStart;
        if (typeof parsed.head === 'string' && Array.isArray(parsed.dirty)) return parsed;
    } catch {
        /* absent or malformed — the caller fails closed */
    }
    return null;
}
/** Start snapshot + resolved base + the paths this run wrote: "changed since base", keeping only
 * start-dirty paths whose content its own edits changed. */
function runContext(run: string, options: GuardOptions) {
    const git = gitOf(options);
    const start = readTreeStart(run, options);
    if (!start) return null;
    let base = options.base ?? '';
    if (!base) {
        try {
            const anchored = readFileSync(at(options, join('.spur', 'run', `${run}-base.sha`)), 'utf8').trim();
            if (/^[0-9a-f]{7,40}$/i.test(anchored)) base = anchored;
        } catch {
            /* no precheck anchor — the start head is the base */
        }
    }
    if (!base) base = start.head.length > 0 ? start.head : 'HEAD';
    const written = changedSinceBase(base, git);
    for (const entry of start.dirty) if (hashPath(entry.path, git) === entry.sha) written.delete(entry.path);
    return { git, base, start, written };
}
function missingStart(run: string): number {
    process.stderr.write(`commit-guard: no ${artifactPath(run)} — run \`commit-guard start --run ${run}\` first\n`);
    return 1;
}
/** Fingerprint the tree once, before the run writes anything (R1). */
export function runStart(run: string, options: GuardOptions = {}): number {
    const git = gitOf(options);
    const head = git(['rev-parse', 'HEAD']);
    const status = git(['status', '--porcelain=v1', '-z']);
    if (head.status !== 0 || status.status !== 0) {
        process.stderr.write('commit-guard: git probe failed (rev-parse HEAD / status) — is this a work tree?\n');
        return 1;
    }
    const snapshot: TreeStart = {
        head: head.stdout.trim(),
        dirty: parsePorcelainZ(status.stdout).map((path) => ({ path, sha: hashPath(path, git) })),
    };
    const abs = at(options, artifactPath(run));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(`${abs}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(`${abs}.tmp`, abs); // atomic: a concurrent reader never sees a half-written snapshot
    return 0;
}
/** The first path that is unmerged or carries conflict markers, or null (R4, fail closed). */
function conflictingTarget(paths: string[], options: GuardOptions, git: GitRunner): string | null {
    const unmerged = new Set(
        git(['diff', '--name-only', '--diff-filter=U'])
            .stdout.split('\n')
            .map((p) => p.trim()),
    );
    for (const path of paths) {
        if (unmerged.has(path)) return `${path} (unmerged)`;
        try {
            if (conflictMarkerLine(readFileSync(at(options, path), 'utf8'))) return `${path} (conflict markers)`;
        } catch {
            /* deleted target — nothing to scan */
        }
    }
    return null;
}
/** Stage only the listed paths this run wrote (R2) and print `{staged, foreign}` (AC1). */
export function runStage(run: string, paths: string[], options: GuardOptions = {}): StageResult {
    if (paths.length === 0) {
        process.stderr.write(`${COMMIT_GUARD_USAGE}\n`);
        return { staged: [], foreign: [], exitCode: 1 };
    }
    const context = runContext(run, options);
    if (!context) return { staged: [], foreign: [], exitCode: missingStart(run) };
    const conflict = conflictingTarget(paths, options, context.git);
    if (conflict) {
        process.stderr.write(`commit-guard: refusing to stage ${conflict}; nothing staged\n`);
        return { staged: [], foreign: [], exitCode: 3 };
    }
    const dirtyAtStart = new Set(context.start.dirty.map((entry) => entry.path));
    const staged = paths.filter((path) => context.written.has(path));
    const refused = paths.filter((path) => !context.written.has(path));
    for (const path of refused) {
        const why = dirtyAtStart.has(path) ? 'foreign — dirty at start, untouched by this run' : 'unchanged since base';
        process.stderr.write(`commit-guard: refused ${path} (${why})\n`);
    }
    if (staged.length > 0 && context.git(['add', '--', ...staged]).status !== 0) {
        process.stderr.write('commit-guard: git add failed — nothing staged\n');
        return { staged: [], foreign: [], exitCode: 1 };
    }
    const foreign = refused.filter((path) => dirtyAtStart.has(path));
    process.stdout.write(`${JSON.stringify({ staged, foreign })}\n`);
    return { staged, foreign, exitCode: refused.length > 0 ? 2 : 0 };
}
/** Report the working-tree changes this run did not write, staging nothing (R3). */
export function runCheck(run: string, options: GuardOptions = {}): number {
    const context = runContext(run, options);
    if (!context) return missingStart(run);
    const foreign = [...changedSinceBase(context.base, context.git)]
        .filter((path) => !context.written.has(path))
        .sort();
    process.stdout.write(`${JSON.stringify({ foreign })}\n`);
    return 0;
}
/** Pull one `--flag value` pair out of argv, or undefined when absent (a missing value is usage). */
function takeFlag(args: string[], name: string): string | undefined {
    const index = args.indexOf(name);
    const value = index === -1 ? undefined : args[index + 1];
    const missing = value === undefined || value.startsWith('--');
    if (index !== -1) args.splice(index, missing ? 1 : 2);
    return missing ? undefined : value;
}
export function main(argv: string[], options: GuardOptions = {}): number {
    const args = [...argv];
    takeFlag(args, '--spur-bin'); // 0482 R2: pipelines hand every plugin script this flag
    const sub = args.shift();
    const run = takeFlag(args, '--run');
    const base = takeFlag(args, '--base');
    const usage = (): number => {
        process.stderr.write(`${COMMIT_GUARD_USAGE}\n`);
        return 1;
    };
    if (!run) return usage();
    if (sub === 'start') return args.length === 0 ? runStart(run, options) : usage();
    if (sub === 'check') return args.length === 0 ? runCheck(run, { ...options, base }) : usage();
    if (sub === 'stage')
        return runStage(
            run,
            args.filter((arg) => arg !== '--'),
            { ...options, base },
        ).exitCode;
    return usage();
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
