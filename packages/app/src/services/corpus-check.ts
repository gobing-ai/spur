/**
 * Explicit unsuppressed corpus audit (ADR-108).
 * Active tasks and features are checked; archived tasks only resolve references
 * and duplicate identities. No baseline, acceptance ledger, or automatic caller.
 * The legacy JSON count names remain for compatibility, with baselined always zero.
 */
import { basename, dirname, join, relative, resolve } from 'node:path';
import { bundledConfigRoot, resolvePlanningFolders } from '@gobing-ai/spur-config/loader';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { parse } from 'yaml';
import { FeatureCheckService } from './feature-check';
import { type CorpusSeverity, key, type SectionMatrix } from './planning-check-base';
import { TaskCheckService } from './task-check';
import { TaskLocator } from './task-locator';

export type { CorpusSeverity };

/** A single finding observed in the corpus sweep (errors and warnings alike). */
export interface CorpusError {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    severity: CorpusSeverity;
    message: string;
}

export { key };

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
    for (const tasksDir of [activeTasksDir]) {
        if (!(await fs.exists(tasksDir))) continue;
        for (const fileName of await fs.readDir(tasksDir)) {
            const wbs = fileName.match(/^(\d{4})_.+\.md$/)?.[1];
            if (wbs === undefined) continue;
            const result = await taskService.check(join(tasksDir, fileName), wbs);
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
            const id = fileName.match(/^([A-Z][0-9]*)_.+\.md$/)?.[1];
            if (id === undefined) continue;
            const result = await featureService.check(join(featuresDir, fileName), id, {
                featuresDir,
                tasksDir: activeTasksDir,
                tasksDirs: taskDirs,
                runDir: fs.resolve('.spur/run'),
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

/** Explicit audit only: no baseline or severity override can hide findings. */
export async function runCorpusCheck(cwd: string, since?: string, report?: (message: string) => void) {
    const projectRoot = resolveProjectRoot(cwd);
    const sweep = await structuralSweep(projectRoot);
    const fog = await ungraduatedFog(projectRoot, { since, report });
    const findings = [
        ...sweep.findings,
        ...(await duplicateIds(projectRoot, sweep.taskDirs, sweep.featuresDir)),
        ...fog.map((finding) => ({ ...finding, severity: 'warning' as const })),
    ];
    const newErrors = findings.filter((finding) => finding.severity === 'error');
    const newWarnings = findings.filter((finding) => finding.severity === 'warning');
    return {
        observed: findings.length,
        baselined: 0,
        newErrors,
        newWarnings,
        bySeverity: {
            error: { observed: newErrors.length, baselined: 0, newCount: newErrors.length },
            warning: { observed: newWarnings.length, baselined: 0, newCount: newWarnings.length },
        },
        duplicateKeys: [],
        ok: newErrors.length === 0,
    };
}

function resolveProjectRoot(cwd: string): string {
    const fs = createNodeFileSystem(cwd);
    let current = resolve(cwd);
    while (true) {
        if (fs.exists(join(current, '.spur', 'config.yaml'))) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) return resolve(cwd);
        current = parent;
    }
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
