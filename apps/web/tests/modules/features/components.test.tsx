import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { FeatureSummary } from '../../../src/lib/feature-types';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { isWebModule } from '../../../src/modules/discover';

import FeatureDetail from '../../../src/modules/features/FeatureDetail';
import FeaturesShell from '../../../src/modules/features/FeaturesShell';
import FeatureTree from '../../../src/modules/features/FeatureTree';
import { module } from '../../../src/modules/features/index';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

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

let originalEventSource: typeof EventSource | undefined;

beforeAll(() => {
    registerHappyDom();
    originalEventSource = globalThis.EventSource;
});

afterEach(() => {
    cleanup();
    FakeEventSource.instances = [];
    resetFetchForTesting();
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
    setFetchForTesting((async (input: RequestInfo | URL) => {
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
    }) as unknown as typeof fetch);
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

    test('renders mapped status icons and accessible labels for all 6 canonical statuses', () => {
        const features: FeatureSummary[] = [
            { id: 'A', name: 'Backlog Item', status: 'backlog' },
            { id: 'B', name: 'Active Item', status: 'active' },
            { id: 'C', name: 'Verifying Item', status: 'verifying' },
            { id: 'D', name: 'Blocked Item', status: 'blocked' },
            { id: 'E', name: 'Done Item', status: 'done' },
            { id: 'F', name: 'Cancelled Item', status: 'cancelled' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length).toBe(6);

        const badges = container.querySelectorAll('[aria-label^="Status:"]');
        expect(badges.length).toBe(6);
        expect(container.innerHTML).toContain('Status: backlog');
        expect(container.innerHTML).toContain('Status: active');
        expect(container.innerHTML).toContain('Status: verifying');
        expect(container.innerHTML).toContain('Status: blocked');
        expect(container.innerHTML).toContain('Status: done');
        expect(container.innerHTML).toContain('Status: cancelled');
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

    test('re-fetches the same feature when refreshKey changes', async () => {
        // The selected feature's id does not change when it is edited elsewhere, so
        // without an explicit generation the panel would keep its first response.
        const calls = installFeatureFetchMock();
        const { rerender, getByText } = render(<FeatureDetail featureId="F" refreshKey={0} />);
        await waitFor(() => expect(getByText('active')).toBeDefined());

        const showCalls = () => calls.filter((url) => /\/features\/F(\?|$)/.test(url)).length;
        const before = showCalls();

        rerender(<FeatureDetail featureId="F" refreshKey={1} />);
        await waitFor(() => expect(showCalls()).toBeGreaterThan(before));
    });

    test('does not re-fetch when refreshKey is unchanged', async () => {
        const calls = installFeatureFetchMock();
        const { rerender, getByText } = render(<FeatureDetail featureId="F" refreshKey={3} />);
        await waitFor(() => expect(getByText('active')).toBeDefined());

        const showCalls = () => calls.filter((url) => /\/features\/F(\?|$)/.test(url)).length;
        const before = showCalls();

        rerender(<FeatureDetail featureId="F" refreshKey={3} />);
        await new Promise((r) => setTimeout(r, 10));
        expect(showCalls()).toBe(before);
    });

    test('a superseded in-flight load does not overwrite the newer feature', async () => {
        // Switching features mid-request: the first response resolves last and its
        // handler closed over the OLD id, so without the sequence guard it would paint
        // feature F's data into a panel that now shows F1.
        const release: Array<() => void> = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            const isOld = /\/features\/F(\?|$)/.test(url);
            const payload = {
                ok: true,
                data: {
                    id: isOld ? 'F' : 'F1',
                    name: isOld ? 'Stale Root' : 'Fresh Child',
                    status: isOld ? 'active' : 'done',
                    frontmatter: {},
                    filePath: 'docs/features/x.md',
                    content: '---\n---\n\n## Goal\nx',
                },
            };
            // Hold the first (soon-to-be-stale) response open until the second lands.
            if (isOld) {
                await new Promise<void>((resolve) => release.push(resolve));
            }
            return jsonResponse(payload);
        }) as unknown as typeof fetch);

        // The header renders `{id} — {name}` across separate text nodes, so assert on
        // the status badge instead: 'done' for the fresh feature, 'active' for the stale.
        const { rerender, getByText, queryByText } = render(<FeatureDetail featureId="F" />);
        // Switch before the first response resolves.
        rerender(<FeatureDetail featureId="F1" />);
        await waitFor(() => expect(getByText('done')).toBeDefined());

        // Now let the stale response through; it must be discarded.
        for (const resolve of release) resolve();
        await new Promise((r) => setTimeout(r, 20));

        expect(getByText('done')).toBeDefined();
        expect(queryByText('active')).toBeNull();
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

    /**
     * Serve the detail endpoint with a status that changes after the first read, so a
     * test can tell an applied refresh from a request whose response was thrown away.
     * Asserting on call count alone would not: the pre-fix code also issued the fetch.
     */
    function installMutatingDetailMock(): { setStatus: (s: string) => void } {
        let detailStatus = 'active';
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (/\/features\/F(\?|$)/.test(url)) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: detailStatus,
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }
            // Tree status deliberately differs from the detail's, so a status query
            // matches exactly one node (the detail panel) and not the tree badge too.
            return jsonResponse({ ok: true, data: [{ id: 'F', name: 'Root', status: 'backlog' }] });
        }) as unknown as typeof fetch);
        Object.defineProperty(globalThis, 'EventSource', { configurable: true, value: FakeEventSource });
        return { setStatus: (s: string) => (detailStatus = s) };
    }

    test('a feature.updated SSE frame refreshes the open detail panel', async () => {
        // End-to-end for the shell→panel refresh path: the selected feature's id does
        // not change, so the shell must nudge the panel. The pre-fix code fetched and
        // discarded, leaving the panel on its original copy — hence the status assertion.
        const { setStatus } = installMutatingDetailMock();
        const { getByText, queryByText } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());
        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(getByText('active')).toBeDefined());

        setStatus('verifying');
        const es = FakeEventSource.instances.at(-1);
        expect(es).toBeDefined();
        es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));

        await waitFor(() => expect(getByText('verifying')).toBeDefined());
        expect(queryByText('active')).toBeNull();
    });

    test('an unrelated SSE frame does not refresh the detail panel', async () => {
        const { setStatus } = installMutatingDetailMock();
        const { getByText } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());
        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(getByText('active')).toBeDefined());

        setStatus('verifying');
        const es = FakeEventSource.instances.at(-1);
        es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'task.updated' }) }));
        await new Promise((r) => setTimeout(r, 20));

        expect(getByText('active')).toBeDefined();
    });

    test('renders empty and error states', async () => {
        setFetchForTesting((async () => jsonResponse({ ok: true, data: [] })) as unknown as typeof fetch);
        const empty = render(<FeaturesShell />);
        await waitFor(() => expect(empty.getByText('No features found.')).toBeDefined());
        empty.unmount();

        setFetchForTesting((async () => jsonResponse({ ok: false }, 500)) as unknown as typeof fetch);
        const failed = render(<FeaturesShell />);
        await waitFor(() => expect(failed.getByRole('alert').textContent).toContain('Failed to load features'));
    });

    test('opens status filter menu on filter button click and filters tree by selected status', async () => {
        installFeatureFetchMock();
        const { getByLabelText, getByText, queryByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        // Both 'Root' (active) and 'Child' (done) are visible initially
        expect(getByText('Root')).toBeDefined();
        expect(getByText('Child')).toBeDefined();

        // Click filter button
        const filterBtn = getByLabelText('Filter features by status');
        fireEvent.click(filterBtn);

        // Menu pops up containing canonical statuses
        expect(container.querySelector('[data-filter-menu]')).not.toBeNull();

        // Filter by 'active'
        const activeOption = Array.from(container.querySelectorAll('[data-filter-menu] button')).find((b) =>
            b.textContent?.includes('active'),
        );
        expect(activeOption).toBeDefined();
        if (activeOption) fireEvent.click(activeOption);

        // Under 'active' filter, 'Root' is visible, 'Child' (done) is hidden
        expect(getByText('Root')).toBeDefined();
        expect(queryByText('Child')).toBeNull();
    });

    test('shows empty state message when status filter matches zero features', async () => {
        installFeatureFetchMock();
        const { getByLabelText, getByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        // Click filter button
        fireEvent.click(getByLabelText('Filter features by status'));

        // Filter by 'blocked' (no feature in mock is blocked)
        const blockedOption = Array.from(container.querySelectorAll('[data-filter-menu] button')).find((b) =>
            b.textContent?.includes('blocked'),
        );
        expect(blockedOption).toBeDefined();
        if (blockedOption) fireEvent.click(blockedOption);

        expect(getByText('No features match status filter "blocked".')).toBeDefined();
    });

    test('closes status filter menu on Escape and on outside mousedown', async () => {
        installFeatureFetchMock();
        const { getByLabelText, getByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        // Open the menu, then close via Escape.
        fireEvent.click(getByLabelText('Filter features by status'));
        expect(container.querySelector('[data-filter-menu]')).not.toBeNull();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(container.querySelector('[data-filter-menu]')).toBeNull();

        // Re-open, then close via mousedown outside the menu anchor.
        fireEvent.click(getByLabelText('Filter features by status'));
        expect(container.querySelector('[data-filter-menu]')).not.toBeNull();
        fireEvent.mouseDown(document.body);
        expect(container.querySelector('[data-filter-menu]')).toBeNull();
    });
});
