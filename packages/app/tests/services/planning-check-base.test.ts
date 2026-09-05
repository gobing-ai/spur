import { describe, expect, test } from 'bun:test';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import {
    type CheckFindings,
    type CheckResultBase,
    type CorpusSeverity,
    type DocKind,
    FINDING_CODES,
    type MatrixEntry,
    PlanningCheckService,
    type SectionMatrix,
} from '../../src/services/planning-check-base';

// ─── Test subclass ────────────────────────────────────────────────────────
// The base class is abstract and its L1/L2/summarize methods are protected.
// A minimal concrete subclass exposes them so each layer can be tested in
// isolation without coupling to TaskCheckService or FeatureCheckService.

class TestCheckService extends PlanningCheckService {
    constructor(
        matrix: SectionMatrix,
        docKind: DocKind = 'task',
        frontmatterSchema: z.ZodTypeAny = z.object({ status: z.string() }).passthrough(),
        parse: (raw: string, kind: DocKind) => MarkdownDocument = (raw, kind) => MarkdownDocument.parse(raw, kind),
    ) {
        super({ fs: createNodeFileSystem(), matrix, docKind, frontmatterSchema, parse });
    }

    override runL1(raw: string, ref: string, findings: CheckFindings[]): MarkdownDocument | null {
        return super.runL1(raw, ref, findings);
    }

    override runL2(
        doc: MarkdownDocument,
        entry: MatrixEntry | undefined,
        findings: CheckFindings[],
        raw: string,
    ): void {
        super.runL2(doc, entry, findings, raw);
    }

    override summarizeWithStatus(
        status: string,
        findings: CheckFindings[],
        strict?: boolean,
        overrides?: Record<string, 'error' | 'warning' | 'off'>,
        accepted?: ReadonlyMap<string, CorpusSeverity>,
        id?: string,
    ): CheckResultBase {
        return super.summarizeWithStatus(status, findings, strict, overrides, accepted, id);
    }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Build a task markdown string with frontmatter and section headings. */
function taskDoc(sections: string[] = [], fm: Record<string, unknown> = { status: 'backlog' }): string {
    const fmLines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
        fmLines.push(typeof v === 'string' ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`);
    }
    fmLines.push('---', '');
    const body = sections.map((s) => `### ${s}\n\ntext`).join('\n\n');
    return body ? `${fmLines.join('\n')}\n${body}` : `${fmLines.join('\n')}\n`;
}

/** Build a feature markdown string with frontmatter and section headings. */
function featureDoc(sections: string[] = [], fm: Record<string, unknown> = { status: 'backlog' }): string {
    const fmLines = ['---'];
    for (const [k, v] of Object.entries(fm)) {
        fmLines.push(typeof v === 'string' ? `${k}: ${v}` : `${k}: ${JSON.stringify(v)}`);
    }
    fmLines.push('---', '');
    const body = sections.map((s) => `## ${s}\n\ntext`).join('\n\n');
    return body ? `${fmLines.join('\n')}\n${body}` : `${fmLines.join('\n')}\n`;
}

const simpleMatrix: SectionMatrix = {
    variants: {
        standard: {
            backlog: { required: ['Background'], optional: ['Notes'], forbidden: ['Solution'] },
            done: { required: ['Solution', 'Testing'], gate: true },
        },
        custom: {
            backlog: { required: ['Goal'] },
        },
    },
};

// ─── resolveMatrixEntry ───────────────────────────────────────────────────

describe('PlanningCheckService.resolveMatrixEntry', () => {
    test('returns the entry for a direct variant + status match', () => {
        const svc = new TestCheckService(simpleMatrix);
        const entry = svc.resolveMatrixEntry('standard', 'backlog');
        expect(entry).toEqual({ required: ['Background'], optional: ['Notes'], forbidden: ['Solution'] });
    });

    test('falls back to the standard variant when the requested variant is missing', () => {
        const svc = new TestCheckService(simpleMatrix);
        const entry = svc.resolveMatrixEntry('nonexistent', 'backlog');
        expect(entry?.required).toEqual(['Background']);
    });

    test('returns undefined when variant exists but status is missing (no cross-variant status fallback)', () => {
        const svc = new TestCheckService(simpleMatrix);
        // 'custom' variant has 'backlog' but not 'done'. The ?? fallback only
        // triggers when the variant itself is absent — it does NOT cross over
        // to the standard variant's status entries. So custom.done → undefined.
        const entry = svc.resolveMatrixEntry('custom', 'done');
        expect(entry).toBeUndefined();
    });

    test('returns the custom variant entry when it has the status', () => {
        const svc = new TestCheckService(simpleMatrix);
        const entry = svc.resolveMatrixEntry('custom', 'backlog');
        expect(entry?.required).toEqual(['Goal']);
    });

    test('returns undefined when no variant matches and standard has no matching status', () => {
        const matrix: SectionMatrix = { variants: { custom: { backlog: { required: ['Goal'] } } } };
        const svc = new TestCheckService(matrix);
        // 'custom' has 'backlog' but not 'active'; no 'standard' to fall back to.
        const entry = svc.resolveMatrixEntry('custom', 'active');
        expect(entry).toBeUndefined();
    });

    test('returns undefined when variants is empty', () => {
        const matrix: SectionMatrix = { variants: {} };
        const svc = new TestCheckService(matrix);
        expect(svc.resolveMatrixEntry('standard', 'backlog')).toBeUndefined();
    });
});

// ─── runL1 ────────────────────────────────────────────────────────────────

describe('PlanningCheckService.runL1', () => {
    test('parses valid markdown and returns the document with no findings', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [];
        const doc = svc.runL1(taskDoc(['Background']), '0001', findings);
        expect(doc).not.toBeNull();
        expect(findings).toEqual([]);
    });

    test('returns null and pushes an L1 error when parse throws', () => {
        const parse = (): MarkdownDocument => {
            throw new Error('boom');
        };
        const svc = new TestCheckService(simpleMatrix, 'task', z.object({}), parse);
        const findings: CheckFindings[] = [];
        const doc = svc.runL1('garbage', '0001', findings);
        expect(doc).toBeNull();
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            layer: 'L1',
            severity: 'error',
            section: '',
        });
        const msg = findings[0]?.message ?? '';
        expect(msg).toContain('Markdown parse failed');
        expect(msg).toContain('task');
        expect(msg).toContain('0001');
        expect(msg).toContain('boom');
    });

    test('pushes an L1 error per Zod issue when frontmatter fails schema validation', () => {
        const schema = z.object({
            status: z.string(),
            priority: z.number(),
        });
        const svc = new TestCheckService(simpleMatrix, 'task', schema);
        const findings: CheckFindings[] = [];
        // frontmatter missing 'priority'
        const doc = svc.runL1(taskDoc(['Background'], { status: 'backlog' }), '0001', findings);
        // doc is still returned — schema failure is non-fatal at L1
        expect(doc).not.toBeNull();
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            layer: 'L1',
            severity: 'error',
            section: '',
        });
        const msg = findings[0]?.message ?? '';
        expect(msg).toContain('Schema:');
        expect(msg).toContain('priority');
    });

    test('pushes multiple L1 errors for multiple schema issues', () => {
        const schema = z.object({
            status: z.string().min(1),
            priority: z.number(),
            name: z.string(),
        });
        const svc = new TestCheckService(simpleMatrix, 'task', schema);
        const findings: CheckFindings[] = [];
        // missing priority and name
        const doc = svc.runL1(taskDoc(['Background'], { status: 'backlog' }), '0001', findings);
        expect(doc).not.toBeNull();
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.layer === 'L1' && f.severity === 'error')).toBe(true);
    });

    test('includes the docKind in the parse-failure message', () => {
        const parse = (): MarkdownDocument => {
            throw new Error('fail');
        };
        const svc = new TestCheckService(simpleMatrix, 'feature', z.object({}), parse);
        const findings: CheckFindings[] = [];
        svc.runL1('bad', 'F1', findings);
        const msg = findings[0]?.message ?? '';
        expect(msg).toContain('feature');
        expect(msg).toContain('F1');
    });

    test('uses empty object for frontmatterData when frontmatter is null', () => {
        // A doc with no frontmatter — frontmatterData is null, safeParse gets {}
        const schema = z.object({ status: z.string() });
        const svc = new TestCheckService(simpleMatrix, 'task', schema);
        const findings: CheckFindings[] = [];
        // task doc with no frontmatter block (just body)
        const raw = '### Background\n\ntext';
        const doc = svc.runL1(raw, '0001', findings);
        expect(doc).not.toBeNull();
        // missing 'status' → one schema error
        expect(findings).toHaveLength(1);
        expect(findings[0]?.message ?? '').toContain('status');
    });
});

// ─── runL2 ────────────────────────────────────────────────────────────────

describe('PlanningCheckService.runL2', () => {
    test('does nothing when entry is undefined', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Background']), 'task');
        const findings: CheckFindings[] = [];
        svc.runL2(doc, undefined, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toEqual([]);
    });

    test('pushes a warning for each missing required section (no gate)', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc([]), 'task'); // no sections
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Background', 'Notes'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toHaveLength(2);
        expect(findings.every((f) => f.layer === 'L2' && f.severity === 'warning')).toBe(true);
        expect(findings.every((f) => f.message.includes('Missing required section'))).toBe(true);
        const sections = findings.map((f) => f.section);
        expect(sections).toContain('Background');
        expect(sections).toContain('Notes');
    });

    test('pushes an error (not warning) for missing required when gate is true', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc([]), 'task');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Solution'], gate: true };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toHaveLength(1);
        expect(findings[0]?.severity).toBe('error');
        expect(findings[0]?.message ?? '').toContain('gate: true');
    });

    test('pushes a warning for each forbidden section that is present', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Background', 'Solution']), 'task');
        const findings: CheckFindings[] = [];
        // Declare Background as optional so only the forbidden finding appears.
        const entry: MatrixEntry = { optional: ['Background'], forbidden: ['Solution'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            layer: 'L2',
            severity: 'warning',
            section: 'Solution',
        });
        expect(findings[0]?.message ?? '').toContain('forbidden');
    });

    test('pushes a warning for sections not in required/optional/forbidden (closed-world)', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Background', 'Design']), 'task');
        const findings: CheckFindings[] = [];
        // Background is required, Design is not declared at all
        const entry: MatrixEntry = { required: ['Background'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        // Background is present → no finding; Design is undeclared → warning
        expect(findings).toHaveLength(1);
        expect(findings[0]).toMatchObject({
            layer: 'L2',
            severity: 'warning',
            section: 'Design',
        });
        expect(findings[0]?.message ?? '').toContain('not allowed');
    });

    test('produces no findings when all sections are declared and required are present', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Background', 'Notes']), 'task');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Background'], optional: ['Notes'], forbidden: ['Solution'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toEqual([]);
    });

    test('handles entry with empty arrays for required/optional/forbidden', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc([]), 'task');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: [], optional: [], forbidden: [] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toEqual([]);
    });

    test('works with feature domain sections (## headings)', () => {
        const svc = new TestCheckService(simpleMatrix, 'feature');
        const doc = MarkdownDocument.parse(featureDoc(['Goal', 'Scope']), 'feature');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Goal'], optional: ['Scope'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toEqual([]);
    });

    test('forbidden section present alongside missing required', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Solution']), 'task');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Background'], forbidden: ['Solution'] };
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toHaveLength(2);
        const missing = findings.find((f) => f.message.includes('Missing required'));
        const forbidden = findings.find((f) => f.message.includes('forbidden'));
        expect(missing?.section).toBe('Background');
        expect(forbidden?.section).toBe('Solution');
    });

    test('undeclared section plus forbidden section plus missing required all reported', () => {
        const svc = new TestCheckService(simpleMatrix);
        const doc = MarkdownDocument.parse(taskDoc(['Design', 'Solution']), 'task');
        const findings: CheckFindings[] = [];
        const entry: MatrixEntry = { required: ['Background'], forbidden: ['Solution'] };
        // Background missing → warning
        // Solution forbidden + present → warning
        // Design undeclared → warning
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        expect(findings).toHaveLength(3);
    });
});

// ─── D61 task 0765 — R1 unsuppressible severity precedence ───────────────

describe('PlanningCheckService.summarizeWithStatus (D61 task 0765 — R1 unsuppressible codes)', () => {
    test('essential L1 schema error survives severityOverrides: { code: off }', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L1',
                code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                severity: 'error',
                section: '',
                message: 'schema bad',
            },
        ];
        const origWrite = process.stderr.write;
        process.stderr.write = () => true;
        const result = svc.summarizeWithStatus('testing', findings, false, {
            [FINDING_CODES.L1_SCHEMA_VALIDATION]: 'off',
        });
        process.stderr.write = origWrite;
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });

    test('advisory L3 warning is still suppressed by severityOverrides: { code: off }', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L3',
                code: FINDING_CODES.L3_SCOPE_DELINEATION,
                severity: 'warning',
                section: 'Scope',
                message: 'no in/out',
            },
        ];
        // Call through the protected helper because TestCheckService's subclass
        // shim exposes a 3-arg signature only.
        const protectedCall = (
            svc as unknown as {
                summarizeWithStatus: (
                    s: string,
                    f: CheckFindings[],
                    strict: boolean,
                    overrides: Record<string, 'error' | 'warning' | 'off'>,
                ) => CheckResultBase;
            }
        ).summarizeWithStatus;
        const result = protectedCall('testing', findings, false, {
            [FINDING_CODES.L3_SCOPE_DELINEATION]: 'off',
        });
        expect(result.findings).toHaveLength(0);
        expect(result.pass).toBe(true);
    });

    test('essential L4 malformed-verdict error survives accepted-map suppression', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L4',
                code: FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT,
                severity: 'error',
                section: '',
                message: 'malformed',
            },
        ];
        const accepted = new Map<string, CorpusSeverity>([
            [`task:0810:${FINDING_CODES.L4_MALFORMED_VERDICT_ARTIFACT}`, 'error'],
        ]);
        // Re-call with the full 6-arg signature to exercise the accepted branch.
        // TestCheckService only exposes a 3-arg overload; fall back to the
        // protected helper through a cast.
        const protectedCall = (
            svc as unknown as {
                summarizeWithStatus: (
                    s: string,
                    f: CheckFindings[],
                    strict: boolean,
                    overrides: undefined,
                    accepted: Map<string, CorpusSeverity>,
                    id: string,
                ) => CheckResultBase;
            }
        ).summarizeWithStatus;
        const result = protectedCall('testing', findings, false, undefined, accepted, '0810');
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });
});

// ─── summarizeWithStatus ──────────────────────────────────────────────────

describe('PlanningCheckService.summarizeWithStatus', () => {
    test('returns pass=true when there are no findings', () => {
        const svc = new TestCheckService(simpleMatrix);
        const result = svc.summarizeWithStatus('backlog', []);
        expect(result).toMatchObject({
            status: 'backlog',
            findings: [],
            requiredSections: [],
            missingSections: [],
            pass: true,
        });
    });

    test('returns pass=true when only warnings are present', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Missing required section "X"',
            },
        ];
        const result = svc.summarizeWithStatus('backlog', findings);
        expect(result.pass).toBe(true);
    });

    test('returns pass=false when an error is present', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L1',
                code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                severity: 'error',
                section: '',
                message: 'Schema: bad',
            },
        ];
        const result = svc.summarizeWithStatus('backlog', findings);
        expect(result.pass).toBe(false);
    });

    test('elevates warnings to errors when strict is true', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Missing required section "X"',
            },
        ];
        const result = svc.summarizeWithStatus('backlog', findings, true);
        expect(findings[0]?.severity).toBe('error');
        expect(result.pass).toBe(false);
    });

    test('does not elevate warnings when strict is false', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Missing required section "X"',
            },
        ];
        const result = svc.summarizeWithStatus('backlog', findings, false);
        expect(findings[0]?.severity).toBe('warning');
        expect(result.pass).toBe(true);
    });

    test('elevates only warnings, leaving errors as errors', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Missing required section "X"',
            },
            {
                layer: 'L1',
                code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                severity: 'error',
                section: '',
                message: 'Schema: bad',
            },
        ];
        svc.summarizeWithStatus('backlog', findings, true);
        expect(findings[0]?.severity).toBe('error');
        expect(findings[1]?.severity).toBe('error');
    });

    test('derives requiredSections and missingSections from L2 "Missing required" findings', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'Background',
                message: 'Missing required section "Background"',
            },
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'Solution',
                message: 'Missing required section "Solution"',
            },
            // Non-missing L2 finding should NOT appear in requiredSections
            {
                layer: 'L2',
                code: FINDING_CODES.L2_DISALLOWED_SECTION,
                severity: 'warning',
                section: 'Design',
                message: 'Section "Design" is not allowed',
            },
            // L1 finding should not appear either
            {
                layer: 'L1',
                code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                severity: 'error',
                section: '',
                message: 'Schema: bad',
            },
        ];
        const result = svc.summarizeWithStatus('done', findings);
        expect(result.requiredSections).toEqual(['Background', 'Solution']);
        expect(result.missingSections).toEqual(['Background', 'Solution']);
    });

    test('does not derive requiredSections from L2 findings whose message does not start with "Missing required"', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_FORBIDDEN_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Section "X" is forbidden for the current status',
            },
        ];
        const result = svc.summarizeWithStatus('backlog', findings);
        expect(result.requiredSections).toEqual([]);
        expect(result.missingSections).toEqual([]);
    });

    test('stops checking for errors after finding the first error', () => {
        const svc = new TestCheckService(simpleMatrix);
        // The loop breaks on first error — verify it still reports pass=false
        // with a mix of warnings before the error.
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'A',
                message: 'Missing required section "A"',
            },
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'B',
                message: 'Missing required section "B"',
            },
            {
                layer: 'L1',
                code: FINDING_CODES.L1_SCHEMA_VALIDATION,
                severity: 'error',
                section: '',
                message: 'Schema: bad',
            },
            {
                layer: 'L3',
                code: FINDING_CODES.L3_SOLUTION_FILE_LINE,
                severity: 'error',
                section: 'C',
                message: 'Format error',
            },
        ];
        const result = svc.summarizeWithStatus('done', findings);
        expect(result.pass).toBe(false);
    });

    test('returns the status string in the result', () => {
        const svc = new TestCheckService(simpleMatrix);
        const result = svc.summarizeWithStatus('verifying', []);
        expect(result.status).toBe('verifying');
    });

    test('strict with no findings still passes', () => {
        const svc = new TestCheckService(simpleMatrix);
        const result = svc.summarizeWithStatus('backlog', [], true);
        expect(result.pass).toBe(true);
    });

    test('mutates the findings array in place (strict elevation)', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [
            {
                layer: 'L2',
                code: FINDING_CODES.L2_MISSING_REQUIRED_SECTION,
                severity: 'warning',
                section: 'X',
                message: 'Missing required section "X"',
            },
        ];
        svc.summarizeWithStatus('backlog', findings, true);
        // The original findings array is mutated — severity changed to 'error'
        expect(findings[0]?.severity).toBe('error');
    });
});

// ─── Integration: L1 → L2 → summarize pipeline ───────────────────────────

describe('PlanningCheckService end-to-end pipeline', () => {
    test('valid task document passes all layers', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [];

        const doc = svc.runL1(taskDoc(['Background', 'Notes']), '0001', findings);
        expect(doc).not.toBeNull();
        if (!doc) return;

        const entry = svc.resolveMatrixEntry('standard', 'backlog');
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        const result = svc.summarizeWithStatus('backlog', findings);

        expect(result.pass).toBe(true);
        expect(result.findings).toEqual([]);
    });

    test('task with missing required section produces warning and passes without strict', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [];

        const doc = svc.runL1(taskDoc(['Notes']), '0001', findings); // missing Background
        expect(doc).not.toBeNull();
        if (!doc) return;

        const entry = svc.resolveMatrixEntry('standard', 'backlog');
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        const result = svc.summarizeWithStatus('backlog', findings);

        expect(result.pass).toBe(true);
        expect(result.missingSections).toEqual(['Background']);
        expect(result.requiredSections).toEqual(['Background']);
    });

    test('task with missing required section fails under strict', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [];

        const doc = svc.runL1(taskDoc(['Notes']), '0001', findings);
        expect(doc).not.toBeNull();
        if (!doc) return;

        const entry = svc.resolveMatrixEntry('standard', 'backlog');
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        const result = svc.summarizeWithStatus('backlog', findings, true);

        expect(result.pass).toBe(false);
    });

    test('task with gate:true status and missing required fails even without strict', () => {
        const svc = new TestCheckService(simpleMatrix);
        const findings: CheckFindings[] = [];

        // No sections — only frontmatter. The done entry requires Solution + Testing.
        const doc = svc.runL1(taskDoc([], { status: 'done' }), '0001', findings);
        expect(doc).not.toBeNull();
        if (!doc) return;

        const entry = svc.resolveMatrixEntry('standard', 'done');
        svc.runL2(doc, entry, findings, doc.bodyWithoutFrontmatter);
        const result = svc.summarizeWithStatus('done', findings);

        expect(result.pass).toBe(false);
        // gate:true makes missing required → error; no other sections present
        // means no closed-world warnings, so all findings are errors.
        expect(findings.every((f) => f.severity === 'error')).toBe(true);
        expect(result.missingSections).toEqual(['Solution', 'Testing']);
    });
});
