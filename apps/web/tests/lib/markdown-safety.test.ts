import { afterAll, describe, expect, test } from 'bun:test';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import { installDompurifyShims } from '../dompurify-happy-dom';
import { registerHappyDom, teardownHappyDom } from '../happy-dom';

// `registerHappyDom()` first: the module under test calls `DOMPurify(window)` when the
// plugin runs, so this file needs a DOM. The real-renderer matrix (every wired preview,
// the editor panes, Mermaid) lives in the isolated
// `tests/modules/task-kanban/markdown-safety-pipeline.tsx` process — that isolation
// exists for the process-global `@uiw/react-md-editor` mock, not for the DOM.
registerHappyDom();
afterAll(teardownHappyDom);

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

describe('rehypeSanitizeMarkdown — serialize → sanitize → re-parse', () => {
    test.each([
        ['<p>hello</p>', '<p>hello</p>'],
        ['<p>t</p><p>u</p>', '<p>t</p><p>u</p>'],
        ['<p style="color:red">x</p>', '<p>x</p>'],
        ['<p>a</p><script>window.pwned=1</script>', '<p>a</p>'],
        ['<style>body{color:red}</style><b>ok</b>', '<b>ok</b>'],
        ['<a href="javascript:alert(1)">x</a>', '<a>x</a>'],
        ['<img src=x onerror="alert(1)">', '<img src="x">'],
    ])('rewrites %s to %s', (input, expected) => {
        // DOMPurify under happy-dom miscarries without these shims (Node.prototype
        // `nodeName`, NodeIterator). They are restored in the `finally` so the sibling
        // web suites in this aggregate process keep happy-dom's untouched behaviour.
        const restore = installDompurifyShims();
        try {
            const tree = fromHtml(input, { fragment: true });
            rehypeSanitizeMarkdown()(tree);
            expect(toHtml(tree)).toBe(expected);
        } finally {
            restore();
        }
    });
});
