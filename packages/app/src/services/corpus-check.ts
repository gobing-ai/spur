/**
 * corpus-check — sweep the whole task and feature corpus and fail on any
 * structural finding that is not in the accepted baseline.
 *
 * WHY this exists: `spur task check <wbs>` runs once, at a transition, against
 * the rules that existed that day. Nothing re-validated afterwards, so two
 * classes of defect accumulated invisibly:
 *
 *   1. **Bypasses.** A task that slipped its gate was never looked at again.
 *   2. **Ratchet drift.** Check rules tighten over time; a task closed legally
 *      under yesterday's rules silently becomes non-compliant under today's.
 *      (Task 0368 closed 2026-07-28; the rule that now flags it landed
 *      2026-08-01.)
 *
 * The baseline (`config/corpus-baseline.json`) is deliberately two-sided: a new
 * finding fails the gate, AND a baseline entry that no longer reproduces fails
 * it too. Without the second half the file would rot into a permanent
 * suppression list — the exact invisible-debt pattern this command exists to
 * end.
 *
 * Every severity is ratcheted (ADR-062, task 0582): both error- and
 * warning-severity findings reconcile two-sided, and the gate report states
 * observed / baselined / new / stale counts per severity so a growing warning
 * class is distinguishable from a stable one. An entry's `severity` is part of
 * its acceptance contract — a baselined warning does NOT cover the same
 * finding promoted to error, and vice versa, so the promotion flow (task 0583)
 * is a reconcile-the-entry event, not a silent widening.
 */
import { basename, dirname, join, relative, resolve } from 'node:path';
import { bundledConfigRoot, resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { parse } from 'yaml';
import { FeatureCheckService } from './feature-check';
import type { SectionMatrix } from './planning-check-base';
import { TaskCheckService } from './task-check';
import { TaskLocator } from './task-locator';

/** Finding severity level — the gate ratchets every severity (ADR-062). */
export type CorpusSeverity = 'error' | 'warning';

/** One accepted-finding record from `config/corpus-baseline.json`. */
export interface BaselineEntry {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    /**
     * Severity of the accepted finding. Entries predating ADR-062 (no field)
     * read as `error`; the regenerated baseline carries it on every entry.
     */
    severity?: CorpusSeverity;
    reason: string;
    since: string;
}

interface Baseline {
    note?: string;
    entries: BaselineEntry[];
}

/** A single finding observed in the corpus sweep (errors and warnings alike). */
export interface CorpusError {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    severity: CorpusSeverity;
    message: string;
}

/** Observed / baselined / new / stale counts for one severity class. */
export interface SeverityCounts {
    observed: number;
    baselined: number;
    newCount: number;
    staleCount: number;
}

/**
 * Result of a full-corpus sweep: totals plus per-severity two-sided findings
 * (R6 — a reader can tell a growing warning class from a stable one).
 */
export interface CorpusCheckResult {
    observed: number;
    baselined: number;
    newErrors: CorpusError[];
    newWarnings: CorpusError[];
    staleEntries: BaselineEntry[];
    bySeverity: {
        error: SeverityCounts;
        warning: SeverityCounts;
    };
    ok: boolean;
}

/**
 * Severity of a baseline entry, defaulting legacy entries (pre-ADR-062) to error.
 */
export function baselineSeverity(e: Pick<BaselineEntry, 'severity'>): CorpusSeverity {
    return e.severity ?? 'error';
}

/** `<kind>:<id>:<code>` — the identity a baseline entry and an observed error share. */
export function key(e: { kind: string; id: string; code: string }): string {
    return `${e.kind}:${e.id}:${e.code}`;
}

function resolveProjectRoot(cwd: string): string {
    const fs = createNodeFileSystem(cwd);
    let current = resolve(cwd);
    while (true) {
        if (
            fs.exists(join(current, '.spur', 'config.yaml')) ||
            fs.exists(join(current, 'config', 'corpus-baseline.json'))
        ) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) return resolve(cwd);
        current = parent;
    }
}

async function loadTaskMatrix(projectRoot: string): Promise<SectionMatrix> {
    const fs = createNodeFileSystem(projectRoot);
    const candidates = [join(projectRoot, '.spur', 'tasks', 'section-matrix.yaml')];
    const bundledRoot = bundledConfigRoot();
    if (bundledRoot !== null) candidates.push(join(bundledRoot, 'tasks', 'section-matrix.yaml'));

    let matrixPath: string | undefined;
    for (const candidate of candidates) {
        if (await fs.exists(candidate)) {
            matrixPath = candidate;
            break;
        }
    }
    if (matrixPath === undefined) {
        throw new Error('corpus-check: task section matrix is unavailable');
    }

    try {
        const parsed = parse(await Bun.file(matrixPath).text());
        if (typeof parsed !== 'object' || parsed === null || !('variants' in parsed)) {
            throw new Error('missing variants object');
        }
        return parsed as SectionMatrix;
    } catch (error) {
        throw new Error(`corpus-check: could not parse task section matrix at ${matrixPath}: ${String(error)}`);
    }
}

async function structuralSweep(projectRoot: string): Promise<{
    findings: CorpusError[];
    taskDirs: string[];
    featuresDir: string;
}> {
    const fs = createNodeFileSystem(projectRoot);
    const planning = await resolvePlanningFolders(fs);
    const taskDirs = Object.keys(planning.foldersConfig.folders).map((dir) => fs.resolve(dir));
    const activeTasksDir = fs.resolve(planning.foldersConfig.active_folder);
    if (!taskDirs.includes(activeTasksDir)) taskDirs.unshift(activeTasksDir);
    const featuresDir = fs.resolve(planning.featuresDir);
    const locator = new TaskLocator({
        fs,
        tasksDir: activeTasksDir,
        foldersConfig: planning.foldersConfig,
    });
    const taskService = new TaskCheckService(fs, await loadTaskMatrix(projectRoot), locator);
    const findings: CorpusError[] = [];

    // Sweep scope is EVERY configured task folder, not just the active one (ADR-062 §1,
    // task 0582). It was frozen to the active folder through 2026-08-17 because widening
    // it exposes the legacy corpora's accumulated drift — 404 errors across 180 `done`
    // tasks in docs/tasks{,2,3} — and forced a large config/corpus-baseline.json
    // reconciliation. That reconciliation is now done: the backlog is baselined, and
    // because the baseline is two-sided, a baselined error that stops reproducing fails
    // the gate as stale. Leaving 84% of the corpus ungated is what let that drift grow
    // unobserved in the first place; do not re-narrow this loop.
    for (const tasksDir of taskDirs) {
        if (!(await fs.exists(tasksDir))) continue;
        for (const fileName of await fs.readDir(tasksDir)) {
            const wbs = fileName.match(/^(\d{4})_.+\.md$/)?.[1];
            if (wbs === undefined) continue;
            const result = await taskService.check(join(tasksDir, fileName), wbs, {
                severityOverrides: planning.severityOverrides,
            });
            // Capture EVERY severity — the ratchet reconciles warnings two-sided too
            // (ADR-062 §3 / task 0582 R3); the old error-only filter is what let the
            // 2289-warning backlog grow unobserved. Filtering happens at reconciliation,
            // where severity is part of the acceptance contract.
            for (const finding of result.findings) {
                findings.push({
                    kind: 'task',
                    id: wbs,
                    code: finding.code,
                    severity: finding.severity,
                    message: finding.message,
                });
            }
        }
    }

    if (await fs.exists(featuresDir)) {
        const featureService = new FeatureCheckService(fs);
        for (const fileName of await fs.readDir(featuresDir)) {
            const id = fileName.match(/^([A-Z][1-9]*)_.+\.md$/)?.[1];
            if (id === undefined) continue;
            const result = await featureService.check(join(featuresDir, fileName), id, {
                featuresDir,
                tasksDir: activeTasksDir,
                tasksDirs: taskDirs,
                runDir: fs.resolve('.spur/run'),
                severityOverrides: planning.severityOverrides,
            });
            for (const finding of result.findings) {
                findings.push({
                    kind: 'feature',
                    id,
                    code: finding.code,
                    severity: finding.severity,
                    message: finding.message,
                });
            }
        }
    }

    return { findings, taskDirs, featuresDir };
}

/**
 * Detect two corpus files claiming the same WBS / feature id.
 *
 * WHY this is separate from the `check` sweep: `spur task check` validates one document at a
 * time, so a duplicate id is invisible to it — and `spur task show <wbs>` resolves to whichever
 * file it finds first, silently shadowing the other. Found live on 2026-08-07: two different
 * tasks both numbered 0468, one CLI-allocated and one hand-written straight to disk. The
 * hand-written file bypassed `spur task create`, so the race-safe allocator never saw it, and
 * every per-file gate passed while one ticket was unreachable.
 */
async function duplicateIds(cwd: string, taskDirs: string[], featuresDir: string): Promise<CorpusError[]> {
    const fs = createNodeFileSystem(cwd);
    const scan = async (
        dir: string,
        kind: 'task' | 'feature',
    ): Promise<{ id: string; file: string; kind: typeof kind }[]> => {
        let names: string[];
        try {
            names = await fs.readDir(dir);
        } catch {
            return [];
        }
        const pattern = kind === 'task' ? /^(\d{4})_/ : /^([A-Z][0-9]*)_/;
        return names
            .map((n) => ({ m: n.match(pattern), n }))
            .filter((x): x is { m: RegExpMatchArray; n: string } => x.m !== null)
            .map((x) => ({ id: x.m[1] as string, file: relative(cwd, join(dir, x.n)), kind }));
    };

    const all = [
        ...(await Promise.all(taskDirs.map((dir) => scan(dir, 'task')))).flat(),
        ...(await scan(featuresDir, 'feature')),
    ];

    const byId = new Map<string, string[]>();
    for (const e of all) {
        const k = `${e.kind}:${e.id}`;
        byId.set(k, [...(byId.get(k) ?? []), e.file]);
    }

    const errors: CorpusError[] = [];
    for (const [k, files] of byId) {
        if (files.length < 2) continue;
        const [kind, id] = k.split(':') as ['task' | 'feature', string];
        errors.push({
            kind,
            id,
            code: 'corpus.duplicate-id',
            severity: 'error',
            message: `${files.length} files claim ${kind} ${id}: ${files.join(' | ')} — one shadows the other in every lookup; renumber the later one via \`spur ${kind} create\``,
        });
    }
    return errors;
}

/* ------------------------------------------------------- ungraduated fog ---
 *
 * The wayfinder protocol says resolving a ticket either graduates newly-specifiable
 * fog into fresh child tasks, or rules it beyond the destination and records that in
 * `### Out of scope`. Both halves are prose, and on 2026-08-07 half of one was done:
 * two fog patches were deleted from feature E1 and zero tickets were created. The map
 * then read as MORE complete than before, because the fog list had shrunk.
 *
 * The check inverts the obvious design. A `graduated: [wbs, …]` frontmatter list would
 * be self-reported, and the incident was precisely a failure to self-report. So the
 * trigger is the destructive act itself — "you removed scope, where did it go?" —
 * which is diff-visible and cannot be forgotten.
 */

/** The fog and scope-cut subsections, `###` under `## Notes`, with free-form trailing text. */
const FOG_HEADING = /^###\s+Not yet specified\b/;
const OUT_OF_SCOPE_HEADING = /^###\s+Out of scope\b/;
const FEATURE_ID = /^([A-Z][0-9]*)_/;
/** Preference order for the branch point; the first that resolves wins. */
const DEFAULT_BRANCHES = ['origin/main', 'origin/master', 'main', 'master'];

/** Read a tree of corpus files — either from disk (working tree) or from a git ref. */
interface TreeReader {
    /** Repo-relative paths of the files directly under `dir`. */
    list(dir: string): Promise<string[]>;
    /** File content, or null when it does not exist in this tree. */
    read(path: string): Promise<string | null>;
}

/** Run git, returning stdout or null when the command failed (missing ref, no repo, …). */
async function git(cwd: string, args: string[]): Promise<string | null> {
    try {
        const p = await new NodeProcessExecutor().run({ command: 'git', args, cwd, rejectOnError: false });
        return p.exitCode === 0 ? p.stdout : null;
    } catch {
        return null;
    }
}

function diskReader(cwd: string): TreeReader {
    const fs = createNodeFileSystem(cwd);
    return {
        list: async (dir) => {
            try {
                return (await fs.readDir(join(cwd, dir))).map((n) => `${dir}/${n}`);
            } catch {
                return [];
            }
        },
        read: async (path) => {
            try {
                return await fs.readFile(join(cwd, path));
            } catch {
                return null;
            }
        },
    };
}

function gitReader(cwd: string, ref: string): TreeReader {
    const listed = new Map<string, string[]>();
    return {
        list: async (dir) => {
            let files = listed.get(dir);
            if (files === undefined) {
                files = ((await git(cwd, ['ls-tree', '-r', '--name-only', ref, '--', dir])) ?? '')
                    .split('\n')
                    .filter(Boolean);
                listed.set(dir, files);
            }
            return files;
        },
        read: (path) => git(cwd, ['show', `${ref}:${path}`]),
    };
}

/** A resolved revision range, or the reason there is none. `spec` names it either way (R5). */
export type FogRange = { base: string; spec: string } | { skip: string; spec: string };

/**
 * Resolve the branch-scoped range: `merge-base(<default branch>, HEAD)` .. the working tree.
 *
 * WHY branch-scoped and not `HEAD~1..HEAD`: walking the real E1 graduation shows the fog edit
 * and its tickets land in DIFFERENT commits (`ee0771ab` edits 2 features and adds 0 tasks;
 * `c9bc177b` adds 8 tasks and 0 features). Any narrower range false-positives on the first of
 * the pair. A wayfinder session is what spans those commits, and a branch is its boundary.
 *
 * Every unusable range skips rather than fails (R8): a gate that breaks a tarball checkout or a
 * CI shallow fetch gets disabled, which costs more than the check buys.
 */
export async function resolveFogRange(cwd: string, since?: string): Promise<FogRange> {
    const spec = since ? `${since}..(working tree)` : `merge-base(${DEFAULT_BRANCHES[0]}, HEAD)..(working tree)`;
    if ((await git(cwd, ['rev-parse', '--git-dir'])) === null) return { skip: 'not a git repository', spec };
    if ((await git(cwd, ['rev-parse', '--is-shallow-repository']))?.trim() === 'true') {
        return { skip: 'shallow clone — the branch point is not in this history', spec };
    }
    const head = (await git(cwd, ['rev-parse', 'HEAD']))?.trim();
    if (!head) return { skip: 'HEAD resolves to no commit', spec };

    if (since) {
        const base = (await git(cwd, ['rev-parse', '--verify', `${since}^{commit}`]))?.trim();
        if (!base) return { skip: `--since ref '${since}' does not resolve to a commit`, spec };
        return { base, spec };
    }
    for (const branch of DEFAULT_BRANCHES) {
        if ((await git(cwd, ['rev-parse', '--verify', `${branch}^{commit}`])) === null) continue;
        const base = (await git(cwd, ['merge-base', branch, 'HEAD']))?.trim();
        if (!base) continue;
        const named = `merge-base(${branch}, HEAD)=${base.slice(0, 8)}..(working tree)`;
        // Undiverged HEAD means there is no session to measure. This is the accepted cost of the
        // branch-scoped range, and why the wayfinder protocol now requires a branch (task 0472 R10).
        if (base === head) return { skip: `HEAD has no divergence from ${branch}`, spec: named };
        return { base, spec: named };
    }
    return { skip: 'no default branch (origin/main, main, …) to bound the range', spec };
}

/** Strip emphasis and trailing punctuation so a label survives re-casing and re-punctuation. */
function normalizeLabel(text: string): string {
    return text
        .replace(/[*_`]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.,;:!?—–-]+$/, '')
        .trim()
        .toLowerCase();
}

/**
 * The identity of each top-level bullet in a `###` subsection, as `normalized -> display`.
 *
 * Identity is the bullet's leading **bold label** — the shape every existing map uses — because
 * character counts break on rewrap and full-text diffs break on rewording. A bullet with no bold
 * label falls back to its first clause. Returns null when the section is absent.
 */
export function sectionLabels(markdown: string, heading: RegExp): Map<string, string> | null {
    const lines = markdown.split('\n');
    const start = lines.findIndex((l) => heading.test(l));
    if (start === -1) return null;

    const labels = new Map<string, string>();
    for (const line of lines.slice(start + 1)) {
        if (/^#{1,3}\s/.test(line)) break; // the next same-or-higher heading ends the section
        const bullet = line.match(/^-\s+(.*\S)\s*$/)?.[1];
        if (bullet === undefined) continue;
        const bold = bullet.match(/^\*\*(.+?)\*\*/)?.[1];
        const display =
            bold ??
            bullet
                .replace(/[*_`]/g, '')
                .split(/\s+[—–-]\s+|[.;:]\s/)[0]
                ?.slice(0, 80) ??
            bullet;
        labels.set(normalizeLabel(display), display.trim());
    }
    return labels;
}

/** Feature id from a corpus filename (`M1_fine-tune-….md` → `M1`), or null. */
function featureIdOf(file: string): string | null {
    return basename(file).match(FEATURE_ID)?.[1] ?? null;
}

function frontmatterFeatureId(markdown: string): string | null {
    return markdown.slice(0, 2000).match(/^feature_id:\s*["']?([A-Za-z0-9]+)["']?\s*$/m)?.[1] ?? null;
}

/**
 * Did a task join this feature inside the range?
 *
 * Both a brand-new task file and an existing task re-parented onto the feature count: re-parenting
 * is a legitimate graduation, and requiring a new file would false-positive on it (R2).
 */
async function taskAddedForFeature(
    before: TreeReader,
    after: TreeReader,
    featureId: string,
    taskDirs: string[],
): Promise<boolean> {
    for (const dir of taskDirs) {
        const existedBefore = new Set(await before.list(dir));
        for (const file of await after.list(dir)) {
            if (!file.endsWith('.md')) continue;
            const md = await after.read(file);
            if (md === null || frontmatterFeatureId(md) !== featureId) continue;
            if (!existedBefore.has(file)) return true;
            const was = await before.read(file);
            if (was === null || frontmatterFeatureId(was) !== featureId) return true;
        }
    }
    return false;
}

/**
 * Fail when a map's fog shrank with neither graduated tickets nor a recorded scope cut.
 *
 * | fog section        | task added | `### Out of scope` grew | verdict |
 * | ------------------ | ---------- | ----------------------- | ------- |
 * | unchanged / grew   | —          | —                       | pass    |
 * | shrank             | ≥ 1        | —                       | pass (graduated) |
 * | shrank             | none       | yes                     | pass (ruled out of scope) |
 * | shrank             | none       | no                      | **fail** |
 *
 * The third row is what keeps the gate credible: a check that only knew about graduation would
 * fail every legitimate scope cut, and a gate that cries wolf gets disabled.
 *
 * `head` reads the range end from a git ref instead of the working tree — used to replay real
 * history in tests.
 */
export async function ungraduatedFog(
    cwd: string = process.cwd(),
    opts: { since?: string; head?: string; report?: (message: string) => void } = {},
): Promise<CorpusError[]> {
    const report = opts.report ?? (() => {});
    const range = await resolveFogRange(cwd, opts.since);
    if ('skip' in range) {
        report(`corpus-check: fog check SKIPPED (${range.skip}) — range ${range.spec} was not evaluated.`);
        return [];
    }
    const fs = createNodeFileSystem(resolveProjectRoot(cwd));
    const planning = await resolvePlanningFolders(fs);
    const taskDirs = Object.keys(planning.foldersConfig.folders).map((dir) => relative(cwd, fs.resolve(dir)));
    const featuresDir = relative(cwd, fs.resolve(planning.featuresDir));
    const before = gitReader(cwd, range.base);
    const after = opts.head ? gitReader(cwd, opts.head) : diskReader(cwd);
    const spec = opts.head ? range.spec.replace('(working tree)', opts.head) : range.spec;

    const errors: CorpusError[] = [];
    let maps = 0;
    for (const file of await after.list(featuresDir)) {
        const id = featureIdOf(file);
        const endMd = id === null ? null : await after.read(file);
        if (id === null || endMd === null) continue;
        const startMd = await before.read(file);
        // No file history (new map, tarball checkout of one file) means nothing could be removed.
        const startFog = startMd === null ? null : sectionLabels(startMd, FOG_HEADING);
        if (startFog === null) continue;
        maps++;

        const endFog = sectionLabels(endMd, FOG_HEADING) ?? new Map();
        const removed = [...startFog].filter(([norm]) => !endFog.has(norm)).map(([, display]) => display);
        if (removed.length === 0) continue;

        const startCut = sectionLabels(startMd as string, OUT_OF_SCOPE_HEADING) ?? new Map();
        const endCut = sectionLabels(endMd, OUT_OF_SCOPE_HEADING) ?? new Map();
        if ([...endCut.keys()].some((norm) => !startCut.has(norm))) continue;
        if (await taskAddedForFeature(before, after, id, taskDirs)) continue;

        errors.push({
            kind: 'feature',
            id,
            code: 'corpus.ungraduated-fog',
            severity: 'error',
            message:
                `fog removed from \`### Not yet specified\` over ${spec} with no graduated ticket and no ` +
                `recorded scope cut: ${removed.map((r) => `"${r}"`).join(', ')} — the work now exists nowhere. ` +
                `Either create the graduated ticket(s) (\`spur task create "<title>" --feature ${id}\`), ` +
                `or record the cut under \`### Out of scope\` in ${file}.`,
        });
    }
    report(`corpus-check: fog check evaluated ${spec} — ${maps} map(s) inspected.`);
    return errors;
}

/**
 * Every observed finding (both severities) across tasks, features, duplicate
 * ids, and the fog check — the exact observed set `runCorpusCheck` reconciles.
 * Exported so baseline generation/reconciliation tooling (task 0582 R5) shares
 * one code path with the gate instead of re-sweeping differently.
 */
export async function collectObservedFindings(projectRoot: string, since?: string): Promise<CorpusError[]> {
    const sweep = await structuralSweep(projectRoot);
    const fogErrors = await ungraduatedFog(projectRoot, { since, report: () => {} });
    return [...sweep.findings, ...(await duplicateIds(projectRoot, sweep.taskDirs, sweep.featuresDir)), ...fogErrors];
}

/**
 * The two-sided per-severity reconciliation — shared by the gate (`runCorpusCheck`)
 * and by baseline generation/verification tooling (task 0582 R5), so a staged
 * baseline is verified by the exact logic the gate will run against it.
 *
 * Severity is part of the acceptance contract: an observed finding is covered
 * only by a baseline entry with the same key AND the same severity. A baselined
 * warning does not cover the same key promoted to error (and vice versa) — that
 * finding reads as new, and the entry reads as stale, forcing reconciliation
 * exactly when a rule's severity changes (ADR-062, task 0583's promotion flow).
 */
export function reconcileBaseline(observed: CorpusError[], baseline: Baseline): CorpusCheckResult {
    const accepted = new Map(baseline.entries.map((e) => [key(e), baselineSeverity(e)]));
    const unexpected = observed.filter((e) => accepted.get(key(e)) !== e.severity);
    const newErrors = unexpected.filter((e) => e.severity === 'error');
    const newWarnings = unexpected.filter((e) => e.severity === 'warning');

    const observedKeys = new Map(observed.map((o) => [key(o), o.severity as CorpusSeverity]));
    const staleEntries = baseline.entries.filter((e) => {
        // Compare against the normalized severity (legacy entries read as 'error');
        // comparing the raw field would mark every pre-ADR-062 entry stale.
        return observedKeys.get(key(e)) !== baselineSeverity(e);
    });

    const bySeverity = {
        error: {
            observed: observed.filter((o) => o.severity === 'error').length,
            baselined: baseline.entries.filter((e) => baselineSeverity(e) === 'error').length,
            newCount: newErrors.length,
            staleCount: staleEntries.filter((e) => baselineSeverity(e) === 'error').length,
        },
        warning: {
            observed: observed.filter((o) => o.severity === 'warning').length,
            baselined: baseline.entries.filter((e) => baselineSeverity(e) === 'warning').length,
            newCount: newWarnings.length,
            staleCount: staleEntries.filter((e) => baselineSeverity(e) === 'warning').length,
        },
    };

    return {
        observed: observed.length,
        baselined: baseline.entries.length,
        newErrors,
        newWarnings,
        staleEntries,
        bySeverity,
        ok: unexpected.length === 0 && staleEntries.length === 0,
    };
}

/** Sweep the corpus in-process and reconcile it against the two-sided baseline. */
export async function runCorpusCheck(cwd: string, since?: string): Promise<CorpusCheckResult> {
    const projectRoot = resolveProjectRoot(cwd);
    const baselineFile = join(projectRoot, 'config', 'corpus-baseline.json');
    // A missing baseline degrades to "no exemptions" rather than crashing. The file is a gate
    // INPUT and belongs in git; but a tarball export, a sparse checkout, or a forgotten `git add`
    // must produce a legible strictest-mode run, not an opaque module/JSON error.
    let baseline: Baseline = { entries: [] };
    if (await Bun.file(baselineFile).exists()) {
        baseline = await Bun.file(baselineFile).json();
    }

    const observed = await collectObservedFindings(projectRoot, since);
    const result = reconcileBaseline(observed, baseline);

    // When the fog range was skipped (no divergence, shallow clone, etc.), baselined
    // corpus.ungraduated-fog entries were never evaluated — "not evaluated" is not "no
    // longer reproduces", so exclude them from the stale sweep to keep the gate green
    // on main and CI without removing legitimate exemptions. reconcileBaseline has no
    // git context, so the fog-skip carve-out stays here at the gate boundary.
    const fogSkipped = await resolveFogRange(projectRoot, since);
    if ('skip' in fogSkipped) {
        const retained = result.staleEntries.filter((e) => e.code !== 'corpus.ungraduated-fog');
        result.staleEntries.length = 0;
        result.staleEntries.push(...retained);
        result.bySeverity.error.staleCount = retained.filter((e) => baselineSeverity(e) === 'error').length;
        result.bySeverity.warning.staleCount = retained.filter((e) => baselineSeverity(e) === 'warning').length;
        result.ok = result.newErrors.length === 0 && result.newWarnings.length === 0 && retained.length === 0;
    }

    return result;
}
