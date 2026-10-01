import { describe, expect, test } from 'bun:test';
import { extractFrontmatter, parseMarkdownFrontmatter, stripFrontmatter } from '../../src/lib/frontmatter';

describe('frontmatter utility', () => {
    describe('stripFrontmatter', () => {
        test('strips standard YAML frontmatter with unix newlines', () => {
            const raw = `---
doc: 02_ROADMAP
title: 02 Roadmap
version: 1.0.0
---

# 02 Roadmap — Spur

Body paragraph.`;

            const stripped = stripFrontmatter(raw);
            expect(stripped).toBe(`
# 02 Roadmap — Spur

Body paragraph.`);
        });

        test('strips YAML frontmatter with CRLF newlines', () => {
            const raw = '---\r\nkind: plan\r\ntitle: Test\r\n---\r\n\r\n# Title\r\nContent';
            const stripped = stripFrontmatter(raw);
            expect(stripped).toBe('\r\n# Title\r\nContent');
        });

        test('strips UTF-8 BOM if present at start', () => {
            const raw = '\uFEFF---\ntitle: BOM Test\n---\n# Real Title';
            const stripped = stripFrontmatter(raw);
            expect(stripped).toBe('# Real Title');
        });

        test('returns original string when no frontmatter is present', () => {
            const raw = '# Just Title\n\nNo frontmatter here.';
            expect(stripFrontmatter(raw)).toBe(raw);
        });

        test('does not strip horizontal rules or code blocks in body', () => {
            const raw = `# Title

Some text

---

Another section
\`\`\`yaml
---
fake: frontmatter
---
\`\`\`
`;
            expect(stripFrontmatter(raw)).toBe(raw);
        });

        test('returns empty string when content is empty or only frontmatter', () => {
            expect(stripFrontmatter('')).toBe('');
            const onlyFm = `---
key: val
---`;
            expect(stripFrontmatter(onlyFm)).toBe('');
        });
    });

    describe('extractFrontmatter', () => {
        test('extracts raw frontmatter content without delimiter fences', () => {
            const raw = `---
doc: 02_ROADMAP
version: 1.11.0
tags: [a, b]
---

# Title`;

            const result = extractFrontmatter(raw);
            expect(result.frontmatterRaw).toBe(`doc: 02_ROADMAP
version: 1.11.0
tags: [a, b]`);
            expect(result.body).toBe('\n# Title');
        });

        test('returns null frontmatterRaw when document has no frontmatter', () => {
            const raw = '# No Frontmatter\nText';
            const result = extractFrontmatter(raw);
            expect(result.frontmatterRaw).toBeNull();
            expect(result.body).toBe(raw);
        });
    });

    describe('parseMarkdownFrontmatter', () => {
        test('parses valid YAML frontmatter into structured data', () => {
            const raw = `---
kind: design
title: "Spur UI Design"
version: alpha
tags:
  - web
  - ui
nested:
  color: "#5e6ad2"
---

# Overview
Design content.`;

            const result = parseMarkdownFrontmatter(raw);
            expect(result.frontmatterRaw).toContain('kind: design');
            expect(result.frontmatter).toEqual({
                kind: 'design',
                title: 'Spur UI Design',
                version: 'alpha',
                tags: ['web', 'ui'],
                nested: { color: '#5e6ad2' },
            });
            expect(result.body).toBe('\n# Overview\nDesign content.');
        });

        test('handles malformed YAML gracefully without throwing', () => {
            const raw = `---
invalid: [yaml
  unterminated
---

# Content`;

            const result = parseMarkdownFrontmatter(raw);
            expect(result.frontmatterRaw).toContain('invalid: [yaml');
            expect(result.frontmatter).toBeNull();
            expect(result.body).toBe('\n# Content');
        });

        test('handles documents without frontmatter', () => {
            const raw = '# Content only';
            const result = parseMarkdownFrontmatter(raw);
            expect(result.frontmatterRaw).toBeNull();
            expect(result.frontmatter).toBeNull();
            expect(result.body).toBe(raw);
        });
    });
});
