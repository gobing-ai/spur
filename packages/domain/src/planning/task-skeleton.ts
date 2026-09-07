/**
 * Task body skeleton builder — the single producer of a new task file's section
 * layout. Both `spur task create` and `spur task batch-create` render through
 * here, so the section set, order, and guidance markers live in ONE place
 * instead of duplicated inline in the service (the drift that shipped empty,
 * vocabulary-violating sections at creation).
 *
 * Design authority: rd3-migration-design.md §2.1 (canonical vocabulary, DD-08),
 * §3.2 (Section-Status-Matrix drives WHICH sections a given status carries).
 *
 * Layering: this module renders the markdown for a *resolved* section list — it
 * does NOT read the matrix (config lives app-side). The caller resolves
 * status → sections from the shipped `tasks/section-matrix.yaml` and passes the
 * ordered list. Domain owns the vocabulary + the per-section guidance; the app
 * owns matrix resolution. Keeps domain free of app/config imports.
 */

import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import { MarkdownDocument, TASK_CANONICAL_SECTIONS } from './markdown-document';

/** A canonical task section name (DD-08). */
export type TaskSection = (typeof TASK_CANONICAL_SECTIONS)[number];

/** Zod enum over the canonical section vocabulary — rejects typo'd section names. */
const sectionNameSchema = z.enum(TASK_CANONICAL_SECTIONS as unknown as [TaskSection, ...TaskSection[]]);

/** Per-status matrix entry: required / optional / forbidden section lists + gate flag. */
export const matrixEntrySchema = z
    .object({
        required: z.array(sectionNameSchema).optional(),
        optional: z.array(sectionNameSchema).optional(),
        forbidden: z.array(sectionNameSchema).optional(),
        gate: z.boolean().optional(),
    })
    .strict();

/** Valid status keys inside a variant. */
const matrixStatusSchema = z.enum(['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled']);

/**
 * Zod SSOT for the shipped `tasks/section-matrix.yaml`. Mirrors
 * `apps/cli/schemas/section-matrix.schema.json` (the editor/CI aid). Validating
 * the matrix on load turns a typo'd section name or status key into a clear
 * error instead of a silently-ignored rule (the "dead rule" failure mode).
 */
export const sectionMatrixSchema = z
    .object({
        // partialRecord: a variant may declare any SUBSET of the status keys
        // (a plain z.record over a Zod enum key would require all 7 exhaustively).
        variants: z.record(z.string(), z.partialRecord(matrixStatusSchema, matrixEntrySchema)),
    })
    .strict();

/** Inferred type for the validated Section-Status-Matrix. */
export type SectionMatrixConfig = z.infer<typeof sectionMatrixSchema>;

/**
 * One-line authoring guidance per section, emitted as an HTML comment under the
 * heading so it renders invisibly in a markdown viewer but guides the author
 * (human or agent) on WHAT belongs there — and, for Design/Solution, on the
 * code-budget rule that keeps task files reviewable (the legacy "too much code"
 * failure mode). Comments are stripped by no tooling and ignored by the BDD /
 * format validators, so they never affect `spur task check`.
 */
const SECTION_GUIDANCE: Record<TaskSection, string> = {
    Background:
        'Why this task exists: the problem, motivation, and context. Self-contained — readable without the parent.',
    Requirements:
        'Optional R-numbered list (R1., R2., …) — referenceable items that map 1:1 to Acceptance Criteria scenarios.',
    'Acceptance Criteria':
        'System-tone Given/When/Then (what the SYSTEM does), or a `- [ ]` checklist for sub-tasks. Drives UAT and L4 coverage.',
    'Q&A': 'Open questions and their resolutions. Delete if none.',
    Design: 'Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX.',
    Plan: 'Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task.',
    Solution:
        'Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each; ≤8-line snippets only for non-obvious logic. NO full-function dumps. (Filled at `wip`/`testing`.)',
    'Root Cause': 'For issue/bug tasks: the verified underlying cause, with a `file:line` anchor.',
    Testing: 'Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.)',
    Review: 'P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.)',
    References: 'Links to design docs, ADRs, related tasks/features.',
    History: 'Auto-appended transition log — leave empty at creation.',
};

/** Options controlling skeleton rendering. */
export interface TaskSkeletonOptions {
    /** Allocated WBS (e.g. `0090`). */
    readonly wbs: string;
    /** Task title (the `## <WBS>. <title>` heading). */
    readonly title: string;
    /** YAML frontmatter body (between the `---` fences, without the fences). */
    readonly frontmatter: string;
    /**
     * Sections to emit, in any order — they are sorted into canonical order and
     * de-duplicated. Unknown names are ignored (closed-world, DD-08). Typically
     * the matrix `required ∪ optional` for the creation status.
     */
    readonly sections: readonly string[];
    /**
     * Pre-filled section bodies (e.g. feature-derived Background, R-numbered
     * Requirements). Keyed by canonical section name; missing keys render the
     * guidance comment only.
     */
    readonly bodies?: Partial<Record<TaskSection, string>>;
    /** Emit per-section guidance comments. Default true. */
    readonly guidance?: boolean;
}

const CANONICAL_INDEX = new Map<string, number>(TASK_CANONICAL_SECTIONS.map((s, i) => [s, i]));

function isTaskSection(name: string): name is TaskSection {
    return CANONICAL_INDEX.has(name);
}

/**
 * Render a new task file's full markdown from a frontmatter block + a resolved
 * section list. Sections are emitted in canonical order; each carries either its
 * provided body or (when enabled) a one-line guidance comment. `History` never
 * gets a guidance line (it is machine-appended).
 */
export function buildTaskSkeleton(options: TaskSkeletonOptions): string {
    const { wbs, title, frontmatter, sections, bodies = {}, guidance = true } = options;

    const ordered = [...new Set(sections)]
        .filter(isTaskSection)
        .sort((a, b) => (CANONICAL_INDEX.get(a) ?? 0) - (CANONICAL_INDEX.get(b) ?? 0));

    const lines: string[] = ['---', frontmatter, '---', '', `## ${wbs}. ${title}`, ''];

    for (const section of ordered) {
        lines.push(`### ${section}`, '');
        const body = bodies[section]?.trim();
        if (body !== undefined && body.length > 0) {
            lines.push(body, '');
        } else if (guidance && section !== 'History') {
            lines.push(`<!-- ${SECTION_GUIDANCE[section]} -->`, '');
        } else {
            lines.push('');
        }
    }

    return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * Serialize a task frontmatter OBJECT to the YAML block that sits between the
 * `---` fences (fences excluded). F21 task 0787 R4: this is the single writer
 * for creation frontmatter. Hand-interpolated `name: "${title}"` broke on
 * quotes, backslashes, and colons; the `yaml` emitter picks a scalar style
 * that parses back to exactly the input value, and the read side
 * (MarkdownDocument.parse) uses the same library — writer and reader cannot
 * drift. Key order = insertion order, so output is deterministic. Long plain
 * scalars are not folded (`lineWidth: 0`) so the block stays diff-friendly.
 */
export function serializeTaskFrontmatter(data: Record<string, unknown>): string {
    return stringifyYaml(data, { lineWidth: 0 });
}

/**
 * Extract per-section body overrides from a variant's scaffold template
 * (`templates/task/<variant>.md` shipped with the CLI). Returns only sections whose body has
 * real content (e.g. `review.md`'s P1–P4 table, `issue.md`'s structure), so the
 * producer can seed variant-specific boilerplate while leaving everything else to
 * the matrix + guidance fallback. The template's `{{ BACKGROUND }}` placeholder
 * is treated as empty (the producer fills Background itself). This keeps the
 * per-variant bodies DATA (in the template files), never hardcoded in the service.
 */
export function extractTemplateBodies(templateMarkdown: string): Partial<Record<TaskSection, string>> {
    const doc = MarkdownDocument.parse(templateMarkdown, 'task');
    const bodies: Partial<Record<TaskSection, string>> = {};
    for (const name of doc.sectionNames) {
        if (!CANONICAL_INDEX.has(name)) continue;
        const raw = doc.getSection(name);
        if (raw === null) continue;
        // getSection returns the body WITHOUT the heading line.
        const body = raw.replace(/\{\{\s*\w+\s*\}\}/g, '').trim();
        if (body.length === 0) continue;
        bodies[name as TaskSection] = body;
    }
    return bodies;
}

// ─────────────────────────────────────────────────────────────────────────
// Template rendering — "template as full skeleton" model
// ─────────────────────────────────────────────────────────────────────────

/** Variables substituted into task template placeholders. */
export interface TaskTemplateVars {
    /** Task title (replaces `{{ NAME }}`). */
    NAME: string;
    /** Allocated WBS number (replaces `{{ WBS }}`). */
    WBS: string;
    /** Background prose (replaces `{{ BACKGROUND }}`). */
    BACKGROUND: string;
    /** Creation timestamp in ISO 8601 (replaces `{{ CREATED_AT }}`). */
    CREATED_AT: string;
    /** Optional feature ID (replaces `{{ FEATURE_ID }}` in feature-impl template). */
    FEATURE_ID?: string;
}

/**
 * Render a task template by substituting `{{ PLACEHOLDER }}` tokens with real
 * values. This implements the "template as full skeleton" model: the template IS
 * the document structure; placeholders are FILLED, not stripped. Any remaining
 * unmatched `{{ ... }}` tokens are cleaned up.
 *
 * Design rationale: the old `buildTaskSkeleton` approach used the matrix to
 * decide which sections appear and extracted template body fragments — but this
 * silently dropped sections the template author intended (e.g. `### Review` in
 * `review.md`). Template-as-skeleton fixes that: the template owns the full
 * section layout; the matrix gates validation only.
 */
export function renderTaskTemplate(templateContent: string, vars: TaskTemplateVars): string {
    let rendered = templateContent;

    for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) continue;
        // Match {{KEY}} or {{ KEY }} (with optional spaces inside braces).
        // Replacer function: a literal value containing `$&`/`$1` must not be
        // interpreted as a replacement pattern (titles/backgrounds are user text).
        rendered = rendered.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), () => value);
    }

    // Clean up any remaining unmatched {{ ... }} placeholders
    rendered = rendered.replace(/\{\{\s*\w+\s*\}\}/g, '');

    return rendered;
}

/** Re-export the canonical guidance map for docs/skill generation and tests. */
export { SECTION_GUIDANCE };
