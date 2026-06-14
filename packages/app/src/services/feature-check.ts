/**
 * Feature check — four-layer validation for feature files.
 *
 * L1: Zod schema (hard error).
 * L2: Section-Status-Matrix presence (warning-first, gate:true hard).
 * L3: Format rules — BDD AC validation, one-active-goal, children-limit.
 * L4: Traceability (warning-first, feature_id edge validation).
 */

import { featureFrontmatterSchema, MarkdownDocument, validateAcceptanceCriteria } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';

// ─── Types ──────────────────────────────────────────────────────────────

/** Finding severity level. `error` blocks the check gate; `warning` is advisory. */
export type CheckFeatureSeverity = 'error' | 'warning';

/** A single validation finding from one of the four check layers. */
export interface CheckFeatureFindings {
    /** Layer the finding belongs to (L1–L4). */
    layer: 'L1' | 'L2' | 'L3' | 'L4';
    severity: CheckFeatureSeverity;
    /** Section name or empty string for document-level findings. */
    section: string;
    line?: number;
    message: string;
}

/** Result of a `spur feature check` validation run. */
export interface CheckFeatureResult {
    id: string;
    status: string;
    findings: CheckFeatureFindings[];
    /** Required sections for the current status. */
    requiredSections: string[];
    /** Missing required sections for the current status. */
    missingSections: string[];
    /** Whether the check passed (no hard errors). */
    pass: boolean;
}

/** Section-Status-Matrix config shape. */
export interface FeatureSectionMatrix {
    variants: Record<string, Record<string, FeatureMatrixEntry>>;
}

/** Per-status matrix entry defining required/optional/forbidden sections. */
export interface FeatureMatrixEntry {
    required?: string[];
    optional?: string[];
    forbidden?: string[];
    gate?: boolean;
}

/** Default feature section matrix — matches the canonical section vocabulary. */
export const DEFAULT_FEATURE_MATRIX: FeatureSectionMatrix = {
    variants: {
        standard: {
            backlog: {
                required: [],
                optional: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks', 'Notes', 'History'],
            },
            active: {
                required: ['Goal', 'Scope', 'Acceptance Criteria'],
                gate: true,
            },
            verifying: {
                required: ['Goal', 'Scope', 'Acceptance Criteria'],
                gate: true,
            },
            blocked: {
                required: ['Goal', 'Notes'],
            },
            done: {
                required: ['Goal', 'Scope', 'Acceptance Criteria', 'Tasks'],
                gate: true,
            },
            cancelled: {
                required: ['Notes'],
            },
        },
    },
};

// ─── FeatureCheckService ────────────────────────────────────────────────

/** Four-layer feature validator. L1 schema → L2 matrix → L3 format → L4 traceability. */
export class FeatureCheckService {
    private readonly fs: FileSystem;
    private readonly matrix: FeatureSectionMatrix;

    constructor(fs: FileSystem, matrix?: FeatureSectionMatrix) {
        this.fs = fs;
        this.matrix = matrix ?? DEFAULT_FEATURE_MATRIX;
    }

    /** Run the four-layer validation against a feature file. */
    async check(
        filePath: string,
        featureId: string,
        options?: { strict?: boolean; featuresDir?: string },
    ): Promise<CheckFeatureResult> {
        const strict = options?.strict === true;
        const raw = await this.fs.readFile(filePath);
        const findings: CheckFeatureFindings[] = [];

        // ── L1: Schema validation (hard) ──
        const doc = this.runL1(raw, featureId, findings);
        if (doc === null) {
            return this.buildResult(featureId, '', findings, strict);
        }

        const fm = doc.frontmatterData ?? {};
        const status = (fm.status as string) ?? 'backlog';
        const entry = this.resolveMatrixEntry('standard', status);

        // ── L2: Section presence (warning-first, gate:true hard) ──
        this.runL2(doc, entry, findings);

        // ── L3: Format rules — BDD AC validation + structural rules ──
        this.runL3(doc, findings);

        // ── L3: One-active-goal — at most one P0 feature in {active, verifying} ──
        if (options?.featuresDir) {
            await this.checkOneActiveGoal(fm, featureId, options.featuresDir, findings);
        }

        // ── L4: Traceability (warning-first) ──
        this.runL4(fm, featureId, findings);

        return this.buildResult(featureId, status, findings, strict);
    }

    /** Resolve the matrix entry for a variant + status. Falls back to `standard` variant. */
    resolveMatrixEntry(variant: string, status: string): FeatureMatrixEntry | undefined {
        const v = this.matrix.variants[variant] ?? this.matrix.variants.standard;
        return v?.[status];
    }

    // ── L1: Zod schema ──
    private runL1(raw: string, featureId: string, findings: CheckFeatureFindings[]): MarkdownDocument | null {
        let doc: MarkdownDocument;
        try {
            doc = MarkdownDocument.parse(raw, 'feature');
        } catch (err) {
            findings.push({
                layer: 'L1',
                severity: 'error',
                section: '',
                message: `Markdown parse failed for feature ${featureId}: ${String(err)}`,
            });
            return null;
        }

        const fm = doc.frontmatterData ?? {};
        const result = featureFrontmatterSchema.safeParse(fm);
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
    private runL2(
        doc: MarkdownDocument,
        entry: FeatureMatrixEntry | undefined,
        findings: CheckFeatureFindings[],
    ): void {
        if (!entry) return;

        const sectionNames: string[] = doc.sectionNames;
        const present: Record<string, true> = {};
        for (const name of sectionNames) {
            present[name] = true;
        }

        // Check required
        for (const sect of entry.required ?? []) {
            if (!present[sect]) {
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
            if (present[sect]) {
                findings.push({
                    layer: 'L2',
                    severity: 'warning',
                    section: sect,
                    message: `Section "${sect}" is forbidden for the current status`,
                });
            }
        }

        // Check allowed vocabulary (closed-world)
        const allowed: Record<string, true> = {};
        for (const sect of entry.required ?? []) allowed[sect] = true;
        for (const sect of entry.optional ?? []) allowed[sect] = true;
        for (const sect of entry.forbidden ?? []) allowed[sect] = true;
        for (const sect of sectionNames) {
            if (!allowed[sect]) {
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
    private runL3(doc: MarkdownDocument, findings: CheckFeatureFindings[]): void {
        // Acceptance Criteria: BDD validation (hard core)
        const acBody = doc.getSection('Acceptance Criteria');
        if (acBody !== null && acBody.trim().length > 0) {
            const bddResult = validateAcceptanceCriteria(acBody);

            for (const err of bddResult.errors) {
                findings.push({
                    layer: 'L3',
                    severity: 'error',
                    section: 'Acceptance Criteria',
                    line: err.line,
                    message: `BDD: ${err.message}`,
                });
            }
            for (const warn of bddResult.warnings) {
                findings.push({
                    layer: 'L3',
                    severity: 'warning',
                    section: 'Acceptance Criteria',
                    line: warn.line,
                    message: `BDD: ${warn.message}`,
                });
            }

            if (!bddResult.valid) {
                findings.push({
                    layer: 'L3',
                    severity: 'error',
                    section: 'Acceptance Criteria',
                    message: 'Acceptance Criteria validation failed; fix BDD syntax errors',
                });
            }
        }

        // Scope: should contain in/out delineation (warning)
        const scopeBody = doc.getSection('Scope');
        if (scopeBody !== null && scopeBody.trim().length > 0) {
            const hasInOut =
                /\b[Ii]n\s*scope\b/.test(scopeBody) ||
                /\b[Oo]ut\s*of\s*scope\b/.test(scopeBody) ||
                /\b[Ii]n:\b/.test(scopeBody) ||
                /\b[Oo]ut:\b/.test(scopeBody);
            if (!hasInOut) {
                findings.push({
                    layer: 'L3',
                    severity: 'warning',
                    section: 'Scope',
                    message: 'Scope should delineate in-scope / out-of-scope items',
                });
            }
        }
    }

    // ── L3: One-active-goal — at most one P0 feature in {active, verifying} ──
    private async checkOneActiveGoal(
        fm: Record<string, unknown>,
        currentId: string,
        featuresDir: string,
        findings: CheckFeatureFindings[],
    ): Promise<void> {
        type Priority = string;
        type Status = string;
        const priority = fm.priority as Priority | undefined;
        const status = fm.status as Status | undefined;

        // Only check P0 features in active/verifying status
        if (priority !== 'P0') return;
        if (status !== 'active' && status !== 'verifying') return;

        // Read all feature files in the directory and check for other P0 active/verifying
        try {
            const entries = await this.fs.readDir(featuresDir);
            for (const entry of entries) {
                if (!entry.endsWith('.md')) continue;

                const otherPath = `${featuresDir}/${entry}`;
                // Extract ID from filename: <ID>_<slug>.md
                const match = /^([A-Z][1-9]*)_/.exec(entry);
                if (!match) continue;
                const otherId = match[1];

                // Skip self
                if (otherId === currentId) continue;

                try {
                    const raw = await this.fs.readFile(otherPath);
                    const doc = MarkdownDocument.parse(raw, 'feature');
                    const otherFm = doc.frontmatterData ?? {};
                    const otherPriority = otherFm.priority as Priority | undefined;
                    const otherStatus = otherFm.status as Status | undefined;

                    if (otherPriority === 'P0' && (otherStatus === 'active' || otherStatus === 'verifying')) {
                        findings.push({
                            layer: 'L3',
                            severity: 'error',
                            section: '',
                            message: `One-active-goal violated: P0 feature "${otherId}" is already ${otherStatus}`,
                        });
                        // Only report the first conflict
                        return;
                    }
                } catch {
                    // Skip unparseable files in the directory scan
                }
            }
        } catch {
            // Directory unreadable — skip the one-active-goal check
        }
    }

    // ── L4: Traceability ──
    private runL4(fm: Record<string, unknown>, _featureId: string, findings: CheckFeatureFindings[]): void {
        // Feature-level traceability is light: features don't reference tasks directly
        // (tasks reference features via feature_id). The inverse lookup is done in task-check's L4.
        // Here we validate the feature's own edges if present.

        // Check for children count (>9 warning — DD-14 limit)
        const childrenCount = fm._childrenCount as number | undefined;
        if (childrenCount !== undefined && childrenCount > 9) {
            findings.push({
                layer: 'L4',
                severity: 'warning',
                section: '',
                message: `Feature has ${childrenCount} children; DD-14 limit is ≤9 per parent node`,
            });
        }
    }

    private buildResult(
        featureId: string,
        status: string,
        findings: CheckFeatureFindings[],
        strict?: boolean,
    ): CheckFeatureResult {
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
            id: featureId,
            status,
            findings,
            requiredSections,
            missingSections,
            pass: !hasError,
        };
    }
}
