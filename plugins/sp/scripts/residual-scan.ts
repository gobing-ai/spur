#!/usr/bin/env bun
/**
 * residual-scan — deterministic task-leftover scanner behind feature F96 (ADR-071).
 *
 * Contract owner: docs/design/task-residual-sweep.md. IO glue only (task 1003 R5): argv, git/spur spawning, file
 * IO, and the four modes; parsing/classification/folding/reporting live in the generated standalone bundle
 * `plugins/sp/lib/residual-scan.generated.mjs` (source: packages/app/src/services/residual-scan.ts), re-exported via
 * `export *`; the local `scanResiduals` wrapper (old 5-arg IO signature) shadows the core of the same name.
 * Modes: scan <wbs> (write `.spur/run/<wbs>-residuals.json`); fold <wbs> (fold blocking residuals into
 * `<wbs>-verdict.json` with PASS→PARTIAL downgrade + `<wbs>-test-gate.findings`); settle <wbs> (file one follow-up
 * task for deferrables, delete `/tmp/<wbs>-*` residue); report <wbs> (write `<wbs>-residual-report.md` when the residual-sweep check failed).
 */
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    renameSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';
import * as core from '../lib/residual-scan.generated.mjs';
import { spurCommand } from '../lib/spur-bin';

export * from '../lib/residual-scan.generated.mjs';
export const RESIDUAL_SCAN_USAGE =
    'usage: residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]';
export type ScanEnv = { spurBin?: string } & Record<string, string | undefined>;
export type ScanIo = { out: (line: string) => void; err: (line: string) => void };
export type ScanOptions = { cwd?: string; io?: ScanIo };
type RunResult = { status: number; stdout: string };
type ParsedArgs = { mode: string; wbs: string; spurBin?: string; root: string; tmpDir: string };
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
        return statSync(path).isFile();
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
        for (const [idx, text] of readFileSync(join(root, f), 'utf8').split('\n').entries())
            out.push({ file: f, line: idx + 1, text });
    }
    return out;
}
export function listStagingResidue(tmpDir: string, wbs: string): string[] {
    let names: string[];
    try {
        names = readdirSync(tmpDir);
    } catch {
        return [];
    }
    return names.filter((n) => n.startsWith(`${wbs}-`) && isRegularFile(join(tmpDir, n))).map((n) => join(tmpDir, n));
}
function readDeferrals(runDir: string, wbs: string): core.Deferral[] {
    const path = join(runDir, `${wbs}-residual-deferrals.json`);
    if (!existsSync(path)) return [];
    const isDeferral = (e: unknown): e is core.Deferral =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as core.Deferral).id === 'string' &&
        typeof (e as core.Deferral).reason === 'string' &&
        (e as core.Deferral).reason.trim().length > 0;
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        return (Array.isArray(parsed) ? parsed : []).filter(isDeferral);
    } catch {
        return [];
    }
}
export function scanResiduals(root: string, wbs: string, tmpDir: string, taskContent: string, _env: ScanEnv) {
    const runDir = join(root, '.spur', 'run');
    const basePath = join(runDir, `${wbs}-base.sha`);
    const base = existsSync(basePath) ? readFileSync(basePath, 'utf8').trim() : null;
    const stagingResidue = listStagingResidue(tmpDir, wbs);
    const deferrals = readDeferrals(runDir, wbs);
    const addedLines = base === null ? [] : collectAddedLines(root, base);
    return core.scanResiduals({ wbs, base, taskContent, addedLines, stagingResidue, deferrals });
}
function parseArgs(argv: string[]): ParsedArgs | null {
    let mode = '';
    let wbs = '';
    let spurBin: string | undefined;
    let root = process.cwd();
    let tmpDir = tmpdir();
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === undefined) break;
        if (a === '--spur-bin') spurBin = argv[++i];
        else if (a === '--root') root = argv[++i] ?? root;
        else if (a === '--tmp-dir') tmpDir = argv[++i] ?? tmpDir;
        else if (a === '--help' || a === '-h') return null;
        else if (mode === '') mode = a;
        else if (wbs === '') wbs = a;
    }
    return mode === '' || wbs === '' ? null : { mode, wbs, spurBin, root, tmpDir };
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
function verdictPath(runDir: string, wbs: string): string {
    const durable = join(runDir, '..', 'memory', 'evidence', `${wbs}-verdict.json`);
    for (const path of [
        join(runDir, '..'),
        join(runDir, '..', 'memory'),
        join(runDir, '..', 'memory', 'evidence'),
        durable,
    ]) {
        try {
            if (lstatSync(path).isSymbolicLink()) throw new Error(`residual-scan: symlink evidence path: ${path}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    return existsSync(durable) ? durable : join(runDir, `${wbs}-verdict.json`);
}
function loadVerdict(runDir: string, wbs: string): VerdictFile {
    return JSON.parse(readFileSync(verdictPath(runDir, wbs), 'utf8'));
}
function scanMode(opts: ParsedArgs, env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    mkdirSync(runDir, { recursive: true });
    const { content } = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const artifact = scanResiduals(opts.root, opts.wbs, opts.tmpDir, content, env);
    writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    io.out(
        `residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}\n`,
    );
    return 0;
}
function foldMode(opts: ParsedArgs, _env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    const scan = JSON.parse(readFileSync(join(runDir, `${opts.wbs}-residuals.json`), 'utf8')) as core.ResidualArtifact;
    const target = verdictPath(runDir, opts.wbs);
    const verdict = loadVerdict(runDir, opts.wbs);
    const findingsPath = join(runDir, `${opts.wbs}-test-gate.findings`);
    const fold = core.foldVerdict(verdict, scan, existsSync(findingsPath) ? readFileSync(findingsPath, 'utf8') : '');
    const bytes = `${JSON.stringify({ ...verdict, verdict: fold.verdict, checks: fold.checks }, null, 2)}\n`;
    const temporary = `${target}.${process.pid}.tmp`;
    try {
        writeFileSync(temporary, bytes, { flag: 'wx' });
        renameSync(temporary, target);
    } finally {
        rmSync(temporary, { force: true });
    }
    // The pipeline still consumes the attempt copy after folding; the recorded copy is authoritative.
    const scratch = join(runDir, `${opts.wbs}-verdict.json`);
    if (target !== scratch) writeFileSync(scratch, bytes);
    writeFileSync(findingsPath, fold.findings);
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
    if (existsSync(residualsPath)) prior = JSON.parse(readFileSync(residualsPath, 'utf8'));
    const deferred = scan.items.filter((i) => i.class === 'deferrable');
    if (deferred.length > 0 && prior.followUp === undefined) {
        if (task.featureId === '') {
            io.err(
                `residual-settle: ${wbs} deferrals pending but feature_id unknown; re-run: residual-scan settle ${wbs}\n`,
            );
            return 0;
        }
        const args = ['task', 'create', `Residuals from ${wbs}`, '--feature', task.featureId, '--skip-ready', '--json'];
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
        const head = `Source task: ${wbs} (feature ${task.featureId}) — deferred residuals filed by residual-scan settle.`;
        const bgFile = join(runDir, `${wbs}-residual-background.md`);
        writeFileSync(bgFile, `${[head, '', ...rows].join('\n')}\n`);
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
            rmSync(path, { force: true });
        } catch {
            io.err(`residual-settle: could not remove ${path}; re-run: residual-scan settle ${wbs}\n`);
            return 0;
        }
    }
    writeFileSync(residualsPath, `${JSON.stringify({ ...scan, ...prior }, null, 2)}\n`);
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
    const attempts = existsSync(attemptFile) ? Number.parseInt(readFileSync(attemptFile, 'utf8').trim() || '0', 10) : 0;
    writeFileSync(
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
    const opts = parseArgs(argv);
    const modes: Record<string, ModeFn> = { scan: scanMode, fold: foldMode, settle: settleMode, report: reportMode };
    const modeFn = opts === null ? undefined : modes[opts.mode];
    if (opts === null || modeFn === undefined) {
        io.err(`${RESIDUAL_SCAN_USAGE}\n`);
        return 2;
    }
    const resolved: ParsedArgs = { ...opts, root: opts.root.startsWith('/') ? opts.root : join(cwd, opts.root) };
    return modeFn(resolved, env, io);
}
if (import.meta.main) process.exit(main(process.argv.slice(2)));
