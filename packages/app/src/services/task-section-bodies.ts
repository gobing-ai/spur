import { type MarkdownDocument, SECTION_GUIDANCE, type TaskSection } from '@gobing-ai/spur-domain';

/**
 * Normalize a Requirements body to a bulleted markdown list. R-numbered items
 * written as one run-on paragraph (`R1. … R2. …`) become one `- Rn. …` line
 * each, so they render as a clear list in a markdown viewer (dogfood issue #2).
 * Already-bulleted or multi-line input is returned unchanged.
 */
export function bulletizeRequirements(raw: string): string {
    const text = raw.trim();
    if (text === '') return text;
    // Already a bullet/numbered list or multi-line — leave as authored.
    if (/\n/.test(text) || /^\s*[-*]\s/.test(text)) return text;
    const parts = text
        .split(/(?=\bR\d+\.)/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    if (parts.length <= 1) return text;
    return parts.map((p) => `- ${p}`).join('\n');
}

/**
 * Strip a redundant leading section header from `--from-file` body content (R1, task 0115).
 *
 * Agents naturally write a full section (`## Acceptance Criteria\n\n- [ ] AC1 …`) to the
 * temp file, but `--section` already names the section and the CLI supplies the canonical
 * heading. A leading heading line whose text matches `sectionName` (any level `#`–`######`,
 * case-insensitive) is therefore a duplicate — strip it and the blank lines that follow so
 * the body handed to `replaceSection` starts at the first real content line (no triple-newline
 * gap, no visual duplicate header). A heading that does NOT match the section name is left
 * alone — `replaceSection`'s same-level strip (R2) handles any phantom risk.
 */
export function stripLeadingSectionHeader(body: string, sectionName: string): string {
    const match = body.match(/^(\s*)#{1,6}\s+(.+?)\s*(?:\n|$)/);
    if (match === null) return body;
    const headingText = (match[2] ?? '').trim();
    if (headingText.toLowerCase() !== sectionName.trim().toLowerCase()) return body;
    // Remove the heading line plus any leading whitespace and the blank lines after it.
    return body.slice(match[0].length).replace(/^\n+/, '');
}

// ─── Section bareness — used by pipeline steps to decide when to write ──

/**
 * Returns `true` if a named section is absent, empty/whitespace-only, guidance-comment-only,
 * or a known pipeline placeholder (the old `printf 'Pipeline run …'` stub).
 *
 * Used by the implement step (write `Solution` only when bare, never clobber
 * a hand-authored change-map) and the record step (backfill `Solution` safety-net,
 * skip `Testing`/`Review` if verify already populated them).
 */
export function sectionIsBare(doc: MarkdownDocument, name: string): boolean {
    if (!doc.hasSection(name)) return true;
    const body = doc.getSection(name);
    if (body === null) return true;
    const trimmed = body.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (trimmed === '') return true;
    // Old pipeline placeholder: "Pipeline run <wbs> — …"
    if (/^Pipeline run \d{4}\b/.test(trimmed)) return true;
    return false;
}

/**
 * Render the placeholder body for a canonical task section — the one-line
 * guidance comment from `SECTION_GUIDANCE` wrapped in `<!-- ... -->`, matching
 * `buildTaskSkeleton`'s rendering (so `sections add` and `sections init`
 * produce the same artifact as `task create`). `History` (machine-owned) and
 * unknown sections render an empty body.
 */
export function renderSectionGuidanceBody(name: TaskSection): string {
    const guidance = SECTION_GUIDANCE[name];
    if (guidance === undefined) return '';
    if (name === 'History') return '';
    return `<!-- ${guidance} -->`;
}
