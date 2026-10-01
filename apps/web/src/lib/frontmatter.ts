import { parse as parseYaml } from 'yaml';

export interface MarkdownFrontmatterResult {
    /** Raw YAML frontmatter without delimiter fences, or null if document has no frontmatter. */
    frontmatterRaw: string | null;
    /** Parsed YAML frontmatter object, or null if absent or failed to parse. */
    frontmatter: Record<string, unknown> | null;
    /** Markdown body with the leading frontmatter block stripped. */
    body: string;
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * Strip the YAML frontmatter delimiter block so that previewers / editors
 * render only the markdown body.
 */
export function stripFrontmatter(content: string): string {
    if (!content) return '';
    const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const match = clean.match(FRONTMATTER_REGEX);
    if (!match) return clean;
    return clean.slice(match[0].length);
}

/**
 * Extract raw frontmatter text and the markdown body from a document.
 */
export function extractFrontmatter(content: string): { frontmatterRaw: string | null; body: string } {
    if (!content) return { frontmatterRaw: null, body: '' };
    const clean = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
    const match = clean.match(FRONTMATTER_REGEX);
    if (!match) return { frontmatterRaw: null, body: clean };
    return {
        frontmatterRaw: match[1]?.trim() ?? '',
        body: clean.slice(match[0].length),
    };
}

/**
 * Parse frontmatter and return both the raw string, parsed YAML object, and clean body.
 */
export function parseMarkdownFrontmatter(content: string): MarkdownFrontmatterResult {
    const { frontmatterRaw, body } = extractFrontmatter(content);
    if (!frontmatterRaw) {
        return { frontmatterRaw: null, frontmatter: null, body };
    }

    let parsed: Record<string, unknown> | null = null;
    try {
        const result = parseYaml(frontmatterRaw);
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            parsed = result as Record<string, unknown>;
        }
    } catch {
        parsed = null;
    }

    return {
        frontmatterRaw,
        frontmatter: parsed,
        body,
    };
}
