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
        this.runL3(doc, findings);
        // ── L4: Traceability — feature_id edges, parent_wbs, dependencies, AC coverage
        const tasksDir = dirname(filePath);
        const featuresDir = join(dirname(tasksDir), 'features');
        await this.runL4(doc, fm, findings, featuresDir, tasksDir);

        return { wbs, ...this.summarizeWithStatus(status, findings, strict) };
    }

    // ── L3: Format rules ──
    private runL3(doc: MarkdownDocument, findings: CheckFindings[]): void {
        // Requirements: R-numbering (warning, only when section has real content)
        const reqBody = doc.getSection('Requirements');
        if (reqBody !== null && !isPlaceholderBody(reqBody)) {
            const rLines = reqBody.trim().split('\n');
            let numbered = 0;
            let allLines = 0;
            for (const l of rLines) {
                if (l.trim().length > 0) {
                    allLines++;
                    // Accept an optional list-bullet prefix: "- R1. …" / "* R1. …" / "R1. …".
                    if (/^\s*[-*]?\s*R\d+\.?\s/.test(l)) numbered++;
                }
            }
            if (numbered === 0 || numbered < allLines * 0.5) {
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
            if (!hasFileLine) {
                findings.push({
                    layer: 'L3',
                    severity: 'error',
                    section: 'Solution',
                    message: 'Solution must contain at least one `file:line` citation',
                });
            }
        }

        // Review: P1–P4 findings table (hard core)
        const revBody = doc.getSection('Review');
        if (revBody !== null && !isPlaceholderBody(revBody)) {
            const hasPColumn = /P[1-4]/.test(revBody);
            if (!hasPColumn) {
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
            const isList = /^\s*[-*]\s|^\s*\d+\.\s/.test(planBody.trimStart());
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
                message: 'Missing feature_id — every task should reference a feature (one direction, DD-07)',
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
