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

import { parseChecklist } from '@gobing-ai/spur-domain';
import { BunSyncProcessExecutor, type FileSystem } from '@gobing-ai/ts-runtime';
import {
    aggregateVerifyVerdict,
    type VerifyVerdict as CanonicalVerifyVerdict,
    type CheckSeverity,
    type ParseVerdictOutcome,
    parseVerifyVerdict,
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
    /** Explicit blocking weight (0721): `major` on the hollow-evidence diagnostic. Legacy rows omit it. */
    severity?: CheckSeverity;
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
    const parsed = parseVerifyVerdict(raw, fallbackWbs);
    if (parsed.kind === 'valid') return parsed.verdict;
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

// ─── R2 (0692): Verdict-driven checkbox auto-flip ───────────────────────

/**
 * Normalize a verdict requirement id to its `R\d+` prefix (e.g.
 * `R1 (anchor-drift detection)` → `R1`) so it matches the checkbox id
 * parseChecklist extracts. Non-`R` ids pass through unchanged.
 */
function prefixId(id: string): string {
    const m = /^R\d+/.exec(id);
    return m ? m[0] : id;
}

/**
 * Flip `- [ ]` → `- [x]` on exactly the Requirements/AC boxes a verdict proves.
 *
 * Conservative by construction (0692 Design): a box flips only when the verdict
 * names that requirement id AND marks it MET. PARTIAL flips exactly the proven
 * ids and leaves the rest; FAIL/UNKNOWN flip nothing; boxes the verdict does not
 * mention are never touched — silence is not proof. Reuses the task-check
 * checkbox parser rather than a second regex.
 *
 * @param body      Section body (Requirements or Acceptance Criteria).
 * @param verdict   Canonical verdict whose proven ids drive the flip.
 * @returns the body with proven boxes checked; unchanged when nothing proves.
 */
export function flipVerifiedCheckboxes(body: string, verdict: CanonicalVerifyVerdict): string {
    if (verdict.verdict === 'FAIL' || verdict.verdict === 'UNKNOWN') return body;
    // Verdict ids may carry trailing context (`R1 (anchor-drift detection)`)
    // while parseChecklist extracts the bare `R1` prefix — normalize both sides
    // to the `R\d+` prefix so a MET row proves its box.
    const proven = new Set<string>();
    for (const req of verdict.requirements) {
        if (req.status === 'MET') proven.add(prefixId(req.id));
    }
    for (const ac of verdict.acceptanceCriteria ?? []) {
        if (ac.status === 'MET') proven.add(prefixId(ac.id));
    }
    if (proven.size === 0) return body;

    const items = parseChecklist(body);
    if (items.length === 0) return body;

    const lines = body.split('\n');
    let changed = false;
    for (const item of items) {
        if (item.checked) continue;
        const rid = item.requirementId;
        if (rid === undefined || !proven.has(rid)) continue;
        const idx = item.line - 1;
        const line = lines[idx];
        if (line === undefined) continue;
        lines[idx] = line.replace(/^\s*[-*]\s+\[ \]\s*/, (m) => m.replace('[ ]', '[x]'));
        changed = true;
    }
    return changed ? lines.join('\n') : body;
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
    if (section === null || section.trim() === '') return { kind: 'missing', wbs };
    return parseTestingBody(section, wbs);
}

/**
 * Locate the `## Testing` (or `### Testing`) section in a task document and
 * slice it to the next same-or-higher heading. When the input carries no
 * Testing heading, a task document is missing the section; otherwise the caller
 * passed the section body directly, so return it unchanged.
 */
function extractTestingSection(markdown: string): string | null {
    const heading = /^#{1,6}\s+Testing\s*$/m.exec(markdown);
    if (!heading || heading.index === undefined) {
        const taskDocument =
            /^##\s+\d+\.\s+|^###\s+(?:Background|Requirements|Acceptance Criteria|Q&A|Design|Plan|Solution|Review|References|History|Notes)\s*$/m.test(
                markdown,
            );
        return taskDocument ? null : markdown;
    }
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
 * Shared with the verified-outcome derivation (0712), which reads the same
 * canonical verdict contract from the raw corpus text.
 * Matches `- Verdict: PASS (from verdict artifact)` and bare `Verdict: PASS`.
 * Returns null when absent — parseable rows are never discarded for that.
 */
export function parseVerdictLine(lines: string[]): VerdictAggregate | null {
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
 * use the title verbatim as the row id. A detected header with a data row whose
 * id or status is missing or non-canonical marks the table malformed (R6: a
 * miss, not a crash). Extra cells before status are reconstructed into the id,
 * preserving the existing renderer's unescaped id format.
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
    let columnCount = -1;
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
        if (cells.every((c) => /^[-: ]*$/.test(c))) {
            if (inTable && cells.length !== columnCount) {
                return { kind: 'malformed', rows };
            }
            continue;
        }

        if (!inTable) {
            if (headerRe.test(line)) {
                inTable = true;
                colStatus = cells.findIndex((c) => /status/i.test(c));
                colEvidenceType = cells.findIndex((c) => /evidence type/i.test(c));
                colEvidence = cells.findIndex((c) => /evidence/i.test(c) && !/type/i.test(c));
                columnCount = cells.length;
                if (colStatus < 0 || colEvidence < 0 || (kind === 'acceptance' && colEvidenceType < 0)) {
                    return { kind: 'malformed', rows };
                }
            }
            continue;
        }

        // Data row inside the table.
        if (cells.length < columnCount) {
            return { kind: 'malformed', rows };
        }
        const extraIdCells = cells.length - columnCount;
        const shifted = (column: number): number => column + extraIdCells;
        const id = cells
            .slice(0, extraIdCells + 1)
            .join('|')
            .trim();
        const statusCell = (cells[shifted(colStatus)] ?? '').trim();
        if (id === '—' && statusCell === '—') continue;
        const status = parseRowStatus(statusCell);
        if (id === '' || status === null) return { kind: 'malformed', rows };
        const evidence = unescapeTablePipe((cells[shifted(colEvidence)] ?? '').trim());
        rows.push({
            id,
            status,
            evidenceType: kind === 'acceptance' ? (cells[shifted(colEvidenceType)] ?? '').trim() : '',
            evidence,
        });
    }

    return { kind: 'ok', rows };
}

function parseRowStatus(raw: string): VerdictRowStatus | null {
    const status = raw.toUpperCase().trim();
    return (ROW_STATUSES as readonly string[]).includes(status) ? (status as VerdictRowStatus) : null;
}

/**
 * Split a markdown table row into cells while preserving pipes prefixed by a
 * backslash. This exactly reverses {@link escapeTablePipe}, including evidence
 * that already contained a backslash before a pipe.
 */
function splitTableRow(line: string): string[] {
    const body = line.replace(/^\|/, '').replace(/\|$/, '');
    const cells: string[] = [];
    let cur = '';
    for (const ch of body) {
        if (ch === '|' && !cur.endsWith('\\')) {
            cells.push(cur);
            cur = '';
            continue;
        }
        cur += ch;
    }
    cells.push(cur);
    return cells;
}

/** Reverse {@link escapeTablePipe}: escaped pipes return to literal. */
function unescapeTablePipe(s: string): string {
    return s.replace(/\\\|/g, '|');
}

/**
 * Marks a `## Review` body as `task record`'s own fallback backfill rather than an authored
 * review (0713 R2). Record must never overwrite a review the coordinator wrote, but it must
 * be able to replace *its own* earlier output: without this, a first `record` on a bare
 * section wrote a FAIL header, and the re-record that followed an updated verdict found the
 * section non-bare and skipped it, leaving the stale verdict on the task forever.
 */
export const RECORD_REVIEW_MARKER = '<!-- spur:record-review -->';

/**
 * The pre-marker shape of record's own output, kept so tasks written before the marker
 * existed are still recognized as record-authored and can be refreshed once.
 */
const LEGACY_RECORD_REVIEW_RE = /^\*\*SECU findings\*\* \(pipeline verify step — verdict: [A-Z]+\)/;

/** True when a `## Review` body is record's own backfill and may be replaced. */
export function isRecordAuthoredReview(body: string | null): boolean {
    if (body === null) return false;
    const trimmed = body.trim();
    if (trimmed.startsWith(RECORD_REVIEW_MARKER)) return true;
    return LEGACY_RECORD_REVIEW_RE.test(trimmed);
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
    lines.push(RECORD_REVIEW_MARKER);
    lines.push('');
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
