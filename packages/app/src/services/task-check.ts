/**
 * Task check — four-layer validation per design §3.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Per-section format rules (warning-first; 3 hard-core rules).
 * L4: Traceability (warning-first).
 */

import { dirname, join } from 'node:path';
import {
    checkAcCoverage,
    DEFAULT_TASK_VARIANT,
    MarkdownDocument,
    parseChecklist,
    stripAcFence,
    taskFrontmatterSchema,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    type CheckFindings,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
    type Severity,
} from './planning-check-base';

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
 * A `### Review` body counts as carrying a real findings table only when at least
 * one `P1`–`P4` row has substantive content beyond the severity label itself — i.e.
 * a markdown table row `| P2 | <file> | <finding> | … |` where some non-severity cell
 * is non-empty. The shipped review template scaffolds an *empty-cell* P-table
 * (`| P1 | | | |`); a bare `/P[1-4]/` match falsely accepts that scaffold as a
 * populated table. Requiring a populated cell closes that false-pass so a review
 * task can't reach `wip` with an empty findings table.
 */
function hasPopulatedPriorityTable(body: string): boolean {
    for (const line of body.split('\n')) {
        const cells = line.split('|');
        if (cells.length < 3) continue; // not a table row
        const severityIdx = cells.findIndex((c) => /^\s*P[1-4]\s*$/.test(c));
        if (severityIdx === -1) continue;
        const hasContent = cells.some((c, i) => i !== severityIdx && c.trim().length > 0);
        if (hasContent) return true;
    }
    return false;
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
    // separator, or `| Pn | | | |`) — any real table content disqualifies it.
    let sawEmptyPRow = false;
    for (const line of body.split('\n')) {
        if (!line.includes('|')) continue; // prose line — allowed alongside the scaffold table
        const cells = line.split('|').map((c) => c.trim());
        const isSeparator = cells.every((c) => c === '' || /^:?-+:?$/.test(c));
        const isEmptyPRow = cells.every((c) => c === '' || /^P[1-4]$/.test(c)) && cells.some((c) => /^P[1-4]$/.test(c));
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

// ─── TaskCheckService ───────────────────────────────────────────────────

/** Four-layer task validator (design §3). L1 schema → L2 matrix → L3 format → L4 traceability. */
export class TaskCheckService extends PlanningCheckService {
    constructor(fs: FileSystem, matrix: SectionMatrix) {
        super({
            fs,
            matrix,
            docKind: 'task',
            frontmatterSchema: taskFrontmatterSchema,
            parse: (raw, kind) => MarkdownDocument.parse(raw, kind),
        });
    }

    /** Run the four-layer validation against a task file. */
    async check(filePath: string, wbs: string, options?: { strict?: boolean }): Promise<CheckResult> {
        const strict = options?.strict === true;
        const raw = await this.fs.readFile(filePath);
        const findings: CheckFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, wbs, findings);
        if (doc === null) {
            return { wbs, ...this.summarizeWithStatus('', findings, strict) };
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
        this.runL3(doc, entry, findings);
        // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage
        const tasksDir = dirname(filePath);
        const featuresDir = join(dirname(tasksDir), 'features');
        await this.runL4(doc, fm, findings, featuresDir, tasksDir);

        // ── L4 roll-up (0121, R1–R3): parent↔child status drift + roster presence.
        // Inert unless one or more sibling tasks declare parent_wbs == this wbs.
        await this.runL4Rollup(doc, wbs, status, findings, tasksDir);

        return { wbs, ...this.summarizeWithStatus(status, findings, strict) };
    }

    // ── L3: Format rules ──
    private runL3(doc: MarkdownDocument, entry: MatrixEntry | undefined, findings: CheckFindings[]): void {
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
                // Accept an optional list-bullet prefix and an optional task-list
                // checkbox: "- [ ] R1. …" / "- R1. …" / "* R1. …" / "R1. …".
                if (/^\s*[-*]?\s*(?:\[[ xX]\]\s*)?R\d+\.?\s/.test(firstLine)) {
                    numbered++;
                }
            }
            if (numbered === 0 || numbered < blocks.length * 0.5) {
                findings.push({
                    layer: 'L3',
                    severity: 'warning',
                    section: 'Requirements',
                    message: 'Requirements should use R-numbered items (R1., R2., …) — got ~50% or fewer',
                });
            }
        }

        // Solution: ≥1 file:line citation (hard core). Only meaningful once the
        // section has real content — an empty heading or guidance-comment-only
        // placeholder (present at todo/wip before implementation) is skipped, so
        // a not-yet-implemented task is not forced to cite lines that don't exist.
        const solBody = doc.getSection('Solution');
        if (solBody !== null && !isPlaceholderBody(solBody)) {
            const hasFileLine = /`[^`]+?:\d+(-\d+)?`/.test(solBody) || /[^\s`]\.\w+:\d+/.test(solBody);
            // Also accept markdown table rows where a file path and a line number
            // appear in adjacent columns (e.g. | `src/foo.ts` | 42 | ... |).
            const hasTableFileLine = hasFileLine || hasAdjacentFileLineColumns(solBody);
            if (!hasTableFileLine) {
                findings.push({
                    layer: 'L3',
                    severity: 'error',
                    section: 'Solution',
                    message: 'Solution must contain at least one `file:line` citation',
                });
            }
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
                    severity: 'error',
                    section: 'Review',
                    message: 'Review must contain P1–P4 priority findings table',
                });
            }
        }

        // Testing: results + coverage claim or N/A (warning)
        const testBody = doc.getSection('Testing');
        if (testBody !== null && !isPlaceholderBody(testBody)) {
            const hasCoverage = /coverage|≥\d+%|\d+\.\d+%|N\/A/i.test(testBody);
            if (!hasCoverage) {
                findings.push({
                    layer: 'L3',
                    severity: 'warning',
                    section: 'Testing',
                    message: 'Testing should include numeric coverage claim or N/A',
                });
            }
        }

        // Plan: ordered checklist or table, not free-form prose (warning)
        const planBody = doc.getSection('Plan');
        if (planBody !== null && !isPlaceholderBody(planBody)) {
            const isList = /^\s*[-*]\s|^\s*\d+\.\s/m.test(planBody);
            const isTable = /\|/.test(planBody);
            if (!isList && !isTable) {
                findings.push({
                    layer: 'L3',
                    severity: 'warning',
                    section: 'Plan',
                    message: 'Plan should be ordered checklist or table, not free-form prose',
                });
            }
        }
    }

    // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage ──
    private async runL4(
        doc: MarkdownDocument,
        fm: Record<string, unknown>,
        findings: CheckFindings[],
        featuresDir: string,
        tasksDir: string,
    ): Promise<void> {
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
                    severity: 'warning',
                    section: '',
                    message: `Feature "${featureId}" not found in ${featuresDir}`,
                });
            } else {
                const featureStatus = await this.readFeatureStatus(featurePath);
                if (featureStatus === 'done' || featureStatus === 'cancelled') {
                    findings.push({
                        layer: 'L4',
                        severity: 'error',
                        section: '',
                        message: `Feature "${featureId}" is ${featureStatus} — remove or re-parent this task`,
                    });
                }
                // ── AC coverage (R1, DD-09): task AC ⊆ linked feature AC ──
                await this.checkAcCoverage(doc, featurePath, featureId, findings);
            }
        } else {
            findings.push({
                layer: 'L4',
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
                    severity: 'warning',
                    section: '',
                    message: `Parent task ${parentWbs} not found in ${tasksDir}`,
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
                            severity: 'warning',
                            section: '',
                            message: `Dependency "${dep}" not found in ${tasksDir}`,
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
                severity: 'warning',
                section: '',
                message: `Parent is ${status} but sub-task(s) still open: ${list} — close or re-parent them`,
            });
        }

        // R1b: every kid closed but the parent is still open.
        if (!parentClosed && openKids.length === 0) {
            findings.push({
                layer: 'L4',
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

    /**
     * Scan the tasks dir for sibling tasks whose `parent_wbs` resolves to `wbs`.
     * Returns each sub-task's wbs + status. Self-referential and malformed files are
     * skipped; a missing/unreadable dir yields no sub-tasks (the check stays inert).
     */
    private async findChildren(tasksDir: string, wbs: string): Promise<{ wbs: string; status: string }[]> {
        const kids: { wbs: string; status: string }[] = [];
        let entries: string[];
        try {
            entries = await this.fs.readDir(tasksDir);
        } catch {
            return kids;
        }
        for (const name of entries) {
            const m = /^(\d{4})_.+\.md$/.exec(name);
            if (m === null) continue;
            const kidWbs = m[1];
            if (kidWbs === undefined || kidWbs === wbs) continue; // skip self
            try {
                const raw = await this.fs.readFile(`${tasksDir}/${name}`);
                const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
                const parent = (fm.parent_wbs as string | undefined) ?? (fm['parent-wbs'] as string | undefined);
                if (parent !== wbs) continue;
                kids.push({ wbs: kidWbs, status: (fm.status as string) ?? 'backlog' });
            } catch {
                // Unreadable/malformed sibling — skip; it surfaces under its own check.
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
     */
    private async checkAcCoverage(
        taskDoc: MarkdownDocument,
        featurePath: string,
        featureId: string,
        findings: CheckFindings[],
    ): Promise<void> {
        const taskAc = stripAcFence(taskDoc.getSection('Acceptance Criteria') ?? '');
        if (taskAc.trim().length === 0) return; // no task AC → nothing to cover

        let featureAc: string;
        try {
            const raw = await this.fs.readFile(featurePath);
            featureAc = stripAcFence(MarkdownDocument.parse(raw, 'feature').getSection('Acceptance Criteria') ?? '');
        } catch {
            return; // feature unreadable — the edge warning above already covered it
        }
        if (featureAc.trim().length === 0) return;

        const taskChecklist = parseChecklist(taskAc);
        const result = checkAcCoverage(featureAc, taskAc, taskChecklist);
        for (const scenario of result.uncovered) {
            findings.push({
                layer: 'L4',
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

    /** Find a task file by WBS number (filename prefix match: `{wbs}_`). */
    private async findTaskFile(tasksDir: string, wbs: string): Promise<string | null> {
        try {
            const entries = await this.fs.readDir(tasksDir);
            for (const name of entries) {
                if (name.startsWith(`${wbs}_`) && name.endsWith('.md')) {
                    return `${tasksDir}/${name}`;
                }
            }
        } catch {
            // Directory doesn't exist or can't be read
        }
        return null;
    }
}
