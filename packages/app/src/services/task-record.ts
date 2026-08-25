/**
 * Task record — move record-step logic out of pipeline YAML into a tested service.
 *
 * Pure generators (renderTesting, renderReview, renderSolutionFromDiff) are exported
 * so unit tests can verify format compliance without touching the filesystem or git.
 *
 * TaskService.record(wbs, opts) composes these generators with PlanningWriteService
 * operations — no temp files, no shell. The pipeline's record state collapses from
 * ~50 lines of awk/grep/sed/jq/printf to a single CLI invocation.
 *
 * Design: docs/tasks/0108_*.md; ADR-022 (orchestration is configuration).
 */

import { BunSyncProcessExecutor, type FileSystem } from '@gobing-ai/ts-runtime';
import {
    aggregateVerifyVerdict,
    type VerifyVerdict as CanonicalVerifyVerdict,
    type ParseVerdictOutcome,
    ROW_STATUSES,
    type VerdictAggregate,
    type VerdictCoverageRow,
    type VerdictRowStatus,
} from './verify-verdict';

/**
 * Escape pipe characters in a string so they don't break markdown table cells.
 * Renders `|` as `\|` — the escape sequence that markdown table parsers accept.
 */
export function escapeTablePipe(s: string): string {
    return s.replace(/\|/g, '\\|');
}

// ─── Types ──────────────────────────────────────────────────────────────

/** Verdict from the verify pipeline step (`.spur/run/<wbs>-verdict.json`). */
export interface VerifyVerdict {
    wbs: string;
    verdict: 'PASS' | 'PARTIAL' | 'FAIL' | 'UNKNOWN';
    requirements: VerdictRequirement[];
    acceptanceCriteria?: VerdictAcceptanceCriteria[];
    checks: VerdictCheck[];
}

/** A single requirement evaluated during verification, with its status and supporting evidence. */
export interface VerdictRequirement {
    id: string;
    status: VerdictRowStatus;
    evidence: string;
}

/** A single Acceptance Criteria evaluated during verification. */
export interface VerdictAcceptanceCriteria {
    id: string;
    status: VerdictRowStatus;
    evidenceType: string;
    evidence: string;
}

/** A single check performed during verification (e.g. SECU review, coverage gate). */
export interface VerdictCheck {
    name: string;
    status: string;
    evidence: string;
}

/** Options for TaskService.record(). */
export interface RecordOptions {
    /** Path to the verdict JSON (default: `.spur/run/<wbs>-verdict.json`). */
    verdictFile?: string;
    /** When true AND Solution is bare, backfill from `git diff -U0` hunk headers. */
    solutionFromDiff?: boolean;
    /** Optional lifecycle transition (e.g. `'testing'`). A `'done'` target with
     *  a PASS verdict auto-walks `wip → testing → done` and auto-creates the
     *  pipeline run-link (task 0436 R4); a non-PASS verdict to `done` errors. */
    transition?: string;
}

/** Result returned by TaskService.record(). */
export interface RecordResult {
    testingWritten: boolean;
    reviewWritten: boolean;
    solutionBackfilled: boolean;
    transitionedTo?: string;
}

// ─── R1: Verdict reader ─────────────────────────────────────────────────

/**
 * Parse verdict JSON text into a typed {@link VerifyVerdict}.
 *
 * Tolerates empty content (→ UNKNOWN with empty arrays) and malformed JSON (same).
 * Never throws — the record step degrades gracefully when the verify step produced
 * no verdict.
 *
 * @param raw          Verdict file content (empty string if the file is missing).
 * @param fallbackWbs  WBS to use when the JSON omits it.
 */
export function parseVerdict(raw: string, fallbackWbs?: string): CanonicalVerifyVerdict {
    if (raw.trim() === '') {
        return { wbs: fallbackWbs ?? '', verdict: 'UNKNOWN', requirements: [], acceptanceCriteria: [], checks: [] };
    }

    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed !== null && typeof parsed === 'object') {
            const obj = parsed as Record<string, unknown>;
            const wbs = typeof obj.wbs === 'string' ? obj.wbs : (fallbackWbs ?? '');
            const verdict = normalizeVerdict(obj.verdict);
            const requirements = normalizeRequirements(obj.requirements);
            const acceptanceCriteria = normalizeAcceptanceCriteria(obj.acceptanceCriteria);
            const checks = normalizeChecks(obj.checks);
            return { wbs, verdict, requirements, acceptanceCriteria, checks };
        }
    } catch {
        // Malformed JSON — fall through to UNKNOWN.
    }

    return { wbs: fallbackWbs ?? '', verdict: 'UNKNOWN', requirements: [], acceptanceCriteria: [], checks: [] };
}

/**
 * Read and parse a verdict JSON file via a {@link FileSystem}.
 *
 * Convenience wrapper: reads the file, then calls {@link parseVerdict}.
 * Returns UNKNOWN on missing/malformed file. Never throws.
 */
export async function readVerdict(fs: FileSystem, path: string, fallbackWbs?: string): Promise<CanonicalVerifyVerdict> {
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch {
        return { wbs: fallbackWbs ?? '', verdict: 'UNKNOWN', requirements: [], acceptanceCriteria: [], checks: [] };
    }
    return parseVerdict(raw, fallbackWbs);
}

function normalizeVerdict(raw: unknown): VerifyVerdict['verdict'] {
    if (typeof raw !== 'string') return 'UNKNOWN';
    const upper = raw.toUpperCase();
    if (upper === 'PASS') return 'PASS';
    if (upper === 'PARTIAL') return 'PARTIAL';
    if (upper === 'FAIL') return 'FAIL';
    return 'UNKNOWN';
}

function normalizeRequirements(raw: unknown): VerdictCoverageRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
        .map((r) => ({
            id: typeof r.id === 'string' ? r.id : '',
            status: normalizeRowStatus(r.status),
            evidenceType: typeof r.evidenceType === 'string' ? r.evidenceType : '',
            evidence: typeof r.evidence === 'string' ? r.evidence : '',
        }));
}

function normalizeAcceptanceCriteria(raw: unknown): VerdictCoverageRow[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((ac): ac is Record<string, unknown> => ac !== null && typeof ac === 'object')
        .map((ac) => ({
            id: typeof ac.id === 'string' ? ac.id : '',
            status: normalizeRowStatus(ac.status),
            evidenceType: typeof ac.evidenceType === 'string' ? ac.evidenceType : '',
            evidence: typeof ac.evidence === 'string' ? ac.evidence : '',
        }));
}

/**
 * Lenient status coercion for the legacy verdict reader. Recognised row statuses
 * (MET/PARTIAL/UNMET/N-A, case-insensitive) normalize to the canonical union;
 * any other value the artifact carries is preserved as-read via a documented
 * cast — the reader records what it read rather than defaulting or inferring a
 * status (task 0671 R4 anti-pattern: "no status is ever defaulted or inferred").
 */
function normalizeRowStatus(raw: unknown): VerdictRowStatus {
    if (typeof raw === 'string') {
        const upper = raw.toUpperCase().trim();
        if ((ROW_STATUSES as readonly string[]).includes(upper)) return upper as VerdictRowStatus;
        if (upper === 'NA') return 'N/A';
        return raw as VerdictRowStatus;
    }
    return '' as VerdictRowStatus;
}

function normalizeChecks(raw: unknown): VerdictCheck[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((c): c is Record<string, unknown> => c !== null && typeof c === 'object')
        .map((c) => ({
            name: typeof c.name === 'string' ? c.name : '',
            status: typeof c.status === 'string' ? c.status : '',
            evidence: typeof c.evidence === 'string' ? c.evidence : '',
        }));
}

// ─── R2: Pure generators ────────────────────────────────────────────────

/**
 * Render the `## Testing` section body from a verdict.
 *
 * Produces a per-requirement verdict table. When there are no requirements,
 * emits a single "no requirements recorded" row.
 *
 * Design: section-matrix §Testing — per-requirement traceability table.
 */
export function renderTesting(v: CanonicalVerifyVerdict): string {
    const lines: string[] = [];
    lines.push('**Pipeline verify results**');
    lines.push('');
    lines.push(`- Verdict: ${v.verdict} (from verdict artifact)`);
    lines.push('');

    if (v.requirements.length === 0) {
        lines.push('| Requirement | Status | Evidence |');
        lines.push('|-------------|--------|----------|');
        lines.push(`| — | — | No requirements recorded; verify verdict ${v.verdict} |`);
    } else {
        lines.push('| Requirement | Status | Evidence |');
        lines.push('|-------------|--------|----------|');
        for (const req of v.requirements) {
            const evidence = escapeTablePipe(req.evidence.replace(/\n/g, ' '));
            lines.push(`| ${req.id} | ${req.status} | ${evidence} |`);
        }
    }

    if (v.acceptanceCriteria.length > 0) {
        lines.push('');
        lines.push('| Acceptance Criteria | Status | Evidence Type | Evidence |');
        lines.push('|---------------------|--------|---------------|----------|');
        for (const ac of v.acceptanceCriteria) {
            const evidence = escapeTablePipe(ac.evidence.replace(/\n/g, ' '));
            lines.push(`| ${ac.id} | ${ac.status} | ${ac.evidenceType} | ${evidence} |`);
        }
    }

    lines.push('- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)');
    return lines.join('\n');
}

// ─── R4: Testing-section inverse parser (task 0671, feature F93) ────────

/**
 * Inverse of {@link renderTesting} over a task's tracked `## Testing` section.
 *
 * Maps the section's requirement / acceptance-criteria tables back to the same
 * coverage rows a verdict artifact carries, so the completion gate can derive
 * coverage from the tracked task record when the artifact is absent. Accepts
 * either the full task markdown (locating the `## Testing` / `### Testing`
 * heading) or the section body alone.
 *
 * Honesty contract (task 0671 R4): prefer yielding no rows over guessing one.
 * A too-tolerant parser would mark unverified work verified at corpus scale —
 * the exact failure the completion gate exists to prevent. Statuses are matched
 * against the canonical {@link ROW_STATUSES}; a missing `Verdict:` line does not
 * discard parseable rows (the aggregate is then derived by the canonical rule).
 *
 * @param markdown Full task document or `## Testing` section body.
 * @param wbs      Task WBS, carried into the outcome for traceability.
 */
export function parseTesting(markdown: string, wbs: string): ParseVerdictOutcome {
    const section = extractTestingSection(markdown);
    if (section.trim() === '') return { kind: 'missing', wbs };
    return parseTestingBody(section, wbs);
}

/**
 * Locate the `## Testing` (or `### Testing`) section in a task document and
 * slice it to the next same-or-higher heading. When the input carries no
 * Testing heading, the caller passed the section body directly — return it
 * unchanged (an absent section then presents as an empty body).
 */
function extractTestingSection(markdown: string): string {
    const heading = /^#{1,6}\s+Testing\s*$/m.exec(markdown);
    if (!heading || heading.index === undefined) return markdown;
    const level = heading[0].match(/^#+/)?.[0]?.length ?? 2;
    const bodyStart = heading.index + heading[0].length;
    const rest = markdown.slice(bodyStart);
    const next = new RegExp(`^#{1,${level}}\\s+\\S`, 'm').exec(rest);
    return next && next.index !== undefined ? rest.slice(0, next.index) : rest;
}

/** Parse the section body into a {@link ParseVerdictOutcome}. Never throws. */
function parseTestingBody(body: string, wbs: string): ParseVerdictOutcome {
    const lines = body.split('\n');
    const verdict = parseVerdictLine(lines);
    const requirements = parseCoverageTable(lines, 'requirement');
    const acceptanceCriteria = parseCoverageTable(lines, 'acceptance');

    if (requirements.kind === 'malformed' || acceptanceCriteria.kind === 'malformed') {
        return {
            kind: 'malformed',
            wbs,
            message: `${requirements.kind === 'malformed' ? 'requirement' : 'acceptance-criteria'} table is truncated or malformed`,
        };
    }

    const rows = requirements.rows.length + acceptanceCriteria.rows.length;
    if (rows === 0) {
        const reason =
            verdict !== null ? 'Verdict line present but no parseable coverage rows' : 'no recognisable coverage rows';
        return { kind: 'invalid', wbs, reason };
    }

    const aggregate =
        verdict ??
        aggregateVerifyVerdict({ requirements: requirements.rows, acceptanceCriteria: acceptanceCriteria.rows });
    return {
        kind: 'valid',
        wbs,
        verdict: {
            wbs,
            verdict: aggregate,
            requirements: requirements.rows,
            acceptanceCriteria: acceptanceCriteria.rows,
            checks: [],
        },
    };
}

/**
 * Read a canonical aggregate from a `Verdict:` line anywhere in the section.
 * Matches `- Verdict: PASS (from verdict artifact)` and bare `Verdict: PASS`.
 * Returns null when absent — parseable rows are never discarded for that.
 */
function parseVerdictLine(lines: string[]): VerdictAggregate | null {
    for (const line of lines) {
        // Line-anchored (optionally after `- ` bullet or `**` bold) so evidence text
        // containing a mid-line "Verdict:" token cannot be misread as the section verdict.
        const m = /^(?:-\s*|\*\*)?Verdict:\s*(PASS|PARTIAL|FAIL|UNKNOWN)\b/i.exec(line.trim());
        if (m) {
            const v = m[1]?.toUpperCase();
            if (v === 'PASS' || v === 'PARTIAL' || v === 'FAIL' || v === 'UNKNOWN') return v;
        }
    }
    return null;
}

/**
 * Parse one coverage table (requirement or acceptance-criteria) from the
 * section lines. Header variants `Requirement` / `Req` / `R#` (and
 * `Acceptance Criteria` / `AC`) are recognised; rows keyed by scenario title
 * use the title verbatim as the row id. A status cell that does not match
 * {@link ROW_STATUSES} is not a usable row (never fabricated). A detected
 * header with a data row whose status column is missing marks the table
 * malformed (R6: a miss, not a crash).
 */
function parseCoverageTable(
    lines: string[],
    kind: 'requirement' | 'acceptance',
): { kind: 'ok' | 'malformed'; rows: VerdictCoverageRow[] } {
    const rows: VerdictCoverageRow[] = [];
    const headerRe =
        kind === 'requirement' ? /^\|\s*(Requirement|Req|R#)\s*\|/i : /^\|\s*(Acceptance Criteria|AC)\s*\|/i;
    let colStatus = -1;
    let colEvidence = -1;
    let colEvidenceType = -1;
    let inTable = false;

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('|')) {
            // A non-table line (prose, heading, blank) ends the table.
            inTable = false;
            continue;
        }
        const cells = splitTableRow(line);
        if (cells.length === 0) continue;
        // Separator row (`|---|---|`): skip.
        if (cells.every((c) => /^[-: ]*$/.test(c))) continue;

        if (!inTable) {
            if (headerRe.test(line)) {
                inTable = true;
                colStatus = cells.findIndex((c) => /status/i.test(c));
                colEvidenceType = cells.findIndex((c) => /evidence type/i.test(c));
                colEvidence = cells.findIndex((c) => /evidence/i.test(c) && !/type/i.test(c));
            }
            continue;
        }

        // Data row inside the table.
        if (colStatus < 0 || colStatus >= cells.length) {
            return { kind: 'malformed', rows };
        }
        const id = (cells[0] ?? '').trim();
        const statusCell = (cells[colStatus] ?? '').trim();
        if (id === '' || statusCell === '') continue;
        const status = normalizeRowStatus(statusCell);
        if (!(ROW_STATUSES as readonly string[]).includes(status)) continue; // not a usable row
        const evidence = unescapeTablePipe((cells[colEvidence >= 0 ? colEvidence : cells.length - 1] ?? '').trim());
        rows.push({
            id,
            status,
            evidenceType: kind === 'acceptance' ? (cells[colEvidenceType >= 0 ? colEvidenceType : 1] ?? '').trim() : '',
            evidence,
        });
    }

    return { kind: 'ok', rows };
}

/**
 * Split a markdown table row into cells on unescaped pipes, preserving
 * backslashes so `\|` stays a single cell (the inverse of {@link escapeTablePipe}
 * is applied by {@link unescapeTablePipe} after splitting).
 */
function splitTableRow(line: string): string[] {
    const body = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let cur = '';
    let escaped = false;
    for (const ch of body) {
        if (escaped) {
            cur += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            escaped = true;
            cur += ch;
            continue;
        }
        if (ch === '|') {
            cells.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    if (escaped) cur += '\\';
    cells.push(cur);
    return cells;
}

/** Reverse {@link escapeTablePipe}: escaped pipes return to literal. */
function unescapeTablePipe(s: string): string {
    return s.replace(/\\\|/g, '|');
}

/**
 * Render the `## Review` section body from a verdict.
 *
 * Produces a P1–P4 priority findings table. When there are no P1–P3 check
 * findings, emits exactly one "no findings" P4 row — a clean verify is a valid
 * review outcome (the section-matrix requires a P1–P4 table, not an empty
 * section).
 *
 * Design: section-matrix §Review — P1–P4 priority table.
 */
export function renderReview(v: VerifyVerdict): string {
    const lines: string[] = [];
    lines.push(`**SECU findings** (pipeline verify step — verdict: ${v.verdict})`);
    lines.push('');
    lines.push('| Priority | Dimension | Location | Finding |');
    lines.push('|----------|-----------|----------|----------|');

    if (v.checks.length === 0) {
        lines.push(`| P4 | — | — | No P1–P3 findings; verify verdict ${v.verdict} |`);
    } else {
        for (const check of v.checks) {
            const finding = escapeTablePipe(check.evidence.replace(/\n/g, ' '));
            // Map check status to P1–P4 severity so the L3 regex /P[1-4]/ matches.
            // If status is already P1–P4, use it directly; otherwise map pass/fail.
            const priority = /^P[1-4]$/.test(check.status) ? check.status : check.status === 'fail' ? 'P1' : 'P4';
            lines.push(`| ${priority} | ${check.name} | — | ${finding} |`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

// ─── R3: Solution safety-net ────────────────────────────────────────────

/**
 * Render the `## Solution` section body from `git diff -U0` output.
 *
 * Parses `@@ -old +new,N @@` hunk headers and pairs each with the file named
 * by the preceding `+++ b/<path>` line. Produces sorted, unique `| \`file:line\` |`
 * rows — the format the section-matrix requires.
 *
 * When the diff produces no hunk lines (e.g. only deletions), falls back to
 * `git diff --name-only` citing each changed file at `:1`.
 *
 * Design: section-matrix §Solution — change-map of `file:line` citations.
 */
export function renderSolutionFromDiff(diffText: string): string {
    const lines: string[] = [];
    lines.push('Change-map (auto-generated — implement step did not record a Solution).');
    lines.push('Each entry cites the first changed line per file (`file:line`).');
    lines.push('');
    lines.push('| Change (`file:line`) |');
    lines.push('|----------------------|');

    const citations = extractFileLineCitations(diffText);

    if (citations.length === 0) {
        // Fallback: cite each changed file at :1.
        const files = extractChangedFiles(diffText);
        if (files.length === 0) {
            lines.push('| `(no changes detected)` |');
        } else {
            for (const f of files) {
                lines.push(`| \`${f}:1\` |`);
            }
        }
    } else {
        for (const citation of citations) {
            lines.push(`| \`${citation}\` |`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

/**
 * Parse `git diff -U0` output for `file:line` citations.
 *
 * Matches `+++ b/<path>` lines to extract file names, then pairs them with
 * `@@ … +new,N @@` hunk headers. Returns sorted, unique `file:line` strings.
 */
function extractFileLineCitations(diffText: string): string[] {
    const citations = new Set<string>();
    let currentFile: string | null = null;

    for (const line of diffText.split('\n')) {
        const fileMatch = /^\+\+\+ b\/(.+)$/.exec(line);
        if (fileMatch) {
            currentFile = fileMatch[1] ?? null;
            continue;
        }

        if (currentFile === null) continue;

        const hunkMatch = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunkMatch) {
            const newLine = hunkMatch[1];
            if (newLine !== undefined) {
                citations.add(`${currentFile}:${newLine}`);
            }
        }
    }

    return [...citations].sort();
}

/** Extract unique file paths from `+++ b/<path>` lines in a diff. */
function extractChangedFiles(diffText: string): string[] {
    const files = new Set<string>();
    for (const line of diffText.split('\n')) {
        const match = /^\+\+\+ b\/(.+)$/.exec(line);
        if (match) {
            const filePath = match[1];
            if (filePath !== undefined) files.add(filePath);
        }
    }
    return [...files].sort();
}

// ─── Git helpers (sync shell — used by record method, not the pure generators) ──

/**
 * Run `git diff -U0` for the current working tree (uncommitted changes).
 *
 * Scoped to source files so generated artifacts don't pollute the change-map.
 * Returns empty string on any failure — the Solution safety-net is best-effort.
 */
export function gitDiffU0(cwd?: string): string {
    try {
        // ProcessExecutor seam (no-direct-process-spawn). Git expands pathspecs itself.
        const result = new BunSyncProcessExecutor().runSync({
            command: 'git',
            args: ['diff', '-U0', 'HEAD', '--', '*.ts', '*.tsx', '*.js'],
            ...(cwd !== undefined ? { cwd } : {}),
            rejectOnError: false,
        });
        return result.exitCode === 0 ? result.stdout : '';
    } catch {
        return '';
    }
}
