/**
 * Task check — four-layer validation per design §3.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Per-section format rules (warning-first; 3 hard-core rules).
 * L4: Traceability (warning-first).
 */

import { dirname, join } from 'node:path';
import { MarkdownDocument, taskFrontmatterSchema } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';

// ─── Types ──────────────────────────────────────────────────────────────

/** Finding severity level. `error` blocks the check gate; `warning` is advisory. */
export type Severity = 'error' | 'warning';

/** A single validation finding from one of the four check layers. */
export interface CheckFindings {
    /** Layer the finding belongs to (L1–L4 per design §3). */
    layer: 'L1' | 'L2' | 'L3' | 'L4';
    severity: Severity;
    /** Section name or empty string for document-level findings. */
    section: string;
    line?: number;
    message: string;
}

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

/** Section-Status-Matrix config shape (design §3.2). */
export interface SectionMatrix {
    variants: Record<string, Record<string, MatrixEntry>>;
}

/** Per-status matrix entry defining required/optional/forbidden sections. */
export interface MatrixEntry {
    required?: string[];
    optional?: string[];
    forbidden?: string[];
    gate?: boolean;
}

// ─── TaskCheckService ───────────────────────────────────────────────────

/** Four-layer task validator (design §3). L1 schema → L2 matrix → L3 format → L4 traceability. */
export class TaskCheckService {
    private readonly fs: FileSystem;
    private readonly matrix: SectionMatrix;

    constructor(fs: FileSystem, matrix: SectionMatrix) {
        this.fs = fs;
        this.matrix = matrix;
    }

    /** Run the four-layer validation against a task file. */
    async check(filePath: string, wbs: string, options?: { strict?: boolean }): Promise<CheckResult> {
        const strict = options?.strict === true;
        const raw = await this.fs.readFile(filePath);
        const findings: CheckFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, wbs, findings);
        if (doc === null) {
            return this.buildResult(wbs, '', findings, strict);
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        const variant = (fm.type as string) ?? 'standard';
        const entry = this.resolveMatrixEntry(variant, status);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings);

        // ── L3: Format rules (warning-first, 3 hard-core) ──
        this.runL3(doc, findings);
        // ── L4: Traceability — feature_id edges, parent_wbs, dependencies
        const tasksDir = dirname(filePath);
        const featuresDir = join(dirname(tasksDir), 'features');
        await this.runL4(fm, findings, featuresDir, tasksDir);

        return this.buildResult(wbs, status, findings, strict);
    }

    /** Resolve the matrix entry for a variant + status. Falls back to `standard` variant. */
    resolveMatrixEntry(variant: string, status: string): MatrixEntry | undefined {
        const v = this.matrix.variants[variant] ?? this.matrix.variants.standard;
        return v?.[status];
    }

    // ── L1: Zod schema ──
    private runL1(raw: string, wbs: string, findings: CheckFindings[]): MarkdownDocument | null {
        let doc: MarkdownDocument;
        try {
            doc = MarkdownDocument.parse(raw, 'task');
        } catch (err) {
            findings.push({
                layer: 'L1',
                severity: 'error',
                section: '',
                message: `Markdown parse failed for task ${wbs}: ${String(err)}`,
            });
            return null;
        }

        const fm = doc.frontmatterData ?? {};
        const result = taskFrontmatterSchema.safeParse(fm);
        if (!result.success) {
            for (const issue of result.error.issues) {
                findings.push({
                    layer: 'L1',
                    severity: 'error',
                    section: '',
                    message: `Schema: ${issue.path.join('.')}: ${issue.message}`,
                });
            }
        }
        return doc;
    }

    // ── L2: Section presence ──
    private runL2(doc: MarkdownDocument, entry: MatrixEntry | undefined, findings: CheckFindings[]): void {
        if (!entry) return;

        const sectionNames: string[] = doc.sectionNames;
        const present = new Set(sectionNames);

        // Check required
        for (const sect of entry.required ?? []) {
            if (!present.has(sect)) {
                const severity = entry.gate === true ? 'error' : 'warning';
                findings.push({
                    layer: 'L2',
                    severity,
                    section: sect,
                    message: `Missing required section "${sect}"${entry.gate ? ' (gate: true)' : ''}`,
                });
            }
        }

        // Check forbidden
        for (const sect of entry.forbidden ?? []) {
            if (present.has(sect)) {
                findings.push({
                    layer: 'L2',
                    severity: 'warning',
                    section: sect,
                    message: `Section "${sect}" is forbidden for the current status`,
                });
            }
        }

        // Check allowed vocabulary (closed-world, DD-08)
        const allowed = new Set([...(entry.required ?? []), ...(entry.optional ?? []), ...(entry.forbidden ?? [])]);
        for (const sect of present) {
            if (!allowed.has(sect)) {
                findings.push({
                    layer: 'L2',
                    severity: 'warning',
                    section: sect,
                    message: `Section "${sect}" is not allowed in this variant/status`,
                });
            }
        }
    }

    // ── L3: Format rules ──
    private runL3(doc: MarkdownDocument, findings: CheckFindings[]): void {
        // Requirements: R-numbering (warning, only when section exists)
        const reqBody = doc.getSection('Requirements');
        if (reqBody !== null && reqBody.trim().length > 0) {
            const rLines = reqBody.trim().split('\n');
            let numbered = 0;
            let allLines = 0;
            for (const l of rLines) {
                if (l.trim().length > 0) {
                    allLines++;
                    if (/^\s*R\d+\.?\s/.test(l)) numbered++;
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

        // Solution: ≥1 file:line citation (hard core)
        const solBody = doc.getSection('Solution');
        if (solBody !== null) {
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
        if (revBody !== null && revBody.trim().length > 0) {
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
        if (testBody !== null && testBody.trim().length > 0) {
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
        if (planBody !== null && planBody.trim().length > 0) {
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

    // ── L4: Traceability — feature_id edges, parent_wbs, dependencies ──
    private async runL4(
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

    private buildResult(wbs: string, status: string, findings: CheckFindings[], strict?: boolean): CheckResult {
        // Elevate warnings to errors when --strict is set
        if (strict) {
            for (const f of findings) {
                if (f.severity === 'warning') f.severity = 'error';
            }
        }
        let hasError = false;
        for (const f of findings) {
            if (f.severity === 'error') {
                hasError = true;
                break;
            }
        }
        const requiredSections: string[] = [];
        const missingSections: string[] = [];

        for (const f of findings) {
            if (f.layer === 'L2' && f.section && f.message.startsWith('Missing required')) {
                requiredSections.push(f.section);
                missingSections.push(f.section);
            }
        }

        return {
            wbs,
            status,
            findings,
            requiredSections,
            missingSections,
            pass: !hasError,
        };
    }
}
