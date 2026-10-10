import { describe, expect, test } from 'bun:test';

// Pure shape assertions only: this file must not register happy-dom or install the
// DOMPurify shims — those mutate `Node.prototype`/`NodeIterator` process-globally and
// would change DOMPurify's removal behaviour for every later test file. The
// DOM-dependent `rehypeSanitizeMarkdown` behaviour tests live in the isolated
// `tests/modules/task-kanban/markdown-safety-pipeline.tsx` process.
const { markdownPreviewSafety, rehypeSanitizeMarkdown } = await import('../../src/lib/markdown-safety');

describe('markdownPreviewSafety — preview props', () => {
    test('appends the sanitizer to the END of the rehype list without mutating it', () => {
        const list: unknown[] = ['first', 'second'];
        const out = markdownPreviewSafety.pluginsFilter('rehype', list);
        expect(out).toHaveLength(3);
        expect(out[2]).toBe(rehypeSanitizeMarkdown);
        expect(list).toHaveLength(2);
    });

    test('returns remark lists unchanged', () => {
        const remark: unknown[] = ['remark', 'gfm'];
        expect(markdownPreviewSafety.pluginsFilter('remark', remark)).toBe(remark);
    });
});
