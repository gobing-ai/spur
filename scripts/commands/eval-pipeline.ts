/**
 * eval-pipeline — parity comparator for task pipelines (task 0595, feature I6).
 *
 * Usage: bun scripts/spur-dev.ts eval-pipeline [--label <name>]
 *        [--pipeline <yaml>]... [--fixture <template-name>]...
 *        [--runs <n>] [--keep] [--dry]
 *
 * For each pipeline under test: create fixture tasks in a detached run-local
 * worktree (WBS 95xx), run them through `spur workflow run <pipeline>
 * --vars {"wbs":...}`, and emit one record per fixture task: { wbs, pipeline,
 * verdict, gateOutcomes[], artifactsWritten[], tokenCost, wallClockMs, exitCode
 * }. Verdict comes from `spur task verdict --json` (never re-implemented). With
 * two pipelines a per-field diff is emitted. Determinism is not assumed: the
 * report carries runCount and variance, and a single run is labelled as such
 * (R3).
 *
 * Fixtures are cleaned up in a finally block (R4) — see
 * tests/fixtures/pipeline-eval/README.md for the documented lifecycle.
 */
import { Database } from 'bun:sqlite';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/pipeline-eval');
const REPORT_DIR = join(REPO_ROOT, '.spur/reports/pipeline-eval');
const DEFAULT_PIPELINE = join(REPO_ROOT, 'config/workflows/task-pipeline.yaml');

/**
 * The spur CLI invocation the eval harness drives, as an argv prefix.
 *
 * Prefer a locally-provisioned `.spur/run/spur-bin.sh` override (the dev setup's gitignored
 * launcher, e.g. a `bun link`ed or built CLI); on CI / fresh checkouts that file does not
 * exist, so fall back to the monorepo dev CLI `<bun> apps/cli/src/index.ts`, which is always
 * in-tree. Without the fallback, `bun run test` on a fresh checkout cannot spawn the CLI and
 * every fixture-create call (the nesting-guard tests) dies with ENOENT. The two-token form
 * is what `doctor.probe`'s `spurBin` option already documents as splittable into argv.
 */
const SPUR_ARGV = resolveSpurArgv();

function resolveSpurArgv(): string[] {
    const override = join(REPO_ROOT, '.spur/run/spur-bin.sh');
    if (existsSync(override)) return [override];
    return [process.execPath, join(REPO_ROOT, 'apps/cli/src/index.ts')];
}

const FIXTURE_BASE_COUNTER = 9499;

function git(args: string[], cwd = REPO_ROOT): { exitCode: number; stdout: string; stderr: string } {
    const proc = Bun.spawnSync(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
    return {
        exitCode: proc.exitCode ?? 1,
        stdout: proc.stdout?.toString() ?? '',
        stderr: proc.stderr?.toString() ?? '',
    };
}

export interface EvalRun {
    projectDir: string;
    tasksDir: string;
    runDir: string;
    dbPath: string;
    tempParent: string;
}

/** Frozen record shape — [0596]'s only interface. Do not change after 0596 starts. */
export interface EvalRecord {
    wbs: string;
    pipeline: string;
    verdict: string | null;
    gateOutcomes: string[];
    artifactsWritten: string[];
    tokenCost: number | null;
    wallClockMs: number;
    exitCode: number;
}

export interface EvalReport {
    label: string;
    generatedAt: string;
    runCount: number;
    singleRun: boolean;
    pipelines: string[];
    records: EvalRecord[];
    variance: { wallClockMs: Record<string, number> } | null;
    promotionBarProposal: string;
    /**
     * Additive (0607 R1): per pipeline path → model-query count from the frozen
     * `modelQueries` list in `config/workflow-composition-baseline.json` (the SSOT,
     * itself two-sided checked). Absent for consumers that never knew it.
     */
    modelQueries?: Record<string, number>;
    /**
     * Additive (0607 R4): per pipeline path → structural breakdown of where
     * wall-clock can go — model hops vs deterministic actions vs gate/recheck
     * states. A reporting aid for the measured breakdown, not a timing rig.
     */
    breakdown?: Record<string, { modelHops: number; deterministicActions: number; gateStates: number }>;
}

/** Per-workflow model-query + action facts read from the composition baseline. */
interface BaselineWorkflowFacts {
    modelQueries: string[];
    actions: string[];
}

/**
 * Load the frozen model-query SSOT from `config/workflow-composition-baseline.json`
 * (task 0607 R1: "reuse the modelQueries list already frozen per workflow … as the
 * query-count source of truth"). A pipeline is matched by its definition path's
 * basename minus the `.yaml` suffix, exactly how the baseline's `definition` field
 * is keyed. Missing baseline / unknown pipeline → empty facts (measurement still
 * proceeds; the count is reported as 0 for the un-baselined case, never guessed).
 */
export async function loadBaselineFacts(baselinePath: string): Promise<Record<string, BaselineWorkflowFacts>> {
    try {
        const content = await readFile(baselinePath, 'utf-8');
        const parsed = JSON.parse(content) as {
            workflows?: Record<string, { modelQueries?: string[]; actions?: Record<string, unknown> }>;
        };
        const out: Record<string, BaselineWorkflowFacts> = {};
        for (const [name, entry] of Object.entries(parsed.workflows ?? {})) {
            out[name] = {
                modelQueries: entry.modelQueries ?? [],
                actions: Object.keys(entry.actions ?? {}),
            };
        }
        return out;
    } catch {
        return {};
    }
}

/** Map a pipeline definition path to its baseline key (basename minus `.yaml`). */
export function baselineKeyForPipeline(pipelinePath: string): string {
    return (
        pipelinePath
            .split('/')
            .pop()
            ?.replace(/\.yaml$/, '') ?? pipelinePath
    );
}

/**
 * Per-pipeline structural breakdown (0607 R4): model hops = the baseline `modelQueries`
 * list length; deterministic actions = every other recorded action; gate/recheck states
 * = actions whose key names a gate/recheck/approve/test state. Reported as a guide for
 * the measured breakdown, never as a timing claim.
 */
export function describeBreakdown(
    facts: Record<string, BaselineWorkflowFacts>,
    pipelinePath: string,
): { modelHops: number; deterministicActions: number; gateStates: number } {
    const entry = facts[baselineKeyForPipeline(pipelinePath)];
    if (!entry) return { modelHops: 0, deterministicActions: 0, gateStates: 0 };
    const gateStates = entry.actions.filter((key) => /(^|:)(test|recheck|approve|gate)/i.test(key)).length;
    return {
        modelHops: entry.modelQueries.length,
        deterministicActions: entry.actions.length - entry.modelQueries.length,
        gateStates,
    };
}

/**
 * Repo-relative paths of every per-workspace `node_modules` that exists in the main tree
 * (e.g. `apps/cli/node_modules`). Discovered rather than hard-coded so adding a workspace does not
 * silently break the eval harness's typecheck.
 */
async function listWorkspaceModuleDirs(): Promise<string[]> {
    const out: string[] = [];
    for (const group of ['apps', 'packages']) {
        const entries = await readdir(join(REPO_ROOT, group), { withFileTypes: true }).catch(() => []);
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const rel = join(group, e.name, 'node_modules');
            const st = await stat(join(REPO_ROOT, rel)).catch(() => null);
            if (st?.isDirectory()) out.push(rel);
        }
    }
    return out;
}

/**
 * Create a disposable detached worktree for one pipeline run.
 *
 * The worktree starts at HEAD, giving workflow actions real Git context. Its
 * local config preserves the repository settings (including agent executors)
 * and adds only the fixture folder/floor; the production config is untouched.
 */
export async function createEvalRun(): Promise<EvalRun> {
    // OUTSIDE the repository, deliberately. A worktree under `.spur/tmp/` sits beneath a gitignored
    // path, so Biome's `vcs.useIgnoreFile` integration ignores the entire tree ("No files were
    // processed in the specified paths") and `bun run format` / `bun run lint` exit 1 — the project
    // quality gate could never pass and every fixture run ended `test-gate=FAIL`. From the system
    // temp dir the same checkout lints all 723 files. (task 0610 R3)
    const tempParent = await mkdtemp(join(tmpdir(), 'spur-eval-pipeline-'));
    const projectDir = join(tempParent, 'worktree');
    let worktreeAdded = false;
    try {
        const created = git(['worktree', 'add', '--detach', projectDir, 'HEAD']);
        if (created.exitCode !== 0) {
            throw new Error(`eval-pipeline: worktree create failed: ${created.stderr || created.stdout}`);
        }
        worktreeAdded = true;

        // A fresh `git worktree add` carries no `node_modules`, so the project quality gate the
        // `test` stage runs (`qualityGateCmd` -> `bun run lint` -> `tsc`) exits 127 with
        // "tsc: command not found" and EVERY fixture run ends `test-gate=FAIL` — the harness could
        // never reach a verdict. Link the repository's existing install instead of reinstalling:
        // `node_modules` is gitignored so it does not dirty the worktree, and
        // `git worktree remove --force` still cleans up. (task 0610 R3)
        //
        // Bun workspaces keep a per-workspace `node_modules` as well as the root one, and `tsc`
        // resolves `@commander-js/extra-typings` and the `@gobing-ai/*` workspace packages through
        // them — the root link alone leaves typecheck failing with TS2307 across `apps/cli`.
        //
        // ponytail: symlink the existing installs rather than running `bun install` per run (tens of
        // seconds, needs network). The links resolve to the MAIN tree, so the gate typechecks
        // main-tree sources rather than the worktree copy — consistent with `$spurBin`, which also
        // resolves to the main tree, and fine for a gate probe. Upgrade to `bun install` here if a
        // worktree-local source change ever needs to be checked by the quality probe.
        await symlink(join(REPO_ROOT, 'node_modules'), join(projectDir, 'node_modules'), 'dir');
        for (const ws of await listWorkspaceModuleDirs()) {
            await mkdir(join(projectDir, ws, '..'), { recursive: true }).catch(() => {});
            await symlink(join(REPO_ROOT, ws), join(projectDir, ws), 'dir').catch(() => {});
        }

        const fixtureDir = join(projectDir, 'tests/fixtures/pipeline-eval');
        const tasksDir = join(fixtureDir, 'tasks');
        await mkdir(tasksDir, { recursive: true });
        await mkdir(join(fixtureDir, 'scratch'), { recursive: true });

        const configPath = join(REPO_ROOT, '.spur/config.yaml');
        const config = await readFile(configPath, 'utf-8');
        const fixturePath = 'tests/fixtures/pipeline-eval/tasks';
        const fixtureConfig = [
            `    ${fixturePath}:`,
            `      baseCounter: ${FIXTURE_BASE_COUNTER}`,
            '      label: Pipeline Eval Fixtures',
        ].join('\n');
        const localConfig = config.includes(`${fixturePath}:`)
            ? config
            : config.replace('  severity:\n', `${fixtureConfig}\n  severity:\n`);
        if (localConfig === config && !config.includes(`${fixturePath}:`)) {
            throw new Error('eval-pipeline: could not inject fixture task folder into worktree config');
        }
        await writeFile(join(projectDir, '.spur/config.yaml'), localConfig);

        return {
            projectDir,
            tasksDir,
            runDir: join(projectDir, '.spur/run'),
            dbPath: join(projectDir, '.spur/spur.db'),
            tempParent,
        };
    } catch (error) {
        if (worktreeAdded) git(['worktree', 'remove', '--force', projectDir]);
        await rm(tempParent, { recursive: true, force: true }).catch(() => {});
        throw error;
    }
}

/** Remove the worktree and its private mutable state. */
export async function removeEvalRun(run: EvalRun): Promise<void> {
    const removed = git(['worktree', 'remove', '--force', run.projectDir]);
    if (removed.exitCode !== 0) {
        throw new Error(`eval-pipeline: worktree cleanup failed: ${removed.stderr || removed.stdout}`);
    }
    await rm(run.tempParent, { recursive: true, force: true });
}

interface Args {
    label?: string;
    pipelines: string[];
    fixtures: string[];
    runs: number;
    keep: boolean;
    dry: boolean;
    vars: Record<string, string>;
}

export function parseArgs(argv: string[]): Args {
    const args: Args = { pipelines: [], fixtures: [], runs: 1, keep: false, dry: false, vars: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = (): string => {
            const v = argv[++i];
            if (v === undefined) throw new Error(`eval-pipeline: ${a} requires a value`);
            return v;
        };
        if (a === '--label') args.label = next();
        else if (a === '--pipeline') args.pipelines.push(next());
        else if (a === '--fixture') args.fixtures.push(next());
        else if (a === '--runs') args.runs = Number.parseInt(next(), 10);
        else if (a === '--keep') args.keep = true;
        else if (a === '--dry') args.dry = true;
        else if (a === '--vars') args.vars = { ...args.vars, ...JSON.parse(next()) };
        else throw new Error(`eval-pipeline: unknown argument ${a}`);
    }
    if (args.pipelines.length === 0) args.pipelines.push(DEFAULT_PIPELINE);
    if (args.fixtures.length === 0) args.fixtures.push('fixture-minimal');
    if (!Number.isFinite(args.runs) || args.runs < 1) throw new Error(`eval-pipeline: --runs must be >= 1`);
    return args;
}

/** Recursive listing of a directory: path (relative to root) -> mtimeMs. */
export async function snapshotDir(root: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    async function walk(dir: string) {
        let entries: Array<{ name: string; isDirectory: () => boolean }>;
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return; // missing dir = empty snapshot
        }
        for (const e of entries) {
            const full = join(dir, e.name);
            if (e.isDirectory()) await walk(full);
            else out[full.slice(root.length + 1)] = (await Bun.file(full).stat()).mtimeMs;
        }
    }
    await walk(root);
    return out;
}

/** Files created or modified between two snapshots (relative paths). */
export function diffSnapshot(before: Record<string, number>, after: Record<string, number>): string[] {
    return Object.keys(after)
        .filter((p) => before[p] === undefined || before[p] !== after[p])
        .sort();
}

/**
 * Cost from the history plane in the run window (task 0607 R1). Reads
 * `history_message` typed `cost_usd` per message — NEVER `action_runs.result_json`,
 * which carries usage on ~44 of 1971 rows and is why the old action_runs derivation
 * reported `null` every run. Returns the summed USD cost; `null` when no message in
 * the window carries `cost_usd` — never zero (unmeasured ≠ free; a source like
 * grok/agy legitimately has no cost rows, so `null` is the honest answer).
 *
 * The frozen `EvalRecord.tokenCost` field name is kept (task 0596 contract); its
 * meaning is the history-plane USD cost. `ts` is ISO-8601 text, so the lexicographic
 * window compare matches `fromIso`/`toIso`. The run window is the correlation anchor
 * ("run window plus session id" per 0607 Design); a deliberate measurement run has
 * no concurrent activity, so the window is honest.
 */
export function extractHistoryCost(dbPath: string, fromIso: string, toIso: string): number | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const row = db
            .query(
                `SELECT SUM(cost_usd) AS total, COUNT(*) AS n
                 FROM history_message
                 WHERE ts >= ? AND ts <= ? AND cost_usd IS NOT NULL`,
            )
            .get(fromIso, toIso) as { total: number | null; n: number } | undefined;
        return row && row.n > 0 ? Math.round((row.total ?? 0) * 10000) / 10000 : null;
    } finally {
        db.close();
    }
}

/** Derive the verdict label from `spur task verdict --json` output. */
export function parseVerdict(json: string): string | null {
    try {
        const parsed = JSON.parse(json) as { verdict?: unknown; data?: { verdict?: unknown } };
        const v = parsed.verdict ?? parsed.data?.verdict;
        return typeof v === 'string' && v.length > 0 ? v : null;
    } catch {
        return null;
    }
}

/** Gate outcome artifacts the pipeline writes per task, in pipeline order. */
const GATE_FILES = [
    '{wbs}-precheck-doctor.status',
    '{wbs}-precheck-size.status',
    '{wbs}-test-gate.status',
    '{wbs}-verdict.json',
];

export async function readGateOutcomes(wbs: string, runDir = join(REPO_ROOT, '.spur/run')): Promise<string[]> {
    const out: string[] = [];
    for (const f of GATE_FILES) {
        const p = join(runDir, f.replace('{wbs}', wbs));
        let content: string;
        try {
            content = await readFile(p, 'utf-8');
        } catch {
            continue;
        }
        const label = f.replace('{wbs}-', '').replace('.status', '').replace('.json', '');
        // A .json gate carries a document, not a status token: slicing its raw text
        // leaks a multi-line JSON blob into the outcome array (task 0595 residual).
        const value = f.endsWith('.json') ? jsonGateVerdict(content) : content.trim().slice(0, 40);
        out.push(`${label}=${value || '(empty)'}`);
    }
    return out;
}

/** Reduce a JSON gate artifact to its verdict token. */
function jsonGateVerdict(content: string): string {
    try {
        const parsed = JSON.parse(content) as { verdict?: unknown };
        return typeof parsed.verdict === 'string' ? parsed.verdict : '(no-verdict)';
    } catch {
        return '(malformed)';
    }
}

function spur(args: string[], opts: { cwd?: string; timeoutMs?: number } = {}) {
    const proc = Bun.spawnSync([...SPUR_ARGV, ...args], {
        cwd: opts.cwd ?? REPO_ROOT,
        timeout: opts.timeoutMs ?? 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout?.toString() ?? '' };
}

/** Create one fixture task from a template; returns its WBS. */
async function createFixture(templateName: string, run: EvalRun): Promise<string> {
    const body = await readFile(join(FIXTURE_DIR, 'templates', `${templateName}.md`), 'utf-8');
    const created = spur(
        [
            'task',
            'create',
            `pipeline-eval fixture ${templateName}`,
            '--folder',
            run.tasksDir,
            '--allow-duplicate-name',
            '--json',
        ],
        { cwd: run.projectDir },
    );
    if (created.exitCode !== 0) {
        throw new Error(`eval-pipeline: fixture create failed for ${templateName}: ${created.stdout}`);
    }
    const wbs = (JSON.parse(created.stdout) as { wbs: string }).wbs;
    // Fill sections by splitting the template on its ### headings.
    const sections = body.split(/^### /m).slice(1);
    for (const section of sections) {
        const nl = section.indexOf('\n');
        const name = section.slice(0, nl).trim();
        const content = section.slice(nl + 1).replace(/\n+$/, '');
        const tmp = join(run.projectDir, '.spur', `eval-${wbs}-${name.replace(/\s+/g, '-')}.md`);
        await Bun.write(tmp, `${content}\n`);
        const r = spur(['task', 'update', wbs, '--section', name, '--from-file', tmp], {
            cwd: run.projectDir,
        });
        if (r.exitCode !== 0) throw new Error(`eval-pipeline: section ${name} write failed for ${wbs}`);
    }
    return wbs;
}

/** Run the fixture set against one pipeline once; returns records. */
async function runOnce(pipeline: string, fixtures: string[], args: Args): Promise<EvalRecord[]> {
    const run = await createEvalRun();
    const wbsList: string[] = [];
    let before: Record<string, number> = {};
    const records: EvalRecord[] = [];
    try {
        before = await snapshotDir(run.runDir);
        for (const f of fixtures) wbsList.push(await createFixture(f, run));
        for (const wbs of wbsList) {
            const t0 = Date.now();
            const fromIso = new Date(t0).toISOString();
            let exitCode = 0;
            if (!args.dry) {
                const proc = Bun.spawnSync(
                    [
                        ...SPUR_ARGV,
                        'workflow',
                        'run',
                        pipeline,
                        '--vars',
                        JSON.stringify({
                            wbs,
                            profile: 'auto',
                            spurBin: SPUR_ARGV.join(' '),
                            ...args.vars,
                        }),
                    ],
                    {
                        cwd: run.projectDir,
                        timeout: 45 * 60_000,
                        stdout: 'pipe',
                        stderr: 'pipe',
                    },
                );
                exitCode = proc.exitCode ?? 1;
            }
            const t1 = Date.now();
            const after = await snapshotDir(run.runDir);
            const verdictJson = spur(['task', 'verdict', wbs, '--json'], {
                cwd: run.projectDir,
            });
            records.push({
                wbs,
                pipeline,
                verdict: parseVerdict(verdictJson.stdout),
                gateOutcomes: await readGateOutcomes(wbs, run.runDir),
                artifactsWritten: diffSnapshot(before, after),
                // 0607 R1: cost comes from the history plane (`history_message` cost_usd)
                // correlated on the run window. The eval worktree's own DB is fresh and holds
                // only action_runs; the real per-message cost rows live in the MAIN tree's
                // `.spur/spur.db`. A deliberate measurement run has no concurrent activity,
                // so the window correlation is the honest anchor.
                tokenCost: args.dry
                    ? null
                    : extractHistoryCost(join(REPO_ROOT, '.spur/spur.db'), fromIso, new Date(t1).toISOString()),
                wallClockMs: t1 - t0,
                exitCode,
            });
        }
    } finally {
        if (args.keep) console.log(`fixture run kept: ${run.projectDir}`);
        else await removeEvalRun(run);
    }
    return records;
}

/** Per-field diff between two record sets keyed by fixture order. */
export function diffRecords(a: EvalRecord[], b: EvalRecord[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const ra = a[i];
        const rb = b[i];
        for (const field of ['verdict', 'exitCode', 'tokenCost', 'wallClockMs'] as const) {
            const va = ra?.[field];
            const vb = rb?.[field];
            if (va !== vb) out.push(`#${i + 1} ${field}: ${String(va)} -> ${String(vb)}`);
        }
        if (ra && rb && ra.gateOutcomes.join('|') !== rb.gateOutcomes.join('|')) {
            out.push(`#${i + 1} gateOutcomes: [${ra.gateOutcomes.join(', ')}] -> [${rb.gateOutcomes.join(', ')}]`);
        }
    }
    return out;
}

// The `promotionBarProposal` field name is frozen by task 0596's EvalRecord/EvalReport contract, so
// it stays; its meaning does not. ADR-076 (Accepted 2026-08-20) retired the D5-N promotion bar as a
// gate and deleted task-pipeline2.yaml rather than promoting it. This command is a MEASUREMENT tool
// now: run it deliberately when you want numbers. Nothing may gate on it.
const PROMOTION_BAR_PROPOSAL =
    'RETIRED (ADR-076, 2026-08-20): the D5-N promotion bar is no longer a gate, and ' +
    'task-pipeline2.yaml was deleted rather than promoted. eval-pipeline remains a measurement ' +
    'tool only — no transition, deletion, feature closure, or verdict may depend on it. ' +
    'tokenCost is now the summed history_message.cost_usd across the run window (task 0607 R1), ' +
    'null on a source with no cost rows. Reopening a promotion bar requires measured real-run ' +
    'evidence, not a fixture run.';

/**
 * Nesting guard (task 0596 P3 — "instruct the sweep agent not to spawn nested pipeline/eval runs").
 *
 * `evalPipeline` spawns a full `spur workflow run <pipeline>`, whose `implement` hop runs an agent
 * that reads the task's own `## Plan` — and several D5/D6 tasks (0604, 0606, 0607) instruct that
 * agent to run `eval-pipeline`. Implementing one of those tasks *through the pipeline* therefore
 * recurses: every level forks another detached worktree and another multi-minute agent run, with no
 * bound. 0596 recorded this happening for real; only the fixture-folder half of its mitigation
 * (per-run worktrees) ever landed.
 *
 * The flag is set on THIS process, so it inherits through `Bun.spawnSync` -> `spur workflow run` ->
 * `agent.run` -> the agent's own shell. A nested invocation anywhere down that chain refuses here
 * instead of forking. Run the bar from a clean host shell, never from inside a pipeline run.
 */
const NESTING_ENV = 'SPUR_EVAL_PIPELINE_ACTIVE';

export async function evalPipeline(argv: string[]): Promise<number> {
    if (process.env[NESTING_ENV] === '1') {
        console.error(
            [
                `eval-pipeline: REFUSING to run — already inside an eval-pipeline run (${NESTING_ENV}=1).`,
                '',
                'eval-pipeline spawns a full task-pipeline run, so a nested invocation forks another',
                'worktree and another agent run, without bound (task 0596 P3).',
                '',
                'If you are an agent implementing a task whose Plan says to run the promotion bar:',
                'do NOT run it here. Record that the bar must be run from a clean host shell,',
                'outside any pipeline run, and continue with the rest of the task.',
            ].join('\n'),
        );
        return 1;
    }
    process.env[NESTING_ENV] = '1';
    const args = parseArgs(argv);
    const label = args.label ?? 'run';
    const baselineFacts = await loadBaselineFacts(join(REPO_ROOT, 'config/workflow-composition-baseline.json'));
    const records: EvalRecord[] = [];
    for (let r = 0; r < args.runs; r++) {
        for (const pipeline of args.pipelines) {
            records.push(...(await runOnce(pipeline, args.fixtures, args)));
        }
    }
    const byPipeline: EvalRecord[][] = args.pipelines.map((p) => records.filter((r) => r.pipeline === p));
    // 0607 R1/R4: per-pipeline model-query count (baseline SSOT) and structural breakdown.
    const modelQueries = Object.fromEntries(
        args.pipelines.map((p) => [p, baselineFacts[baselineKeyForPipeline(p)]?.modelQueries.length ?? 0]),
    );
    const breakdown = Object.fromEntries(args.pipelines.map((p) => [p, describeBreakdown(baselineFacts, p)]));
    const first = byPipeline[0] ?? [];
    const variance: { wallClockMs: Record<string, number> } | null =
        args.runs > 1 && first.length > 0
            ? {
                  wallClockMs: Object.fromEntries(
                      first.map((rec, i) => [
                          `fixture${i + 1}`,
                          Math.round(
                              records
                                  .filter((r) => r.pipeline === rec.pipeline && r.wbs === rec.wbs)
                                  .reduce((acc, r) => acc + r.wallClockMs, 0) / args.runs,
                          ),
                      ]),
                  ),
              }
            : null;
    const report: EvalReport = {
        label,
        generatedAt: new Date().toISOString(),
        runCount: args.runs,
        singleRun: args.runs === 1,
        pipelines: args.pipelines,
        records,
        variance,
        promotionBarProposal: PROMOTION_BAR_PROPOSAL,
        modelQueries,
        breakdown,
    };
    await Bun.write(
        join(REPORT_DIR, `${report.generatedAt.replace(/[:.]/g, '-')}-${label}.json`),
        JSON.stringify(report, null, 2),
    );
    for (const rec of records) {
        console.log(
            `${rec.wbs} [${rec.pipeline.split('/').pop()}] verdict=${rec.verdict ?? 'UNKNOWN'} exit=${rec.exitCode} ` +
                `wall=${(rec.wallClockMs / 1000).toFixed(1)}s queries=${modelQueries[rec.pipeline] ?? 0} ` +
                `cost=$ ${rec.tokenCost ?? 'null'} ` +
                `artifacts=${rec.artifactsWritten.length} gates=[${rec.gateOutcomes.join(', ')}]`,
        );
    }
    for (const p of args.pipelines) {
        const b = breakdown[p];
        console.log(
            `breakdown ${p.split('/').pop()}: modelHops=${b.modelHops} deterministicActions=${b.deterministicActions} gateStates=${b.gateStates}`,
        );
    }
    if (byPipeline.length === 2) {
        for (const line of diffRecords(byPipeline[0] ?? [], byPipeline[1] ?? [])) console.log(`diff ${line}`);
    }
    if (report.singleRun) console.log('note: single run — variance unmeasured; label stands (R3)');
    console.log(`report: ${join(REPORT_DIR, `${report.generatedAt.replace(/[:.]/g, '-')}-${label}.json`)}`);
    return records.every((r) => r.exitCode === 0) ? 0 : 1;
}
