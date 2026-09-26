import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

import { afterAll, describe, expect, test } from 'bun:test';

// Real DOMPurify (markdown-body.test.tsx mocks it as identity for routing tests).
const { sanitizeMermaidSvg } = await import('../../../src/modules/task-kanban/MarkdownBody');

afterAll(teardownHappyDom);

describe('sanitizeMermaidSvg', () => {
    test('strips script, event handlers and javascript: links from untrusted diagram output', () => {
        const out = sanitizeMermaidSvg(
            '<svg><script>alert(1)</script><g onclick="alert(2)"><a href="javascript:alert(3)"><text>ok</text></a></g>' +
                '<foreignObject><div><img src=x onerror="alert(4)">x</div></foreignObject></svg>',
        );
        expect(out).not.toContain('<script');
        expect(out).not.toContain('onclick');
        expect(out).not.toContain('onerror');
        expect(out).not.toContain('javascript:');
    });

    test('keeps native <text> and foreignObject HTML labels visible', () => {
        const out = sanitizeMermaidSvg(
            '<svg><g><text>Plain label</text><foreignObject><div><span class="nodeLabel">Html label</span></div></foreignObject></g></svg>',
        );
        expect(out).toContain('Plain label');
        expect(out).toContain('Html label');
    });
});
