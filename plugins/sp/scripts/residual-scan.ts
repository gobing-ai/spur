#!/usr/bin/env bun
/**
 * residual-scan — deterministic task-leftover scanner behind feature F96 (ADR-071).
 *
 * Contract owner: docs/design/task-residual-sweep.md. Model-free detection; writes only
 * under `.spur/run/` (observe-only). Four modes:
 *   scan   <wbs>  write `.spur/run/<wbs>-residuals.json`
 *   fold   <wbs>  fold blocking residuals into `<wbs>-verdict.json` (residual-sweep check,
 *                  PASS→PARTIAL downgrade) and `<wbs>-test-gate.findings`
 *   settle <wbs>  file one follow-up task for deferrables; delete `/tmp/<wbs>-*` residue
 *   report <wbs>  write `.spur/run/<wbs>-residual-report.md` when the verdict's
 *                  residual-sweep check failed; print the recovery line
 *
 * Environment: `spurBin` (CLI resolution, mirrors wrapup-steps `spurCommand`).
 * Pure helpers (parsers, classify, foldVerdict, renderReport) are exported for unit
 * testing; node/bun builtin imports only (plugin standalone contract).
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '../lib/env';

export const RESIDUAL_SCAN_USAGE =
    'usage: residual-scan.ts <scan|fold|settle|report> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]';

export type ResidualCategory = 'review-finding' | 'diff-marker' | 'unchecked-box' | 'staging-residue';
export type ResidualClass = 'blocking' | 'deferrable' | 'advisory' | 'housekeeping';

export interface ResidualItem {
    id: string;
    category: ResidualCategory;
    class: ResidualClass;
    priority?: string;
    location: string;
    text: string;
}

export interface ResidualArtifact {
    wbs: string;
    base: string | null;
    scanned: Record<ResidualCategory, boolean>;
    items: ResidualItem[];
    counts: { blocking: number; deferrable: number; advisory: number; housekeeping: number };
}

export interface ScanEnv {
    spurBin?: string;
    [key: string]: string | undefined;
}

export interface ScanIo {
    out: (line: string) => void;
    err: (line: string) => void;
}

export interface ScanOptions {
    cwd?: string;
    /** Injectable output sinks; defaults to process streams (tests inject no-ops to keep reporter output clean). */
    io?: ScanIo;
}

const MARKER_PATTERN = /TODO|FIXME|XXX|HACK/;
const PRIORITY_PATTERN = /^P[1-4]/;
const NONE_FINDING = /^(none|—)$/i;
const DISPOSITION_HEADER = /^(Disposition|Action|Status|Resolution|Fixed)$/i;
const RESOLVED_DISPOSITION = /^(FIXED|RESOLVED|DONE)\b/i;
const DEFERRED_DISPOSITION = /^DEFER(RED)?\b/i;
const ANCHOR_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
/** `path:12-18` range anchor → single-line `path:12`. */
const RANGE_ANCHOR = /([A-Za-z0-9_./-]+\.[A-Za-z]+):([0-9]+)-[0-9]+/g;
const EXCLUDED_PATHS = ['docs/tasks', 'docs/features/', '.spur/'];
export const ALLOW_PRAGMA = 'residual-scan:allow';

/** `spurBin` splits on whitespace into command + prefix args (same as wrapup-steps). */
export function spurCommand(spurBin: string | undefined): { cmd: string; prefix: string[] } {
    const parts = (spurBin ?? 'spur')
        .trim()
        .split(/\s+/)
        .filter((p) => p.length > 0);
    return { cmd: parts[0] ?? 'spur', prefix: parts.slice(1) };
}

function run(cmd: string, args: string[], cwd: string): { status: number; stdout: string } {
    const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (result.error !== undefined) return { status: result.status ?? 1, stdout: '' };
    return { status: result.status ?? 1, stdout: result.stdout ?? '' };
}

export function makeItemId(category: ResidualCategory, location: string, text: string): string {
    const normalized = text.trim().replace(/\s+/g, ' ');
    const hex = createHash('sha256').update(`${location}${normalized}`).digest('hex');
    return `${category}:${hex.slice(0, 8)}`;
}

/** `path:12-18` → `path:12` (anchor normalization from the design doc). */
export function normalizeAnchor(location: string): string {
    return location.replace(RANGE_ANCHOR, '$1:$2');
}

/** Normalize a finding cell to an anchor: Location column, else first backticked `path:line`. */
export function locationOf(locationCell: string, finding: string): string {
    const cell = locationCell.trim().replace(/`/g, '');
    if (cell.length > 0 && cell !== '—') return normalizeAnchor(cell);
    const backtick = finding.match(/`([^`]+)`/);
    return backtick === null ? '' : normalizeAnchor(backtick[1]);
}

/**
 * Extract review-finding rows: any `### Review` section table whose header carries a
 * Priority column. Rows need `^P[1-4]` priority and a finding other than `none`/`—`.
 * A disposition column (Disposition/Action/Status/Resolution/Fixed) is honored: `FIXED`/
 * `RESOLVED`/`DONE` rows are dropped; `DEFER` rows carry the cell as an in-table deferral reason.
 */
export function parseReviewFindings(
    taskContent: string,
): Array<{ priority: string; location: string; text: string; deferral?: string }> {
    const section = taskContent.split(/^### Review\b/m)[1];
    if (section === undefined) return [];
    const body = section.split(/^### /m)[0];
    const out: Array<{ priority: string; location: string; text: string; deferral?: string }> = [];
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || !line.trimStart().startsWith('|')) continue;
        const header = splitRow(line);
        const priorityCol = header.findIndex((h) => h.trim() === 'Priority');
        if (priorityCol === -1) {
            // Not a Priority table; skip its separator + body rows.
            while (i + 1 < lines.length && lines[i + 1]?.trimStart().startsWith('|')) i++;
            continue;
        }
        const findingCol = header.findIndex((h) => h.trim() === 'Finding');
        const locationCol = header.findIndex((h) => h.trim() === 'Location');
        const dispositionCol = header.findIndex((h) => DISPOSITION_HEADER.test(h.trim()));
        i++; // skip header
        const sep = lines[i];
        if (sep !== undefined && /^\s*\|[\s:|-]+\|\s*$/.test(sep)) i++; // skip separator
        while (i < lines.length) {
            const row = lines[i];
            if (row === undefined || !row.trimStart().startsWith('|')) break;
            const cells = splitRow(row);
            const priority = (cells[priorityCol] ?? '').trim();
            const finding = (cells[findingCol] ?? '').trim();
            const disposition = dispositionCol === -1 ? '' : (cells[dispositionCol] ?? '').trim();
            if (
                PRIORITY_PATTERN.test(priority) &&
                !NONE_FINDING.test(finding) &&
                finding.length > 0 &&
                !RESOLVED_DISPOSITION.test(disposition)
            ) {
                const location = locationOf(cells[locationCol] ?? '', finding);
                out.push(
                    DEFERRED_DISPOSITION.test(disposition)
                        ? { priority, location, text: finding, deferral: disposition }
                        : { priority, location, text: finding },
                );
            }
            i++;
        }
    }
    return out;
}

function splitRow(line: string): string[] {
    return line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
}

/** Added lines (`<file>:<line>:<text>`) from `git diff --unified=0 <base>` plus untracked files. */
export function collectAddedLines(root: string, base: string): Array<{ file: string; line: number; text: string }> {
    const out: Array<{ file: string; line: number; text: string }> = [];
    const diff = run('git', ['diff', '--unified=0', base], root);
    let file = '';
    let newLine = 0;
    for (const line of diff.stdout.split('\n')) {
        if (line.startsWith('+++ b/')) file = line.slice(6);
        else if (line.startsWith('@@')) {
            const m = line.match(/\+[0-9]+/);
            newLine = m === null ? newLine : Number.parseInt(m[0].slice(1), 10);
        } else if (line.startsWith('+') && !line.startsWith('+++')) {
            out.push({ file, line: newLine, text: line.slice(1) });
            newLine++;
        }
    }
    const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], root);
    for (const f of untracked.stdout.split('\n')) {
        if (f.length === 0) continue;
        try {
            if (!statSync(join(root, f)).isFile()) continue;
        } catch {
            continue;
        }
        const content = readFileSync(join(root, f), 'utf8').split('\n');
        content.forEach((text, idx) => {
            out.push({ file: f, line: idx + 1, text });
        });
    }
    return out;
}

/** TODO/FIXME/XXX/HACK markers on added lines, honoring path exclusions + allow pragma. */
export function parseDiffMarkers(
    addedLines: Array<{ file: string; line: number; text: string }>,
): Array<{ location: string; text: string }> {
    return addedLines
        .filter((l) => !EXCLUDED_PATHS.some((p) => l.file.startsWith(p)))
        .filter((l) => !l.text.includes(ALLOW_PRAGMA))
        .filter((l) => MARKER_PATTERN.test(l.text))
        .map((l) => ({ location: `${l.file}:${l.line}`, text: l.text.trim() }));
}

/** `- [ ]` lines in the task file. */
export function findUncheckedBoxes(taskContent: string): Array<{ location: string; text: string }> {
    const path = 'task-file';
    return taskContent
        .split('\n')
        .map((text, idx) => ({ text: text.trim(), line: idx + 1 }))
        .filter((l) => l.text.startsWith('- [ ]'))
        .map((l) => ({ location: `${path}:${l.line}`, text: l.text }));
}

/** Regular files matching `<tmpDir>/<wbs>-*`. */
export function listStagingResidue(tmpDir: string, wbs: string): string[] {
    let names: string[];
    try {
        names = readdirSync(tmpDir);
    } catch {
        return [];
    }
    return names
        .filter((n) => n.startsWith(`${wbs}-`))
        .filter((n) => {
            try {
                return statSync(join(tmpDir, n)).isFile();
            } catch {
                return false;
            }
        })
        .map((n) => join(tmpDir, n));
}

interface Deferral {
    id: string;
    reason: string;
}

function readDeferrals(runDir: string, wbs: string): Deferral[] {
    const path = join(runDir, `${wbs}-residual-deferrals.json`);
    if (!existsSync(path)) return [];
    try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(
            (e): e is Deferral =>
                typeof e === 'object' &&
                e !== null &&
                typeof (e as Deferral).id === 'string' &&
                typeof (e as Deferral).reason === 'string' &&
                (e as Deferral).reason.trim().length > 0,
        );
    } catch {
        return [];
    }
}

/**
 * Classification: P1–P3 findings, diff markers and unchecked boxes are blocking; P4 is
 * advisory; staging residue is housekeeping. A deferral entry with a non-empty reason
 * reclassifies a P3 finding or diff marker as deferrable — never P1/P2 or unchecked boxes.
 */
export function classify(
    items: Array<Omit<ResidualItem, 'id' | 'class'> & { category: ResidualCategory }>,
    deferrals: Deferral[],
): ResidualItem[] {
    const deferred = new Map(deferrals.map((d) => [d.id, d.reason]));
    return items.map((item) => {
        const id = makeItemId(item.category, item.location, item.text);
        let klass: ResidualClass;
        if (item.category === 'review-finding') klass = item.priority?.startsWith('P4') ? 'advisory' : 'blocking';
        else if (item.category === 'staging-residue') klass = 'housekeeping';
        else klass = 'blocking';
        if (klass === 'blocking' && item.category !== 'unchecked-box') {
            const p3Like =
                item.category === 'diff-marker' ||
                (item.category === 'review-finding' && (item.priority ?? '').startsWith('P3'));
            const reason = deferred.get(id);
            if (p3Like && reason !== undefined && reason.trim().length > 0) klass = 'deferrable';
        }
        return {
            id,
            category: item.category,
            class: klass,
            priority: item.priority,
            location: item.location,
            text: item.text,
        };
    });
}

export function scanResiduals(
    root: string,
    wbs: string,
    tmpDir: string,
    taskContent: string,
    _env: ScanEnv,
): ResidualArtifact {
    const runDir = join(root, '.spur', 'run');
    const basePath = join(runDir, `${wbs}-base.sha`);
    const base = existsSync(basePath) ? readFileSync(basePath, 'utf8').trim() : null;
    const reviewRows = parseReviewFindings(taskContent);
    const tableDeferrals = reviewRows.flatMap((r) =>
        r.deferral === undefined ? [] : [{ id: makeItemId('review-finding', r.location, r.text), reason: r.deferral }],
    );
    const review = reviewRows.map((r) => ({
        category: 'review-finding' as const,
        priority: r.priority,
        location: r.location,
        text: r.text,
    }));
    const markers =
        base === null
            ? []
            : parseDiffMarkers(collectAddedLines(root, base)).map((m) => ({
                  category: 'diff-marker' as const,
                  location: m.location,
                  text: m.text,
              }));
    const boxes = findUncheckedBoxes(taskContent).map((b) => ({
        category: 'unchecked-box' as const,
        location: b.location,
        text: b.text,
    }));
    const residue = listStagingResidue(tmpDir, wbs).map((p) => ({
        category: 'staging-residue' as const,
        location: p,
        text: p,
    }));
    const items = classify(
        [...review, ...markers, ...boxes, ...residue],
        [...tableDeferrals, ...readDeferrals(runDir, wbs)],
    );
    const counts = { blocking: 0, deferrable: 0, advisory: 0, housekeeping: 0 };
    for (const item of items) counts[item.class]++;
    return {
        wbs,
        base,
        scanned: {
            'review-finding': true,
            'diff-marker': base !== null,
            'unchecked-box': true,
            'staging-residue': true,
        },
        items,
        counts,
    };
}

/** Blocking locations that match the `file.ext:line` findings-anchor shape. */
export function blockingAnchors(items: ResidualItem[]): string[] {
    const anchors = new Set<string>();
    for (const item of items) {
        if (item.class !== 'blocking') continue;
        for (const m of normalizeAnchor(item.location).matchAll(ANCHOR_PATTERN)) anchors.add(m[0]);
    }
    return [...anchors];
}

export interface FoldResult {
    verdict: 'PASS' | 'PARTIAL' | 'FAIL';
    checks: Array<{ name: string; status: string; evidence: string }>;
    findings: string;
}

/**
 * Fold the scan into a verdict: replace the `residual-sweep` check (fail when blocking > 0),
 * downgrade PASS→PARTIAL when blocking > 0 (PARTIAL/FAIL unchanged), and merge blocking
 * anchors into the gate findings (unique, sorted, cap 20). Idempotent.
 */
export function foldVerdict(
    verdict: { verdict: string; checks: Array<{ name: string; status: string; evidence: string }> },
    scan: ResidualArtifact,
    existingFindings: string,
    maxFindings = 20,
): FoldResult {
    const blocking = scan.items.filter((i) => i.class === 'blocking');
    const deferrable = scan.items.filter((i) => i.class === 'deferrable');
    const evidence =
        `blocking=${blocking.length} deferrable=${deferrable.length} advisory=${scan.counts.advisory} housekeeping=${scan.counts.housekeeping}` +
        (blocking.length > 0 ? `; blocking ids: ${blocking.map((i) => i.id).join(', ')}` : '') +
        (deferrable.length > 0 ? `; deferrable ids: ${deferrable.map((i) => i.id).join(', ')}` : '');
    const checks = verdict.checks.filter((c) => c.name !== 'residual-sweep');
    checks.push({ name: 'residual-sweep', status: blocking.length > 0 ? 'fail' : 'pass', evidence });
    const merged = new Set([
        ...existingFindings.split(/\s+/).filter((a) => a.length > 0),
        ...blockingAnchors(scan.items),
    ]);
    const findings = [...merged]
        .sort()
        .slice(0, maxFindings)
        .map((a) => `${a} `)
        .join('');
    let verdictStatus: FoldResult['verdict'] = verdict.verdict === 'PASS' ? 'PASS' : 'FAIL';
    if (verdict.verdict === 'PARTIAL') verdictStatus = 'PARTIAL';
    else if (verdict.verdict === 'FAIL') verdictStatus = 'FAIL';
    else if (blocking.length > 0) verdictStatus = 'PARTIAL';
    return { verdict: verdictStatus, checks, findings };
}

/** Render the recovery report for blocking items. */
export function renderReport(wbs: string, items: ResidualItem[], attemptCount: number): string {
    const lines = [
        `# Residual report — ${wbs}`,
        '',
        `Attempt: ${attemptCount}`,
        '',
        '| Category | Class | Location | Text |',
        '| --- | --- | --- | --- |',
    ];
    for (const item of items) {
        lines.push(`| ${item.category} | ${item.class} | ${item.location} | ${item.text.replace(/\|/g, '\\|')} |`);
    }
    return `${lines.join('\n')}\n`;
}

// ── impure modes ─────────────────────────────────────────────────────────────

function parseArgs(
    argv: string[],
): { mode: string; wbs: string; spurBin?: string; root: string; tmpDir: string } | null {
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
    if (mode === '' || wbs === '') return null;
    return { mode, wbs, spurBin, root, tmpDir };
}

function spur(
    env: ScanEnv,
    spurBinFlag: string | undefined,
    args: string[],
    cwd: string,
): { status: number; stdout: string } {
    return run(
        spurCommand(spurBinFlag ?? env.spurBin).cmd,
        [...spurCommand(spurBinFlag ?? env.spurBin).prefix, ...args],
        cwd,
    );
}

function loadTask(
    env: ScanEnv,
    spurBinFlag: string | undefined,
    wbs: string,
    root: string,
): { content: string; featureId: string } {
    const res = spur(env, spurBinFlag, ['task', 'show', wbs, '--json'], root);
    if (res.status !== 0) throw new Error(`task show ${wbs} failed`);
    const parsed = JSON.parse(res.stdout) as Record<string, unknown>;
    const content = typeof parsed.content === 'string' ? parsed.content : '';
    const fm = parsed.frontmatter;
    const featureId =
        typeof parsed.feature_id === 'string'
            ? parsed.feature_id
            : fm !== null && typeof fm === 'object' && typeof (fm as Record<string, unknown>).feature_id === 'string'
              ? ((fm as Record<string, unknown>).feature_id as string)
              : '';
    return { content, featureId };
}

function loadVerdict(
    runDir: string,
    wbs: string,
): { verdict: string; checks: Array<{ name: string; status: string; evidence: string }> } {
    return JSON.parse(readFileSync(join(runDir, `${wbs}-verdict.json`), 'utf8'));
}

function scanMode(opts: NonNullable<ReturnType<typeof parseArgs>>, env: ScanEnv, io: ScanIo): number {
    const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const runDir = join(opts.root, '.spur', 'run');
    mkdirSync(runDir, { recursive: true });
    const artifact = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
    writeFileSync(join(runDir, `${opts.wbs}-residuals.json`), `${JSON.stringify(artifact, null, 2)}\n`);
    io.out(
        `residual-scan: ${opts.wbs} blocking=${artifact.counts.blocking} deferrable=${artifact.counts.deferrable} advisory=${artifact.counts.advisory} housekeeping=${artifact.counts.housekeeping}\n`,
    );
    return 0;
}

function foldMode(opts: NonNullable<ReturnType<typeof parseArgs>>, _env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    const scan = JSON.parse(readFileSync(join(runDir, `${opts.wbs}-residuals.json`), 'utf8')) as ResidualArtifact;
    const verdictPath = join(runDir, `${opts.wbs}-verdict.json`);
    const verdict = loadVerdict(runDir, opts.wbs);
    const findingsPath = join(runDir, `${opts.wbs}-test-gate.findings`);
    const existing = existsSync(findingsPath) ? readFileSync(findingsPath, 'utf8') : '';
    const folded = foldVerdict(verdict, scan, existing);
    writeFileSync(
        verdictPath,
        `${JSON.stringify({ ...verdict, verdict: folded.verdict, checks: folded.checks }, null, 2)}\n`,
    );
    writeFileSync(findingsPath, folded.findings);
    io.out(
        `residual-fold: ${opts.wbs} verdict=${folded.verdict} residual-sweep=${folded.checks.find((c) => c.name === 'residual-sweep')?.status}\n`,
    );
    return 0;
}

function settleMode(opts: NonNullable<ReturnType<typeof parseArgs>>, env: ScanEnv, io: ScanIo): number {
    const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const runDir = join(opts.root, '.spur', 'run');
    const scan = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
    const residualsPath = join(runDir, `${opts.wbs}-residuals.json`);
    const deferred = scan.items.filter((i) => i.class === 'deferrable');
    const prior = existsSync(residualsPath)
        ? (JSON.parse(readFileSync(residualsPath, 'utf8')) as Partial<ResidualArtifact & { followUp?: string }>)
        : {};
    if (deferred.length > 0 && prior.followUp === undefined) {
        if (task.featureId === '') {
            io.err(
                `residual-settle: ${opts.wbs} deferrals pending but feature_id unknown; re-run: residual-scan settle ${opts.wbs}\n`,
            );
            return 0;
        }
        const created = spur(
            env,
            opts.spurBin,
            ['task', 'create', `Residuals from ${opts.wbs}`, '--feature', task.featureId, '--skip-ready', '--json'],
            opts.root,
        );
        if (created.status !== 0) {
            io.err(`residual-settle: task create failed; re-run: residual-scan settle ${opts.wbs}\n`);
            return 0;
        }
        let wbsNew = '';
        try {
            const parsed = JSON.parse(created.stdout) as Record<string, unknown>;
            const pick = (o: Record<string, unknown>): string => (typeof o.wbs === 'string' ? o.wbs : '');
            wbsNew =
                pick(parsed) ||
                (parsed.data !== null && typeof parsed.data === 'object'
                    ? pick(parsed.data as Record<string, unknown>)
                    : '');
        } catch {
            wbsNew = '';
        }
        if (wbsNew === '') {
            io.err(`residual-settle: could not read created task wbs; re-run: residual-scan settle ${opts.wbs}\n`);
            return 0;
        }
        const bg = [
            `Source task: ${opts.wbs} (feature ${task.featureId}) — deferred residuals filed by residual-scan settle.`,
            '',
            ...deferred.map((i) => `- ${i.id} — ${i.location}: ${i.text}`),
        ].join('\n');
        const bgFile = join(runDir, `${opts.wbs}-residual-background.md`);
        writeFileSync(bgFile, `${bg}\n`);
        const upd = spur(
            env,
            opts.spurBin,
            ['task', 'update', wbsNew, '--section', 'Background', '--from-file', bgFile],
            opts.root,
        );
        if (upd.status !== 0) {
            io.err(`residual-settle: background write failed; re-run: residual-scan settle ${opts.wbs}\n`);
            return 0;
        }
        prior.followUp = wbsNew;
        io.out(`residual-settle: filed follow-up ${wbsNew} for ${deferred.length} deferred item(s)\n`);
    }
    // Cleanup: only regular files `<tmpDir>/<wbs>-*`. Never directories, never other prefixes.
    for (const path of listStagingResidue(opts.tmpDir, opts.wbs)) {
        try {
            rmSync(path, { force: true });
        } catch {
            io.err(`residual-settle: could not remove ${path}; re-run: residual-scan settle ${opts.wbs}\n`);
            return 0;
        }
    }
    writeFileSync(residualsPath, `${JSON.stringify({ ...scan, ...prior }, null, 2)}\n`);
    return 0;
}

function reportMode(opts: NonNullable<ReturnType<typeof parseArgs>>, env: ScanEnv, io: ScanIo): number {
    const runDir = join(opts.root, '.spur', 'run');
    const verdict = loadVerdict(runDir, opts.wbs);
    const sweep = verdict.checks.find((c) => c.name === 'residual-sweep');
    if (sweep === undefined || sweep.status !== 'fail') return 0;
    const task = loadTask(env, opts.spurBin, opts.wbs, opts.root);
    const scan = scanResiduals(opts.root, opts.wbs, opts.tmpDir, task.content, env);
    const blocking = scan.items.filter((i) => i.class === 'blocking');
    const attemptFile = join(runDir, `${opts.wbs}-test-fix-attempt`);
    const attempts = existsSync(attemptFile) ? Number.parseInt(readFileSync(attemptFile, 'utf8').trim() || '0', 10) : 0;
    const reportPath = join(runDir, `${opts.wbs}-residual-report.md`);
    writeFileSync(reportPath, renderReport(opts.wbs, blocking, Number.isNaN(attempts) ? 0 : attempts));
    io.out(`Recovery: fix the items in .spur/run/${opts.wbs}-residual-report.md, then /sp:dev-run ${opts.wbs}\n`);
    return 0;
}

export function main(argv: string[], env: ScanEnv = getEnvVars(), options: ScanOptions = {}): number {
    const io: ScanIo = options.io ?? {
        out: (line) => process.stdout.write(line),
        err: (line) => process.stderr.write(line),
    };
    const opts = parseArgs(argv);
    if (opts === null) {
        io.err(`${RESIDUAL_SCAN_USAGE}\n`);
        return 2;
    }
    const cwd = options.cwd ?? process.cwd();
    const resolved = { ...opts, root: opts.root.startsWith('/') ? opts.root : join(cwd, opts.root) };
    if (resolved.mode === 'scan') return scanMode(resolved, env, io);
    if (resolved.mode === 'fold') return foldMode(resolved, env, io);
    if (resolved.mode === 'settle') return settleMode(resolved, env, io);
    if (resolved.mode === 'report') return reportMode(resolved, env, io);
    io.err(`${RESIDUAL_SCAN_USAGE}\n`);
    return 2;
}

if (import.meta.main) {
    process.exit(main(process.argv.slice(2)));
}
