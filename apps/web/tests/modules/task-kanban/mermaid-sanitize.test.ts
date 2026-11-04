import { installDompurifyShims } from '../../dompurify-happy-dom';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
const restoreDompurifyShims = installDompurifyShims();

import { afterAll, describe, expect, test } from 'bun:test';

// Real DOMPurify (markdown-body.test.tsx mocks it as identity for routing tests).
const { MERMAID_SANITIZE_CONFIG, sanitizeMermaidSvg } = await import('../../../src/modules/task-kanban/MarkdownBody');
const DOMPurify = (await import('dompurify')).default;

afterAll(async () => {
    restoreDompurifyShims();
    await teardownHappyDom();
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

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

    test('keeps native <text> labels visible', () => {
        const out = sanitizeMermaidSvg('<svg><g><text>Plain label</text></g></svg>');
        expect(out).toContain('Plain label');
    });

    test('keeps foreignObject HTML labels visible', () => {
        // happy-dom does not implement the foreignObject HTML integration point: its parser puts
        // every label child in the SVG namespace, and DOMPurify then drops it as a non-SVG tag in
        // SVG. So the browser-faithful namespaces are built here rather than parsed from a string.
        const doc = document.implementation.createHTMLDocument('');
        const svg = doc.createElementNS(SVG_NS, 'svg');
        const foreignObject = doc.createElementNS(SVG_NS, 'foreignObject');
        const label = doc.createElementNS(XHTML_NS, 'span');
        label.setAttribute('class', 'nodeLabel');
        label.textContent = 'Html label';
        foreignObject.appendChild(label);
        svg.appendChild(foreignObject);

        const out = DOMPurify(window).sanitize(svg, MERMAID_SANITIZE_CONFIG);
        expect(out).toContain('Html label');
    });
});
