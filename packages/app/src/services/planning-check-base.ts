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

import { type MarkdownDocument, UNIVERSAL_SECTIONS } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { echoError } from '@gobing-ai/ts-utils';
import type { z } from 'zod';

import { ALL_FINDING_CODES, FINDING_CODES, type FindingCode, isFindingCode } from './finding-codes';
import { structuralFindings } from './structural-repair';

export { ALL_FINDING_CODES, FINDING_CODES, type FindingCode, isFindingCode };

/** Finding severity level in corpus / planning checks. */
export type CorpusSeverity = 'error' | 'warning';

/** `<kind>:<id>:<code>` — the identity a baseline entry and an observed error share. */
export function key(e: { kind: string; id: string; code: string }): string {
    return `${e.kind}:${e.id}:${e.code}`;
}

// R1 (D61 task 0765): the unsuppressible error set. These finding codes
// represent structural / completion-integrity errors that cannot be downgraded
// by `severityOverrides` or absorbed by `accepted`-map filtering. Defaults to
// the same set the design contract freezes; callers MAY extend it for project-
// specific essential errors but MUST NOT shrink it. Frozen at the planning-
// check-base seam so the policy is shared by both TaskCheckService and
// FeatureCheckService and not redefined per subclass.
const REQUIRED_FINDING_CODES: ReadonlySet<FindingCode> = new Set<FindingCode>([
    FINDING_CODES.L1_MARKDOWN_PARSE,
    FINDING_CODES.L1_SCHEMA_VALIDATION,
    FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
    FINDING_CODES.L3_AC_BDD_ERROR,
    FINDING_CODES.L3_AC_BDD_INVALID,
    FINDING_CODES.L3_REQUIREMENTS_EMPTY,
    FINDING_CODES.L3_AC_EMPTY,
    FINDING_CODES.L3_REQUIRED_SECTION_PLACEHOLDER,
    // Edge-resolution errors are NOT unsuppressible: the design contract freezes
    // them as error when the edge is present and unresolvable, but advisory when
    // the edge is absent (e.g. an optional feature_id). `severityOverrides`
    // remains free to escalate these from warning to error when the caller
    // wants stricter behavior.
    FINDING_CODES.L4_PREREQUISITE_CYCLE,
    FINDING_CODES.L4_ORPHAN_SCENARIOS,
    FINDING_CODES.L4_UNCOVERED_FEATURE_SCENARIO,
    FINDING_CODES.L4_SCENARIO_UNVERIFIED,
    FINDING_CODES.L4_VERIFYING_INCOMPLETE_TASKS,
    FINDING_CODES.L4_VERDICT_ROWS_MATCH_NO_SCENARIO,
    FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
    FINDING_CODES.L4_EVIDENCE_NOT_RECOVERABLE,
    FINDING_CODES.L4_DOGFOOD_MISSING,
    FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
    FINDING_CODES.L4_TESTING_VERDICT_STUB,
    FINDING_CODES.L4_UNCOVERED_TASK_SCENARIO,
    FINDING_CODES.L3_REVIEW_TESTING_CONTRADICTION,
    FINDING_CODES.L4_ROLLUP_SUBTASKS_OPEN,
    FINDING_CODES.L4_ROLLUP_MISSING_ROSTER,
    FINDING_CODES.L4_ROLLUP_ROSTER_NOT_DECLARED_DEPENDENCY,
]);

/** Whether a finding's code is unsuppressible — its severity was fixed at emit time. */
export function isUnsuppressibleFinding(code: FindingCode): boolean {
    return REQUIRED_FINDING_CODES.has(code);
}

export { REQUIRED_FINDING_CODES };

// ─── Shared types ─────────────────────────────────────────────────────────

// `UNIVERSAL_SECTIONS` (the closed-world relaxation: History/References/Notes)
// is imported from `@gobing-ai/spur-domain` — domain owns the section vocabulary
// so the write pipeline's R3 guard and this check share one definition.

/** Finding severity level. `error` blocks the check gate; `warning` is advisory. */
export type Severity = 'error' | 'warning';

/** A single validation finding from one of the four check layers. */
export interface CheckFindings {
    /** Layer the finding belongs to (L1–L4 per design §3). */
    layer: 'L1' | 'L2' | 'L3' | 'L4';
    /** Machine-readable finding code identifying the rule (R1, task 0321). */
    code: FindingCode;
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
    protected readonly docKind: DocKind;
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
                code: FINDING_CODES.L1_MARKDOWN_PARSE,
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
                    code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                    severity: 'error',
                    section: '',
                    message: `Schema: ${issue.path.join('.')}: ${issue.message}`,
                });
            }
        }
        return doc;
    }

    /** L2: Section-Status-Matrix presence — required / forbidden / closed-world vocabulary. */
    protected runL2(
        doc: MarkdownDocument,
        entry: MatrixEntry | undefined,
        findings: CheckFindings[],
        raw: string,
    ): void {
        if (!entry) return;

        const sectionNames: string[] = doc.sectionNames;
        const present = new Set(sectionNames);

        for (const sect of entry.required ?? []) {
            if (!present.has(sect)) {
                const severity = entry.gate === true ? 'error' : 'warning';
                findings.push({
                    layer: 'L2',
                    code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
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
                    code: FINDING_CODES.L2_FORBIDDEN_SECTION,
                    severity: 'warning',
                    section: sect,
                    message: `Section "${sect}" is forbidden for the current status`,
                });
            }
        }

        // Closed-world vocabulary (DD-08): every present section must be declared.
        // `History` (machine-appended transition log) and `References` are
        // structural and present in every file at every status, so they are
        // universally allowed rather than re-declared in each status row.
        const allowed = new Set([
            ...(entry.required ?? []),
            ...(entry.optional ?? []),
            ...(entry.forbidden ?? []),
            ...UNIVERSAL_SECTIONS,
        ]);
        for (const sect of present) {
            if (!allowed.has(sect)) {
                findings.push({
                    layer: 'L2',
                    code: FINDING_CODES.L2_DISALLOWED_SECTION,
                    severity: 'warning',
                    section: sect,
                    message: `Section "${sect}" is not allowed in this variant/status`,
                });
            }
        }

        // Structural repairs the `--fix` verb can apply (task 0619): heading level,
        // section order, and R-item checkbox form are detected on the raw body
        // because a mis-levelled heading is not parsed into `doc.sectionNames`.
        findings.push(...structuralFindings(raw, this.docKind));
    }

    /**
     * Apply config severity overrides (R3/R4) and `--strict` elevation, compute
     * the pass gate, and derive the required/missing section lists from L2 findings.
     *
     * **Severity precedence (D61 task 0765 — R1/R3):** essential / required-error
     * codes (see {@link REQUIRED_FINDING_CODES}) have their severity ESTABLISHED at
     * emit time and cannot be downgraded by `severityOverrides` or absorbed by
     * `accepted`-map filtering. Overrides apply only to advisory warnings; an
     * override that targets an unsuppressible error is silently ignored (with a
     * stderr trace) so callers see the bypass attempt without changing the pass
     * gate. `--strict` elevation only walks warnings → errors; required errors
     * stay required.
     *
     * Returns the outcome fields common to every check result.
     */
    protected summarizeWithStatus(
        status: string,
        findings: CheckFindings[],
        strict?: boolean,
        overrides?: Record<string, 'error' | 'warning' | 'off'>,
        accepted?: ReadonlyMap<string, CorpusSeverity>,
        id?: string,
    ): CheckResultBase {
        // R1 (D61 task 0765): essential / required-error codes are unsuppressible.
        // Their severity was fixed at emit time, so overrides that drop or
        // downgrade them are refused and the accepted-map cannot absorb them.
        // Advisory findings keep the legacy override + accepted path.
        const effectiveFindings: CheckFindings[] = [];
        for (const f of findings) {
            const unsuppressible = isUnsuppressibleFinding(f.code);
            const override = overrides?.[f.code];
            if (override === 'off') {
                if (unsuppressible) {
                    echoError(`summarize: override 'off' refused for unsuppressible ${f.code}`);
                } else {
                    continue; // dropped before pass gate or strict elevation sees it (R4)
                }
            }
            if (override === 'error' || override === 'warning') {
                if (unsuppressible) {
                    echoError(
                        `summarize: severity override for unsuppressible ${f.code} ignored (required severity preserved)`,
                    );
                } else {
                    f.severity = override;
                }
            }
            if (strict && f.severity === 'warning') {
                f.severity = 'error';
            }
            if (accepted && id && !unsuppressible) {
                const k = key({ kind: this.docKind, id, code: f.code });
                const acceptedSev = accepted.get(k);
                if (acceptedSev !== undefined && acceptedSev === f.severity) {
                    continue; // accepted debt at matching severity dropped after overrides & strict elevation (R1, R2)
                }
            }
            effectiveFindings.push(f);
        }

        let hasError = false;
        for (const f of effectiveFindings) {
            if (f.severity === 'error') {
                hasError = true;
                break;
            }
        }
        const requiredSections: string[] = [];
        const missingSections: string[] = [];
        for (const f of effectiveFindings) {
            if (f.layer === 'L2' && f.section && f.message.startsWith('Missing required')) {
                requiredSections.push(f.section);
                missingSections.push(f.section);
            }
        }
        return { status, findings: effectiveFindings, requiredSections, missingSections, pass: !hasError };
    }
}
