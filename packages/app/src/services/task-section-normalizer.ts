// 1132 R1 — write-time lossless normalization for task section bodies.
//
// `task update --section` and `task batch-create` accept loose authoring shapes
// (bold-wrapped requirement headings, `R2:` / `R3 -` prefixes, bare AC bullets) that
// `spur task check` rejects after the fact. Normalizing AT THE WRITE removes the
// write/check rewrite loop while keeping the author's wording byte-for-byte. The R-item
// regex is shared with structural-repair.ts (single source — same predicate `task check`
// uses for L3.requirements-checkbox).

import { REQUIREMENT_LINE_RE } from './structural-repair';

/** One normalization applied to a section body (or its frontmatter). */
export interface NormalizedSectionInfo {
    readonly section: string;
    readonly kind: 'requirement' | 'acceptance' | 'ac-altitude';
    readonly count: number;
}

/** Result of normalizing one section body (1132 R1). */
export interface SectionNormalizationResult {
    /** Body to persist (same string when nothing changed). */
    readonly body: string;
    readonly normalized: NormalizedSectionInfo[];
    /** Frontmatter keys to merge when the section shape implies them (gherkin-only AC). */
    readonly frontmatter?: Record<string, string>;
}

/** Detect gherkin-only AC bodies: every scenario binds `(req: Rn)` and there are no bare bullet items. */
function isGherkinOnlyAc(body: string): boolean {
    const lines = body.split('\n').filter((l) => l.trim() !== '');
    if (lines.length === 0) return false;
    let scenarioCount = 0;
    let boundCount = 0;
    let hasBullets = false;
    for (const line of lines) {
        if (/^\s*[-*]\s+/.test(line)) hasBullets = true;
        const s = /^\s*Scenario(?:\s+Outline)?:\s*(.*)$/.exec(line);
        if (s !== null) {
            scenarioCount++;
            if (/\(req:\s*[^)]*\)/i.test(s[1] ?? '')) boundCount++;
        }
    }
    return scenarioCount > 0 && !hasBullets && scenarioCount === boundCount;
}

/**
 * Normalizes a single requirement line if it uses loose formatting.
 * Handles:
 * - Bold headings: `- **R1 Lock.** text`, `- **R1.** text`, `- **R1** text`, `**R1: Lock.** text`
 * - Colons/dashes: `R2: text`, `- R3 - text`, `- R3: text`, `R3 - text`
 * - Plain unadorned: `R4. text`, `- R4 text`
 * Returns the normalized line and whether it changed.
 */
function normalizeRequirementLine(line: string): { normalized: string; changed: boolean } {
    const indentMatch = /^(\s*)/.exec(line);
    const indent = indentMatch?.[1] ?? '';
    const trimmed = line.slice(indent.length);

    if (!trimmed || trimmed.startsWith('#')) return { normalized: line, changed: false };
    // Already checkboxed: canonical form, and `task check` binds bold R-items too — leave it
    // byte-for-byte (the same skip predicate `requirementsMissingCheckbox` applies).
    if (/\[[ xX]\]/.test(trimmed)) return { normalized: line, changed: false };

    // 1. Bold R-items: - **R1 Lock.** text / **R1.** text / **R1** text
    //    The bullet group requires trailing whitespace so a bare `**R1**` is not read as a
    //    `*` bullet followed by a `*R1**` emphasis run (which ate one asterisk of the run).
    const boldMatch = /^(?:[-*][ \t]+)?([*_]{1,2})R(\d+)[.:]?(.*?)\1[ \t]*(.*)$/.exec(trimmed);
    if (boldMatch !== null) {
        const num = boldMatch[2];
        const insideBold = boldMatch[3]?.trim() ?? '';
        const outside = boldMatch[4]?.trim() ?? '';
        const rest = [insideBold, outside].filter((s) => s !== '').join(' ');
        const res = `${indent}- [ ] R${num}.${rest ? ` ${rest}` : ''}`;
        return { normalized: res, changed: res !== line };
    }

    // 2. Non-bold R-items: R2: text / - R3 - text / R4. text / - R5 text
    //    The separator is consumed HERE so the text is taken verbatim — a second strip pass
    //    would eat a leading character that belongs to the wording (`R2: -1 degree` lost its
    //    sign). A bare `R4--` matches no separator and is left alone (the checker never flags it).
    const plainMatch = /^(?:[-*][ \t]+)?R(\d+)(?::|\.|\s+[-–—:]\s*|\s+|\s*$)(.*)$/.exec(trimmed);
    if (plainMatch !== null) {
        const num = plainMatch[1];
        const rest = plainMatch[2]?.trim() ?? '';
        const res = `${indent}- [ ] R${num}.${rest ? ` ${rest}` : ''}`;
        return { normalized: res, changed: res !== line };
    }

    // 3. Fallback — the checker's own predicate flagged this line (e.g. a malformed emphasis
    //    run like `- R1**`), so rebuild from ITS groups instead of leaving a line that
    //    `task check` would keep bouncing. This is what makes the two predicates share one
    //    "is this an R-item" answer while the branches above stay a superset by design (the
    //    checker does not flag `R2: text`, and R1 exists to normalize exactly those shapes).
    const checkMatch = REQUIREMENT_LINE_RE.exec(trimmed);
    if (checkMatch !== null) {
        const num = checkMatch[3];
        const text = (checkMatch[4] ?? '').replace(/^[*_\s]+/, '').trim();
        const res = `${indent}- [ ] R${num}.${text ? ` ${text}` : ''}`;
        return { normalized: res, changed: res !== line };
    }

    return { normalized: line, changed: false };
}

/**
 * Track fenced-code state line by line (1132 review P4, direct fix). A fenced block is documentation,
 * not authoring: rewriting `- R2. …` inside a ``` fence silently corrupts a syntax example the author
 * wrote on purpose. The AC gherkin detector deliberately still looks INSIDE fences (the canonical AC
 * form wraps its scenarios in one), so only the line-rewriting passes skip fenced lines.
 */
function fenceAwareLines(body: string): Array<{ line: string; fenced: boolean }> {
    let inFence = false;
    return body.split('\n').map((line) => {
        const isDelimiter = /^\s*(```|~~~)/.test(line);
        const fenced = inFence || isDelimiter;
        if (isDelimiter) inFence = !inFence;
        return { line, fenced };
    });
}

/**
 * Normalize one task section body losslessly (1132 R1). Returns the body to write plus
 * what changed, so the caller can report `normalized: [{section, kind, count}]` in
 * `--json` and merge implied frontmatter keys. Wording is never reworded.
 */
export function normalizeTaskSection(name: string, body: string): SectionNormalizationResult {
    if (name === 'Requirements') {
        let count = 0;
        const normalized = fenceAwareLines(body).map(({ line, fenced }) => {
            if (fenced) return line;
            const { normalized: next, changed } = normalizeRequirementLine(line);
            if (changed) count++;
            return next;
        });
        if (count === 0) return { body, normalized: [] };
        return { body: normalized.join('\n'), normalized: [{ section: name, kind: 'requirement', count }] };
    }
    if (name === 'Acceptance Criteria') {
        if (isGherkinOnlyAc(body)) {
            return {
                body,
                normalized: [{ section: name, kind: 'ac-altitude', count: 1 }],
                frontmatter: { ac_altitude: 'task-local', ac_numbering: 'task-local' },
            };
        }
        let count = 0;
        const normalized = fenceAwareLines(body).map(({ line, fenced }) => {
            if (fenced) return line;
            // 1132 review P2: an existing box is never flipped — rewriting a checked AC to an
            // open one would silently arm the hard `L3.unchecked-checklist` error at a
            // transition target. Only the bare `- AC1 …` authoring shape is normalized.
            if (/\[[ xX]\]/.test(line)) return line;
            const m = /^(\s*)[-*]\s+AC(\d+)\.?(?:\s*[:—–-]\s*|\s+)(.*)$/.exec(line);
            if (m === null) return line;
            const [, indent = '', num, text = ''] = m;
            const rest = text.trim();
            const res = `${indent}- [ ] AC${num} — ${rest}`;
            if (res !== line) {
                count++;
                return res;
            }
            return line;
        });
        if (count === 0) return { body, normalized: [] };
        return { body: normalized.join('\n'), normalized: [{ section: name, kind: 'acceptance', count }] };
    }
    return { body, normalized: [] };
}
