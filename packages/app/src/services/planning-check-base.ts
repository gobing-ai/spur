/**
 * Planning check base — the shared four-layer validation scaffold behind
 * `TaskCheckService` and `FeatureCheckService` (design §3).
 *
 * Owns the parts that are identical across task and feature checks:
 *  - finding / result / matrix types,
 *  - L1 schema parse (generic over doc-kind + Zod schema),
 *  - L2 Section-Status-Matrix presence (required / forbidden / closed-world),
 *  - matrix-entry resolution,
 *  - `--strict` elevation + result building.
 *
 * The divergent layers (L3 format rules, L4 traceability) and the `check()`
 * orchestration stay in the subclasses, which differ entirely in those bodies.
 */

import type { MarkdownDocument } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { z } from 'zod';

// ─── Shared types ─────────────────────────────────────────────────────────

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

/** Per-status matrix entry defining required/optional/forbidden sections. */
export interface MatrixEntry {
    required?: string[];
    optional?: string[];
    forbidden?: string[];
    gate?: boolean;
}

/** Section-Status-Matrix config shape (design §3.2). */
export interface SectionMatrix {
    variants: Record<string, Record<string, MatrixEntry>>;
}

/** Outcome fields common to every check result (the id field is added per entity). */
export interface CheckResultBase {
    status: string;
    findings: CheckFindings[];
    /** Required sections for the current status (for `--json` reporting). */
    requiredSections: string[];
    /** Missing required sections for the current status. */
    missingSections: string[];
    /** Whether the check passed (no hard errors). */
    pass: boolean;
}

/** Doc kind passed to {@link MarkdownDocument.parse}. */
export type DocKind = 'task' | 'feature';

// ─── Base scaffold ────────────────────────────────────────────────────────

/**
 * Shared scaffold for the four-layer planning checks. Subclasses supply the
 * doc-kind + schema (for L1) and the divergent L3/L4 bodies.
 */
export abstract class PlanningCheckService {
    protected readonly fs: FileSystem;
    protected readonly matrix: SectionMatrix;
    private readonly docKind: DocKind;
    private readonly frontmatterSchema: z.ZodTypeAny;
    private readonly parse: (raw: string, kind: DocKind) => MarkdownDocument;

    protected constructor(args: {
        fs: FileSystem;
        matrix: SectionMatrix;
        docKind: DocKind;
        frontmatterSchema: z.ZodTypeAny;
        parse: (raw: string, kind: DocKind) => MarkdownDocument;
    }) {
        this.fs = args.fs;
        this.matrix = args.matrix;
        this.docKind = args.docKind;
        this.frontmatterSchema = args.frontmatterSchema;
        this.parse = args.parse;
    }

    /** Resolve the matrix entry for a variant + status. Falls back to `standard` variant. */
    resolveMatrixEntry(variant: string, status: string): MatrixEntry | undefined {
        const v = this.matrix.variants[variant] ?? this.matrix.variants.standard;
        return v?.[status];
    }

    /** L1: parse the markdown + validate frontmatter against the Zod schema. */
    protected runL1(raw: string, ref: string, findings: CheckFindings[]): MarkdownDocument | null {
        let doc: MarkdownDocument;
        try {
            doc = this.parse(raw, this.docKind);
        } catch (err) {
            findings.push({
                layer: 'L1',
                severity: 'error',
                section: '',
                message: `Markdown parse failed for ${this.docKind} ${ref}: ${String(err)}`,
            });
            return null;
        }

        const fm = doc.frontmatterData ?? {};
        const result = this.frontmatterSchema.safeParse(fm);
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

    /** L2: Section-Status-Matrix presence — required / forbidden / closed-world vocabulary. */
    protected runL2(doc: MarkdownDocument, entry: MatrixEntry | undefined, findings: CheckFindings[]): void {
        if (!entry) return;

        const sectionNames: string[] = doc.sectionNames;
        const present = new Set(sectionNames);

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

        // Closed-world vocabulary (DD-08): every present section must be declared.
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

    /**
     * Apply `--strict` elevation, compute the pass gate, and derive the
     * required/missing section lists from L2 findings. Returns the outcome
     * fields common to every check result; the subclass spreads its id field on.
     */
    protected summarizeWithStatus(status: string, findings: CheckFindings[], strict?: boolean): CheckResultBase {
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
        return { status, findings, requiredSections, missingSections, pass: !hasError };
    }
}
