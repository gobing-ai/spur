/**
 * corpus-check — sweep the whole task and feature corpus and fail on any
 * structural error that is not in the accepted baseline.
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
 * error fails the gate, AND a baseline entry that no longer reproduces fails it
 * too. Without the second half the file would rot into a permanent suppression
 * list — the exact invisible-debt pattern this command exists to end.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** One accepted-error record from `config/corpus-baseline.json`. */
interface BaselineEntry {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    reason: string;
    since: string;
}

interface Baseline {
    note?: string;
    entries: BaselineEntry[];
}

/** A single error observed in the corpus sweep. */
interface CorpusError {
    kind: 'task' | 'feature';
    id: string;
    code: string;
    message: string;
}

/** `<kind>:<id>:<code>` — the identity a baseline entry and an observed error share. */
export function key(e: { kind: string; id: string; code: string }): string {
    return `${e.kind}:${e.id}:${e.code}`;
}

/**
 * Run one `spur <noun> check --json` sweep and collect its errors.
 *
 * The CLI exits non-zero when findings exist, so the exit code is expected and
 * ignored; stdout is the signal. A sweep that produces unparseable output is a
 * hard failure — silently treating it as "no errors" would disable the gate.
 */
async function sweep(noun: 'task' | 'feature', cwd: string): Promise<CorpusError[]> {
    const proc = Bun.spawn(['bun', 'run', join('apps', 'cli', 'src', 'index.ts'), noun, 'check', '--json'], {
        cwd,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    await proc.exited;

    const start = stdout.indexOf('[');
    if (start === -1) {
        throw new Error(
            `corpus-check: \`spur ${noun} check --json\` produced no JSON array. ` +
                `Output was:\n${stdout.slice(0, 400)}`,
        );
    }
    let rows: { wbs?: string; id?: string; findings?: { code: string; severity: string; message: string }[] }[];
    try {
        rows = JSON.parse(stdout.slice(start));
    } catch (err) {
        throw new Error(`corpus-check: could not parse \`spur ${noun} check --json\` output: ${String(err)}`);
    }

    const errors: CorpusError[] = [];
    for (const row of rows) {
        const id = row.wbs ?? row.id;
        if (id === undefined) continue;
        for (const f of row.findings ?? []) {
            if (f.severity !== 'error') continue;
            errors.push({ kind: noun, id, code: f.code, message: f.message });
        }
    }
    return errors;
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
async function duplicateIds(cwd: string): Promise<CorpusError[]> {
    const scan = (dir: string, kind: 'task' | 'feature'): { id: string; file: string; kind: typeof kind }[] => {
        let names: string[];
        try {
            names = readdirSync(join(cwd, dir));
        } catch {
            return [];
        }
        const pattern = kind === 'task' ? /^(\d{4})_/ : /^([A-Z][0-9]*)_/;
        return names
            .map((n) => ({ m: n.match(pattern), n }))
            .filter((x): x is { m: RegExpMatchArray; n: string } => x.m !== null)
            .map((x) => ({ id: x.m[1] as string, file: `${dir}/${x.n}`, kind }));
    };

    const all = [
        ...scan('docs/tasks', 'task'),
        ...scan('docs/tasks2', 'task'),
        ...scan('docs/tasks3', 'task'),
        ...scan('docs/features', 'feature'),
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
const TASK_DIRS = ['docs/tasks', 'docs/tasks2', 'docs/tasks3'];
/** Preference order for the branch point; the first that resolves wins. */
const DEFAULT_BRANCHES = ['origin/main', 'origin/master', 'main', 'master'];

/** Read a tree of corpus files — either from disk (working tree) or from a git ref. */
interface TreeReader {
    /** Repo-relative paths of the files directly under `dir`. */
    list(dir: string): string[];
    /** File content, or null when it does not exist in this tree. */
    read(path: string): string | null;
}

/** Run git, returning stdout or null when the command failed (missing ref, no repo, …). */
function git(cwd: string, args: string[]): string | null {
    const p = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return p.exitCode === 0 ? p.stdout.toString() : null;
}

function diskReader(cwd: string): TreeReader {
    return {
        list: (dir) => {
            try {
                return readdirSync(join(cwd, dir)).map((n) => `${dir}/${n}`);
            } catch {
                return [];
            }
        },
        read: (path) => {
            try {
                return readFileSync(join(cwd, path), 'utf8');
            } catch {
                return null;
            }
        },
    };
}

function gitReader(cwd: string, ref: string): TreeReader {
    const listed = new Map<string, string[]>();
    return {
        list: (dir) => {
            let files = listed.get(dir);
            if (files === undefined) {
                files = (git(cwd, ['ls-tree', '-r', '--name-only', ref, '--', dir]) ?? '').split('\n').filter(Boolean);
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
export function resolveFogRange(cwd: string, since?: string): FogRange {
    const spec = since ? `${since}..(working tree)` : `merge-base(${DEFAULT_BRANCHES[0]}, HEAD)..(working tree)`;
    if (git(cwd, ['rev-parse', '--git-dir']) === null) return { skip: 'not a git repository', spec };
    if (git(cwd, ['rev-parse', '--is-shallow-repository'])?.trim() === 'true') {
        return { skip: 'shallow clone — the branch point is not in this history', spec };
    }
    const head = git(cwd, ['rev-parse', 'HEAD'])?.trim();
    if (!head) return { skip: 'HEAD resolves to no commit', spec };

    if (since) {
        const base = git(cwd, ['rev-parse', '--verify', `${since}^{commit}`])?.trim();
        if (!base) return { skip: `--since ref '${since}' does not resolve to a commit`, spec };
        return { base, spec };
    }
    for (const branch of DEFAULT_BRANCHES) {
        if (git(cwd, ['rev-parse', '--verify', `${branch}^{commit}`]) === null) continue;
        const base = git(cwd, ['merge-base', branch, 'HEAD'])?.trim();
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
function taskAddedForFeature(before: TreeReader, after: TreeReader, featureId: string): boolean {
    for (const dir of TASK_DIRS) {
        const existedBefore = new Set(before.list(dir));
        for (const file of after.list(dir)) {
            if (!file.endsWith('.md')) continue;
            const md = after.read(file);
            if (md === null || frontmatterFeatureId(md) !== featureId) continue;
            if (!existedBefore.has(file)) return true;
            const was = before.read(file);
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
    opts: { since?: string; head?: string } = {},
): Promise<CorpusError[]> {
    const range = resolveFogRange(cwd, opts.since);
    if ('skip' in range) {
        console.log(`corpus-check: fog check SKIPPED (${range.skip}) — range ${range.spec} was not evaluated.`);
        return [];
    }
    const before = gitReader(cwd, range.base);
    const after = opts.head ? gitReader(cwd, opts.head) : diskReader(cwd);
    const spec = opts.head ? range.spec.replace('(working tree)', opts.head) : range.spec;

    const errors: CorpusError[] = [];
    let maps = 0;
    for (const file of after.list('docs/features')) {
        const id = featureIdOf(file);
        const endMd = id === null ? null : after.read(file);
        if (id === null || endMd === null) continue;
        const startMd = before.read(file);
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
        if (taskAddedForFeature(before, after, id)) continue;

        errors.push({
            kind: 'feature',
            id,
            code: 'corpus.ungraduated-fog',
            message:
                `fog removed from \`### Not yet specified\` over ${spec} with no graduated ticket and no ` +
                `recorded scope cut: ${removed.map((r) => `"${r}"`).join(', ')} — the work now exists nowhere. ` +
                `Either create the graduated ticket(s) (\`spur task create "<title>" --feature ${id}\`), ` +
                `or record the cut under \`### Out of scope\` in ${file}.`,
        });
    }
    console.log(`corpus-check: fog check evaluated ${spec} — ${maps} map(s) inspected.`);
    return errors;
}

/** Sweep the corpus and diff it against the baseline. Returns the process exit code. */
export async function corpusCheck(cwd: string = process.cwd(), since?: string): Promise<number> {
    const baselineFile = join(cwd, 'config', 'corpus-baseline.json');
    // A missing baseline degrades to "no exemptions" rather than crashing. The file is a gate
    // INPUT and belongs in git; but a tarball export, a sparse checkout, or a forgotten `git add`
    // must produce a legible strictest-mode run, not an opaque module/JSON error.
    let baseline: Baseline = { entries: [] };
    if (await Bun.file(baselineFile).exists()) {
        baseline = await Bun.file(baselineFile).json();
    } else {
        console.warn(
            `corpus-check: no baseline at ${baselineFile} — running with zero exemptions. ` +
                'If this is a git checkout, the file is missing from version control.',
        );
    }
    const accepted = new Map(baseline.entries.map((e) => [key(e), e]));

    const fogErrors = await ungraduatedFog(cwd, { since });
    const observed = [
        ...(await sweep('task', cwd)),
        ...(await sweep('feature', cwd)),
        ...(await duplicateIds(cwd)),
        ...fogErrors,
    ];
    const observedKeys = new Set(observed.map(key));

    const unexpected = observed.filter((e) => !accepted.has(key(e)));
    // When the fog range was skipped (no divergence, shallow clone, etc.), baselined
    // corpus.ungraduated-fog entries were never evaluated — "not evaluated" is not "no
    // longer reproduces", so exclude them from the stale sweep to keep the gate green
    // on main and CI without removing legitimate exemptions.
    const fogSkipped = resolveFogRange(cwd, since);
    const stale = baseline.entries.filter((e) => {
        if ('skip' in fogSkipped && e.code === 'corpus.ungraduated-fog') return false;
        return !observedKeys.has(key(e));
    });

    console.log(
        `corpus-check: swept tasks + features — ${observed.length} error(s) observed, ` +
            `${accepted.size} baselined, ${unexpected.length} new, ${stale.length} stale.`,
    );

    for (const e of unexpected) {
        console.error(`  NEW    ${e.kind} ${e.id}: ${e.code} — ${e.message}`);
    }
    for (const e of stale) {
        console.error(`  STALE  ${e.kind} ${e.id}: ${e.code} — fixed; remove this entry from ${baselineFile}`);
    }

    if (unexpected.length > 0 || stale.length > 0) {
        console.error(
            '\ncorpus-check FAILED.\n' +
                '  NEW   → fix the finding, or add it to config/corpus-baseline.json with a reason and a date.\n' +
                '  STALE → the finding is gone; delete its baseline entry so the list stays honest.',
        );
        return 1;
    }
    console.log('corpus-check OK — no corpus errors outside the accepted baseline.');
    return 0;
}
