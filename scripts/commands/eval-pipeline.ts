/**
 * eval-pipeline — parity comparator for task pipelines (task 0595, feature I6).
 *
 * Usage: bun scripts/spur-dev.ts eval-pipeline [--label <name>]
 *        [--pipeline <yaml>]... [--fixture <template-name>]...
 *        [--runs <n>] [--keep] [--dry]
 *
 * For each pipeline under test: create fixture tasks under
 * tests/fixtures/pipeline-eval/tasks (WBS 95xx), run them through
 * `spur workflow run <pipeline> --vars {"wbs":...}`, and emit one record per
 * fixture task: { wbs, pipeline, verdict, gateOutcomes[], artifactsWritten[],
 * tokenCost, wallClockMs, exitCode }. Verdict comes from `spur task verdict
 * --json` (never re-implemented). With two pipelines a per-field diff is
 * emitted. Determinism is not assumed: the report carries runCount and
 * variance, and a single run is labelled as such (R3).
 *
 * Fixtures are cleaned up in a finally block (R4) — see
 * tests/fixtures/pipeline-eval/README.md for the documented lifecycle.
 */
import { Database } from 'bun:sqlite';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

const REPO_ROOT = new URL('../../', import.meta.url).pathname;
const FIXTURE_DIR = join(REPO_ROOT, 'tests/fixtures/pipeline-eval');
const FIXTURE_TASKS_DIR = join(FIXTURE_DIR, 'tasks');
const RUN_DIR = join(REPO_ROOT, '.spur/run');
const REPORT_DIR = join(REPO_ROOT, '.spur/reports/pipeline-eval');
const DEFAULT_PIPELINE = join(REPO_ROOT, 'config/workflows/task-pipeline.yaml');
const SPUR_BIN = join(RUN_DIR, 'spur-bin.sh');

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

export async function readGateOutcomes(wbs: string): Promise<string[]> {
    const out: string[] = [];
    for (const f of GATE_FILES) {
        const p = join(RUN_DIR, f.replace('{wbs}', wbs));
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

function spur(args: string[], opts: { timeoutMs?: number } = {}) {
    const proc = Bun.spawnSync([SPUR_BIN, ...args], {
        cwd: REPO_ROOT,
        timeout: opts.timeoutMs ?? 60_000,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    return { exitCode: proc.exitCode ?? 1, stdout: proc.stdout?.toString() ?? '' };
}

/** Create one fixture task from a template; returns its WBS. */
async function createFixture(templateName: string): Promise<string> {
    const body = await readFile(join(FIXTURE_DIR, 'templates', `${templateName}.md`), 'utf-8');
    const created = spur([
        'task',
        'create',
        `pipeline-eval fixture ${templateName}`,
        '--folder',
        FIXTURE_TASKS_DIR,
        '--json',
    ]);
    const wbs = (JSON.parse(created.stdout) as { wbs: string }).wbs;
    // Fill sections by splitting the template on its ### headings.
    const sections = body.split(/^### /m).slice(1);
    for (const section of sections) {
        const nl = section.indexOf('\n');
        const name = section.slice(0, nl).trim();
        const content = section.slice(nl + 1).replace(/\n+$/, '');
        const tmp = join(REPO_ROOT, '.spur/tmp', `eval-${wbs}-${name.replace(/\s+/g, '-')}.md`);
        await Bun.write(tmp, `${content}\n`);
        const r = spur(['task', 'update', wbs, '--section', name, '--from-file', tmp]);
        if (r.exitCode !== 0) throw new Error(`eval-pipeline: section ${name} write failed for ${wbs}`);
    }
    return wbs;
}

async function cleanupFixtures(): Promise<void> {
    await rm(FIXTURE_TASKS_DIR, { recursive: true, force: true }).catch(() => {});
    await rm(join(FIXTURE_DIR, 'scratch'), { recursive: true, force: true }).catch(() => {});
    // tasks/ keeps a gitignore skeleton (fixture .md files are runtime-only);
    // scratch/ stays fully git-visible — the implement no-op guard probes git
    // (task 0595), and the run's deliverable must be a visible tree change.
    await Bun.write(join(FIXTURE_TASKS_DIR, '.gitignore'), '*.md\n!.gitignore\n');
}

/** Run the fixture set against one pipeline once; returns records. */
async function runOnce(pipeline: string, fixtures: string[], args: Args): Promise<EvalRecord[]> {
    const wbsList: string[] = [];
    let before: Record<string, number> = {};
    const records: EvalRecord[] = [];
    try {
        before = await snapshotDir(RUN_DIR);
        for (const f of fixtures) wbsList.push(await createFixture(f));
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
                        JSON.stringify({ wbs, profile: 'auto', ...args.vars }),
                    ],
                    { cwd: REPO_ROOT, timeout: 45 * 60_000, stdout: 'pipe', stderr: 'pipe' },
                );
                exitCode = proc.exitCode ?? 1;
            }
            const t1 = Date.now();
            const after = await snapshotDir(RUN_DIR);
            const verdictJson = spur(['task', 'verdict', wbs, '--json']);
            records.push({
                wbs,
                pipeline,
                verdict: parseVerdict(verdictJson.stdout),
                gateOutcomes: await readGateOutcomes(wbs),
                artifactsWritten: diffSnapshot(before, after),
                tokenCost: args.dry
                    ? null
                    : extractTokenCost(join(REPO_ROOT, '.spur/spur.db'), fromIso, new Date(t1).toISOString()),
                wallClockMs: t1 - t0,
                exitCode,
            });
        }
    } finally {
        if (!args.keep) await cleanupFixtures();
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

const PROMOTION_BAR_PROPOSAL =
    'PROPOSAL (map open question 1 — operator ratifies): promote task-pipeline2.yaml when, ' +
    'over >= 3 consecutive eval-pipeline runs on the fixture set: (1) verdict parity — every ' +
    'fixture verdict is PASS in pipeline2 at least as often as baseline (no regression); ' +
    '(2) cost band — mean wallClockMs within +10% of the baseline mean, with the measured ' +
    'variance reported alongside; (3) gate integrity — zero fixture runs ending in `failed` ' +
    'attributable to pipeline defects; (4) no new CLI surface required beyond recorded ' +
    'ADR-051 consent items.';

export async function evalPipeline(argv: string[]): Promise<number> {
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
