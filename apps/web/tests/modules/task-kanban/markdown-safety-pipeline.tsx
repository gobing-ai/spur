/**
 * Isolated-process DOM regressions behind `markdown-safety.test.tsx`.
 *
 * Why a second file: sibling suites register a process-global
 * `mock.module('@uiw/react-md-editor', …)` stub (`task-detail.test.tsx`,
 * `new-task-panel.test.tsx`, `task-kanban/components.test.tsx`). Bun's
 * `mock.module` is process-global with "last registration wins", so in the
 * aggregate run that stub replaces the renderer here too and every assertion
 * below would be meaningless. This file therefore runs in a fresh Bun process,
 * driven by `markdown-safety.test.tsx` via `bun test --isolate ./<this file>`.
 * Its name deliberately omits `.test`/`.spec` so the aggregate runner never
 * collects it.
 *
 * No `@uiw/react-md-editor` mock here: every render below goes through the real
 * rehype/remark pipeline with the shared preview props under test.
 */
registerHappyDom();
installDompurifyShims();

import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { fromHtml } from 'hast-util-from-html';
import { toHtml } from 'hast-util-to-html';
import type { ReactElement } from 'react';
import { installDompurifyShims } from '../../dompurify-happy-dom';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';
import { buildFullRpcMock } from '../../test-helpers/rpc-client-mock';

// Mock mermaid *generation* only — routing, sanitizeMermaidSvg and the real
// Markdown renderer all run for real. The mock returns a deliberately unsafe SVG
// so we can prove the dedicated Mermaid sanitizer still runs after the fix.
const renderedDiagrams: string[] = [];
mock.module('mermaid', () => ({
    default: {
        initialize: () => {},
        render: async (_id: string, code: string) => {
            renderedDiagrams.push(code);
            return { svg: '<svg onload="window.pwned=1"><text>diagram</text></svg>' };
        },
    },
}));

// FeatureDetail's data layer is the only thing mocked for the editor check below
// ("mock RPC/outer context only"); its Markdown renderer stays real.
mock.module('../../../src/lib/rpc-client', () => buildFullRpcMock({}));

const { default: MarkdownBody } = await import('../../../src/modules/task-kanban/MarkdownBody');
const { default: PlanMarkdownBody } = await import('../../../src/modules/plans/PlanMarkdownBody');
const { default: DesignMarkdownBody } = await import('../../../src/modules/designs/DesignMarkdownBody');
const { default: FeatureDetail } = await import('../../../src/modules/features/FeatureDetail');
const { MDEditor } = await import('@/ui');
const { setFetchForTesting } = await import('../../../src/lib/rpc-client');
const { markdownPreviewSafety, rehypeSanitizeMarkdown } = await import('../../../src/lib/markdown-safety');

class FakeEventSource {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor(readonly url: string) {}
    close(): void {}
}
Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });

afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    renderedDiagrams.length = 0;
});

/** Executable raw HTML, event handlers, unsafe URLs and style payloads (AC1). */
const XSS = [
    '<iframe srcdoc="<script>window.pwned=1</script>"></iframe>',
    '<script>window.pwned=1</script>',
    '<object data="x"></object><embed src="x">',
    '<img src="x" onerror="window.pwned=1">',
    '<a href="javascript:window.pwned=1">js link</a>',
    '[markdown js link](JaVaScRiPt:window.pwned=1)',
    '<a href="vbscript:msgbox(1)">vbs link</a>',
    '<a href="&#106;avascript:window.pwned=1">entity js link</a>',
    '<svg onload="window.pwned=1"><a xlink:href="javascript:window.pwned=1">svg</a></svg>',
    '<math><mtext><script>window.pwned=1</script></mtext></math>',
    '<div style="background:url(javascript:window.pwned=1)">styled</div>',
    '<style>body{background:red}</style>',
    '<a href="#x" onclick="window.pwned=1">click</a>',
    '<form action="javascript:window.pwned=1"><input formaction="javascript:window.pwned=1"></form>',
    '<span>unclosed <b>nesting',
    '# Heading after payload',
].join('\n\n');

/** AC2 positive-control fixture: nothing executable, everything supported. */
const SAFE = [
    '# Overview',
    '## Overview',
    '**bold** and a [safe link](https://example.com) and a [relative link](/docs/tasks)',
    '- one',
    '- [x] done',
    '| a | b |\n| --- | --- |\n| 1 | 2 |',
    '```ts\nconst literal = "<script>window.pwned=1</script>";\n```',
].join('\n\n');

function assertNoDangerousNode(scope: HTMLElement): void {
    for (const selector of ['iframe', 'script', 'object', 'embed', 'style', 'svg script', 'svg[onload]']) {
        expect(scope.querySelector(selector)).toBeNull();
    }
    expect(scope.innerHTML).not.toContain('srcdoc');
    for (const element of Array.from(scope.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
            const value = attribute.value.toLowerCase().replace(/\s/g, '');
            expect(attribute.name.toLowerCase().startsWith('on')).toBe(false);
            expect(value.startsWith('javascript:')).toBe(false);
            expect(value.startsWith('vbscript:')).toBe(false);
        }
    }
    const html = scope.innerHTML.toLowerCase();
    expect(html.includes('javascript:')).toBe(false);
    expect(html.includes('vbscript:')).toBe(false);
}

/**
 * Render a real preview and settle the async Markdown pipeline: the wrapper
 * exists before its content does, so absence assertions are only meaningful once
 * the fixture's sentinel heading is in the DOM (otherwise they pass vacuously).
 */
async function renderPreview(element: ReactElement) {
    const result = render(element);
    await waitFor(() => expect(result.container.querySelector('h1')).not.toBeNull(), { timeout: 5000 });
    return result;
}

describe('AC1 — reproducing edge case is safe across real previews', () => {
    test('MarkdownBody read preview emits no dangerous DOM', async () => {
        const { container } = await renderPreview(<MarkdownBody source={XSS} />);
        assertNoDangerousNode(container);
        expect(container.querySelector('h1')?.textContent).toBe('Heading after payload');
    });

    test('PlanMarkdownBody read preview emits no dangerous DOM', async () => {
        const { container } = await renderPreview(<PlanMarkdownBody source={XSS} />);
        assertNoDangerousNode(container);
    });

    test('DesignMarkdownBody read preview emits no dangerous DOM', async () => {
        const { container } = await renderPreview(<DesignMarkdownBody source={XSS} />);
        assertNoDangerousNode(container);
    });

    test('New Task read preview props render no dangerous DOM', async () => {
        // Same props NewTaskPanel spreads onto its direct read preview.
        const { container } = await renderPreview(
            <MDEditor.Markdown source={XSS} data-color-mode="dark" {...markdownPreviewSafety} />,
        );
        assertNoDangerousNode(container);
    });

    test('real editor preview pane emits no dangerous DOM', async () => {
        const { container } = await renderPreview(
            <MDEditor value={XSS} preview="preview" height={160} previewOptions={markdownPreviewSafety} />,
        );
        assertNoDangerousNode(container);
        expect(container.querySelector('h1')?.textContent).toBe('Heading after payload');
    });

    test('FeatureDetail editor preview pane emits no dangerous DOM', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            const body =
                url.includes('/features/F') && !url.includes('/body') && !url.includes('/status')
                    ? {
                          ok: true,
                          data: {
                              id: 'F',
                              name: 'Root',
                              status: 'active',
                              frontmatter: {},
                              filePath: 'docs/features/F.md',
                              content: XSS,
                          },
                      }
                    : { ok: true, data: {} };
            return new Response(JSON.stringify(body), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }) as unknown as typeof fetch);

        const { container, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByLabelText('Edit body')).toBeDefined());
        fireEvent.click(getByLabelText('Edit body'));
        await waitFor(() => expect(container.querySelector('.w-md-editor-preview h1')).not.toBeNull(), {
            timeout: 5000,
        });
        assertNoDangerousNode(container.querySelector('.w-md-editor-preview') as HTMLElement);
    });
});

describe('AC2 — supported behavior is preserved', () => {
    test('ordinary Markdown renders: headings, bold, safe links, list, table, checkbox', async () => {
        const { container } = await renderPreview(<MarkdownBody source={SAFE} />);
        expect(container.querySelectorAll('h1')).toHaveLength(1);
        expect(container.querySelector('h1')?.textContent).toContain('Overview');
        expect(container.querySelector('strong')?.textContent).toBe('bold');
        expect(container.querySelector('a[href="https://example.com"]')?.textContent).toBe('safe link');
        expect(container.querySelector('a[href="/docs/tasks"]')?.textContent).toBe('relative link');
        expect(container.querySelectorAll('ul li').length).toBeGreaterThanOrEqual(2);
        const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
        expect(checkbox).not.toBeNull();
        expect(checkbox?.checked).toBe(true);
        expect(container.querySelector('table')).not.toBeNull();
    });

    test('fenced code keeps its language class and literal dangerous-looking text stays inert', async () => {
        const { container } = await renderPreview(<MarkdownBody source={SAFE} />);
        const code = container.querySelector('code.language-ts');
        expect(code).not.toBeNull();
        expect(code?.textContent).toContain('<script>window.pwned=1</script>');
        expect(container.querySelector('code script')).toBeNull();
    });

    test('plan and design heading anchors stay consistent after sanitization', async () => {
        const plan = await renderPreview(<PlanMarkdownBody source={SAFE} />);
        expect(plan.container.querySelector('h1')?.id).toBe('overview');
        expect(plan.container.querySelector('h2')?.id).toBe('overview-1');
        plan.unmount();

        const design = await renderPreview(<DesignMarkdownBody source={SAFE} />);
        expect(design.container.querySelector('h1')?.id).toBe('overview');
        expect(design.container.querySelector('h2')?.id).toBe('overview-1');
    });

    test('a mermaid fence still routes to MermaidBlock and its SVG is sanitized', async () => {
        const { container, findByTestId } = render(<MarkdownBody source={'```mermaid\ngraph TD; A-->B\n```'} />);
        const diagram = await findByTestId('mermaid-diagram');
        await waitFor(() => expect(diagram.innerHTML).toContain('<svg'), { timeout: 5000 });
        expect(renderedDiagrams).toContain('graph TD; A-->B');
        expect(diagram.querySelector('svg')?.getAttribute('onload')).toBeNull();
        expect(container.querySelector('code.language-mermaid')).toBeNull();
    });
});

// Moved out of tests/lib/markdown-safety.test.ts: these assertions need DOMPurify *and*
// the happy-dom shims, which mutate process-global DOM state. `tests/lib` must stay
// DOM-free so the aggregate run's other suites are unaffected; this file already runs
// in its own `bun test --isolate` process, so the mutation stays contained.
describe('rehypeSanitizeMarkdown — final-HAST sanitizer', () => {
    test('drops executable elements, event handlers and unsafe URLs', () => {
        const tree = fromHtml(
            '<p>keep</p><iframe srcdoc="<script>x</script>"></iframe><script>evil</script>' +
                '<img src="x" onerror="alert(1)"><a href="javascript:alert(2)">js</a><div style="color:red">styled</div>',
            { fragment: true },
        );

        rehypeSanitizeMarkdown()(tree);
        const html = toHtml(tree);

        expect(html).toContain('keep');
        expect(html).not.toContain('<iframe');
        expect(html).not.toContain('srcdoc');
        expect(html).not.toContain('<script');
        expect(html).not.toContain('onerror');
        expect(html).not.toContain('javascript:');
        expect(html).not.toContain('style=');
    });

    test('preserves ordinary Markdown output: headings, links, code and checkbox inputs', () => {
        const tree = fromHtml(
            '<h1 id="overview">Overview</h1><a href="https://example.com">link</a>' +
                '<a href="/docs">relative</a><code class="language-ts">const a = 1;</code>' +
                '<input type="checkbox" checked disabled>',
            { fragment: true },
        );

        rehypeSanitizeMarkdown()(tree);
        const html = toHtml(tree);

        expect(html).toContain('<h1 id="overview">Overview</h1>');
        expect(html).toContain('href="https://example.com"');
        expect(html).toContain('href="/docs"');
        expect(html).toContain('class="language-ts"');
        expect(html).toContain('type="checkbox"');
    });
});
