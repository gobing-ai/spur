import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
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
// need to verify MarkdownBody calls it and injects the result.
mock.module('dompurify', () => ({
    default: { sanitize: (html: string) => html },
}));

const MarkdownBody = (await import('../../../src/modules/task-kanban/MarkdownBody')).default;

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    renderCalls.length = 0;
});

// react-markdown transforms markdown→DOM in an effect, so the rendered output (the
// `code` override that produces these nodes) appears after the first paint. On a loaded
// CI runner that microtask resolves well past testing-library's 1s default, so every
// query here must be async (findBy*/waitFor) with a CI-tolerant budget — a synchronous
// getBy* would flake. The budget is generous because we assert the *eventual* DOM, not
// latency; a real regression still fails (the element never appears).
const WAIT = { timeout: 5_000 } as const;

describe('MarkdownBody — code block handling', () => {
    test('routes a ```mermaid fence to the mermaid diagram renderer', async () => {
        const src = ['# Heading', '', '```mermaid', 'graph TD; A-->B', '```', ''].join('\n');
        const { findByTestId } = render(<MarkdownBody source={src} />);

        // The mermaid block placeholder is rendered, and mermaid.render was invoked.
        const diagram = await findByTestId('mermaid-diagram', {}, WAIT);
        expect(diagram).toBeDefined();
        await waitFor(() => expect(renderCalls.length).toBe(1), WAIT);
        expect(renderCalls[0]?.code).toBe('graph TD; A-->B');
        // The sanitized SVG is injected into the diagram container.
        await waitFor(() => expect(diagram.querySelector('svg[data-mock="true"]')).not.toBeNull(), WAIT);
    });

    test('renders a non-mermaid fenced block as a normal highlighted code block (no diagram)', async () => {
        const src = ['```ts', 'const x: number = 1;', '```', ''].join('\n');
        const { container, queryByTestId } = render(<MarkdownBody source={src} />);

        await waitFor(() => expect(container.querySelector('pre')).not.toBeNull(), WAIT);
        // A ts block is NOT routed to mermaid.
        expect(queryByTestId('mermaid-diagram')).toBeNull();
        expect(renderCalls.length).toBe(0);
        // rehype-prism-plus tags the <code> with a language class for highlighting.
        expect(container.querySelector('code.language-ts')).not.toBeNull();
    });

    test('renders inline code without invoking the mermaid path', async () => {
        const { container, queryByTestId } = render(<MarkdownBody source={'Use `npm install` here.'} />);

        await waitFor(() => expect(container.querySelector('code')).not.toBeNull(), WAIT);
        expect(queryByTestId('mermaid-diagram')).toBeNull();
    });
});
