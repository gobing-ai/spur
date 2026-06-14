/**
 * Checklist parser — Tier-2 AC format (`- [ ]` / `- [x]` items).
 *
 * Parses markdown checklist items from an Acceptance Criteria section.
 * Each item may optionally reference a scenario by name via an R-id prefix
 * (e.g. `- [ ] R1: user can log in`) for requirement traceability.
 */

/** A parsed `- [ ]` or `- [x]` checklist item with optional R-id requirement prefix. */
export interface ChecklistItem {
    /** Raw item text after the checkbox marker. */
    text: string;
    /** Whether the item is checked (`- [x]`). */
    checked: boolean;
    /** 1-indexed line number in the source content. */
    line: number;
    /** Optional R-id prefix extracted from the text (e.g. "R1", "R2"). */
    requirementId?: string;
}

/**
 * Parse checklist items from markdown content.
 *
 * Recognizes both `- [ ]` and `- [x]` (also `* [ ]` / `* [x]`) syntax.
 * R-id prefixes like "R1:", "R2 -" are extracted into `requirementId`.
 */
export function parseChecklist(content: string): ChecklistItem[] {
    const lines = content.split('\n');
    const items: ChecklistItem[] = [];

    // Matches: <bullet> [ ] or [x] followed by optional text
    // Bullet can be - or *, with optional leading indentation
    const checkboxRegex = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine) {
            continue;
        }
        const match = rawLine.match(checkboxRegex);
        if (!match) {
            continue;
        }

        const checked = (match[1] ?? '').toLowerCase() === 'x';
        const rawText = (match[2] ?? '').trim();
        const line = i + 1;

        const reqIdMatch = rawText.match(/^(R\d+)\s*[:\-—]?\s*(.*)$/);
        if (reqIdMatch) {
            items.push({
                text: (reqIdMatch[2] ?? '').trim(),
                checked,
                line,
                requirementId: reqIdMatch[1],
            });
        } else {
            items.push({
                text: rawText,
                checked,
                line,
            });
        }
    }

    return items;
}
