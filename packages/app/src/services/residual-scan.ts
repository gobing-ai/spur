import { join } from 'node:path';
/**
 * Residual scan — task-leftover classification and recorded-verdict discovery (F96, ADR-071).
 *
 * Contract owner: docs/design/task-residual-sweep.md. The plugin script
 * `plugins/sp/scripts/residual-scan.ts` keeps the IO glue (git/spur spawning, file IO, the
 * scan/fold/settle/report/review-gate modes) and calls into this module through the
 * generated standalone bundle `plugins/sp/lib/residual-scan.generated.mjs` — node-builtin
 * only, no workspace imports, so the bundle satisfies the plugin standalone contract.
 *
 * Classification is pure: the script collects the base sha, added diff lines, staging
 * residue paths and deferral entries, then calls {@link scanResiduals}. Recorded verdict
 * discovery also checks the canonical evidence plane without following symlink paths.
 */

import { createHash } from 'node:crypto';

/** Residual-scan item categories: review-table rows, TODO markers, unchecked boxes, staging residue. */
export type ResidualCategory = 'review-finding' | 'diff-marker' | 'unchecked-box' | 'staging-residue';
/** Severity class assigned by {@link classify}: blocking gates the sweep, deferrable has a reason, the rest are informational. */
export type ResidualClass = 'blocking' | 'deferrable' | 'advisory' | 'housekeeping';

/** One residual-scan finding with its stable identity and classification. */
export interface ResidualItem {
    id: string;
    category: ResidualCategory;
    class: ResidualClass;
    priority?: string;
    location: string;
    text: string;
}

/** Scan artifact persisted for the residual-sweep step: what was scanned, the items, and class counts. */
export interface ResidualArtifact {
    wbs: string;
    base: string | null;
    scanned: Record<ResidualCategory, boolean>;
    items: ResidualItem[];
    counts: { blocking: number; deferrable: number; advisory: number; housekeeping: number };
}

/** A deferral entry: a P3 finding / diff marker reclassified as deferrable by its reason. */
export interface Deferral {
    id: string;
    reason: string;
}

/** Inputs the script's IO glue collects before calling the pure scan core. */
export interface ResidualScanInputs {
    wbs: string;
    /** Base ref from `<runDir>/<wbs>-base.sha`, or `null` when never captured. */
    base: string | null;
    taskContent: string;
    /** Added lines (`<file>:<line>:<text>`) from `git diff --unified=0 <base>` + untracked files. */
    addedLines: Array<{ file: string; line: number; text: string }>;
    /** Regular files matching `<tmpDir>/<wbs>-*` (absolute paths). */
    stagingResidue: string[];
    /** File-declared deferrals plus in-table DEFER dispositions. */
    deferrals: Deferral[];
}

const MARKER_PATTERN = /TODO|FIXME|XXX|HACK/;
const PRIORITY_PATTERN = /^P[1-4]/;
// Range priorities (`P1–P3`) mark clean-report summary rows, never a single real finding (task 1065 R4).
// Regexes below stay ASCII-only (`\u` escapes): shebang'd standalone twins can decode non-ASCII
// regex literals as latin1, silently breaking the class (observed under bun).
const RANGE_PRIORITY = /^P[1-4]\s*[\u2013\u2014-]\s*P?[1-4]/;
// Placeholder "no finding" cells, optionally with a trailing "(…)" note; "None of X…" is a real finding.
const NONE_FINDING = /^(none( found)?|no (findings?|issues?)( found)?|\u2014)\s*(\(.*\))?\.?$/i;
const DISPOSITION_HEADER = /^(Disposition|Action|Status|Resolution|Fixed)$/i;
const RESOLVED_DISPOSITION = /^(FIXED|RESOLVED|DONE)\b/i;
const DEFERRED_DISPOSITION = /^DEFER(RED)?\b/i;
const ANCHOR_PATTERN = /[A-Za-z0-9_./-]+\.[A-Za-z]+:[0-9]+/g;
/** `path:12-18` range anchor → single-line `path:12`. */
const RANGE_ANCHOR = /([A-Za-z0-9_./-]+\.[A-Za-z]+):([0-9]+)-[0-9]+/g;
const EXCLUDED_PATHS = ['docs/tasks', 'docs/features/', '.spur/'];
/** Inline marker that exempts a line from TODO-marker scanning. */
export const ALLOW_PRAGMA = 'residual-scan:allow';

/** Stable item id: sha256(category + location + normalized text), truncated to 8 hex chars. */
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
    const backtick = finding.match(/`([^`]+)`/)?.[1];
    return backtick === undefined ? '' : normalizeAnchor(backtick);
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
    const body = section.split(/^### /m)[0] ?? '';
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
                !RANGE_PRIORITY.test(priority) &&
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
    return (
        line
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            // Escape-aware: `\|` inside a cell is content, not a column break (task 1065 R4).
            .split(/(?<!\\)\|/)
            .map((c) => c.trim())
    );
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

/**
 * Pure scan core: assemble the residual artifact from the script's collected inputs.
 * `diff-marker` scanning is only claimed when a base sha was available.
 */
export function scanResiduals(inputs: ResidualScanInputs): ResidualArtifact {
    const { wbs, base, taskContent, addedLines, stagingResidue, deferrals } = inputs;
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
            : parseDiffMarkers(addedLines).map((m) => ({
                  category: 'diff-marker' as const,
                  location: m.location,
                  text: m.text,
              }));
    const boxes = findUncheckedBoxes(taskContent).map((b) => ({
        category: 'unchecked-box' as const,
        location: b.location,
        text: b.text,
    }));
    const residue = stagingResidue.map((p) => ({
        category: 'staging-residue' as const,
        location: p,
        text: p,
    }));
    const items = classify([...review, ...markers, ...boxes, ...residue], [...tableDeferrals, ...deferrals]);
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

/**
 * Validate raw parsed deferral-file JSON: only entries with a non-empty string `id` and
 * `reason` survive; anything else (or a non-array payload) is silently ignored.
 */
export function parseDeferralEntries(raw: unknown): Deferral[] {
    const isDeferral = (e: unknown): e is Deferral =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as Deferral).id === 'string' &&
        typeof (e as Deferral).reason === 'string' &&
        (e as Deferral).reason.trim().length > 0;
    return (Array.isArray(raw) ? raw : []).filter(isDeferral);
}

/**
 * Task 1122 R1: the review-finding slice of the record sweep — same `parseReviewFindings`, same
 * `classify`, same deferrals (in-table `DEFER` dispositions plus the file entries) — so the
 * review-time gate and the record sweep cannot disagree. Restricted to `review-finding`:
 * unchecked boxes and diff markers are not decidable before record flips the proven boxes. The
 * record sweep stays the final authority; this only runs the same check before verify.
 */
export function blockingReviewFindings(taskContent: string, deferrals: Deferral[]): ResidualItem[] {
    const rows = parseReviewFindings(taskContent);
    const tableDeferrals = rows.flatMap((r) =>
        r.deferral === undefined ? [] : [{ id: makeItemId('review-finding', r.location, r.text), reason: r.deferral }],
    );
    const items = rows.map((r) => ({
        category: 'review-finding' as const,
        priority: r.priority,
        location: r.location,
        text: r.text,
    }));
    return classify(items, [...tableDeferrals, ...deferrals]);
}

/**
 * Task 1122 R2: the review-gate artifact assembly — the review-finding slice
 * ({@link blockingReviewFindings}) shaped into the same `ResidualArtifact` the record sweep
 * writes to `.spur/run/<wbs>-residuals.json` (the test-fix hop's remediation input; the
 * record sweep stays the final authority and overwrites it), plus the operator line naming
 * blocking ids and anchors. The script's `review-gate` mode owns only the IO: task load,
 * artifact write, and the fail-closed exit code.
 */
export function buildReviewGateArtifact(
    wbs: string,
    taskContent: string,
    deferrals: Deferral[],
): { artifact: ResidualArtifact; note: string } {
    const items = blockingReviewFindings(taskContent, deferrals);
    const blocking = items.filter((i) => i.class === 'blocking');
    const counts = { blocking: 0, deferrable: 0, advisory: 0, housekeeping: 0 };
    for (const item of items) counts[item.class]++;
    const artifact: ResidualArtifact = {
        wbs,
        base: null,
        scanned: {
            'review-finding': true,
            'diff-marker': false,
            'unchecked-box': false,
            'staging-residue': false,
        },
        items,
        counts,
    };
    const note =
        `residual-review-gate: ${wbs} blocking=${counts.blocking}` +
        (blocking.length > 0
            ? ` ids=${blocking.map((i) => i.id).join(',')} anchors=${blockingAnchors(blocking).join(',')}`
            : '') +
        '\n';
    return { artifact, note };
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

/** Result of folding a residual scan into the verify verdict. */
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

/**
 * Select canonical recorded evidence, refusing linked ancestors.
 *
 * Freshness-aware (task 1065): when both the run copy (`.spur/run/<wbs>-verdict.json`)
 * and the durable copy (`.spur/memory/evidence/<wbs>-verdict.json`) exist, the newer
 * mtime wins — ties resolve to the run copy, the pipeline's fresh attempt copy. This
 * breaks the self-reinforcing stale loop observed in the D63 sweep, where an older
 * durable PARTIAL (written by a prior downgrade) was re-folded over a fresh PASS and
 * written back, re-deriving PARTIAL forever. Disagreement reporting is the fold IO
 * glue's job (task 1065 R2); this function only chooses.
 */
export function recordedVerdictPath(
    runDir: string,
    wbs: string,
    fs: Pick<typeof import('node:fs'), 'lstatSync' | 'existsSync' | 'statSync'>,
): string {
    const evidence = join(runDir, '..', 'memory', 'evidence');
    const durable = join(evidence, `${wbs}-verdict.json`);
    const run = join(runDir, `${wbs}-verdict.json`);
    for (const path of [join(runDir, '..'), join(evidence, '..'), evidence, durable, run]) {
        try {
            if (fs.lstatSync(path).isSymbolicLink()) throw new Error(`residual-scan: symlink evidence path: ${path}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
    }
    if (!fs.existsSync(durable)) return run;
    if (!fs.existsSync(run)) return durable;
    const newer = (a: string, b: string): string => (mtimeOf(fs, b) > mtimeOf(fs, a) ? b : a);
    return newer(run, durable);
}

function mtimeOf(fs: Pick<typeof import('node:fs'), 'statSync'>, path: string): number {
    try {
        return fs.statSync(path).mtimeMs;
    } catch {
        return 0;
    }
}

/**
 * Task 1065 R2: fold-side report for verdict-copy disagreement, or null when either copy
 * is absent or the bytes are equal (R3c — no noise). Names both paths, both verdict values,
 * and the freshness winner, so a stale durable being overridden is visible to the operator.
 */
export function verdictDisagreementNote(
    runDir: string,
    wbs: string,
    fs: Pick<typeof import('node:fs'), 'existsSync' | 'readFileSync' | 'statSync'>,
): string | null {
    const run = join(runDir, `${wbs}-verdict.json`);
    const durable = join(runDir, '..', 'memory', 'evidence', `${wbs}-verdict.json`);
    if (!fs.existsSync(run) || !fs.existsSync(durable)) return null;
    const bytes = (path: string): string | null => {
        try {
            return fs.statSync(path).isFile() ? fs.readFileSync(path, 'utf8') : null;
        } catch {
            return null;
        }
    };
    const runBytes = bytes(run);
    if (runBytes === null || runBytes === bytes(durable)) return null;
    const value = (path: string): string => {
        try {
            return (JSON.parse(bytes(path) ?? '{}') as { verdict?: string }).verdict ?? '?';
        } catch {
            return '?';
        }
    };
    const winner = mtimeOf(fs, durable) > mtimeOf(fs, run) ? 'durable' : 'run';
    return (
        `residual-fold: ${wbs} verdict copies disagree — run=${run} (${value(run)}) durable=${durable} (${value(durable)})` +
        ` → chose ${winner} (newer mtime)`
    );
}

/** Parsed `residual-scan` argv: the mode, target wbs, and optional root/tmp-dir/spur-bin overrides. */
export interface ParsedScanArgs {
    mode: string;
    wbs: string;
    spurBin?: string;
    root: string;
    tmpDir: string;
}

/**
 * Pure argv parse for the residual-scan CLI surface:
 * `<mode> <wbs> [--spur-bin <bin>] [--root <dir>] [--tmp-dir <dir>]`. Returns null on
 * `--help`/`-h` or a missing mode/wbs — the caller prints usage and exits 2. `cwd` and
 * `defaultTmpDir` are the caller's IO defaults for `--root` and `--tmp-dir`.
 */
export function parseScanArgs(
    argv: readonly (string | undefined)[],
    cwd: string,
    defaultTmpDir: string,
): ParsedScanArgs | null {
    let mode = '';
    let wbs = '';
    let spurBin: string | undefined;
    let root = cwd;
    let tmpDir = defaultTmpDir;
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
