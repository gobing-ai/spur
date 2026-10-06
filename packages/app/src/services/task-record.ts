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

import { join } from 'node:path';
import { parseChecklist } from '@gobing-ai/spur-domain';
import { BunSyncProcessExecutor, createNodeFileSystem, type FileSystem } from '@gobing-ai/ts-runtime';
import type { TransitionCheckGate } from './task-transition';
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
    /**
     * Explicit diff base for the Solution backfill. Wins over the pipeline's
     * `.spur/run/<wbs>-base.sha` run-base capture, which wins over `HEAD`
     * (task 1090 R1). Internal seam — deliberately not a public CLI flag.
     */
    solutionDiffBase?: string;
    /** Optional lifecycle transition (e.g. `'testing'`). A `'done'` target with
     *  a PASS verdict auto-walks `wip → testing → done` and auto-creates the
     *  pipeline run-link (task 0436 R4); a non-PASS verdict to `done` errors. */
    transition?: string;
    /** 0980: structural gate supplied when the caller suppresses the lifecycle
     *  FSM (`task record --no-lifecycle`). Without the FSM, its target-aware
     *  `spur task check --as <target>` YAML guard would be silently lost, so the
     *  caller injects the same P3 backstop `task update` uses (task 0130). Runs
     *  only when the status actually changes — matching the adapter guard, which
     *  fires on `requestTransition` and never on a same-status no-op. */
    checkGate?: TransitionCheckGate;
}

/** Result returned by TaskService.record(). */
export interface RecordResult {
    testingWritten: boolean;
    reviewWritten: boolean;
    solutionBackfilled: boolean;
    /**
     * 1040 P3 review finding: unforced-close reconciliation failure from the
     * record done path — same best-effort channel as `TransitionOutcome
     * .closeAuditError`. Reported by the CLI, never thrown.
     */
    closeAuditError?: string;
    /**
     * 1047 R3: lifecycle-bookkeeping reconciliation failure from a terminal
     * transition or the already-terminal replay — same best-effort channel as
     * `closeAuditError`. The task file is committed; the CLI reports it so a
     * replay of the same terminal transition repairs the row. Never thrown.
     */
    bookkeepingError?: string;
    transitionedTo?: string;
    /**
     * 0936 R1: scenario-key carry-forward warnings from the Testing
     * re-transcription guard — one per dropped MET-matched feature scenario key,
     * plus the no-match parity warning. Warn-only (exit 0); the CLI prints each
     * to stderr and `--json` carries the array. Absent when silent.
     */
    scenarioWarnings?: string[];
    /**
     * 1040 R1/R4: state of the verdict artifact this record actually pulled —
     * `readable` (parsed, rows usable), `missing` (absent, unreadable, or a
     * foreign-task artifact), or `malformed` (bad JSON / structurally invalid).
     */
    verdictState?: 'readable' | 'missing' | 'malformed';
    /**
     * 1040 R1: actionable message for `missing`/`malformed` states naming the
     * selected path and the verdict-first remedy. Absent when `readable`.
     */
    verdictMessage?: string;
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

/** 1040: classified verdict-artifact read — the state + remedy the record step reports. */
export interface ClassifiedVerdict {
    state: 'readable' | 'missing' | 'malformed';
    verdict: CanonicalVerifyVerdict;
    /** Set only for missing/malformed: names the selected path and the remedy. */
    message?: string;
}

/**
 * 1040 R1/R4: read the verdict artifact and report its state instead of
 * collapsing every failure to UNKNOWN.
 *
 * Missing = absent/unreadable file, empty file, or a foreign-task artifact
 * (present `wbs` naming another task — unusable evidence; frozen mapping reports
 * it as `missing` with a mismatch message). Malformed = bad JSON, non-object
 * root, or a structurally invalid artifact. An artifact omitting `wbs` keeps
 * the fallback-WBS compatibility. Identity is checked against the RAW JSON
 * before schema parse, because `verifyVerdictSchema` defaults an omitted `wbs`
 * to `''` — post-parse, omitted and explicit-`''` are indistinguishable.
 */
export async function readVerdictClassified(
    fs: FileSystem,
    path: string,
    fallbackWbs: string,
): Promise<ClassifiedVerdict> {
    let raw: string;
    try {
        raw = await fs.readFile(path);
    } catch {
        return {
            state: 'missing',
            verdict: unknownStub(fallbackWbs),
            message:
                `verdict artifact not readable at ${path}. ` +
                `Run \`spur task verify ${fallbackWbs}\` to produce a PASS verdict, then re-run \`spur task record ${fallbackWbs}\`.`,
        };
    }
    if (raw.trim() === '') {
        return {
            state: 'missing',
            verdict: unknownStub(fallbackWbs),
            message:
                `verdict artifact at ${path} is empty. ` +
                `Run \`spur task verify ${fallbackWbs}\` to produce a PASS verdict, then re-run \`spur task record ${fallbackWbs}\`.`,
        };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        return {
            state: 'malformed',
            verdict: unknownStub(fallbackWbs),
            message:
                `verdict artifact at ${path} is malformed JSON (${(err as Error).message}). ` +
                `Re-run \`spur task verify ${fallbackWbs}\` to regenerate it, then re-record.`,
        };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            state: 'malformed',
            verdict: unknownStub(fallbackWbs),
            message:
                `verdict artifact at ${path} is invalid: root must be a JSON object. ` +
                `Re-run \`spur task verify ${fallbackWbs}\` to regenerate it, then re-record.`,
        };
    }
    const record = parsed as Record<string, unknown>;

    // 1040 R4: a present `wbs` naming another task makes the artifact unusable
    // for this task — derive no PASS and flip no checkboxes from it. Frozen
    // result mapping: unusable reports as `missing` with expected/actual + path.
    if ('wbs' in record) {
        const artifactWbs: unknown = record.wbs;
        if (typeof artifactWbs !== 'string' || artifactWbs !== fallbackWbs) {
            const actual = typeof artifactWbs === 'string' ? JSON.stringify(artifactWbs) : String(artifactWbs);
            return {
                state: 'missing',
                verdict: unknownStub(fallbackWbs),
                message:
                    `artifact identity mismatch at ${path}: expected wbs '${fallbackWbs}', actual ${actual}. ` +
                    `This task cannot use another task's verdict artifact. ` +
                    `Run \`spur task verify ${fallbackWbs}\` to produce this task's own PASS verdict, then re-record.`,
            };
        }
    }

    const outcome = parseVerifyVerdict(raw, fallbackWbs);
    if (outcome.kind === 'valid') return { state: 'readable', verdict: outcome.verdict };
    return {
        state: 'malformed',
        verdict: unknownStub(fallbackWbs),
        message:
            `verdict artifact at ${path} is invalid: ${outcome.kind === 'invalid' ? outcome.reason : outcome.kind}. ` +
            `Re-run \`spur task verify ${fallbackWbs}\` to regenerate it, then re-record.`,
    };
}

/** The honest UNKNOWN stub a non-readable artifact degrades to (preserves authored Testing). */
function unknownStub(wbs: string): CanonicalVerifyVerdict {
    return { wbs: wbs || '', verdict: 'UNKNOWN', requirements: [], acceptanceCriteria: [], checks: [] };
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
    // 1068 R3: render the verifier's stated confidence when the artifact carries it;
    // pre-1068 artifacts have no field and render no line (optional on read).
    if (v.confidence !== undefined) lines.push(`- Confidence: ${v.confidence}`);
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
 * Normalize a verdict row id to its `R\d+` / `AC\d+` prefix (e.g.
 * `R1 (anchor-drift detection)` → `R1`, `AC1 — <scenario title>` → `AC1`) so it
 * matches the checkbox id parseChecklist extracts. Other ids pass through unchanged.
 * Without the AC form, an AC row keyed by scenario title for feature credit
 * could never tick its own task box.
 */
function prefixId(id: string): string {
    const m = /^(?:AC|R)\d+/.exec(id);
    return m ? m[0] : id;
}

// A spaced hyphen or en dash is the same separator as an em dash, so `AC1 - R3 — <title>` still aliases.
const normalizeKey = (text: string): string =>
    text
        .replace(/\s+[-–—]\s+/g, ' — ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();

/**
 * Resolve the checkbox an AC verdict row proves (0996). A feature-linked task keys its AC rows
 * by feature scenario (`R3 — <title>`), whose leading `R3` is the feature's id, not the task's
 * Requirements box. When a task AC line aliases that scenario (`AC1 — R3 — <title>`), the row
 * proves `AC1`; an unaliased scenario key (`R<n> — <title>`) proves nothing. `AC1`,
 * `AC1 — <title>` and bare/parenthesized `R1` keys keep the {@link prefixId} behavior.
 *
 * `AC-<n>` is the feature's 1-based scenario alias, not the task's `AC<n>` box — the numbering
 * spaces differ — so it resolves through `scenarioTitles[n-1]` to the AC line aliasing that
 * scenario, and proves nothing when no line does (never a numeric guess).
 */
function acRowProves(
    rowId: string,
    items: ReturnType<typeof parseChecklist>,
    scenarioTitles: readonly string[],
): string | undefined {
    const ordinal = /^AC-(\d+)$/.exec(rowId.trim());
    const key = normalizeKey(ordinal ? (scenarioTitles[Number(ordinal[1]) - 1] ?? '') : rowId);
    for (const item of items) {
        if (!item.requirementId?.startsWith('AC')) continue;
        const alias = normalizeKey(item.text.replace(/\s*\(req:[^)]*\)\s*$/, ''));
        if (alias !== '' && key !== '' && (alias === key || alias.endsWith(`— ${key}`))) return item.requirementId;
    }
    if (ordinal || /^R\d+\s*[—-]\s*\S/.test(rowId.trim())) return undefined;
    return prefixId(rowId);
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
 * @param scenarioTitles  Linked feature's scenario titles in `AC-<n>` order; empty when unlinked.
 * @returns the body with proven boxes checked; unchanged when nothing proves.
 */
export function flipVerifiedCheckboxes(
    body: string,
    verdict: CanonicalVerifyVerdict,
    scenarioTitles: readonly string[] = [],
): string {
    if (verdict.verdict === 'FAIL' || verdict.verdict === 'UNKNOWN') return body;
    // Verdict ids may carry trailing context (`R1 (anchor-drift detection)`)
    // while parseChecklist extracts the bare `R1` prefix — normalize both sides
    // to the `R\d+` prefix so a MET row proves its box.
    const items = parseChecklist(body);
    if (items.length === 0) return body;

    const proven = new Set<string>();
    for (const req of verdict.requirements) {
        if (req.status !== 'MET') continue;
        const id = /^AC-\d+$/.test(req.id.trim()) ? acRowProves(req.id, items, scenarioTitles) : prefixId(req.id);
        if (id !== undefined) proven.add(id);
    }
    for (const ac of verdict.acceptanceCriteria ?? []) {
        if (ac.status !== 'MET') continue;
        const id = acRowProves(ac.id, items, scenarioTitles);
        if (id !== undefined) proven.add(id);
    }
    if (proven.size === 0) return body;

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

/** Explicit check severity → rendered P-level (0721): blocker/major must stay distinguishable. */
const SEVERITY_PRIORITY: Record<string, string | undefined> = {
    blocker: 'P1',
    major: 'P2',
    minor: 'P3',
    advisory: 'P4',
};

/**
 * Render the `## Review` section body from a verdict.
 *
 * Produces a P1–P4 priority findings table. A passing check with no explicit
 * severity is a gate outcome, not a finding, so it gets no row — rendering it as
 * P4 made the residual sweep count every clean gate as an advisory residual. When
 * no finding remains, emits exactly one "No findings" P4 row — a clean verify is a
 * valid review outcome (the section-matrix requires a P1–P4 table, not an empty
 * section), and the residual sweep reads that row as no finding.
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

    const findings = v.checks.filter((check) => check.severity !== undefined || check.status !== 'pass');
    if (findings.length === 0) {
        lines.push(`| P4 | — | — | No findings (verify verdict ${v.verdict}) |`);
    } else {
        for (const check of findings) {
            const finding = escapeTablePipe(check.evidence.replace(/\n/g, ' '));
            // Map to P1–P4 so the L3 regex /P[1-4]/ matches. An explicit `severity`
            // (0721) wins — dropping it would collapse major/blocker into the same P1.
            // Otherwise: an already-P1–P4 status passes through, then legacy pass/fail.
            const priority =
                SEVERITY_PRIORITY[check.severity ?? ''] ??
                (/^P[1-4]$/.test(check.status) ? check.status : check.status === 'fail' ? 'P1' : 'P4');
            lines.push(`| ${priority} | ${check.name} | — | ${finding} |`);
        }
    }

    lines.push('');
    return lines.join('\n');
}

// ─── R3: Solution safety-net ────────────────────────────────────────────

/** First line of record's own `## Solution` backfill — the attribution marker. */
export const RECORD_SOLUTION_HEADER = 'Change-map (auto-generated — implement step did not record a Solution).';

/** The row record emits when the filtered diff named no changed file. */
export const SOLUTION_NO_ROWS_ROW = '(no changes detected)';

/** Lockfiles: regenerated dependency state, not an implementation change. */
const SOLUTION_EXCLUDED_LOCKFILES = new Set([
    'bun.lock',
    'bun.lockb',
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
]);

/**
 * Generated planes the auto change-map must not advertise: `.spur/` runtime state,
 * task-corpus status churn, and lockfiles. Passed to git as pathspec excludes by
 * {@link gitDiffU0} and re-applied by {@link isExcludedSolutionPath} inside the pure
 * renderer, so a raw diff handed straight to the renderer is filtered identically.
 *
 * Design (task 1090 R2): the former `*.ts`/`*.tsx`/`*.js` allowlist made a docs, YAML or
 * corpus-only task produce an empty change-map **by construction** — R2 requires those
 * changes to be named, so the task corpus is deliberately NOT excluded here (a corpus-only
 * task must produce rows too), and hardcoding a planning folder would additionally trip the
 * `no-hardcoded-planning-folder` rule.
 */
export const SOLUTION_EXCLUDE_PATHSPECS = [
    ':(exclude).spur/**',
    ':(exclude)bun.lock',
    ':(exclude)bun.lockb',
    ':(exclude)package-lock.json',
    ':(exclude)yarn.lock',
    ':(exclude)pnpm-lock.yaml',
] as const;

/** True when a changed path belongs to a generated plane the change-map must not cite. */
export function isExcludedSolutionPath(path: string): boolean {
    if (path.startsWith('.spur/')) return true;
    const base = path.split('/').pop() ?? path;
    return SOLUTION_EXCLUDED_LOCKFILES.has(base);
}

/** True when a `## Solution` body is record's own backfill output. */
export function isRecordAuthoredSolution(body: string | null): boolean {
    if (body === null) return false;
    return body.trim().startsWith(RECORD_SOLUTION_HEADER);
}

/**
 * True when record's own backfill ran and reported no rows — the run diff named no
 * changed file. The `L3.solution-file-line` denial reads this to name the empty
 * backfill instead of misattributing the cause to an unauthored Solution (task 1090 R3).
 */
export function isEmptyRecordSolution(body: string | null): boolean {
    return body !== null && isRecordAuthoredSolution(body) && body.includes(SOLUTION_NO_ROWS_ROW);
}

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
    lines.push(RECORD_SOLUTION_HEADER);
    lines.push('Each entry cites the first changed line per file (`file:line`).');
    lines.push('');
    lines.push('| Change (`file:line`) |');
    lines.push('|----------------------|');

    const citations = extractFileLineCitations(diffText);

    if (citations.length === 0) {
        // Fallback: cite each changed file at :1.
        const files = extractChangedFiles(diffText);
        if (files.length === 0) {
            lines.push(`| \`${SOLUTION_NO_ROWS_ROW}\` |`);
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
            const path = fileMatch[1] ?? null;
            // An excluded file's hunks are skipped too: `-U0` keeps each file's hunks
            // directly under its own `+++` line (task 1090 R2).
            currentFile = path !== null && !isExcludedSolutionPath(path) ? path : null;
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
            if (filePath !== undefined && !isExcludedSolutionPath(filePath)) files.add(filePath);
        }
    }
    return [...files].sort();
}

// ─── Git helpers (sync shell — used by record method, not the pure generators) ──

/** Options for {@link gitDiffU0} / {@link resolveDiffBase}. */
export interface GitDiffU0Options {
    /** Working directory the diff runs in (the project root by default). */
    cwd?: string;
    /** Explicit diff base (commit-ish). Highest precedence when non-empty. */
    base?: string;
    /** Task WBS — resolves the pipeline's `.spur/run/<wbs>-base.sha` run-base capture. */
    wbs?: string;
}

/**
 * Resolve the change-map's diff base, first non-empty of: an explicit option →
 * `.spur/run/<wbs>-base.sha` (the pipeline precheck's run-base capture, task 0950) →
 * `HEAD`.
 *
 * Design (task 1090 R1): fixing on `HEAD` made committed work invisible — the
 * documented `--worktree` flow commits before `record` runs, so the safety-net
 * backfill reported "no changes detected" for any run that had already committed.
 *
 * The run-base file is read through the ts-runtime FileSystem seam (the
 * `no-direct-fs-io` boundary rule), hence async.
 */
export async function resolveDiffBase(options: GitDiffU0Options = {}): Promise<string> {
    const explicit = options.base?.trim();
    if (explicit !== undefined && explicit !== '') return explicit;
    const wbs = options.wbs?.trim();
    if (wbs !== undefined && wbs !== '') {
        const baseFile = join(options.cwd ?? process.cwd(), '.spur', 'run', `${wbs}-base.sha`);
        try {
            const sha = (await createNodeFileSystem().readFile(baseFile)).trim();
            if (sha !== '') return sha;
        } catch {
            // No run-base capture — fall through to HEAD.
        }
    }
    return 'HEAD';
}

/**
 * Run `git diff -U0 <base>` for the working tree.
 *
 * The base is the run base, not the working tree, so committed work is named too
 * (task 1090 R1). Generated planes are excluded by pathspec rather than by an
 * extension allowlist, so a non-JS change set produces rows (task 1090 R2).
 * Returns empty string on any failure — the Solution safety-net is best-effort.
 */
export async function gitDiffU0(options: GitDiffU0Options = {}): Promise<string> {
    try {
        const base = await resolveDiffBase(options);
        // ProcessExecutor seam (no-direct-process-spawn). Git expands pathspecs itself,
        // and the excludes need `-- .` as their positive pathspec.
        const result = new BunSyncProcessExecutor().runSync({
            command: 'git',
            args: ['diff', '-U0', base, '--', '.', ...SOLUTION_EXCLUDE_PATHSPECS],
            ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
            rejectOnError: false,
        });
        return result.exitCode === 0 ? result.stdout : '';
    } catch {
        return '';
    }
}
