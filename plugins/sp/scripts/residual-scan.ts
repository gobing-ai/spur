#!/usr/bin/env bun
/** F96 residual IO glue. Pure logic: residual-scan.generated.mjs; contract: task-residual-sweep.md. */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';
import * as core from '../lib/residual-scan.generated.mjs';
import { spurCommand } from '../lib/spur-bin';

export * from '../lib/residual-scan.generated.mjs';
export const RESIDUAL_SCAN_USAGE =
    'usage: residual-scan.ts <scan|fold|settle|report|review-gate> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]';
export type ScanEnv = { spurBin?: string } & Record<string, string | undefined>;
export type ScanIo = { out: (line: string) => void; err: (line: string) => void };
export type ScanOptions = { cwd?: string; io?: ScanIo };
type RunResult = { status: number; stdout: string };
type ParsedArgs = core.ParsedScanArgs;
type ModeFn = (o: ParsedArgs, e: ScanEnv, i: ScanIo) => number;
type ScanTask = { content: string; featureId: string };
type VerdictFile = { verdict: string; checks: Array<{ name: string; status: string; evidence: string }> };
function run(cmd: string, args: string[], cwd: string): RunResult {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (result.error !== undefined) return { status: result.status ?? 1, stdout: '' };
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}
function spur(env: ScanEnv, spurBinFlag: string | undefined, args: string[], cwd: string): RunResult {
    const { cmd, prefix } = spurCommand(spurBinFlag ?? env.spurBin);
    return run(cmd, [...prefix, ...args], cwd);
}
function isRegularFile(path: string): boolean {
    try {
        return fs.statSync(path).isFile();
    } catch {
        return false;
    }
}
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
export function scanResiduals(root: string, wbs: string, tmpDir: string, taskContent: string, _env: ScanEnv) {
    const runDir = join(root, '.spur', 'run');
    const basePath = join(runDir, `${wbs}-base.sha`);
    const base = fs.existsSync(basePath) ? fs.readFileSync(basePath, 'utf8').trim() : null;
    const stagingResidue = listStagingResidue(tmpDir, wbs);
    const deferrals = readDeferrals(runDir, wbs);
    const addedLines = base === null ? [] : collectAddedLines(root, base);
    return core.scanResiduals({ wbs, base, taskContent, addedLines, stagingResidue, deferrals });
}
function loadTask(env: ScanEnv, spurBinFlag: string | undefined, wbs: string, root: string): ScanTask {
    const res = spur(env, spurBinFlag, ['task', 'show', wbs, '--json'], root);
    if (res.status !== 0) throw new Error(`task show ${wbs} failed`);
    type TaskJson = { content?: unknown; feature_id?: unknown; frontmatter?: { feature_id?: unknown } | null };
    const parsed = JSON.parse(res.stdout) as TaskJson;
    const featureId =
        [parsed.feature_id, parsed.frontmatter?.feature_id].find((v): v is string => typeof v === 'string') ?? '';
    return { content: typeof parsed.content === 'string' ? parsed.content : '', featureId };
}
const loadVerdict = (runDir: string, wbs: string): VerdictFile =>
    JSON.parse(fs.readFileSync(core.recordedVerdictPath(runDir, wbs, fs), 'utf8'));
function scanMode(opts: ParsedArgs, env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    fs.mkdirSync(runDir, { recursive: true });
    const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const artifact = scanResiduals(opts.root, opts.wbs, opts.tmpDir, content, env);
    fs.writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    io.out(
        `residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}\n`,
    );
    return 0;
}
/**
 * Task 1122 R2: the review-time gate — the record sweep's review-finding slice with the same
 * parse/classify/deferrals (core.buildReviewGateArtifact), applied at the review PASS edges
 * before verify spends the cycle. Writes the same `<wbs>-residuals.json` artifact the test-fix
 * hop already appends to the gate log (its remediation input); the record sweep stays the final
 * authority and overwrites it. Exit 1 on an open P1-P3 finding fails the review PASS edge closed
 * into review-fail-triage.
 */
function reviewGateMode(opts: ParsedArgs, env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    fs.mkdirSync(runDir, { recursive: true });
    const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const gate = core.buildReviewGateArtifact(opts.wbs, content, readDeferrals(runDir, opts.wbs));
    fs.writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(gate.artifact, null, 2)}\n`);
    io.out(gate.note);
    return gate.artifact.counts.blocking > 0 ? 1 : 0;
}
function foldMode(opts: ParsedArgs, _env: ScanEnv, io: ScanIo): number {
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
function settleMode(opts: ParsedArgs, env: ScanEnv, io: ScanIo): number {
    const wbs = opts.wbs;
    const task = loadTask(env, opts.spurBin, wbs, opts.root);
    const runDir = join(opts.root, '.spur', 'run');
    const scan = scanResiduals(opts.root, wbs, opts.tmpDir, task.content, env);
    const residualsPath = join(runDir, `${wbs}-residuals.json`);
    let prior: Partial<core.ResidualArtifact & { followUp?: string }> = {};
    if (fs.existsSync(residualsPath)) prior = JSON.parse(fs.readFileSync(residualsPath, 'utf8'));
    const deferred = scan.items.filter((i) => i.class === 'deferrable');
    if (deferred.length > 0 && prior.followUp === undefined) {
        // The follow-up is filed UNLINKED: carrying a feature edge to the feature whose run produced
        // it made that feature's done-gate fail with `L4.verifying-incomplete-tasks` the moment a
        // residual was deferred (2026-10-04 session, E72/1086→1087), so a deferral must not be able
        // to block the completing feature. The source task and its feature stay named in the
        // Background, which keeps the traceability without the lifecycle coupling.
        const args = ['task', 'create', `Residuals from ${wbs}`, '--skip-ready', '--json'];
        const created = spur(env, opts.spurBin, args, opts.root);
        let wbsNew = '';
        try {
            const parsed = JSON.parse(created.stdout) as { wbs?: unknown; data?: { wbs?: unknown } | null };
            const data = typeof parsed.data === 'object' && parsed.data !== null ? parsed.data : {};
            wbsNew = [parsed.wbs, data.wbs].find((v): v is string => typeof v === 'string') ?? '';
        } catch {
            wbsNew = '';
        }
        if (created.status !== 0 || wbsNew === '') {
            io.err(`residual-settle: task create failed or unreadable wbs; re-run: residual-scan settle ${wbs}\n`);
            return 0;
        }
        const rows = deferred.map((i) => `- ${i.id} — ${i.location}: ${i.text}`);
        const head = `Source task: ${wbs}${task.featureId === '' ? '' : ` (feature ${task.featureId})`} — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).`;
        const bgFile = join(runDir, `${wbs}-residual-background.md`);
        fs.writeFileSync(bgFile, `${[head, '', ...rows].join('\n')}\n`);
        const updArgs = ['task', 'update', wbsNew, '--section', 'Background', '--from-file', bgFile];
        if (spur(env, opts.spurBin, updArgs, opts.root).status !== 0) {
            io.err(`residual-settle: background write failed; re-run: residual-scan settle ${wbs}\n`);
            return 0;
        }
        prior.followUp = wbsNew;
        io.out(`residual-settle: filed follow-up ${wbsNew} for ${deferred.length} deferred item(s)\n`);
    }
    for (const path of listStagingResidue(opts.tmpDir, wbs)) {
        try {
            fs.rmSync(path, { force: true });
        } catch {
            io.err(`residual-settle: could not remove ${path}; re-run: residual-scan settle ${wbs}\n`);
            return 0;
        }
    }
    fs.writeFileSync(residualsPath, `${JSON.stringify({ ...scan, ...prior }, null, 2)}\n`);
    return 0;
}
function reportMode(opts: ParsedArgs, env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    const sweep = loadVerdict(runDir, opts.wbs).checks.find((c) => c.name === 'residual-sweep');
    if (sweep === undefined || sweep.status !== 'fail') return 0;
    const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const scan = scanResiduals(opts.root, opts.wbs, opts.tmpDir, content, env);
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
export function main(argv: string[], env: ScanEnv = getEnvVars(), options: ScanOptions = {}): number {
    const io: ScanIo = options.io ?? {
        out: (line) => process.stdout.write(line),
        err: (line) => process.stderr.write(line),
    };
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
    return modeFn(resolved, env, io);
}
if (import.meta.main) process.exit(main(process.argv.slice(2)));
