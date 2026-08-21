/**
 * Structural repair engine for task/feature corpus files (task 0619).
 *
 * Repairs are limited to heading presence, heading level, section order, and
 * R-item checkbox form — the shapes a check can derive from the section matrix.
 * It never authors section content: an empty section is inserted as a bare
 * heading, prose is never rewritten, and acceptance-criteria bodies are never
 * touched. Off-variant sections (disallowed/forbidden) are reported and left in
 * place — there is deliberately no section-delete verb.
 *
 * The engine is a pure string transform: input markdown → output markdown.
 * A file with nothing structural to repair returns its input byte-identical
 * (`changed === false`), which is the trust property (R4/R15).
 */

import { FEATURE_CANONICAL_SECTIONS, type MarkdownDomain, TASK_CANONICAL_SECTIONS } from '@gobing-ai/spur-domain';

import { type CheckFindings, FINDING_CODES, type MatrixEntry } from './planning-check-base';

/** One applied repair, rendered by the CLI in the per-file report. */
export interface StructuralRepair {
    kind: 'heading-level' | 'section-order' | 'missing-section' | 'requirement-checkbox';
    section: string;
    detail: string;
}

/** Result of applying structural repairs: the (possibly unchanged) content plus the applied repairs. */
export interface RepairResult {
    content: string;
    changed: boolean;
    repairs: StructuralRepair[];
}

/** Heading level per domain: tasks use `###` (3), features use `##` (2). */
const LEVEL: Record<MarkdownDomain, number> = { task: 3, feature: 2 };

/** Canonical section order per domain. */
function canonicalOrder(domain: MarkdownDomain): readonly string[] {
    return (domain === 'task' ? TASK_CANONICAL_SECTIONS : FEATURE_CANONICAL_SECTIONS) as readonly string[];
}

const FM_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

/** Split raw content into `{ frontmatter, body }`, keeping byte-exact spans. */
function splitFrontmatter(content: string): { frontmatter: string; body: string } {
    const m = FM_RE.exec(content);
    if (m && m.index === 0) {
        return { frontmatter: m[0], body: content.slice(m[0].length) };
    }
    return { frontmatter: '', body: content };
}

/** A heading line in the body, with its byte offset and the domain-level flag. */
interface HeadingLine {
    /** Character offset of the line start within the body. */
    start: number;
    /** Original line text without the trailing newline. */
    line: string;
    hashes: number;
    name: string;
    atLevel: boolean;
}

/** Scan the body for heading lines at line-start, tracking fenced code blocks. */
function scanHeadings(body: string, level: number): HeadingLine[] {
    const headings: HeadingLine[] = [];
    let inCodeBlock = false;
    let lineStart = 0;
    for (let i = 0; i <= body.length; i++) {
        const atEnd = i === body.length;
        if (!atEnd && body[i] !== '\n') continue;
        const line = body.slice(lineStart, i);
        if (line.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
        } else {
            const m = /^(#{1,6}) (.+)$/.exec(line);
            if (m !== null && !inCodeBlock) {
                const hashes = (m[1] ?? '').length;
                headings.push({
                    start: lineStart,
                    line,
                    hashes,
                    name: (m[2] ?? '').trim(),
                    atLevel: hashes === level,
                });
            }
        }
        lineStart = i + 1;
    }
    return headings;
}

/** R-numbered requirement lines lacking the `[ ] ` checkbox marker. */
function requirementsMissingCheckbox(body: string): Array<{ index: number; bullet: string }> {
    const out: Array<{ index: number; bullet: string }> = [];
    for (const [i, line] of body.split('\n').entries()) {
        if (/\[[ xX]\]/.test(line)) continue;
        const m = /^(\s*)([-*])?\s*R\d+\.?(\s.*)?$/.exec(line);
        if (m !== null) out.push({ index: i, bullet: m[2] ?? '' });
    }
    return out;
}

/** The corrected heading set: wrong-level canonical headings promoted to at-level. */
function correctedHeadings(headings: HeadingLine[], level: number, canonical: ReadonlySet<string>): HeadingLine[] {
    return headings.map((h) =>
        h.atLevel || !canonical.has(h.name)
            ? h
            : { start: h.start, line: h.line, hashes: level, name: h.name, atLevel: true },
    );
}

/**
 * Detect the structural findings `--fix` can repair, so a plain check surfaces
 * the same shapes (R5). Returns findings only — never mutates.
 */
export function structuralFindings(content: string, domain: MarkdownDomain): CheckFindings[] {
    const findings: CheckFindings[] = [];
    const level = LEVEL[domain];
    const order = canonicalOrder(domain);
    const { body } = splitFrontmatter(content);
    const headings = scanHeadings(body, level);
    const canonical = new Set<string>(order);

    for (const h of headings) {
        if (h.atLevel || !canonical.has(h.name)) continue;
        findings.push({
            layer: 'L2',
            code: FINDING_CODES.L2_HEADING_LEVEL,
            severity: 'warning',
            section: h.name,
            message: `Section "${h.name}" uses ${h.hashes} heading level; expected ${level} (${'#'.repeat(level)} ${h.name})`,
        });
    }

    const corrected = correctedHeadings(headings, level, canonical);
    const atLevel = corrected.filter((h) => h.atLevel);
    const presentCanonical = atLevel.filter((h) => canonical.has(h.name));
    const allCanonical = atLevel.length === presentCanonical.length;
    const ranked = presentCanonical.map((h) => order.indexOf(h.name));
    const sorted = [...ranked].sort((a, b) => a - b);
    const outOfOrder = ranked.some((r, i) => r !== (sorted[i] ?? -1));
    if (allCanonical && outOfOrder && presentCanonical.length > 1) {
        findings.push({
            layer: 'L2',
            code: FINDING_CODES.L2_SECTION_ORDER,
            severity: 'warning',
            section: '',
            message: `Sections are out of canonical order: ${presentCanonical
                .map((h) => h.name)
                .join(' → ')} (expected ${order.join(' → ')})`,
        });
    }

    const reqHeading = atLevel.find((h) => h.name === 'Requirements');
    if (reqHeading !== undefined) {
        const bodyStart = reqHeading.start + reqHeading.line.length + 1;
        const next = atLevel.find((h) => h.start > reqHeading.start);
        const bodyEnd = next !== undefined ? next.start : body.length;
        const missing = requirementsMissingCheckbox(body.slice(bodyStart, bodyEnd));
        if (missing.length > 0) {
            findings.push({
                layer: 'L3',
                code: FINDING_CODES.L3_REQUIREMENTS_CHECKBOX,
                severity: 'warning',
                section: 'Requirements',
                message: `${missing.length} R-item(s) missing the checkbox marker — write as "- [ ] R1. …"`,
            });
        }
    }

    return findings;
}

/**
 * Apply the structural repairs. Returns the repaired content (byte-identical
 * when nothing was repairable) and the list of repairs.
 */
export function applyStructuralRepairs(
    content: string,
    domain: MarkdownDomain,
    entry: MatrixEntry | undefined,
): RepairResult {
    const repairs: StructuralRepair[] = [];
    const level = LEVEL[domain];
    const order = canonicalOrder(domain);
    const canonical = new Set<string>(order);
    const { frontmatter, body } = splitFrontmatter(content);
    const headings = scanHeadings(body, level);

    // ── 1. Heading level: rewrite wrong-depth canonical headings ──
    const levelEdits = new Map<number, string>();
    for (const h of headings) {
        if (h.atLevel || !canonical.has(h.name)) continue;
        const fixed = `${'#'.repeat(level)} ${h.name}`;
        levelEdits.set(h.start, fixed);
        repairs.push({
            kind: 'heading-level',
            section: h.name,
            detail: `"${h.line.trim()}" → "${fixed.trim()}"`,
        });
    }

    // Corrected heading set (level edits conceptually applied).
    const corrected = correctedHeadings(headings, level, canonical);
    const atLevel = corrected.filter((h) => h.atLevel);

    // Lead: everything before the first at-level section heading (title, preamble).
    const leadStart = atLevel.length > 0 ? (atLevel[0]?.start ?? 0) : body.length;
    const lead = body.slice(0, leadStart);

    // Section blocks in document order.
    interface SectionBlock {
        name: string;
        heading: string;
        body: string;
        canonicalRank: number;
    }
    const blocks: SectionBlock[] = [];
    for (let i = 0; i < atLevel.length; i++) {
        const h = atLevel[i];
        if (h === undefined) continue;
        const next = atLevel[i + 1];
        const end = next !== undefined ? next.start : body.length;
        const headingLine = levelEdits.get(h.start) ?? h.line;
        const bodyStart = h.start + h.line.length + 1;
        blocks.push({
            name: h.name,
            heading: headingLine,
            body: body.slice(bodyStart, end),
            canonicalRank: order.indexOf(h.name),
        });
    }

    // ── 2. Missing required sections (bare headings only — never content) ──
    const present = new Set<string>(blocks.map((b) => b.name));
    const missingNames = (entry?.required ?? [])
        .filter((n) => !present.has(n) && canonical.has(n))
        .sort((a, b) => order.indexOf(a) - order.indexOf(b));
    for (const name of missingNames) {
        repairs.push({
            kind: 'missing-section',
            section: name,
            detail: `inserted empty "${'#'.repeat(level)} ${name}"`,
        });
    }

    // ── 3. Section order (only when every present at-level section is canonical) ──
    const presentCanonical = blocks.filter((b) => b.canonicalRank >= 0);
    const allCanonical = blocks.length === presentCanonical.length;
    const ranked = presentCanonical.map((b) => b.canonicalRank);
    const sortedRanks = [...ranked].sort((a, b) => a - b);
    const outOfOrder = ranked.some((r, i) => r !== (sortedRanks[i] ?? -1));
    const reorder = allCanonical && outOfOrder && presentCanonical.length > 1;
    if (reorder) {
        repairs.push({
            kind: 'section-order',
            section: '',
            detail: `reordered to ${[...presentCanonical]
                .sort((a, b) => a.canonicalRank - b.canonicalRank)
                .map((b) => b.name)
                .join(' → ')}`,
        });
    }

    // ── 4. R-item checkbox form inside Requirements ──
    const reqBlock = blocks.find((b) => b.name === 'Requirements');
    let reqRepairs: Array<{ index: number; bullet: string }> = [];
    if (reqBlock !== undefined) {
        reqRepairs = requirementsMissingCheckbox(reqBlock.body);
        if (reqRepairs.length > 0) {
            repairs.push({
                kind: 'requirement-checkbox',
                section: 'Requirements',
                detail: `${reqRepairs.length} R-item(s) gained the "[ ] " checkbox marker`,
            });
        }
    }

    if (repairs.length === 0) {
        return { content, changed: false, repairs: [] };
    }

    // ── Assemble ──
    const orderedBlocks = reorder ? [...presentCanonical].sort((a, b) => a.canonicalRank - b.canonicalRank) : blocks;
    const emitted = new Set<string>();
    const rendered: string[] = [];
    for (const b of orderedBlocks) {
        emitted.add(b.name);
        let blockBody = b.body;
        if (b.name === 'Requirements' && reqRepairs.length > 0) {
            const lines = blockBody.split('\n');
            for (const rr of reqRepairs) {
                const orig = lines[rr.index];
                if (orig === undefined) continue;
                const leadWs = /^(\s*)/.exec(orig)?.[1] ?? '';
                const rest = orig.slice(leadWs.length).replace(/^[-*]\s*/, '');
                lines[rr.index] = `${leadWs}${rr.bullet === '' ? '- [ ]' : `${rr.bullet} [ ]`} ${rest}`;
            }
            blockBody = lines.join('\n');
        }
        rendered.push(`${b.heading}\n${blockBody}`);
    }
    // Off-variant (non-canonical) blocks keep their original relative position.
    for (const b of blocks) {
        if (!emitted.has(b.name)) {
            rendered.push(`${b.heading}\n${b.body}`);
        }
    }

    // Insert missing sections at their canonical rank among the rendered blocks.
    if (missingNames.length > 0) {
        for (const name of missingNames) {
            const rank = order.indexOf(name);
            const at = rendered.findIndex((blk) => {
                const headingName = /^#{1,6} (.+)$/.exec(blk.split('\n')[0] ?? '')?.[1]?.trim() ?? '';
                return canonical.has(headingName) && order.indexOf(headingName) > rank;
            });
            const heading = `${'#'.repeat(level)} ${name}\n`;
            const prev = at === -1 ? rendered[rendered.length - 1] : rendered[at - 1];
            const sep = prev !== undefined && !prev.endsWith('\n\n') ? '\n' : '';
            rendered.splice(at === -1 ? rendered.length : at, 0, `${sep}${heading}\n`);
        }
    }

    const result = frontmatter + lead + rendered.join('');
    const changed = result !== content;
    return { content: result, changed, repairs };
}
