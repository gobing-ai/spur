/**
 * migrate-0412-v3.ts — Fix two remaining issues on the v2-migrated dev-*.md files:
 *
 * 1. ESCAPE PIPES in Argument Flags table cells: `<tag|commit>` → `<tag\|commit>`
 *    Standard GFM table behavior: a raw `|` inside a cell is a column separator.
 *    Escaped `\|` renders as literal `|`. The validator's parseMarkdownTable now
 *    splits on unescaped pipes only and unescapes `\|`.
 *
 * 2. STRIP INLINE GLOSSARY ANCHOR LINKS from the entire body, keeping ONLY the
 *    canonical footer reference `[flag glossary](../skills/spur-dev/references/flag-glossary.md)`.
 *    Patterns: [`--flag`](../skills/spur-dev/references/flag-glossary.md#flag-xxx) → `--flag`
 *
 * Idempotent: safe to run multiple times.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const COMMANDS_DIR = join(import.meta.dir, '..', 'commands');
// Matches [`--flag`](../skills/spur-dev/references/flag-glossary.md#flag-anything)
// Captures the flag name inside the backtick-wrapped link text.
const GLOSSARY_ANCHOR_RE = /\[`([^\]]+)`\]\(([^)]*flag-glossary\.md#[^)]*)\)/g;

// Matches <...|...> tokens that need pipe escaping inside table cells.
// Matches the entire <...> token and escapes any unescaped | inside it.
function escapePipesInPositional(token: string): string {
    // Only escape pipes that aren't already escaped
    return token.replace(/\|/g, (_m, offset, str) => {
        // Check if preceded by backslash already
        const before = str[offset - 1];
        return before === '\\' ? '|' : '\\|';
    });
}

// Process the Argument Flags table only: escape pipes inside <...> tokens in the Flag column.
function fixTablePipes(content: string): { content: string; changed: boolean } {
    const marker = /^## Argument Flags\n/m;
    const start = content.search(marker);
    if (start < 0) return { content, changed: false };

    const sectionStart = start;
    const afterMarker = content.slice(start);
    const nextH2 = afterMarker.slice(afterMarker.indexOf('\n') + 1).search(/^## /m);
    const sectionEnd = nextH2 < 0 ? content.length : start + afterMarker.indexOf('\n') + 1 + nextH2;

    const before = content.slice(0, sectionStart);
    const section = content.slice(sectionStart, sectionEnd);
    const after = content.slice(sectionEnd);

    const lines = section.split('\n');
    let inTable = false;
    let changed = false;
    const fixedLines = lines.map((line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|')) {
            if (inTable) inTable = false; // left the table
            return line;
        }
        inTable = true;
        // Skip separator row (---)
        if (/^\|[\s:]*-{2,}[\s:]*\|/.test(trimmed)) return line;

        // Fix <...|...> tokens in this table line
        const fixed = line.replace(/<(?:[^<>|\\]*\|)+[^<>|\\]*>/g, (token) => {
            const escaped = escapePipesInPositional(token);
            if (escaped !== token) changed = true;
            return escaped;
        });
        return fixed;
    });

    if (!changed) return { content, changed: false };
    return {
        content: before + fixedLines.join('\n') + after,
        changed: true,
    };
}

// Strip inline glossary anchor links, replacing them with the bare flag token.
function stripGlossaryAnchors(content: string): { content: string; stripped: number } {
    let stripped = 0;
    const fixed = content.replace(GLOSSARY_ANCHOR_RE, (_match, flagName) => {
        stripped++;
        return `\`${flagName}\``;
    });
    return { content: fixed, stripped };
}

const files = readdirSync(COMMANDS_DIR)
    .filter((f) => f.startsWith('dev-') && f.endsWith('.md'))
    .sort();

let totalPipeFixed = 0;
let totalGlossaryStripped = 0;

for (const file of files) {
    const path = join(COMMANDS_DIR, file);
    let content = readFileSync(path, 'utf-8');
    let fileChanged = false;

    // 1. Fix pipe escaping in table cells
    const tableResult = fixTablePipes(content);
    if (tableResult.changed) {
        content = tableResult.content;
        fileChanged = true;
        totalPipeFixed++;
    }

    // 2. Strip inline glossary anchor links (but NOT the footer reference which uses [flag glossary] not [flag])
    const glossaryResult = stripGlossaryAnchors(content);
    if (glossaryResult.stripped > 0) {
        content = glossaryResult.content;
        fileChanged = true;
        totalGlossaryStripped += glossaryResult.stripped;
    }

    if (fileChanged) {
        writeFileSync(path, content);
        console.log(`Fixed: ${file}`);
    }
}

console.log(`\nDone. Pipe fixes: ${totalPipeFixed} files. Glossary links stripped: ${totalGlossaryStripped}.`);
