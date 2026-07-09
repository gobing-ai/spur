import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { FeatureSummary } from '../../../src/lib/feature-types';
import { isWebModule } from '../../../src/modules/discover';

// Shared full-surface rpc-client mock — prevents "last mock wins" starvation
import '../../test-helpers/rpc-client-mock';

import FeatureDetail from '../../../src/modules/features/FeatureDetail';
import FeaturesShell from '../../../src/modules/features/FeaturesShell';
import FeatureTree from '../../../src/modules/features/FeatureTree';
import { module } from '../../../src/modules/features/index';
import { teardownHappyDom } from '../../happy-dom';

class FakeEventSource {
    static instances: FakeEventSource[] = [];

    onmessage: ((event: MessageEvent) => void) | null = null;
    closed = false;

    constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
    }

    close(): void {
        this.closed = true;
    }
}

let originalFetch: typeof fetch;
let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    try {
        GlobalRegistrator.register();
    } catch {} // already registered in suite
    originalFetch = globalThis.fetch;
    originalEventSource = globalThis.EventSource;
});

afterEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    globalThis.fetch = originalFetch;
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: originalEventSource,
    });
});

afterAll(async () => {
    await teardownHappyDom();
});

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

function installFeatureFetchMock(): string[] {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        calls.push(url);
        if (url.includes('/features/F/status')) {
            return jsonResponse({ ok: true, data: { status: 'verifying' } });
        }
        if (url.includes('/features/F/body')) {
            return jsonResponse({ ok: true, data: {} });
        }
        if (url.includes('/features/F/action')) {
            return jsonResponse({ ok: true, data: {} });
        }
        if (url.includes('/features/F')) {
            return jsonResponse({
                ok: true,
                data: {
                    id: 'F',
                    name: 'Root',
                    status: 'active',
                    frontmatter: { owner: 'robin', priority: 'P1', created_at: '2026-06-01' },
                    filePath: 'docs/features/F.md',
                    content: [
                        '---',
                        'id: F',
                        'status: active',
                        '---',
                        '',
                        '## Goal',
                        'Ship feature workflow.',
                        '',
                        '## Scope',
                        'Feature board and checks.',
                        '',
                        '## Acceptance Criteria',
                        '```gherkin',
                        'Given a feature',
                        'When it is opened',
                        'Then details render',
                        '```',
                    ].join('\n'),
                },
            });
        }
        if (url.includes('/tasks')) {
            return jsonResponse({ ok: true, data: [] });
        }
        if (url.includes('/features')) {
            return jsonResponse({
                ok: true,
                data: [
                    { id: 'F', name: 'Root', status: 'active' },
                    { id: 'F1', name: 'Child', status: 'done' },
                ],
            });
        }
        return jsonResponse({ ok: false, error: { message: 'not found' } }, 404);
    }) as typeof fetch;
    Object.defineProperty(globalThis, 'EventSource', {
        configurable: true,
        value: FakeEventSource,
    });
    return calls;
}

// ── Module discovery (R6) ──

test('features module is a valid WebModule (auto-discoverable)', () => {
    expect(isWebModule(module)).toBe(true);
    expect(module.id).toBe('features');
    expect(module.name).toBe('Feature Board');
    expect(module.route).toBe('features');
});

// ── FeatureTree (R2) ──

describe('FeatureTree', () => {
    test('renders without crashing (empty list)', () => {
        const { container } = render(<FeatureTree features={[]} selectedId={null} onSelect={() => {}} />);
        expect(container.querySelector('[data-feature-tree]')).not.toBeNull();
    });

    test('renders feature ids, names, and status badges from flat list', () => {
        // Root features have 1-char ids. Children have longer ids (F → F1 → F1A).
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child', status: 'done' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const html = container.innerHTML;
        expect(html).toContain('F');
        expect(html).toContain('F1');
        expect(html).toContain('Root');
        expect(html).toContain('Child');
        expect(html).toContain('active');
        expect(html).toContain('done');
        const buttons = container.querySelectorAll('button');
        expect(buttons.length).toBe(2);
    });

    test('selectedId applies accent to the selected node', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Alpha', status: 'active' },
            { id: 'G', name: 'Beta', status: 'active' },
        ];
        render(<FeatureTree features={features} selectedId="F" onSelect={() => {}} />);
        // The selected node's button has the accent class in its class attribute.
        const buttons = document.querySelectorAll('button');
        const alphaBtn = Array.from(buttons).find((b) => b.getAttribute('class')?.includes('bg-spur-accent'));
        expect(alphaBtn).toBeDefined();
        // One button — the selected one — has the accent class.
        const accentButtons = Array.from(buttons).filter((b) => b.getAttribute('class')?.includes('bg-spur-accent'));
        expect(accentButtons.length).toBe(1);
    });
});

describe('FeatureDetail', () => {
    test('renders header with status pill and action buttons', async () => {
        installFeatureFetchMock();
        const { getByText, getByLabelText } = render(<FeatureDetail featureId="F" />);

        // Status pill renders
        await waitFor(() => expect(getByText('active')).toBeDefined());

        // Action buttons for 'active' status render
        expect(getByLabelText('Verify')).toBeDefined();
        expect(getByLabelText('Block')).toBeDefined();
        expect(getByLabelText('Cancel')).toBeDefined();
        expect(getByLabelText('+ Child')).toBeDefined();
        expect(getByLabelText('+ Task')).toBeDefined();
        expect(getByLabelText('Link Task')).toBeDefined();
        expect(getByLabelText('Sync')).toBeDefined();
    });
});

describe('FeaturesShell', () => {
    test('loads feature tree and renders detail on click', async () => {
        const calls = installFeatureFetchMock();
        const { getByText } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());
        fireEvent.click(getByText('Root'));
        // After clicking a feature, the detail panel should render (body section)
        await waitFor(() => expect(calls.some((url) => url.includes('/features/F'))).toBe(true));
    });

    test('renders empty and error states', async () => {
        globalThis.fetch = (async () => jsonResponse({ ok: true, data: [] })) as unknown as typeof fetch;
        const empty = render(<FeaturesShell />);
        await waitFor(() => expect(empty.getByText('No features found.')).toBeDefined());
        empty.unmount();

        globalThis.fetch = (async () => jsonResponse({ ok: false }, 500)) as unknown as typeof fetch;
        const failed = render(<FeaturesShell />);
        await waitFor(() => expect(failed.getByRole('alert').textContent).toContain('Failed to load features'));
    });
});
