import DOMPurify from 'dompurify';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';

type HastTree = Parameters<typeof toHtml>[0];

/**
 * Final sanitizer for every Markdown preview: serialize the parsed HAST, run it
 * through the one DOMPurify instance, then re-parse the clean fragment back to
 * HAST. Nothing executes during the round trip, and React only ever sees the
 * sanitized tree. Default URL filtering stays on (no ALLOW_UNKNOWN_PROTOCOLS);
 * `style` tags/attributes are dropped with the unsafe HTML.
 */
export const rehypeSanitizeMarkdown = () => (tree: unknown) => {
    const root = tree as { children: unknown[] };
    const clean = DOMPurify(window).sanitize(toHtml(tree as HastTree), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['style'],
        FORBID_ATTR: ['style'],
    });
    root.children = fromHtml(clean, { fragment: true }).children;
};

/**
 * Shared preview props. The preview component builds its own rehype list
 * (`rehypeRaw` first, highlighting last) and hands it to `pluginsFilter`, so
 * appending here is the only way to run the sanitizer after every built-in and
 * caller plugin. Remark lists pass through untouched.
 */
export const markdownPreviewSafety = {
    pluginsFilter: <T extends unknown[]>(type: 'rehype' | 'remark', plugins: T): T =>
        type === 'rehype' ? ([...plugins, rehypeSanitizeMarkdown] as unknown as T) : plugins,
};
