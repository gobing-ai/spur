/**
 * F96 residual sweep IO — `spur task residual <wbs> <scan|fold|settle|report|review-gate>`
 * (script-absorption PR-3; moved from the retired `plugins/sp/scripts/residual-scan.ts`). Pure
 * logic: `./residual-scan.ts`; contract: docs/design/task-residual-sweep.md.
 *
 * The plugin glue shelled `spur task show|create|update`; here those go through an injected
 * {@link ResidualTaskPort} (the CLI binds it to the in-process task service), so the modes are
 * async. Git reads use ts-runtime's sync executor. Artifacts, stdout lines and exit codes are
 * unchanged: exit 0 except `review-gate` with an open P1-P3 finding (1) and usage errors (2).
 */
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import * as core from './residual-scan';

/** Usage line printed with exit 2. */
export const RESIDUAL_SCAN_USAGE =
    'usage: spur task residual <wbs> <scan|fold|settle|report|review-gate> [--root <dir>] [--tmp-dir <dir>]';

/** The task operations the sweep needs — `task show`, `task create --skip-ready`, `task update --section`. */
export interface ResidualTaskPort {
    /** Task body and feature id; throws when the task cannot be read. */
    show(wbs: string): Promise<{ content: string; featureId: string }>;
    /** Create an unlinked backlog capture (no ready preparation); resolves to its wbs. */
    create(title: string): Promise<string>;
    /** Replace a section's body from a file. */
    updateSection(wbs: string, section: string, fromFile: string): Promise<void>;
}

/** Line sinks (each call carries its own trailing newline). */
export type ScanIo = { out: (line: string) => void; err: (line: string) => void };

/** Invocation context: the task port, an optional cwd for relative `--root`, and the line sinks. */
export type ScanOptions = { tasks: ResidualTaskPort; cwd?: string; io?: ScanIo };

type RunResult = { status: number; stdout: string };
type ParsedArgs = core.ParsedScanArgs;
type ModeFn = (o: ParsedArgs, tasks: ResidualTaskPort, i: ScanIo) => Promise<number>;
type ScanTask = { content: string; featureId: string };
type VerdictFile = { verdict: string; checks: Array<{ name: string; status: string; evidence: string }> };
function run(cmd: string, args: string[], cwd: string): RunResult {
    const result = new NodeSyncProcessExecutor().runSync({ command: cmd, args, cwd, rejectOnError: false });
    return { status: result.exitCode ?? 1, stdout: result.stdout ?? '' };
}
function isRegularFile(path: string): boolean {
    try {
        return fs.statSync(path).isFile();
    } catch {
        return false;
    }
}
/** Lines added since `base` (`git diff -U0`) plus every line of each untracked regular file. */
export function collectAddedLines(root: string, base: string): Array<{ file: string; line: number; text: string }> {
    const out: Array<{ file: string; line: number; text: string }> = [];
    const diff = run('git', ['diff', '--unified=0', base], root);
    let file = '';
    let newLine = 0;
    for (const line of diff.stdout.split('\n')) {
        if (line.startsWith('+++ b/')) file = line.slice(6);
        else if (line.startsWith('@@')) newLine = Number.parseInt((line.match(/\+[0-9]+/) ?? ['+0'])[0].slice(1), 10);
        else if (line.startsWith('+') && !line.startsWith('+++'))
            out.push({ file, line: newLine++, text: line.slice(1) });
    }
    const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], root);
    for (const f of untracked.stdout.split('\n')) {
        if (f.length === 0 || !isRegularFile(join(root, f))) continue;
        for (const [idx, text] of fs.readFileSync(join(root, f), 'utf8').split('\n').entries())
            out.push({ file: f, line: idx + 1, text });
    }
    return out;
}
/** `<tmpDir>/<wbs>-*` regular files left by staging writes. */
export function listStagingResidue(tmpDir: string, wbs: string): string[] {
    let names: string[];
    try {
        names = fs.readdirSync(tmpDir);
    } catch {
        return [];
    }
    return names.filter((n) => n.startsWith(`${wbs}-`) && isRegularFile(join(tmpDir, n))).map((n) => join(tmpDir, n));
}
function readDeferrals(runDir: string, wbs: string): core.Deferral[] {
    const path = join(runDir, `${wbs}-residual-deferrals.json`);
    if (!fs.existsSync(path)) return [];
    try {
        return core.parseDeferralEntries(JSON.parse(fs.readFileSync(path, 'utf8')));
    } catch {
        return [];
    }
}
/** Run the pure sweep over the run base, staging residue and recorded deferrals. */
export function scanResidualsAt(root: string, wbs: string, tmpDir: string, taskContent: string) {
    const runDir = join(root, '.spur', 'run');
    const basePath = join(runDir, `${wbs}-base.sha`);
    const base = fs.existsSync(basePath) ? fs.readFileSync(basePath, 'utf8').trim() : null;
    const stagingResidue = listStagingResidue(tmpDir, wbs);
    const deferrals = readDeferrals(runDir, wbs);
    const addedLines = base === null ? [] : collectAddedLines(root, base);
    return core.scanResiduals({ wbs, base, taskContent, addedLines, stagingResidue, deferrals });
}
async function loadTask(tasks: ResidualTaskPort, wbs: string): Promise<ScanTask> {
    try {
        return await tasks.show(wbs);
    } catch {
        throw new Error(`task show ${wbs} failed`);
    }
}
const loadVerdict = (runDir: string, wbs: string): VerdictFile =>
    JSON.parse(fs.readFileSync(core.recordedVerdictPath(runDir, wbs, fs), 'utf8'));
async function scanMode(opts: ParsedArgs, tasks: ResidualTaskPort, io: ScanIo): Promise<number> {
    const runDir = join(opts.root, '.spur', 'run');
    fs.mkdirSync(runDir, { recursive: true });
    const { content } = await loadTask(tasks, opts.wbs);
    const artifact = scanResidualsAt(opts.root, opts.wbs, opts.tmpDir, content);
    fs.writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    io.out(
        `residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}\n`,
    );
    return 0;
}
/**
 * Task 1122 R2: the review-time gate — the record sweep's review-finding slice
 * (core.buildReviewGateArtifact) at the review PASS edges; writes the same `<wbs>-residuals.json`
 * the test-fix hop reads. Exit 1 on an open P1-P3 finding. The answer-grade rule (1204) was
 * retired with the asserted confidence machinery (F511); findings stay the gate.
 */
async function reviewGateMode(opts: ParsedArgs, tasks: ResidualTaskPort, io: ScanIo): Promise<number> {
    const runDir = join(opts.root, '.spur', 'run');
    fs.mkdirSync(runDir, { recursive: true });
    const { content } = await loadTask(tasks, opts.wbs);
    const gate = core.buildReviewGateArtifact(opts.wbs, content, readDeferrals(runDir, opts.wbs));
    fs.writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(gate.artifact, null, 2)}\n`);
    io.out(gate.note);
    return gate.artifact.counts.blocking > 0 ? 1 : 0;
}
async function foldMode(opts: ParsedArgs, _tasks: ResidualTaskPort, io: ScanIo): Promise<number> {
    const runDir = join(opts.root, '.spur', 'run');
    const scan = JSON.parse(
        fs.readFileSync(join(runDir, `${opts.wbs}-residuals.json`), 'utf8'),
    ) as core.ResidualArtifact;
    const target = core.recordedVerdictPath(runDir, opts.wbs, fs);
    const note = core.verdictDisagreementNote(runDir, opts.wbs, fs);
    if (note !== null) io.out(`${note}\n`);
    const verdict = loadVerdict(runDir, opts.wbs);
    const findingsPath = join(runDir, `${opts.wbs}-test-gate.findings`);
    const fold = core.foldVerdict(
        verdict,
        scan,
        fs.existsSync(findingsPath) ? fs.readFileSync(findingsPath, 'utf8') : '',
    );
    const bytes = `${JSON.stringify({ ...verdict, verdict: fold.verdict, checks: fold.checks }, null, 2)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    try {
        fs.writeFileSync(temporary, bytes, { flag: 'wx' });
        fs.renameSync(temporary, target);
    } finally {
        fs.rmSync(temporary, { force: true });
    }
    // The pipeline still consumes the attempt copy after folding; the recorded copy is authoritative.
    const scratch = join(runDir, `${opts.wbs}-verdict.json`);
    if (target !== scratch) fs.writeFileSync(scratch, bytes);
    fs.writeFileSync(findingsPath, fold.findings);
    io.out(
        `residual-fold: ${opts.wbs} verdict=${fold.verdict} residual-sweep=${fold.checks.find((c) => c.name === 'residual-sweep')?.status}\n`,
    );
    return 0;
}
async function settleMode(opts: ParsedArgs, tasks: ResidualTaskPort, io: ScanIo): Promise<number> {
    const wbs = opts.wbs;
    const task = await loadTask(tasks, wbs);
    const runDir = join(opts.root, '.spur', 'run');
    const scan = scanResidualsAt(opts.root, wbs, opts.tmpDir, task.content);
    const residualsPath = join(runDir, `${wbs}-residuals.json`);
    let prior: Partial<core.ResidualArtifact & { followUp?: string }> = {};
    if (fs.existsSync(residualsPath)) prior = JSON.parse(fs.readFileSync(residualsPath, 'utf8'));
    const deferred = scan.items.filter((i) => i.class === 'deferrable');
    if (deferred.length > 0 && prior.followUp === undefined) {
        // Filed UNLINKED: a feature edge failed that feature's done-gate (`L4.verifying-incomplete-tasks`,
        // E72/1086→1087); the Background still names the source task and feature for traceability.
        let wbsNew = '';
        try {
            wbsNew = await tasks.create(`Residuals from ${wbs}`);
        } catch {
            wbsNew = '';
        }
        if (wbsNew === '') {
            io.err(`residual-settle: task create failed or unreadable wbs; re-run: spur task residual ${wbs} settle\n`);
            return 0;
        }
        const rows = deferred.map((i) => `- ${i.id} — ${i.location}: ${i.text}`);
        const head = `Source task: ${wbs}${task.featureId === '' ? '' : ` (feature ${task.featureId})`} — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).`;
        const bgFile = join(runDir, `${wbs}-residual-background.md`);
        fs.writeFileSync(bgFile, `${[head, '', ...rows].join('\n')}\n`);
        const updated = await tasks.updateSection(wbsNew, 'Background', bgFile).then(
            () => true,
            () => false,
        );
        if (!updated) {
            io.err(`residual-settle: background write failed; re-run: spur task residual ${wbs} settle\n`);
            return 0;
        }
        prior.followUp = wbsNew;
        io.out(`residual-settle: filed follow-up ${wbsNew} for ${deferred.length} deferred item(s)\n`);
    }
    for (const path of listStagingResidue(opts.tmpDir, wbs)) {
        try {
            fs.rmSync(path, { force: true });
        } catch {
            io.err(`residual-settle: could not remove ${path}; re-run: spur task residual ${wbs} settle\n`);
            return 0;
        }
    }
    fs.writeFileSync(residualsPath, `${JSON.stringify({ ...scan, ...prior }, null, 2)}\n`);
    return 0;
}
async function reportMode(opts: ParsedArgs, tasks: ResidualTaskPort, io: ScanIo): Promise<number> {
    const runDir = join(opts.root, '.spur', 'run');
    // A fix-budget-exhausted run never reaches verify: no verdict is a no-op, not ENOENT (1178 run 1).
    const verdictPath = core.recordedVerdictPath(runDir, opts.wbs, fs);
    if (!fs.existsSync(verdictPath)) {
        io.err(`residual-report: no verdict at ${verdictPath}; nothing to report for ${opts.wbs}\n`);
        return 0;
    }
    const sweep = loadVerdict(runDir, opts.wbs).checks.find((c) => c.name === 'residual-sweep');
    if (sweep === undefined || sweep.status !== 'fail') return 0;
    const { content } = await loadTask(tasks, opts.wbs);
    const scan = scanResidualsAt(opts.root, opts.wbs, opts.tmpDir, content);
    const blocking = scan.items.filter((i) => i.class === 'blocking');
    const attemptFile = join(runDir, `${opts.wbs}-test-fix-attempt`);
    const attempts = fs.existsSync(attemptFile)
        ? Number.parseInt(fs.readFileSync(attemptFile, 'utf8').trim() || '0', 10)
        : 0;
    fs.writeFileSync(
        join(runDir, `${opts.wbs}-residual-report.md`),
        core.renderReport(opts.wbs, blocking, Number.isNaN(attempts) ? 0 : attempts),
    );
    io.out(`Recovery: fix the items in .spur/run/${opts.wbs}-residual-report.md, then /sp:dev-run ${opts.wbs}\n`);
    return 0;
}
/** Parse `<mode> <wbs> [--root] [--tmp-dir]` (a legacy `--spur-bin` is accepted and ignored) and run the mode. */
export async function residualScanMain(argv: string[], options: ScanOptions): Promise<number> {
    const io: ScanIo = options.io ?? { out: () => {}, err: () => {} };
    const cwd = options.cwd ?? process.cwd();
    const opts = core.parseScanArgs(argv, cwd, tmpdir());
    const modes: Record<string, ModeFn> = {
        scan: scanMode,
        fold: foldMode,
        settle: settleMode,
        report: reportMode,
        'review-gate': reviewGateMode,
    };
    const modeFn = opts === null ? undefined : modes[opts.mode];
    if (opts === null || modeFn === undefined) {
        io.err(`${RESIDUAL_SCAN_USAGE}\n`);
        return 2;
    }
    const resolved: ParsedArgs = { ...opts, root: opts.root.startsWith('/') ? opts.root : join(cwd, opts.root) };
    return modeFn(resolved, options.tasks, io);
}
