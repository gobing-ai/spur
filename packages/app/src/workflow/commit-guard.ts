/**
 * Commit guard — refuse a driver commit that would sweep a *foreign* writer's working-tree changes
 * (task 1129, feature H1; incidents `a94f9f431`, `36f274590` — commits swept other sessions' files).
 * Transport: `spur workflow commit-guard <start|stage|check> --run <id>` (script-absorption PR-4;
 * moved verbatim from the retired `plugins/sp/scripts/commit-guard.ts`).
 *
 * Read/write `.spur/run/<id>-tree-start.json`; stage only the listed paths this run wrote; report
 * the rest. "Written by this run" = "changed since base" (task-diffstat semantics) minus start-dirty
 * paths whose content still matches the snapshot — a path dirty at start and untouched by the run
 * belongs to another writer. Exit codes: 0 = staged all requested · 2 = some refused as foreign ·
 * 3 = conflict or unmerged target (nothing staged) · 1 = mis-invocation, a missing start snapshot
 * (`start` first), or a failed Git safety probe (nothing staged/reported). `.spur/` is excluded
 * from both sets (run bookkeeping is not product work — task-diffstat).
 *
 * Every entry point returns a {@link CommitGuardReport} (exit code plus the stdout/stderr lines)
 * instead of writing to the process, so the CLI owns the output seam.
 *
 * shortcut: a foreign edit to a path CLEAN at `start` is indistinguishable from this run's own
 * write — git records content, not authorship — caught only once dirty at start. Upgrade: a
 * per-run write journal if that case recurs.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';

/** Base directory for the probes; `git` is the test seam (a fake runner instead of spawning). */
export interface CommitGuardOptions {
    cwd?: string;
    base?: string;
    git?: GitRunner;
}
/** Minimal spawnable git surface — tests fake this to return canned probe output. */
export interface GitRunResult {
    status: number;
    stdout: string;
}
/** Runs `git <args>` and returns its exit status and stdout; injected so tests can fake git. */
export type GitRunner = (args: string[]) => GitRunResult;
/** The `.spur/run/<id>-tree-start.json` snapshot. */
export interface TreeStart {
    head: string;
    /** Working-file blob hashes at start; `sha` is null when the path did not exist. */
    dirty: Array<{ path: string; sha: string | null }>;
}
/** What one guard invocation produced: the process exit code and the lines for stdout / stderr. */
export interface CommitGuardReport {
    exitCode: number;
    stdout: string[];
    stderr: string[];
}
/** `stage` also reports the partition it computed (empty on any refusal before staging). */
export interface CommitGuardStageReport extends CommitGuardReport {
    staged: string[];
    foreign: string[];
}

/** One-line usage printed when an op or its required `--run` is missing (exit 1). */
export const COMMIT_GUARD_USAGE =
    'usage: spur workflow commit-guard start --run <id> | stage --run <id> [--base <sha>] -- <paths…> | check --run <id> [--base <sha>]';

/** Run bookkeeping is not product work — neither set may contain it (task-diffstat's rule). */
const isBookkeeping = (path: string): boolean => path === '.spur' || path.startsWith('.spur/');
/** Probe/artifact paths are repo-relative; `cwd` only anchors them for tests and callers. */
const at = (options: CommitGuardOptions, rel: string): string => (options.cwd ? join(options.cwd, rel) : rel);
const artifactPath = (run: string): string => join('.spur', 'run', `${run}-tree-start.json`);

function gitOf(options: CommitGuardOptions): GitRunner {
    if (options.git) return options.git;
    const executor = new NodeSyncProcessExecutor();
    return (args: string[]): GitRunResult => {
        const run = executor.runSync({ command: 'git', args, ...(options.cwd ? { cwd: options.cwd } : {}) });
        return { status: run.exitCode ?? 1, stdout: run.stdout };
    };
}
/** Working-file blob hash, or null when the path is absent (`git hash-object` failed). */
function hashPath(path: string, git: GitRunner): string | null {
    const run = git(['hash-object', '--', path]);
    return run.status === 0 ? run.stdout.trim() : null;
}
/** Paths from `git status --porcelain=v1 -z` (`XY <path>` entries; a rename's source token is consumed, not registered). */
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
/** "Changed since base" (task-diffstat semantics): tracked changes + untracked, minus bookkeeping.
 * A failed probe throws (1209): an empty set would certify a tree the guard never actually saw. */
function changedSinceBase(base: string, git: GitRunner): Set<string> {
    const tracked = git(['diff', '--name-only', base]);
    if (tracked.status !== 0) throw new Error(`git diff --name-only failed (status ${tracked.status})`);
    const others = git(['ls-files', '--others', '--exclude-standard', '-z']);
    if (others.status !== 0) throw new Error(`git ls-files --others failed (status ${others.status})`);
    const clean = (out: string, sep: string): string[] =>
        out
            .split(sep)
            .map((p) => p.trim())
            .filter((p) => p.length > 0 && !isBookkeeping(p));
    return new Set([...clean(tracked.stdout, '\n'), ...clean(others.stdout, '\u0000')]);
}
function readTreeStart(run: string, options: CommitGuardOptions): TreeStart | null {
    try {
        const parsed = JSON.parse(readFileSync(at(options, artifactPath(run)), 'utf8')) as TreeStart;
        if (typeof parsed.head === 'string' && Array.isArray(parsed.dirty)) return parsed;
    } catch {
        /* absent or malformed — the caller fails closed */
    }
    return null;
}
/** Start snapshot + resolved base + the paths this run wrote: "changed since base" minus start-dirty paths unchanged since. */
function runContext(run: string, options: CommitGuardOptions) {
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
const report = (exitCode: number, stdout: string[] = [], stderr: string[] = []): CommitGuardReport => ({
    exitCode,
    stdout,
    stderr,
});
function missingStart(run: string): CommitGuardReport {
    return report(
        1,
        [],
        [`commit-guard: no ${artifactPath(run)} — run \`spur workflow commit-guard start --run ${run}\` first`],
    );
}
/** The usage line with exit 1 — a mis-invocation stages and reports nothing. */
export function commitGuardUsage(): CommitGuardReport {
    return report(1, [], [COMMIT_GUARD_USAGE]);
}
/** One diagnostic for any failed safety probe: the tree state is unproven, so nothing else happens. */
function probeDiagnostic(err: unknown): string {
    const detail = err instanceof Error ? err.message : String(err);
    return `commit-guard: git probe failed (${detail}) — tree state unproven, nothing staged or reported`;
}

/** Fingerprint the tree once, before the run writes anything (R1). */
export function commitGuardStart(run: string, options: CommitGuardOptions = {}): CommitGuardReport {
    const git = gitOf(options);
    const head = git(['rev-parse', 'HEAD']);
    const status = git(['status', '--porcelain=v1', '-z']);
    if (head.status !== 0 || status.status !== 0) {
        return report(1, [], ['commit-guard: git probe failed (rev-parse HEAD / status) — is this a work tree?']);
    }
    const snapshot: TreeStart = {
        head: head.stdout.trim(),
        dirty: parsePorcelainZ(status.stdout).map((path) => ({ path, sha: hashPath(path, git) })),
    };
    const abs = at(options, artifactPath(run));
    mkdirSync(join(abs, '..'), { recursive: true });
    writeFileSync(`${abs}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(`${abs}.tmp`, abs); // atomic: a concurrent reader never sees a half-written snapshot
    return report(0);
}

/** The first path that is unmerged or carries conflict markers, or null (R4, fail closed).
 * The unmerged probe is a safety gate too: a failed one throws instead of staging blind (1209 R2). */
function conflictingTarget(paths: string[], options: CommitGuardOptions, git: GitRunner): string | null {
    const probe = git(['diff', '--name-only', '--diff-filter=U']);
    if (probe.status !== 0) throw new Error(`git diff --name-only --diff-filter=U failed (status ${probe.status})`);
    const unmerged = new Set(probe.stdout.split('\n').map((p) => p.trim()));
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
export function commitGuardStage(
    run: string,
    paths: string[],
    options: CommitGuardOptions = {},
): CommitGuardStageReport {
    const refusedEarly = (r: CommitGuardReport): CommitGuardStageReport => ({ ...r, staged: [], foreign: [] });
    if (paths.length === 0) return refusedEarly(commitGuardUsage());
    let context: ReturnType<typeof runContext>, conflict: string | null;
    try {
        context = runContext(run, options);
        if (!context) return refusedEarly(missingStart(run));
        conflict = conflictingTarget(paths, options, context.git);
    } catch (err) {
        return refusedEarly(report(1, [], [probeDiagnostic(err)])); // 1209 R2: git add is never reached after a failed probe
    }
    if (conflict) return refusedEarly(report(3, [], [`commit-guard: refusing to stage ${conflict}; nothing staged`]));
    const { written, start } = context;
    const dirtyAtStart = new Set(start.dirty.map((entry) => entry.path));
    const staged = paths.filter((path) => written.has(path));
    const refused = paths.filter((path) => !written.has(path));
    const stderr = refused.map((path) => {
        const why = dirtyAtStart.has(path) ? 'foreign — dirty at start, untouched by this run' : 'unchanged since base';
        return `commit-guard: refused ${path} (${why})`;
    });
    if (staged.length > 0 && context.git(['add', '--', ...staged]).status !== 0) {
        return refusedEarly(report(1, [], [...stderr, 'commit-guard: git add failed — nothing staged']));
    }
    const foreign = refused.filter((path) => dirtyAtStart.has(path));
    return {
        ...report(refused.length > 0 ? 2 : 0, [JSON.stringify({ staged, foreign })], stderr),
        staged,
        foreign,
    };
}

/** Report the working-tree changes this run did not write, staging nothing (R3). */
export function commitGuardCheck(run: string, options: CommitGuardOptions = {}): CommitGuardReport {
    try {
        const context = runContext(run, options); // first changed-path scan
        if (!context) return missingStart(run);
        const { base, git, written } = context; // second changed-path scan — guarded too (1209 R1)
        const foreign = [...changedSinceBase(base, git)].filter((path) => !written.has(path)).sort();
        return report(0, [JSON.stringify({ foreign })]);
    } catch (err) {
        return report(1, [], [probeDiagnostic(err)]); // a failed probe emits no success JSON (R1)
    }
}
