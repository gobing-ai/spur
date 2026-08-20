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
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/pipeline-eval');
const REPORT_DIR = join(REPO_ROOT, '.spur/reports/pipeline-eval');
const DEFAULT_PIPELINE = join(REPO_ROOT, 'config/workflows/task-pipeline.yaml');
const SPUR_BIN = join(REPO_ROOT, '.spur/run/spur-bin.sh');
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
}

/**
 * Create a disposable detached worktree for one pipeline run.
 *
 * The worktree starts at HEAD, giving workflow actions real Git context. Its
 * local config preserves the repository settings (including agent executors)
 * and adds only the fixture folder/floor; the production config is untouched.
 */
export async function createEvalRun(): Promise<EvalRun> {
    await mkdir(join(REPO_ROOT, '.spur/tmp'), { recursive: true });
    const tempParent = await mkdtemp(join(REPO_ROOT, '.spur/tmp/eval-pipeline-'));
    const projectDir = join(tempParent, 'worktree');
    let worktreeAdded = false;
    try {
        const created = git(['worktree', 'add', '--detach', projectDir, 'HEAD']);
        if (created.exitCode !== 0) {
            throw new Error(`eval-pipeline: worktree create failed: ${created.stderr || created.stdout}`);
        }
        worktreeAdded = true;

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
 * Token cost from agent.run actions in the run window. Scans action_runs
 * result_json for token/usage fields; returns null when none recorded —
 * never zero (unmeasured ≠ free).
 */
export function extractTokenCost(dbPath: string, fromIso: string, toIso: string): number | null {
    const db = new Database(dbPath, { readonly: true });
    try {
        const rows = db
            .query(
                `SELECT result_json FROM action_runs
                 WHERE kind = 'agent.run' AND created_at >= ? AND created_at <= ?`,
            )
            .all(fromIso, toIso) as Array<{ result_json: string | null }>;
        let total: number | null = null;
        for (const row of rows) {
            if (!row.result_json) continue;
            const found = JSON.stringify(row.result_json).match(/"(?:input|output|total)?[Tt]okens?"\s*:\s*(\d+)/g);
            for (const m of found ?? []) {
                const n = Number.parseInt(m.replace(/\D+/g, ''), 10);
                total = (total ?? 0) + n;
            }
        }
        return total;
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
    const proc = Bun.spawnSync([SPUR_BIN, ...args], {
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
                        SPUR_BIN,
                        'workflow',
                        'run',
                        pipeline,
                        '--vars',
                        JSON.stringify({
                            wbs,
                            profile: 'auto',
                            spurBin: SPUR_BIN,
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
                tokenCost: args.dry ? null : extractTokenCost(run.dbPath, fromIso, new Date(t1).toISOString()),
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
    'tool only — no transition, deletion, feature closure, or verdict may depend on it. Note its ' +
    'tokenCost is derived from action_runs, where almost no row carries token usage, so it reports ' +
    'null; for real cost use per-message input_tokens/output_tokens/cost_usd in history_message. ' +
    'Reopening a promotion bar requires measured real-run evidence, not a fixture run.';

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
    const records: EvalRecord[] = [];
    for (let r = 0; r < args.runs; r++) {
        for (const pipeline of args.pipelines) {
            records.push(...(await runOnce(pipeline, args.fixtures, args)));
        }
    }
    const byPipeline: EvalRecord[][] = args.pipelines.map((p) => records.filter((r) => r.pipeline === p));
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
    };
    await Bun.write(
        join(REPORT_DIR, `${report.generatedAt.replace(/[:.]/g, '-')}-${label}.json`),
        JSON.stringify(report, null, 2),
    );
    for (const rec of records) {
        console.log(
            `${rec.wbs} [${rec.pipeline.split('/').pop()}] verdict=${rec.verdict ?? 'UNKNOWN'} exit=${rec.exitCode} ` +
                `wall=${(rec.wallClockMs / 1000).toFixed(1)}s tokens=${rec.tokenCost ?? 'null'} ` +
                `artifacts=${rec.artifactsWritten.length} gates=[${rec.gateOutcomes.join(', ')}]`,
        );
    }
    if (byPipeline.length === 2) {
        for (const line of diffRecords(byPipeline[0] ?? [], byPipeline[1] ?? [])) console.log(`diff ${line}`);
    }
    if (report.singleRun) console.log('note: single run — variance unmeasured; label stands (R3)');
    console.log(`report: ${join(REPORT_DIR, `${report.generatedAt.replace(/[:.]/g, '-')}-${label}.json`)}`);
    return records.every((r) => r.exitCode === 0) ? 0 : 1;
}
