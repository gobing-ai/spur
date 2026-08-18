/**
 * Task check — four-layer validation per design §3.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Per-section format rules (warning-first; 3 hard-core rules).
 * L4: Traceability (warning-first).
 */

import { basename, dirname, join } from 'node:path';
import {
    checkAcCoverage,
    DEFAULT_TASK_VARIANT,
    MarkdownDocument,
    parseChecklist,
    stripAcFence,
    taskFrontmatterSchema,
    WAYFINDER_MAP_TAG,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { readVerdictArtifact as readGuardVerdictArtifact } from './done-transition-guard';
import {
    type CheckFindings,
    FINDING_CODES,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';
import { TaskLocator } from './task-locator';

// ─── Types ──────────────────────────────────────────────────────────────

export type { CheckFindings, MatrixEntry, SectionMatrix, Severity };

/** Result of a `spur task check` validation run. */
export interface CheckResult {
    wbs: string;
    status: string;
    findings: CheckFindings[];
    /** Required sections for the current status (for `--json` reporting). */
    requiredSections: string[];
    /** Missing required sections for the current status. */
    missingSections: string[];
    /** Whether the check passed (no hard errors). */
    pass: boolean;
}

interface TaskSnapshot {
    wbs: string;
    status: string;
    dependencies: string[];
}

/**
 * A section body is a placeholder when, after stripping HTML guidance comments
 * (`<!-- … -->`) and blockquote `> TBD`-style markers, nothing substantive
 * remains. Used to skip format rules for sections not yet authored (e.g. an
 * empty Solution at todo/wip before implementation).
 */
function isPlaceholderBody(body: string): boolean {
    const stripped = body
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/^\s*>\s*TBD\s*$/gim, '')
        .trim();
    return stripped.length === 0;
}

/**
 * A table cell that carries no real content: empty, a dash/em-dash placeholder run
 * (`—`, `–`, `-`, `---`), or a bare `n/a`/`N/A`. Dash-filled cells defeat a bare
 * non-empty check — a `| P1 | — | — | — |` placeholder row is still a placeholder
 * (task 0297; how 0296 reached `done` with an unauthored Review).
 */
function isPlaceholderCell(cell: string): boolean {
    const c = cell.trim();
    return c === '' || /^[—–-]+$/.test(c) || /^n\/?a$/i.test(c);
}

/**
 * A `### Review` body counts as carrying a real findings table only when at least
 * one `P1`–`P4` row has substantive content beyond the severity label itself — i.e.
 * a markdown table row `| P2 | <file> | <finding> | … |` where some non-severity cell
 * is non-placeholder. The shipped review template scaffolds an *empty-cell* P-table
 * (`| P1 | | | |`); a bare `/P[1-4]/` match falsely accepts that scaffold as a
 * populated table, and a bare non-empty check falsely accepts dash-filled cells
 * (`| P1 | — | — | — |`). Requiring a non-placeholder cell closes both false-passes
 * so a review task can't reach `wip` with an unauthored findings table.
 */
/**
 * True when Review body has at least one `| P1|…|P4 |` row with a non-placeholder
 * non-severity cell. Exported for the lifecycle done-gate (task 0278 R1) so
 * `testing→done` can refuse prose-only Reviews in-process — defense-in-depth
 * when PATH `spur task check --strict-core` is stale or unreachable.
 */
export function hasPopulatedPriorityTable(body: string): boolean {
    for (const line of body.split('\n')) {
        const cells = line.split('|');
        if (cells.length < 3) continue; // not a table row
        // R7a (task 0487): the severity cell may carry prose — `P1 (blocker)`,
        // `P2 — deferred`. Anchor on the label, not on the whole cell; `\b`
        // still rejects `P12`. The non-placeholder content check below is what
        // separates a real finding row from the empty scaffold.
        const severityIdx = cells.findIndex((c) => /^\s*P[1-4]\b/.test(c));
        if (severityIdx === -1) continue;
        const hasContent = cells.some((c, i) => i !== severityIdx && !isPlaceholderCell(c));
        if (hasContent) return true;
    }
    return false;
}

/**
 * Extract the `### Review` section body from a task markdown document.
 * Returns null when the section is absent.
 *
 * R7c (task 0487): the previous single-regex form ended the body at
 * `(?=^### |Z)` — a literal `Z`, not the `\Z` end-anchor JS does not have. That
 * truncated every Review body at its first uppercase `Z`, and when `### Review`
 * was the file's last section (no following `### ` heading and no `Z`) the match
 * failed outright, so the gate read a populated Review as absent. Slice to the
 * next `### ` heading or to end-of-input instead.
 */
export function extractReviewSectionBody(markdown: string): string | null {
    const heading = markdown.match(/^### Review[ \t]*\n/m);
    if (!heading) return null;
    const rest = markdown.slice((heading.index ?? 0) + heading[0].length);
    const next = rest.match(/^### /m);
    return next ? rest.slice(0, next.index ?? 0) : rest;
}

/**
 * The shipped `### Review` scaffold is reflection prose plus an *empty-cell* P-table
 * (`| P1 | | | |`). A review task carries this verbatim from creation until the first
 * fix round fills it. Such a scaffold is a placeholder — neither a real findings table
 * (so it must not satisfy the L3 rule) nor a half-authored section the operator forgot
 * to table (so it must not error either): it errors only once the section becomes
 * required (`wip`+), exactly like a missing required section.
 *
 * A body is the review scaffold when, after stripping the empty-cell P-table rows and
 * the markdown table chrome (header + `---` separator), nothing but guidance prose
 * remains. If real prose-with-no-table or a partially-filled table is present, it is
 * NOT a scaffold — the L3 rule then applies and fires on the missing populated table.
 */
function isReviewScaffold(body: string): boolean {
    if (isPlaceholderBody(body)) return true;
    if (hasPopulatedPriorityTable(body)) return false; // real findings → not a scaffold
    // The scaffold's structural signature is an empty-cell `P1`–`P4` table. Require it:
    // pure prose with no table at all is a half-authored section, not the shipped
    // scaffold, and must still error. The scaffold is present only when at least one
    // empty-cell P-row exists AND every table row is empty-cell chrome (header,
    // separator, or `| Pn | | | |` — dash/`n/a` placeholder cells count as empty) —
    // any real table content disqualifies it.
    let sawEmptyPRow = false;
    for (const line of body.split('\n')) {
        if (!line.includes('|')) continue; // prose line — allowed alongside the scaffold table
        const cells = line.split('|').map((c) => c.trim());
        const isSeparator = cells.every((c) => c === '' || /^:?-+:?$/.test(c));
        const isEmptyPRow =
            cells.every((c) => isPlaceholderCell(c) || /^P[1-4]$/.test(c)) && cells.some((c) => /^P[1-4]$/.test(c));
        const isHeader = cells.some((c) => /severity|file|finding|recommendation/i.test(c));
        if (isEmptyPRow) sawEmptyPRow = true;
        else if (!isSeparator && !isHeader) return false; // real table content → not a scaffold
    }
    return sawEmptyPRow;
}

/**
 * A `### Review` body is "prose-only" when, after stripping placeholder content,
 * it contains no markdown table rows at all (no `|` characters). This covers the
 * pre-fix-round authoring window where the operator has written context prose but
 * has not yet drafted a findings table — a legitimate state when Review is *optional*
 * (backlog/todo for the `review` variant). It must NOT be tolerated where Review is
 * *required* (`wip`+): there a populated findings table is mandatory regardless.
 */
function isProseOnlyReview(body: string): boolean {
    if (isPlaceholderBody(body)) return true; // placeholder — always tolerated as a scaffold
    if (hasPopulatedPriorityTable(body)) return false; // real findings → not prose-only
    // A body is prose-only when no line contains a `|` (table-row marker). If any
    // `|` is present, the operator has started a table (even partially) — that is a
    // half-authored section and must still trigger the L3 error.
    const stripped = body.replace(/<!--[\s\S]*?-->/g, '');
    return !stripped.split('\n').some((l) => l.includes('|'));
}

/**
 * Detect a file:line citation in markdown table format — a file path in one column
 * and a line number (or line range) in an adjacent column. Example rows:
 *   | `src/foo.ts` | 42 | fixed the bug |
 *   | `src/bar.ts` | 42-45 | refactored range |
 *
 * The file column must contain a recognisable extension (`.ts`, `.js`, `.md`, etc.);
 * the line column must be a bare integer or integer range.
 */
/**
 * Project root for resolving relative `path:line` citations.
 * `docs/tasks*` → two levels up; otherwise one level up from the tasks folder.
 */
export function resolveProjectRootFromTasksDir(tasksDir: string): string {
    const norm = tasksDir.replace(/\\/g, '/');
    if (/\/docs\/tasks\d*$/.test(norm) || /\/docs\/tasks$/.test(norm)) {
        return dirname(dirname(tasksDir));
    }
    return dirname(tasksDir);
}

/** Backtick `path:line` / `path:start-end` citations (skips URLs and bare numbers). */
export function extractBacktickLineAnchors(
    body: string,
): Array<{ raw: string; path: string; startLine: number; endLine?: number }> {
    const out: Array<{ raw: string; path: string; startLine: number; endLine?: number }> = [];
    const re = /`([^`\n]+?:(\d+)(?:-(\d+))?)`/g;
    let m: RegExpExecArray | null = re.exec(body);
    while (m !== null) {
        const raw = m[1] ?? '';
        const startStr = m[2];
        const endStr = m[3];
        if (startStr) {
            // Split path from trailing :line / :start-end
            const pathPart = raw.replace(/:(\d+)(?:-(\d+))?$/, '');
            const hasExt = /\.\w{1,8}$/.test(pathPart.split('/').pop() ?? '');
            if (pathPart && !pathPart.includes('://') && hasExt) {
                const startLine = Number(startStr);
                const endLine = endStr !== undefined ? Number(endStr) : undefined;
                if (Number.isFinite(startLine) && startLine >= 1) {
                    out.push({ raw, path: pathPart, startLine, endLine });
                }
            }
        }
        m = re.exec(body);
    }
    return out;
}

/**
 * Frozen external-evidence form (task 0584 / ADR-062): a named origin plus a * backticked path with the line number OUTSIDE the backticks.
 *
 *   Evidence: @gobing-ai/ts-llm-jsonl-importer `src/mappers.ts` line 481 — …
 *
 * The frozen shape keeps the line number outside the backticks so
 * `extractBacktickLineAnchors` (whose regex requires `path:NN` inside the
 * backticks) can never match it — the work here is classification, not
 * parsing (task 0584 Design decision 1). Reported: external citations whose
 * path is NOT a uniquely-resolvable in-repo basename (R1); if the path
 * resolves in-repo, the citation is in-repo evidence and must use a
 * repo-relative anchor instead — it still reports (R2).
 */
const EXTERNAL_EVIDENCE_RE = /`([^`\n]+?)`\s+(?:line|lines?)\s+(\d+)(?:-(\d+))?/g;

/**
 * Classify frozen external-evidence citations in a body.
 *
 * Returns citations (named origin + backticked path + line number outside the
 * backticks) for `checkLineAnchors` so external evidence never emits
 * `L4.stale-line-anchor` (R1). The origin must be package/project-like (bear a
 * structural separator — `/`, `@`, `.`, `_`, `-`) so sentence prose like
 * "at `path` line N" is never promoted to external evidence: classifying prose
 * would put pre-existing corpus text into the R2 in-repo net and manufacture
 * new gate debt. Consumed by task 0583's subject-matching rule — it must not
 * re-implement or re-interpret this classification.
 */
export function classifyExternalEvidence(
    body: string,
): Array<{ origin: string; path: string; startLine: number; endLine?: number }> {
    const out: Array<{ origin: string; path: string; startLine: number; endLine?: number }> = [];
    const re = new RegExp(EXTERNAL_EVIDENCE_RE.source, 'g');
    let m: RegExpExecArray | null = re.exec(body);
    while (m !== null) {
        const raw = m[0] ?? '';
        const path = m[1] ?? '';
        if (!path) {
            m = re.exec(body);
            continue;
        }
        // The frozen shape is origin + `path` + line N — no colon-line inside the
        // backticks, so no `:line` suffix to strip.
        const before = body.slice(Math.max(0, re.lastIndex - raw.length - 80), re.lastIndex - raw.length);
        const originMatch = /([^\s`]+)\s*$/.exec(before);
        const origin = originMatch?.[1] ?? '';
        // Named-origin gate: only package/project-like tokens count. Prepositions
        // and sentence words ("at", "in", "lines:") are prose, not origins.
        if (!/[/@._-]/.test(origin)) {
            m = re.exec(body);
            continue;
        }
        const startLine = Number(m[2]);
        const endLine = m[3] !== undefined ? Number(m[3]) : undefined;
        if (Number.isFinite(startLine) && startLine >= 1) {
            out.push({ origin, path, startLine, endLine });
        }
        m = re.exec(body);
    }
    return out;
}

/**
 * Subject-matching for in-repo evidence anchors (task 0583 R4/R5).
 *
 * Given the requirement/AC row that names an anchor and the cited source text,
 * decide whether the cited lines really address the citing requirement's subject.
 * The subject is the row's noun — prefer symbols/identifiers over free text so a
 * citation whose line content names the same symbol passes even under ordinary
 * wording drift (R5): a test whose identifier paraphrases the requirement counts.
 *
 * Extracts candidate subject tokens from the citing row (backticked symbols,
 * PascalCase/camelCase identifiers, and the R-/AC-n API), then checks whether any
 * appears in the cited window. If none does, the anchor's lines do not name the
 * requirement's subject → mismatch (R4). Never re-reads the whole file: the caller
 * already holds the in-range window.
 */
export function extractSubjectTokens(row: string, excludeCitation?: string): string[] {
    const tokens = new Set<string>();
    // Tokens that can never appear in cited SOURCE lines, so keeping them only
    // guarantees a mismatch on well-formed rows:
    //   - the citation itself — code never contains its own `path:line`;
    //   - verdict-table metadata (`MET`, `PARTIAL`, …) — row status, not subject.
    // A minimal, correct evidence row (`| R1 | MET | \`path.ts:12-20\` |`) yields
    // exactly these and nothing else, so without the exclusion every such row
    // reports (task 0583 R5 verify).
    const ROW_METADATA = new Set(['met', 'partial', 'unmet', 'n/a', 'na', 'pass', 'fail', 'todo', 'done']);
    const excluded = new Set<string>();
    if (excludeCitation !== undefined && excludeCitation !== '') {
        excluded.add(excludeCitation.toLowerCase());
        excluded.add(excludeCitation.replace(/:(\d+)(?:-(\d+))?$/, '').toLowerCase());
    }
    // Backticked symbols/identifiers in the row (the strongest subject signal).
    for (const m of row.matchAll(/`([^`]+)`/g)) {
        const t = m[1]?.trim();
        if (!t || !/[A-Za-z0-9_./-]+/.test(t)) continue;
        tokens.add(t.toLowerCase());
        // A backticked PHRASE (`spur task migrate-anchors --dry-run`) is one atomic
        // token that source can never contain verbatim, even when the code plainly
        // names the verb. Contribute its identifier-ish words too, so the phrase
        // still carries a matchable subject instead of guaranteeing a mismatch.
        if (/\s/.test(t)) {
            for (const part of t.split(/\s+/)) {
                const word = part.replace(/^-+/, '').replace(/[^A-Za-z0-9_./-]+$/, '');
                if (word.length >= 3 && /[A-Za-z]/.test(word)) tokens.add(word.toLowerCase());
            }
        }
    }
    // CamelCase / PascalCase / snake_case identifiers (bare symbols).
    for (const m of row.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*[A-Z][A-Za-z0-9_]*\b/g)) {
        if (m[0]) tokens.add(m[0].toLowerCase());
    }
    for (const m of row.matchAll(/\b[a-z0-9_]+_[a-z0-9_]+\b/g)) {
        if (m[0]) tokens.add(m[0].toLowerCase());
    }
    // R-/AC- references.
    for (const m of row.matchAll(/\b(R|AC)-?\d+\b/g)) {
        if (m[0]) tokens.add(m[0].toLowerCase());
    }
    return [...tokens].filter((t) => !excluded.has(t) && !ROW_METADATA.has(t));
}

/**
 * Whether the cited lines name the requirement's subject (R5 paraphrase-tolerance).
 * True when any extracted subject token appears in the cited window. An empty
 * token set (no identifiable subject) counts as matching — we only report a
 * mismatch when we know what the subject should be and it is absent.
 */
export function citedLinesNameSubject(subjectTokens: string[], cited: string): boolean {
    if (subjectTokens.length === 0) return true;
    const lower = cited.toLowerCase();
    if (subjectTokens.some((t) => lower.includes(t))) return true;
    // An `R3`/`AC-2` id is matchable evidence when a code comment cites it, but it is
    // not a SUBJECT: a row whose only remaining token is its own requirement id names
    // nothing to look for in the code, so demanding a match there reports every
    // correctly-cited minimal row. Absence of a real identifier ⇒ nothing to assert.
    const isRowId = (t: string) => /^(r|ac)-?\d+$/.test(t);
    return subjectTokens.every(isRowId);
}

function hasAdjacentFileLineColumns(body: string): boolean {
    const lines = body.split('\n');
    for (const line of lines) {
        if (!line.includes('|')) continue;
        const cells = line.split('|').map((c) => c.trim());
        // Need at least 2 content cells for an adjacent pair.
        if (cells.length < 3) continue;
        for (let i = 0; i < cells.length - 1; i++) {
            const a = cells[i];
            const b = cells[i + 1];
            if (a === undefined || b === undefined) continue;
            // Column A is a file path (backtick-wrapped or bare, with a known extension).
            // Strip backticks before testing the extension so `\`src/foo.ts\`` matches.
            const fileText = a.replace(/`/g, '');
            const fileCell = /\.(tsx?|jsx?|mjs|cjs|md|ya?ml|json|css|html|sql|sh|toml)$/i.test(fileText);
            // Column B is a line number or range.
            const lineCell = /^\d+(-\d+)?$/.test(b);
            if (fileCell && lineCell) return true;
        }
    }
    return false;
}

/**
 * True when a Solution body carries at least one recognized `file:line` citation:
 * a backticked `` `path:line` `` / `` `path:start-end` `` anchor, a bare
 * `path.ext:line` citation, or a markdown table row with a file path and a line
 * number in adjacent columns (e.g. | `src/foo.ts` | 42 | ... |). Single source of
 * truth shared by the L3 checker and the task-write seam (task 0510 R1) so
 * write-time and `task check` behavior cannot drift.
 */
export function hasSolutionFileLineCitation(body: string): boolean {
    const hasFileLine = /`[^`]+?:\d+(-\d+)?`/.test(body) || /[^\s`]\.\w+:\d+/.test(body);
    return hasFileLine || hasAdjacentFileLineColumns(body);
}

// ─── TaskCheckService ───────────────────────────────────────────────────

/** Four-layer task validator (design §3). L1 schema → L2 matrix → L3 format → L4 traceability. */
export class TaskCheckService extends PlanningCheckService {
    /**
     * Locator for the L4 relational checks. When absent, those checks fall back to
     * the checked file's own directory — correct for a single-folder corpus, but it
     * cannot see sibling folders, so callers with a folder config should inject one.
     */
    private readonly locator?: TaskLocator;

    constructor(fs: FileSystem, matrix: SectionMatrix, locator?: TaskLocator) {
        super({
            fs,
            matrix,
            docKind: 'task',
            frontmatterSchema: taskFrontmatterSchema,
            parse: (raw, kind) => MarkdownDocument.parse(raw, kind),
        });
        this.locator = locator;
    }

    /**
     * The folder set the L4 edge checks search. Without an injected locator the
     * corpus is assumed to be the checked task's own directory.
     */
    private locatorFor(tasksDir: string): TaskLocator {
        return this.locator ?? TaskLocator.forSingleDir(this.fs, tasksDir);
    }

    /**
     * Human-readable rendering of the folders an edge check actually searched, so a
     * "not found" finding names the real search scope rather than one directory.
     */
    private searchedFolders(tasksDir: string): string {
        return this.locatorFor(tasksDir).folderDirs().join(', ');
    }

    /** Run the four-layer validation against a task file. */
    async check(
        filePath: string,
        wbs: string,
        options?: { strict?: boolean; severityOverrides?: Record<string, 'error' | 'warning' | 'off'> },
    ): Promise<CheckResult> {
        const strict = options?.strict === true;
        const raw = await this.fs.readFile(filePath);
        const findings: CheckFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, wbs, findings);
        if (doc === null) {
            return { wbs, ...this.summarizeWithStatus('', findings, strict, options?.severityOverrides) };
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        // The template variant is the unified section-layout axis (§3.2); `template`
        // frontmatter selects it, defaulting to `default`. (`type` is the orthogonal
        // task/brainstorm corpus-compat field, not the matrix key.)
        const variant = (fm.template as string) ?? DEFAULT_TASK_VARIANT;
        const entry = this.resolveMatrixEntry(variant, status);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings);

        // ── L3: Format rules (warning-first, 3 hard-core) ──
        this.runL3(doc, entry, status, findings);
        // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage
        const tasksDir = dirname(filePath);
        const featuresDir = join(dirname(tasksDir), 'features');
        await this.runL4(doc, fm, status, findings, featuresDir, tasksDir, wbs);

        // ── L4 roll-up (0121, R1–R3): parent↔child status drift + roster presence.
        // Inert unless one or more sibling tasks declare parent_wbs == this wbs.
        await this.runL4Rollup(doc, wbs, status, findings, tasksDir);

        // ── L4 readiness (0211/R4): dependencies and gate-like prose are prerequisites.
        // Terminal tasks are completion records, not readiness candidates.
        if (status !== 'done' && status !== 'cancelled') {
            await this.runL4Readiness(doc, fm, wbs, status, findings, tasksDir);
        }

        return { wbs, ...this.summarizeWithStatus(status, findings, strict, options?.severityOverrides) };
    }

    // ── L3: Format rules ──
    private runL3(
        doc: MarkdownDocument,
        entry: MatrixEntry | undefined,
        status: string,
        findings: CheckFindings[],
    ): void {
        // ── Task 0339 (R3): a placeholder-only body (HTML comments, `> TBD`,
        // whitespace) means the task has no real requirements or contract — fail
        // before format rules run. Fires only when the section heading exists;
        // a missing section is L2's job (matrix-driven presence). L2 drives
        // presence, this drives substance.
        const reqBodyRaw = doc.getSection('Requirements');
        if (reqBodyRaw !== null && isPlaceholderBody(reqBodyRaw)) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_REQUIREMENTS_EMPTY,
                severity: 'error',
                section: 'Requirements',
                message: 'Requirements is placeholder-only — a task with no requirements is unverifiable',
            });
        }
        const acBodyRaw = doc.getSection('Acceptance Criteria');
        if (acBodyRaw !== null && isPlaceholderBody(stripAcFence(acBodyRaw))) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_AC_EMPTY,
                severity: 'error',
                section: 'Acceptance Criteria',
                message: 'Acceptance Criteria is placeholder-only — populate with real scenarios',
            });
        }
        // Requirements: R-numbering (warning, only when section has real content)
        const reqBody = doc.getSection('Requirements');
        if (reqBody !== null && !isPlaceholderBody(reqBody)) {
            // Split into blocks by blank lines. Each block is a candidate requirement
            // item. A block whose first line is R-numbered counts as numbered. This is
            // line-count tolerant: multi-line R-item bodies (continuation lines, detail
            // paragraphs) don't dilute the ratio the way per-line counting does, so a
            // well-structured Requirements section with multi-paragraph R-items doesn't
            // false-positive (the 0174 dogfood bug).
            const blocks = reqBody
                .trim()
                .split(/\n\s*\n/)
                .filter((b) => b.trim().length > 0);
            let numbered = 0;
            for (const block of blocks) {
                const firstLine = block.trimStart().split('\n')[0] ?? '';
                // Accept an optional list-bullet prefix, an optional task-list checkbox,
                // and optional bold/italic emphasis around the R-number:
                // "- [ ] R1. …" / "- R1. …" / "* R1. …" / "R1. …" / "- [ ] **R1.** …".
                // Emphasis is a natural way to write R-items and was previously rejected,
                // so a correctly-structured Requirements section warned for a cosmetic reason.
                if (/^\s*[-*]?\s*(?:\[[ xX]\]\s*)?[*_]{0,2}R\d+\.?[*_]{0,2}\s/.test(firstLine)) {
                    numbered++;
                }
            }
            if (numbered === 0 || numbered < blocks.length * 0.5) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_REQUIREMENTS_FORMAT,
                    severity: 'warning',
                    section: 'Requirements',
                    message: 'Requirements should use R-numbered items (R1., R2., …) — got ~50% or fewer',
                });
            }
        }

        // Requirements ↔ Acceptance Criteria coverage, opt-in via `ac_numbering: task-local`.
        //
        // WHY GATED: DD-09 (L4) compares a task's AC to its FEATURE's AC; nothing compared
        // a task's AC to its OWN Requirements, so a requirement could carry zero scenarios
        // and every gate stayed green — how task 0465 shipped refined R1–R5 beside stale AC
        // covering only R1–R2, leaving its highest-risk requirement untested and one
        // scenario demanding behavior its requirement had explicitly deferred.
        //
        // It cannot run unconditionally. An audit of 117 task files found three coexisting
        // conventions: 43 tasks copy AC verbatim from the feature and carry the FEATURE's
        // R-numbers (Requirements R1–R5 beside `Scenario: R6` is correct there), 29 number
        // locally, and 38 use no R-ids at all. Ungated, this fires on nearly every task and
        // trains everyone to ignore L3. So it runs only where the task declares the
        // namespace. Opting a legacy task in is a pure prefix renumber — `normalizeTitle`
        // strips `R\d+` before matching, so feature traceability cannot see it.
        const acBodyForCoverage = doc.getSection('Acceptance Criteria');
        if (
            doc.frontmatterData?.ac_numbering === 'task-local' &&
            reqBody !== null &&
            !isPlaceholderBody(reqBody) &&
            acBodyForCoverage !== null &&
            !isPlaceholderBody(stripAcFence(acBodyForCoverage))
        ) {
            const reqIds = new Set<string>();
            for (const line of reqBody.split('\n')) {
                const m = /^\s*[-*]?\s*(?:\[[ xX]\]\s*)?R(\d+)\.?\s/.exec(line);
                if (m?.[1] !== undefined) reqIds.add(m[1]);
            }
            const acIds = new Set<string>();
            let scenarioCount = 0;
            for (const line of stripAcFence(acBodyForCoverage).split('\n')) {
                const s = /^\s*Scenario(?:\s+Outline)?:\s*(.*)$/.exec(line);
                if (s === null) continue;
                scenarioCount++;
                const id = /^R(\d+)\b/.exec((s[1] ?? '').trim());
                if (id?.[1] !== undefined) acIds.add(id[1]);
            }
            const byNumber = (a: string, b: string): number => Number(a) - Number(b);
            if (reqIds.size > 0 && scenarioCount > 0 && acIds.size === 0) {
                // Declared task-local but nothing binds to it — the third legacy convention.
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE,
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    message:
                        'ac_numbering is task-local but no scenario is R-numbered — prefix each scenario with the requirement it covers (Scenario: R1 — …)',
                });
            } else if (reqIds.size > 0 && acIds.size > 0) {
                const uncovered = [...reqIds].filter((id) => !acIds.has(id)).sort(byNumber);
                const stale = [...acIds].filter((id) => !reqIds.has(id)).sort(byNumber);
                if (uncovered.length > 0) {
                    findings.push({
                        layer: 'L3',
                        code: FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE,
                        severity: 'warning',
                        section: 'Acceptance Criteria',
                        message: `Requirements with no Acceptance Criteria scenario: ${uncovered
                            .map((id) => `R${id}`)
                            .join(', ')} — add a scenario or drop the requirement`,
                    });
                }
                if (stale.length > 0) {
                    findings.push({
                        layer: 'L3',
                        code: FINDING_CODES.L3_AC_REQUIREMENT_COVERAGE,
                        severity: 'warning',
                        section: 'Acceptance Criteria',
                        message: `Acceptance Criteria scenarios cite requirements that do not exist: ${stale
                            .map((id) => `R${id}`)
                            .join(', ')} — the AC is stale relative to Requirements`,
                    });
                }
            }
        }

        // Solution: ≥1 file:line citation (hard core). Only meaningful once the
        // section has real content — an empty heading or guidance-comment-only
        // placeholder (present at todo/wip before implementation) is skipped, so
        // a not-yet-implemented task is not forced to cite lines that don't exist.
        const solBody = doc.getSection('Solution');
        if (solBody !== null && !isPlaceholderBody(solBody) && !hasSolutionFileLineCitation(solBody)) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_SOLUTION_FILE_LINE,
                severity: 'error',
                section: 'Solution',
                message: 'Solution must contain at least one `file:line` citation',
            });
        }

        // Review: P1–P4 findings table (hard core). Only fires when Review is
        // *allowed* at the current status (required or optional) — a forward-reference
        // scaffold at a status where Review is forbidden/absent is not forced to have
        // a populated table (L2 already flags the section itself).
        //
        // Where Review is *optional* (pre-fix-round window): both the empty-cell
        // scaffold (shipped template) AND prose-only bodies with no table are tolerated
        // — either is a legitimate "not yet authored" state. Where Review is *required*
        // (wip+): only a truly-empty placeholder is tolerated; any authored content
        // (prose or scaffold) requires a populated findings table.
        const revBody = doc.getSection('Review');
        const revRequired = (entry?.required ?? []).includes('Review');
        const revAllowed = revRequired || (entry?.optional ?? []).includes('Review');
        const revScaffoldTolerated = revRequired
            ? isPlaceholderBody(revBody ?? '')
            : isReviewScaffold(revBody ?? '') || isProseOnlyReview(revBody ?? '');
        if (revBody !== null && !revScaffoldTolerated && revAllowed) {
            if (!hasPopulatedPriorityTable(revBody)) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_REVIEW_PRIORITY_TABLE,
                    severity: 'error',
                    section: 'Review',
                    message: 'Review must contain P1–P4 priority findings table',
                });
            }
        }

        // A status-required section that is still the shipped scaffold is not "nothing to
        // validate" — it is an unfilled obligation. Every other L3 content rule here skips
        // placeholders (correctly: at `todo`/`wip` an empty Testing is the normal state), which
        // left a hole at the far end: a task could reach `done` carrying the verbatim
        // `<!-- Filled during verification: … -->` scaffold and every Testing rule would decline
        // to look at it. Feature H8's four tasks did exactly that.
        //
        // The `record` step (`spur task record`) is what normally fills Testing from the verdict
        // artifact, so the gap opens whenever a task is driven outside the pipeline — which is the
        // common case when `agent.run` is unavailable. Matrix-keyed rather than status-hardcoded:
        // it fires only where the section-matrix already declares the section required, so a `wip`
        // task with an empty Testing stays clean and the rule tracks the matrix if it changes.
        //
        // Same shape as L3.requirements-empty / L3.ac-empty, and an error for the same reason:
        // `testing → done` is gated by `spur task check --strict-core`, so this blocks the
        // transition until the section is filled instead of discovering it months later.
        const requiredSections = new Set(entry?.required ?? []);
        for (const sectionName of ['Testing', 'Solution'] as const) {
            if (!requiredSections.has(sectionName)) continue;
            const body = doc.getSection(sectionName);
            if (body === null || !isPlaceholderBody(body)) continue;
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_REQUIRED_SECTION_PLACEHOLDER,
                severity: 'error',
                section: sectionName,
                message: `${sectionName} is required at status '${status}' but is still placeholder-only — run \`spur task record <wbs>\` to fill it from the verdict artifact, or author it directly`,
            });
        }

        // Testing: results + coverage claim or N/A (warning)
        const testBody = doc.getSection('Testing');
        if (testBody !== null && !isPlaceholderBody(testBody)) {
            const hasCoverage = /coverage|≥\d+%|\d+\.\d+%|N\/A/i.test(testBody);
            if (!hasCoverage) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_TESTING_COVERAGE,
                    severity: 'warning',
                    section: 'Testing',
                    message: 'Testing should include numeric coverage claim or N/A',
                });
            }
        }

        // Note: L4.stale-line-anchor for Testing/Solution file:line citations runs in runL4
        // (needs tasksDir → project root resolution).

        // Plan: ordered checklist or table, not free-form prose (warning)
        const planBody = doc.getSection('Plan');
        if (planBody !== null && !isPlaceholderBody(planBody)) {
            const isList = /^\s*[-*]\s|^\s*\d+\.\s/m.test(planBody);
            const isTable = /\|/.test(planBody);
            if (!isList && !isTable) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_PLAN_FORMAT,
                    severity: 'warning',
                    section: 'Plan',
                    message: 'Plan should be ordered checklist or table, not free-form prose',
                });
            }
        }

        // Terminal-status open checkboxes (0182 R7-optional): a `done`/`cancelled` task
        // should carry zero unchecked `- [ ] ` boxes anywhere in its body — an open box
        // on closed work means the reader can't tell "done" from "abandoned" by the
        // boxes alone. Warning only (never error): a task can be legitimately closed
        // with an intentionally-unchecked box (e.g. a deferred sub-item noted in prose).
        // Gated strictly on terminal status so it never fires on a roster-bearing
        // umbrella/tracking parent still in progress (todo/wip) — the 0176 roster
        // pattern's Plan is expected to carry open boxes until every child lands.
        if (status === 'done' || status === 'cancelled') {
            const fullBody = doc.bodyWithoutFrontmatter;
            const openBoxes = (fullBody.match(/^\s*[-*]\s\[ \]\s/gm) ?? []).length;
            if (openBoxes > 0) {
                findings.push({
                    layer: 'L3',
                    code: FINDING_CODES.L3_UNCHECKED_CHECKLIST,
                    severity: 'warning',
                    section: '',
                    message: `Task is ${status} but carries ${openBoxes} unchecked checklist box(es) — flip to [x] or remove before closing`,
                });
            }
        }
    }

    // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage ──
    private async runL4(
        doc: MarkdownDocument,
        fm: Record<string, unknown>,
        status: string,
        findings: CheckFindings[],
        featuresDir: string,
        tasksDir: string,
        wbs: string,
    ): Promise<void> {
        // ── R1: Done-gate verdict artifact check (testing/done status) ──
        if (status === 'testing' || status === 'done') {
            await this.checkVerdictArtifact(wbs, tasksDir, findings);
        }

        // ── R4 (task 0294): Design placeholder warning ──
        // Standard tasks retain Design as historical intent after it stops being
        // status-required at `testing`/`done`. Key this content warning to the
        // template, not the current matrix entry, so an empty scaffold cannot
        // become silent merely because the task advanced. L2 remains responsible
        // for a missing required heading; this warning only covers a present but
        // empty / HTML-comment-only / `> TBD` body.
        const template = typeof fm.template === 'string' ? fm.template : DEFAULT_TASK_VARIANT;
        if (template === DEFAULT_TASK_VARIANT) {
            const designBody = doc.getSection('Design');
            if (designBody !== null && isPlaceholderBody(designBody)) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_DESIGN_PLACEHOLDER,
                    severity: 'warning',
                    section: 'Design',
                    message:
                        'Design section is present but empty (placeholder-only) — populate it so the task retains an explicit implementation approach',
                });
            }
        }

        // ── Stale file:line anchors in Testing / Solution (dogfood F81 P2) ──
        // Re-check backtick citations ``path:line`` / ``path:start-end`` against
        // the working tree: file must exist and the line number must fall within
        // the file. Warning-only (L4) — does not block done unless elevated.
        await this.checkLineAnchors(doc, tasksDir, findings);

        // Resolve feature_id from either snake_case or legacy kebab-case key.
        const featureId = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
        const parentWbs = (fm.parent_wbs as string | undefined) ?? (fm['parent-wbs'] as string | undefined);
        const deps = fm.dependencies as string[] | undefined;

        // ── feature_id edge ──
        if (featureId && featureId.length > 0) {
            const featurePath = await this.findFeatureFile(featuresDir, featureId);
            if (featurePath === null) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_FEATURE_NOT_FOUND,
                    severity: 'warning',
                    section: '',
                    message: `Feature "${featureId}" not found in ${featuresDir}`,
                });
            } else {
                const featureStatus = await this.readFeatureStatus(featurePath);
                // Task 0339 (R1/R2): a terminal task under a terminal feature is the
                // correct end state — flag only when the task itself is still live
                // (backlog/todo/wip/testing/blocked), since that genuinely needs re-parenting.
                const featureTerminal = featureStatus === 'done' || featureStatus === 'cancelled';
                const taskTerminal = status === 'done' || status === 'cancelled';
                if (featureTerminal && !taskTerminal) {
                    const reopenGuide =
                        featureStatus === 'done'
                            ? `Reopen: \`spur feature update ${featureId} active\` (or \`spur feature sync ${featureId} --force\` when non-terminal tasks are already linked). Alternatively re-parent: \`spur task update <wbs> --feature <otherId>\`.`
                            : `Feature is cancelled — re-parent or unlink this live task (\`spur task update <wbs> --feature <otherId>\`).`;
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_FEATURE_TERMINAL,
                        severity: 'error',
                        section: '',
                        message: `Feature "${featureId}" is ${featureStatus} — live tasks cannot stay linked without action. ${reopenGuide}`,
                    });
                }
                // ── AC coverage (R1, DD-09): task AC ⊆ linked feature AC ──
                // Declared altitude (task 0584 R3): `task-local` skips the subset
                // rule; absent/`graduating` enforces it. Field-only — never inferred.
                const acAltitude = fm.ac_altitude as 'graduating' | 'task-local' | undefined;
                await this.checkAcCoverage(doc, featurePath, featureId, acAltitude, findings);
            }
        } else {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_MISSING_FEATURE_ID,
                severity: 'warning',
                section: '',
                message:
                    'Missing feature_id — every task should reference a feature (one direction, DD-07). To link: `spur task update <wbs> --feature <id>`, or use the sp:spur-dev feature-link helper.',
            });
        }

        // ── parent_wbs edge ──
        if (parentWbs && parentWbs.length > 0) {
            const parentPath = await this.findTaskFile(tasksDir, parentWbs);
            if (parentPath === null) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_PARENT_NOT_FOUND,
                    severity: 'warning',
                    section: '',
                    message: `Parent task ${parentWbs} not found in ${this.searchedFolders(tasksDir)}`,
                });
            }
        }

        // ── dependency edges ──
        if (deps && deps.length > 0) {
            for (const dep of deps) {
                // Dependencies can be WBS numbers ("0001") or WBS+name strings ("0001: some desc")
                const wbsMatch = /^(\d{4})/.exec(dep.trim());
                if (wbsMatch) {
                    const depWbs = wbsMatch[1];
                    if (!depWbs) continue;
                    const depPath = await this.findTaskFile(tasksDir, depWbs);
                    if (depPath === null) {
                        findings.push({
                            layer: 'L4',
                            code: FINDING_CODES.L4_DEPENDENCY_NOT_FOUND,
                            severity: 'warning',
                            section: '',
                            message: `Dependency "${dep}" not found in ${this.searchedFolders(tasksDir)}`,
                        });
                    }
                }
            }
        }
    }

    /**
     * L4 roll-up (0121): a task that is a decomposition parent — one or more
     * sibling tasks whose `parent_wbs` points at it — has its parent↔child
     * status relationship validated. Three advisory (warning) findings:
     *
     *  1. parent `done` while a kid is not `done`/`cancelled` (R1, drift down);
     *  2. all kids `done`/`cancelled` while the parent is still open (R1, drift up);
     *  3. parent `## Plan` carries no sub-task roster table (R2, the 0109 omission).
     *
     * Severity is `warning`; `--strict` elevates per the shared base. Inert for a
     * task with zero kids (R3) — the dir scan finds nothing and returns early.
     *
     * NOTE (0121 design correction): L4 does NOT pre-load the corpus — `check()` is
     * invoked per-task and resolves the *current* task's edges by reading individual
     * files. Finding kids therefore requires one `readDir` + frontmatter scan of
     * the tasks dir here; it cannot "reuse the same pass" as the Design assumed. The
     * scan is O(n) over the tasks dir, once per check, and short-circuits when no
     * kid references this wbs.
     */
    private async runL4Rollup(
        doc: MarkdownDocument,
        wbs: string,
        status: string,
        findings: CheckFindings[],
        tasksDir: string,
    ): Promise<void> {
        const kids = await this.findChildren(tasksDir, wbs);
        if (kids.length === 0) return; // not a parent — inert (R3)

        const closed = (s: string): boolean => s === 'done' || s === 'cancelled';
        const parentClosed = closed(status);
        const openKids = kids.filter((c) => !closed(c.status));

        // R1a: parent done/cancelled but a kid is still open.
        if (parentClosed && openKids.length > 0) {
            const list = openKids.map((c) => c.wbs).join(', ');
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ROLLUP_SUBTASKS_OPEN,
                severity: 'warning',
                section: '',
                message: `Parent is ${status} but sub-task(s) still open: ${list} — close or re-parent them`,
            });
        }

        // R1b: every kid closed but the parent is still open.
        if (!parentClosed && openKids.length === 0) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ROLLUP_PARENT_OPEN,
                severity: 'warning',
                section: '',
                message: `All ${kids.length} sub-task(s) are done/cancelled but parent is still ${status} — close the parent`,
            });
        }

        // R2: parent has kids but no sub-task roster in its Plan (the 0109 gap).
        const planBody = doc.getSection('Plan') ?? '';
        if (!this.hasSubtaskRoster(planBody, kids)) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_ROLLUP_MISSING_ROSTER,
                severity: 'warning',
                section: 'Plan',
                message: 'Parent task has sub-tasks but its Plan has no sub-task roster (decomposition.md)',
            });
        }
    }

    /**
     * A Plan body counts as carrying a sub-task roster when it references at least
     * one sub-task WBS inside a markdown table. Heuristic, intentionally permissive
     * (warning, not error): a table row mentioning a real sub-task WBS is the roster
     * signal — a bare prose Plan or a checklist without WBS refs is not.
     */
    private hasSubtaskRoster(planBody: string, kids: { wbs: string }[]): boolean {
        if (!/\|/.test(planBody)) return false; // no table at all
        return kids.some((c) => planBody.includes(c.wbs));
    }

    private async runL4Readiness(
        doc: MarkdownDocument,
        fm: Record<string, unknown>,
        wbs: string,
        status: string,
        findings: CheckFindings[],
        tasksDir: string,
    ): Promise<void> {
        if (status === 'blocked') {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_READINESS_BLOCKED,
                severity: 'warning',
                section: '',
                message: `Task ${wbs} is blocked — readiness is false until the blocker is resolved or explicitly forced`,
            });
        }

        const declaredDeps = this.extractDependencyWbs(fm.dependencies);
        const proseDeps = this.extractProsePrerequisites(doc);
        for (const dep of proseDeps) {
            if (!declaredDeps.includes(dep.wbs)) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_PROSE_PREREQUISITE_UNLISTED,
                    severity: 'warning',
                    section: dep.section,
                    message: `Prose prerequisite ${dep.wbs} is not mirrored in frontmatter dependencies[]`,
                });
            }
        }

        const declaredSet = new Set(declaredDeps);
        const directDeps = [...new Set([...declaredDeps, ...proseDeps.map((d) => d.wbs)])].filter((dep) => dep !== wbs);
        for (const depWbs of directDeps) {
            // R3: a prose-inferred seed edge never closes a prerequisite-cycle — only a
            // frontmatter dependencies[] edge can. proseSeeded marks the path's origin.
            const proseSeeded = !declaredSet.has(depWbs);
            await this.checkDependencyReadiness(depWbs, wbs, findings, tasksDir, new Set([wbs]), false, proseSeeded);
        }

        this.checkGateLanguage(doc, findings);
    }

    private extractDependencyWbs(raw: unknown): string[] {
        if (!Array.isArray(raw)) return [];
        const deps: string[] = [];
        for (const item of raw) {
            if (typeof item !== 'string') continue;
            const match = /^(\d{4})/.exec(item.trim());
            if (match?.[1] !== undefined) deps.push(match[1]);
        }
        return deps;
    }

    /**
     * Infer prerequisite WBS values from prose. Frozen rule (task 0475): a strong-verb
     * keyword must *precede* the WBS within a bounded same-sentence window, list
     * continuation captures the "tasks X and Y" form, and non-assertive text (fenced
     * code blocks, table rows, inline code spans) is excluded — quoted or illustrative
     * dependency language does not assert an edge.
     */
    private extractProsePrerequisites(doc: MarkdownDocument): { wbs: string; section: string }[] {
        const refs: { wbs: string; section: string }[] = [];
        // Ordered, sentence-bounded adjacency: keyword precedes the WBS within 40 chars,
        // with no sentence boundary (. or ;) between them.
        const headRe = /(?:depends on|depends upon|gated on|blocked by|waiting for)\b[^.;\n]{0,40}?\b(\d{4})\b/gi;
        // List continuation after a head match: ", 0003" / "and 0003" / "and tasks 0003".
        const listRe = /\s*(?:,|and)\s*(?:tasks?\s+)?(\d{4})\b/gi;
        for (const section of ['Background', 'Requirements', 'Design', 'Acceptance Criteria', 'Plan']) {
            const body = doc.getSection(section);
            if (body === null) continue;
            let inFence = false;
            for (const line of body.split('\n')) {
                // R2: fenced code blocks toggle on ``` and are skipped entirely.
                if (/^\s*```/.test(line)) {
                    inFence = !inFence;
                    continue;
                }
                if (inFence) continue;
                // R2: markdown table rows quote/illustrate rather than assert.
                if (/^\s*\|/.test(line)) continue;
                // R2: blank inline code spans before matching (backtick examples, finding output).
                const cleaned = line.replace(/`[^`]*`/g, ' ');
                headRe.lastIndex = 0;
                for (let head = headRe.exec(cleaned); head !== null; head = headRe.exec(cleaned)) {
                    const wbs = head[1];
                    if (wbs !== undefined) refs.push({ wbs, section });
                    // Consume any continuation list immediately after the head match.
                    listRe.lastIndex = headRe.lastIndex;
                    for (let cont = listRe.exec(cleaned); cont !== null; cont = listRe.exec(cleaned)) {
                        const cw = cont[1];
                        if (cw !== undefined) refs.push({ wbs: cw, section });
                    }
                }
            }
        }
        return refs;
    }

    private async checkDependencyReadiness(
        depWbs: string,
        rootWbs: string,
        findings: CheckFindings[],
        tasksDir: string,
        seen: Set<string>,
        transitive: boolean,
        proseSeeded = false,
    ): Promise<void> {
        if (seen.has(depWbs)) {
            // R3: report a cycle only when it rests on at least one frontmatter
            // dependencies[] edge. A loop reached solely through a prose-inferred seed
            // edge is a parser artifact, not a corpus defect.
            if (!proseSeeded) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_PREREQUISITE_CYCLE,
                    severity: 'warning',
                    section: '',
                    message: `Prerequisite cycle detected while checking ${rootWbs}: ${[...seen, depWbs].join(' -> ')}`,
                });
            }
            return;
        }

        const dep = await this.readTaskSnapshot(tasksDir, depWbs);
        if (dep === null) return;

        if (dep.status !== 'done') {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_PREREQUISITE_NOT_DONE,
                severity: 'warning',
                section: '',
                message: `${transitive ? 'Transitive prerequisite' : 'Prerequisite'} ${depWbs} is ${dep.status}; task ${rootWbs} is not ready until it is done`,
            });
        }

        const nextSeen = new Set(seen);
        nextSeen.add(depWbs);
        for (const childDep of dep.dependencies) {
            await this.checkDependencyReadiness(childDep, rootWbs, findings, tasksDir, nextSeen, true, proseSeeded);
        }
    }

    private checkGateLanguage(doc: MarkdownDocument, findings: CheckFindings[]): void {
        for (const section of ['Background', 'Requirements', 'Design', 'Acceptance Criteria', 'Plan']) {
            const body = doc.getSection(section);
            if (body === null) continue;
            if (
                /\b(HITL|human[- ]in[- ]the[- ]loop|approval|approved|merge event|merged|content-gate|GATED|capstone)\b/i.test(
                    body,
                )
            ) {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_GATE_LANGUAGE,
                    severity: 'warning',
                    section,
                    message: `${section} contains gate language; model the gate as a frontmatter dependency or verify it before treating the task as ready`,
                });
            }
        }
    }

    private async readTaskSnapshot(tasksDir: string, wbs: string): Promise<TaskSnapshot | null> {
        const path = await this.findTaskFile(tasksDir, wbs);
        if (path === null) return null;
        try {
            const raw = await this.fs.readFile(path);
            const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
            return {
                wbs,
                status: (fm.status as string | undefined) ?? 'backlog',
                dependencies: this.extractDependencyWbs(fm.dependencies),
            };
        } catch {
            return null;
        }
    }

    /**
     * Validate backtick `path:line` / `path:start-end` citations in Testing and
     * Solution against the working tree. Emits L4.stale-line-anchor warnings when
     * the file is missing or the line is out of range (dogfood F81 P2).
     *
     * Caps findings per section to 5 so a heavily-cited section does not flood
     * the report. Subject-name matching (line content names the R-item) stays an
     * agent re-verify responsibility — this gate is existence + bounds only.
     */
    private async checkLineAnchors(doc: MarkdownDocument, tasksDir: string, findings: CheckFindings[]): Promise<void> {
        const projectRoot = resolveProjectRootFromTasksDir(tasksDir);
        for (const section of ['Testing', 'Solution'] as const) {
            const body = doc.getSection(section);
            if (body === null || isPlaceholderBody(body)) continue; // External-evidence form (task 0584 R1): a named origin + backticked
            // path + line number OUTSIDE the backticks is evidence that lives
            // outside this repo — never a repo-root anchor, never stale. R2: a
            // citation whose basename resolves uniquely inside this repo is NOT
            // eligible for the external form — it is in-repo evidence and must
            // use a repo-relative anchor; the external form still reports.
            const external = classifyExternalEvidence(body);
            let reported = 0;
            if (external.length > 0) {
                const uniqueInRepo = await this.uniqueRepoBasenames(projectRoot, external);
                for (const e of external) {
                    if (reported >= 5) break;
                    // Only THIS citation resolving uniquely in-repo disqualifies it.
                    if (!uniqueInRepo.has(basename(e.path).toLowerCase())) continue;
                    reported++;
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_STALE_LINE_ANCHOR,
                        severity: 'warning',
                        section,
                        message: `External evidence form used for in-repo path \`${e.path}\` (origin ${e.origin}, line ${e.startLine}) — resolve it repo-relative instead (task 0584 R2)`,
                    });
                }
            }
            const citations = extractBacktickLineAnchors(body);
            for (const cite of citations) {
                if (reported >= 5) break;
                const abs = join(projectRoot, cite.path);
                let exists = false;
                try {
                    exists = await this.fs.exists(abs);
                } catch {
                    exists = false;
                }
                if (!exists) {
                    findings.push({
                        layer: 'L4',
                        code: FINDING_CODES.L4_STALE_LINE_ANCHOR,
                        severity: 'warning',
                        section,
                        message: `Stale line anchor \`${cite.raw}\` — file not found at ${cite.path} (from project root)`,
                    });
                    reported++;
                    continue;
                }
                // Line-count bounds: only when we can cheaply read the file.
                try {
                    const raw = await this.fs.readFile(abs);
                    const lineCount = raw.split('\n').length;
                    const end = cite.endLine ?? cite.startLine;
                    if (cite.startLine < 1 || end > lineCount) {
                        findings.push({
                            layer: 'L4',
                            code: FINDING_CODES.L4_STALE_LINE_ANCHOR,
                            severity: 'warning',
                            section,
                            message: `Stale line anchor \`${cite.raw}\` — line ${cite.startLine}${cite.endLine ? `-${cite.endLine}` : ''} outside file (${lineCount} lines)`,
                        });
                        reported++;
                    } else {
                        // R4/R5 (task 0583): subject matching — the cited lines must
                        // name the requirement/AC row's subject. Extract subject tokens
                        // from the citing row (the line that carries this citation) and
                        // require one to appear in the cited window. Warning until the
                        // R1 qualification pass has landed (severity-override promotes).
                        const rawLow = raw.toLowerCase();
                        const basename = cite.path.split('/').pop() ?? '';
                        const citedWindow =
                            (raw
                                .split('\n')
                                .slice(cite.startLine - 1, cite.endLine ?? cite.startLine)
                                .join('\n') || '') + (rawLow.includes(basename.toLowerCase()) ? ` ${basename}` : '');
                        const citingRow =
                            body.split('\n').find((l) => l.includes(`\`${cite.raw}\``)) ??
                            body.split('\n').find((l) => l.includes(cite.raw)) ??
                            '';
                        const tokens = extractSubjectTokens(citingRow, cite.raw);
                        if (!citedLinesNameSubject(tokens, citedWindow)) {
                            findings.push({
                                layer: 'L4',
                                code: FINDING_CODES.L4_ANCHOR_SUBJECT_MISMATCH,
                                severity: 'warning',
                                section,
                                message: `Anchor \`${cite.raw}\` subject mismatch — cited lines do not name the requirement's subject (${tokens.join(', ') || 'none identifiable'}). Rewrite the citation to point at the code that implements this row.`,
                            });
                            reported++;
                        }
                    }
                } catch {
                    // Unreadable — skip bounds; existence already passed.
                }
            }
        }
    }

    /**
     * R2 (task 0584): true when any external-form citation's basename resolves
     * uniquely inside this repo — i.e. exactly one file in the tree (excluding
     * gitignored/build/generated surfaces) shares the basename. Unique resolution
     * means the citation is in-repo evidence, so the external form is ineligible.
     */
    /**
     * Basenames from `external` that resolve to EXACTLY ONE file in the repo.
     *
     * Per-citation, deliberately: an earlier shape answered a single boolean for the
     * whole set, so one in-repo basename flagged every external citation in the
     * section — each with a message naming ITS path as in-repo, which was false for
     * all but one. One tree walk still serves the whole set.
     */
    private async uniqueRepoBasenames(projectRoot: string, external: Array<{ path: string }>): Promise<Set<string>> {
        const toMatch = new Set(external.map((e) => basename(e.path).toLowerCase()).filter(Boolean));
        if (toMatch.size === 0) return new Set();
        const counts = new Map<string, number>();
        const stack = [projectRoot];
        while (stack.length > 0) {
            const dir = stack.pop();
            if (!dir) continue;
            if (/\.spur$/.test(dir) || /(^|\/)(node_modules|\.git|dist|build|coverage)(\/|$)/.test(dir)) continue;
            let entries: string[];
            try {
                entries = await this.fs.readDir(dir);
            } catch {
                continue;
            }
            for (const name of entries) {
                const lower = name.toLowerCase();
                if (toMatch.has(lower)) {
                    counts.set(lower, (counts.get(lower) ?? 0) + 1);
                    continue;
                }
                try {
                    const abs = join(dir, name);
                    const stat = await this.fs.stat(abs);
                    if (
                        stat !== null &&
                        stat !== undefined &&
                        (stat as { isDirectory?: () => boolean }).isDirectory?.()
                    )
                        stack.push(abs);
                } catch {
                    // unreadable entry — skip
                }
            }
        }
        return new Set([...counts].filter(([, n]) => n === 1).map(([k]) => k));
    }

    /**
     * Scan the tasks dir for sibling tasks whose `parent_wbs` resolves to `wbs`.
     * Returns each sub-task's wbs + status. Self-referential and malformed files are
     * skipped; a missing/unreadable dir yields no sub-tasks (the check stays inert).
     */
    private async findChildren(tasksDir: string, wbs: string): Promise<{ wbs: string; status: string }[]> {
        const kids: { wbs: string; status: string }[] = [];
        for (const dir of this.locatorFor(tasksDir).folderDirs()) {
            let entries: string[];
            try {
                entries = await this.fs.readDir(dir);
            } catch {
                continue; // folder may not exist yet
            }
            for (const name of entries) {
                const m = /^(\d{4})_.+\.md$/.exec(name);
                if (m === null) continue;
                const kidWbs = m[1];
                if (kidWbs === undefined || kidWbs === wbs) continue; // skip self
                try {
                    const raw = await this.fs.readFile(`${dir}/${name}`);
                    const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
                    const parent = (fm.parent_wbs as string | undefined) ?? (fm['parent-wbs'] as string | undefined);
                    if (parent !== wbs) continue;
                    kids.push({ wbs: kidWbs, status: (fm.status as string) ?? 'backlog' });
                } catch {
                    // Unreadable/malformed sibling — skip; it surfaces under its own check.
                }
            }
        }
        return kids;
    }

    /** Find a feature file by ID (filename prefix match: `{id}_`). */
    private async findFeatureFile(featuresDir: string, id: string): Promise<string | null> {
        try {
            const entries = await this.fs.readDir(featuresDir);
            for (const name of entries) {
                if (name.startsWith(`${id}_`) && name.endsWith('.md')) {
                    return `${featuresDir}/${name}`;
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
        return null;
    }

    /**
     * AC coverage (L4, DD-09): every task scenario must map to a feature scenario
     * by normalized title (subset rule). Uncovered task scenarios are warnings by
     * default (C04: errors only if the hard core elevates; `--strict` does that).
     * Uses the shared 0043 `checkAcCoverage` — never a private matcher.
     * Declared `ac_altitude: task-local` (task 0584 / ADR-062) skips the subset
     * rule entirely; the field is the only input, never inferred from notation.
     */
    private async checkAcCoverage(
        taskDoc: MarkdownDocument,
        featurePath: string,
        featureId: string,
        acAltitude: 'graduating' | 'task-local' | undefined,
        findings: CheckFindings[],
    ): Promise<void> {
        const taskAc = stripAcFence(taskDoc.getSection('Acceptance Criteria') ?? '');
        if (taskAc.trim().length === 0) return; // no task AC → nothing to cover
        // task-local: criteria sit at a finer altitude than the feature's ship
        // contract — the DD-09 subset rule does not apply (task 0584 R3).
        if (acAltitude === 'task-local') return;

        let featureAc: string;
        let featureTags: string[] = [];
        try {
            const raw = await this.fs.readFile(featurePath);
            const featureDoc = MarkdownDocument.parse(raw, 'feature');
            // DD-09 subset rule is category-wrong for wayfinder maps: a map's AC is
            // destination-level or absent, so comparing task scenarios against it
            // produces noise, not signal (task 0476).
            featureTags = Array.isArray(featureDoc.frontmatterData?.tags)
                ? (featureDoc.frontmatterData.tags as unknown[]).filter((t): t is string => typeof t === 'string')
                : [];
            if (featureTags.includes(WAYFINDER_MAP_TAG)) return;
            featureAc = stripAcFence(featureDoc.getSection('Acceptance Criteria') ?? '');
        } catch {
            return; // feature unreadable — the edge warning above already covered it
        }
        if (featureAc.trim().length === 0) return;

        const taskChecklist = parseChecklist(taskAc);
        const result = checkAcCoverage(featureAc, taskAc, taskChecklist, acAltitude);
        for (const scenario of result.uncovered) {
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_UNCOVERED_TASK_SCENARIO,
                severity: 'warning',
                section: 'Acceptance Criteria',
                message: `Task scenario "${scenario}" is not in feature "${featureId}"'s AC (DD-09 subset rule)`,
            });
        }
    }

    /** Read the status from a feature file's frontmatter. */
    private async readFeatureStatus(featurePath: string): Promise<string | null> {
        try {
            const raw = await this.fs.readFile(featurePath);
            const doc = MarkdownDocument.parse(raw, 'feature');
            const fm = doc.frontmatterData ?? {};
            return (fm.status as string) ?? null;
        } catch {
            return null;
        }
    }

    /** Find a task file by WBS number across every registered task folder. */
    private async findTaskFile(tasksDir: string, wbs: string): Promise<string | null> {
        return await this.locatorFor(tasksDir).findPathByWbs(wbs);
    }

    /**
     * R1 (0479): Done-gate verdict artifact check.
     * Emits L4.malformed-verdict-artifact when status is testing/done and the
     * verdict artifact is UNKNOWN, malformed, or has empty requirements[] and AC[].
     */
    private async checkVerdictArtifact(wbs: string, tasksDir: string, findings: CheckFindings[]): Promise<void> {
        const projectRoot = resolveProjectRootFromTasksDir(tasksDir);
        const runDir = join(projectRoot, '.spur', 'run');
        const loaded = await readGuardVerdictArtifact(this.fs, runDir, wbs);

        if (loaded.artifact === undefined) {
            if (loaded.readError && loaded.readError !== 'artifact is missing') {
                findings.push({
                    layer: 'L4',
                    code: FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
                    severity: 'error',
                    section: 'Testing',
                    message: `Verdict artifact at ${loaded.path} is malformed: ${loaded.readError}`,
                });
            }
            return;
        }

        const artifact = loaded.artifact;
        const reqs = artifact.requirements ?? [];
        const acs = artifact.acceptanceCriteria ?? [];
        const isUnknown = artifact.verdict === 'UNKNOWN';
        const isEmpty = reqs.length === 0 && acs.length === 0;

        if (isUnknown || isEmpty) {
            const reason = isUnknown ? 'verdict is UNKNOWN' : 'requirements and AC are empty';
            findings.push({
                layer: 'L4',
                code: FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
                severity: 'error',
                section: 'Testing',
                message: `Verdict artifact at ${loaded.path} is malformed: ${reason}`,
            });
        }
    }
}
