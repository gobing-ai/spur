import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();


import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { teardownHappyDom } from '../../happy-dom';
// Mock mermaid: its real ESM render path needs a full DOM + worker support that
// happy-dom lacks. The mock returns a deterministic SVG so we can assert routing.
const renderCalls: Array<{ id: string; code: string }> = [];
mock.module('mermaid', () => ({
    default: {
        initialize: () => {},
        render: async (id: string, code: string) => {
            renderCalls.push({ id, code });
            return { svg: `<svg data-mock="true"><text>${code}</text></svg>` };
        },
    },
}));

// DOMPurify in the test passes the SVG through unchanged (identity) — we only
// need to verify MermaidBlock calls it and injects the result.
mock.module('dompurify', () => ({
    default: { sanitize: (html: string) => html },
}));

// Dynamic import is required because happy-dom must be registered before
// any React/component module loads (the component tree reads from document).
const { MermaidBlock, languageOf, nodeText, renderCodeBlock } = await import(
    '../../../src/modules/task-kanban/MarkdownBody'
);

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    renderCalls.length = 0;
});

// These tests exercise the markdown→component *routing* primitives directly instead
// of through MDEditor.Markdown. The full preview pipeline (react-markdown's unified
// transform) renders in an async effect that, on a loaded CI runner, can stall past
// any timeout and leaves the assertions racing the library's internals — flaky by
// construction. `languageOf` (the routing predicate) and `nodeText` (the raw-source
// extractor mermaid needs) are pure; `MermaidBlock` owns the one async path that
// matters (lazy mermaid import → sanitize → inject). Testing them in isolation
// asserts the same intent deterministically.
const WAIT = { timeout: 5_000 } as const;

describe('languageOf — fenced-block routing predicate', () => {
    test('extracts the language token from a language-xxx className', () => {
        expect(languageOf('language-mermaid')).toBe('mermaid');
        expect(languageOf('hljs language-ts other')).toBe('ts');
    });

    test('returns null when no language class is present', () => {
        expect(languageOf(undefined)).toBeNull();
        expect(languageOf('')).toBeNull();
        expect(languageOf('inline-code')).toBeNull();
    });
});

describe('nodeText — raw source extraction from a highlighted node tree', () => {
    test('returns string and number leaves verbatim', () => {
        expect(nodeText('graph TD; A-->B')).toBe('graph TD; A-->B');
        expect(nodeText(42)).toBe('42');
    });

    test('ignores nullish and boolean nodes', () => {
        expect(nodeText(null)).toBe('');
        expect(nodeText(undefined)).toBe('');
        expect(nodeText(true)).toBe('');
    });

    test('concatenates the text leaves of a nested element tree', () => {
        // rehype-prism-plus tokenizes fenced code into nested <span> elements; mermaid
        // needs the original un-highlighted source, so the walk must flatten the tree.
        const tree = createElement(
            'code',
            null,
            createElement('span', null, 'graph '),
            createElement('span', null, createElement('span', null, 'TD; '), 'A-->B'),
        );
        expect(nodeText(tree)).toBe('graph TD; A-->B');
    });

    test('concatenates arrays of element nodes', () => {
        const a = createElement('span', null, 'foo');
        const b = createElement('span', null, 'bar');
        expect(nodeText([a, b])).toBe('foobar');
    });

    test('returns empty string for unrecognized node types', () => {
        // No `props` and not a primitive/array — the fallback return.
        const weird = { kind: 'something' } as unknown as React.ReactNode;
        expect(nodeText(weird)).toBe('');
    });
});

describe('MermaidBlock — mermaid fence rendering', () => {
    test('invokes mermaid.render with the fence code and injects the sanitized SVG', async () => {
        const { findByTestId } = render(<MermaidBlock code="graph TD; A-->B" />);

        const diagram = await findByTestId('mermaid-diagram', {}, WAIT);
        await waitFor(() => expect(renderCalls.length).toBe(1), WAIT);
        expect(renderCalls[0]?.code).toBe('graph TD; A-->B');
        // The sanitized SVG is injected into the diagram container.
        await waitFor(() => expect(diagram.querySelector('svg[data-mock="true"]')).not.toBeNull(), WAIT);
    });

    test('falls back to a raw <pre><code> block when mermaid.render throws', async () => {
        // A render failure must degrade to the raw source, never a thrown error (the
        // component's documented contract).
        mock.module('mermaid', () => ({
            default: {
                initialize: () => {},
                render: async () => {
                    throw new Error('boom');
                },
            },
        }));
        const { container, queryByTestId } = render(<MermaidBlock code="bad diagram" />);

        await waitFor(() => expect(container.querySelector('pre code')).not.toBeNull(), WAIT);
        expect(queryByTestId('mermaid-diagram')).toBeNull();
        expect(container.querySelector('pre code')?.textContent).toBe('bad diagram');
    });
});

describe('renderCodeBlock', () => {
    test('returns plain code element for non-mermaid languages', () => {
        const el = renderCodeBlock({ className: 'language-ts', children: 'const x = 1;' });
        expect(el.type).toBe('code');
        expect(el.props.className).toBe('language-ts');
        expect(el.props.children).toBe('const x = 1;');
    });

    test('delegates to MermaidBlock for mermaid language', () => {
        const el = renderCodeBlock({ className: 'language-mermaid', children: 'graph TD; A-->B' });
        // Renders a MermaidBlock component (not a plain code element).
        // MermaidBlock's type is a function component, so we verify it's not 'code'.
        expect(el.type).not.toBe('code');
    });
});


