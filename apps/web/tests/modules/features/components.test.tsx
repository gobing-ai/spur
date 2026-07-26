import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { FEATURE_STATUSES as DOMAIN_FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { FeatureSummary } from '../../../src/lib/feature-types';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { isWebModule } from '../../../src/modules/discover';

import FeatureDetail from '../../../src/modules/features/FeatureDetail';
import FeaturesShell from '../../../src/modules/features/FeaturesShell';
import FeatureTree from '../../../src/modules/features/FeatureTree';
import { module } from '../../../src/modules/features/index';
import { FEATURE_STATUSES, FeatureStatusIcon } from '../../../src/modules/features/status-icons';
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

    test('renders feature ids, names, and leading status indicators from flat list', () => {
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
        // Status is conveyed by the icon's accessible name, never by rendered text.
        expect(container.querySelector('[data-feature-tree] svg[aria-label="Active"]')).not.toBeNull();
        expect(container.querySelector('[data-feature-tree] svg[aria-label="Done"]')).not.toBeNull();
        expect(html).not.toContain('>active<');
        expect(html).not.toContain('>done<');
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

        // Each row carries exactly one leading status slot whose icon is named by the
        // capitalized vocabulary label; no badge chrome and no raw status text remain.
        const slots = container.querySelectorAll('[data-testid="feature-tree-status"]');
        expect(slots.length).toBe(6);
        for (const label of ['Backlog', 'Active', 'Verifying', 'Blocked', 'Done', 'Cancelled']) {
            expect(container.querySelector(`svg[role="img"][aria-label="${label}"]`)).not.toBeNull();
        }
        expect(container.querySelectorAll('[aria-label^="Status:"]').length).toBe(0);
        expect(container.querySelectorAll('[data-feature-tree] .badge').length).toBe(0);
        const html = container.innerHTML;
        for (const status of ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled']) {
            expect(html).not.toContain(`>${status}<`);
        }
    });

    test('renders the status indicator as the leading slot of each row, ahead of id and name', () => {
        const features: FeatureSummary[] = [{ id: 'F', name: 'Root', status: 'active' }];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const button = container.querySelector('[data-feature-tree] button');
        expect(button).not.toBeNull();
        const children = Array.from(button?.children ?? []);
        expect(children.length).toBe(3);
        // Leading fixed-width status slot, then id, then name.
        expect(children[0]?.getAttribute('data-testid')).toBe('feature-tree-status');
        expect(children[0]?.querySelector('svg[aria-label="Active"]')).not.toBeNull();
        expect(children[1]?.textContent).toBe('F');
        expect(children[2]?.textContent).toBe('Root');
    });

    test('indicators occupy the same fixed-width slot across nesting depths', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child', status: 'verifying' },
            { id: 'F1A', name: 'Grandchild', status: 'done' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const slots = Array.from(container.querySelectorAll('[data-testid="feature-tree-status"]'));
        expect(slots.length).toBe(3);
        // Fixed, not intrinsic: identical slot classes at every depth, so the icon column
        // never shifts with the status and a future chevron can take an adjacent slot.
        const slotClasses = slots.map((slot) => slot.getAttribute('class'));
        const reference = slotClasses[0];
        expect(reference).toBeDefined();
        for (const classes of slotClasses) {
            expect(classes).toBe(reference ?? null);
            expect(classes).toContain('w-4');
            expect(classes).toContain('shrink-0');
        }
        // Depth indentation stays on the row button, so the slot indents with its row.
        const buttons = Array.from(container.querySelectorAll('[data-feature-tree] button'));
        expect(buttons.map((b) => b.getAttribute('style'))).toEqual([
            'padding-left: calc(0.5rem + 0px);',
            'padding-left: calc(0.5rem + 16px);',
            'padding-left: calc(0.5rem + 32px);',
        ]);
    });

    test('selected row keeps the indicator visible with its accessible name intact', () => {
        const features: FeatureSummary[] = [{ id: 'F', name: 'Root', status: 'done' }];
        const { container } = render(<FeatureTree features={features} selectedId="F" onSelect={() => {}} />);
        const selected = Array.from(container.querySelectorAll('button')).find((b) =>
            b.getAttribute('class')?.includes('bg-spur-accent'),
        );
        expect(selected).toBeDefined();
        const icon = selected?.querySelector('[data-testid="feature-tree-status"] svg');
        expect(icon).not.toBeNull();
        expect(icon?.getAttribute('role')).toBe('img');
        expect(icon?.getAttribute('aria-label')).toBe('Done');
    });

    test('long feature names truncate without displacing the leading indicator', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'An extremely long feature name that exceeds the panel width', status: 'active' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const button = container.querySelector('[data-feature-tree] button');
        const slot = button?.querySelector('[data-testid="feature-tree-status"]');
        const nameSpan = button?.lastElementChild;
        // shrink-0 slot + truncating flex-1 name: the name absorbs overflow, the icon stays put.
        expect(slot?.getAttribute('class')).toContain('shrink-0');
        expect(nameSpan?.getAttribute('class')).toContain('flex-1');
        expect(nameSpan?.getAttribute('class')).toContain('truncate');
        expect(button?.firstElementChild).toBe(slot ?? null);
    });

    test('renders siblings sorted by id regardless of input order', () => {
        // Out-of-order input must still render in id order so the tree is stable
        // against server-side list ordering.
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F2', name: 'Second', status: 'active' },
            { id: 'F1', name: 'First', status: 'active' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const ids = Array.from(container.querySelectorAll('[data-feature-tree] button span.font-mono')).map(
            (span) => span.textContent,
        );
        expect(ids).toEqual(['F', 'F1', 'F2']);
    });

    // ── Task 0336: hover tooltip revealing the status label (AC R5) ──

    test('indicator slot carries a daisyUI tooltip whose data-tip is the human status label', () => {
        const features: FeatureSummary[] = [{ id: 'F', name: 'Root', status: 'blocked' }];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const slot = container.querySelector('[data-testid="feature-tree-status"]');
        expect(slot).not.toBeNull();
        const classes = slot?.getAttribute('class') ?? '';
        expect(classes).toContain('tooltip');
        expect(classes).toContain('tooltip-right');
        // One label source: data-tip and the icon's accessible name must agree.
        expect(slot?.getAttribute('data-tip')).toBe('Blocked');
        expect(slot?.querySelector('svg')?.getAttribute('aria-label')).toBe(slot?.getAttribute('data-tip'));
    });

    test('tooltip data-tip uses the same unknown-status fallback as the accessible name', () => {
        const features: FeatureSummary[] = [{ id: 'F', name: 'Root', status: 'frobnicate' }];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const slot = container.querySelector('[data-testid="feature-tree-status"]');
        expect(slot?.getAttribute('data-tip')).toBe('Unknown status: frobnicate');
        expect(slot?.querySelector('svg')?.getAttribute('aria-label')).toBe('Unknown status: frobnicate');
    });

    test('removing the tooltip affordance leaves the accessible name intact (ADR-034)', () => {
        const features: FeatureSummary[] = [{ id: 'F', name: 'Root', status: 'blocked' }];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const slot = container.querySelector('[data-testid="feature-tree-status"]');
        expect(slot).not.toBeNull();
        // Strip the entire tooltip affordance: data-tip plus the tooltip classes.
        slot?.removeAttribute('data-tip');
        const withoutTooltip = (slot?.getAttribute('class') ?? '')
            .split(/\s+/)
            .filter((c) => c !== 'tooltip' && c !== 'tooltip-right')
            .join(' ');
        slot?.setAttribute('class', withoutTooltip);
        // The accessible name survives untouched — the tooltip can never be the sole channel.
        const icon = slot?.querySelector('svg');
        expect(icon?.getAttribute('role')).toBe('img');
        expect(icon?.getAttribute('aria-label')).toBe('Blocked');
    });

    test('no title attribute is rendered anywhere in a tree row', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child', status: 'done' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        expect(container.querySelectorAll('[title]').length).toBe(0);
    });
});

// ── FeatureStatusIcon (task 0332: self-describing, vocabulary-linked) ──

describe('FeatureStatusIcon', () => {
    test('re-exports the domain FEATURE_STATUSES verbatim — one definition site', () => {
        // Reference identity proves status-icons re-exports instead of re-declaring.
        expect(FEATURE_STATUSES).toBe(DOMAIN_FEATURE_STATUSES);
        expect([...FEATURE_STATUSES]).toEqual(['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled']);
    });

    test('every canonical status renders one img-role SVG named by its capitalized label', () => {
        const cases: Array<[string, string]> = [
            ['backlog', 'Backlog'],
            ['active', 'Active'],
            ['verifying', 'Verifying'],
            ['blocked', 'Blocked'],
            ['done', 'Done'],
            ['cancelled', 'Cancelled'],
        ];
        for (const [status, label] of cases) {
            const { container, unmount } = render(<FeatureStatusIcon status={status} />);
            const svgs = container.querySelectorAll('svg');
            expect(svgs.length).toBe(1);
            const svg = svgs[0];
            // Accessible name lives in the markup, independent of any tooltip (R3/R5).
            expect(svg?.getAttribute('role')).toBe('img');
            expect(svg?.getAttribute('aria-label')).toBe(label);
            expect(svg?.getAttribute('aria-hidden')).toBeNull();
            unmount();
        }
    });

    test('accessible name comes from the status map label, not the raw status string', () => {
        const { container } = render(<FeatureStatusIcon status="verifying" />);
        const svg = container.querySelector('svg');
        expect(svg?.getAttribute('aria-label')).toBe('Verifying');
        expect(svg?.getAttribute('aria-label')).not.toBe('verifying');
    });

    test('every canonical status maps to distinct shape markup (task 0334, R1/R2/R6)', () => {
        // Pairwise-distinct inner SVG markup is the guard against two statuses silently
        // sharing a silhouette; the visual 15-pair greyscale matrix lives on task 0334.
        const shapeMarkups = new Map<string, string>();
        for (const status of FEATURE_STATUSES) {
            const { container, unmount } = render(<FeatureStatusIcon status={status} />);
            const svg = container.querySelector('svg');
            // Compare only the shape content — aria-label differs by construction.
            const markup = svg?.innerHTML ?? '';
            expect(markup.length).toBeGreaterThan(0);
            shapeMarkups.set(status, markup);
            unmount();
        }
        expect(new Set(shapeMarkups.values()).size).toBe(FEATURE_STATUSES.length);
    });

    test('unrecognized status degrades to a labelled fallback indicator without throwing', () => {
        const { container } = render(<FeatureStatusIcon status="frobnicate" />);
        const svgs = container.querySelectorAll('svg');
        expect(svgs.length).toBe(1);
        const svg = svgs[0];
        expect(svg?.getAttribute('role')).toBe('img');
        const name = svg?.getAttribute('aria-label');
        expect(name).toBe('Unknown status: frobnicate');
        expect(name && name.length > 0).toBe(true);
    });
    // ── Task 0338: colorClass contract (R3 token swap + R4 single-token-family gate) ──
    //
    // R3 swapped blocked/done onto the Spur semantic tokens and cancelled onto the
    // new --color-spur-text-faint token; R4 requires all six statuses to resolve
    // through the `text-spur-*` family. The colorClass is observable in the rendered
    // SVG className (status-icons.tsx:155), so a regression that re-introduces
    // `text-error` / `text-success` / the `opacity-60` blend would fail here.
    test('every canonical status renders through its assigned text-spur-* colorClass (0338 R3/R4)', () => {
        const expectedClass: Record<string, string> = {
            backlog: 'text-spur-text-muted',
            active: 'text-spur-accent',
            verifying: 'text-spur-warning',
            blocked: 'text-spur-error',
            done: 'text-spur-success',
            cancelled: 'text-spur-text-faint',
        };
        for (const [status, expected] of Object.entries(expectedClass)) {
            const { container, unmount } = render(<FeatureStatusIcon status={status} />);
            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();
            const classes = svg?.getAttribute('class') ?? '';
            // R3/R4: the assigned colorClass is present as a discrete class on the SVG.
            expect(classes).toContain(expected);
            // R4 single-token-family gate: no legacy text-error / text-success leaks,
            // and the cancelled opacity-60 blend hack is gone.
            expect(classes).not.toContain('text-error');
            expect(classes).not.toContain('text-success');
            expect(classes).not.toContain('opacity-60');
            // R4 single-token-family gate: at least one class on the SVG is a text-spur-* token.
            // (expectedClass[status] membership above already proves the exact token; this asserts
            // the family property holds independent of the map definition.)
            const tokenClasses = classes.split(/\s+/).filter((c) => c.startsWith('text-spur-'));
            expect(tokenClasses.length).toBeGreaterThan(0);
            unmount();
        }
    });

    test('cancelled resolves to the solid text-spur-text-faint token, not the opacity-60 blend (0338 R1/R3)', () => {
        // R1 replaced the `text-spur-text-muted opacity-60` blended hack with a
        // dedicated solid token so the cancelled glyph's contrast is governable
        // per-canvas. Assert the exact resolution — a revert would put `opacity-60`
        // back on the className and drop `text-spur-text-faint`.
        const { container } = render(<FeatureStatusIcon status="cancelled" />);
        const classes = container.querySelector('svg')?.getAttribute('class') ?? '';
        expect(classes).toContain('text-spur-text-faint');
        expect(classes).not.toContain('opacity-60');
        expect(classes).not.toContain('text-spur-text-muted');
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

    test('keeps the labelled status pill — the tree icon-only treatment does not apply here', async () => {
        installFeatureFetchMock();
        const { getByTestId } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('active'));
        const pill = getByTestId('status-pill');
        // Labelled pill chrome: rounded-full + border, holding the raw status text.
        expect(pill.getAttribute('class')).toContain('rounded-full');
        expect(pill.getAttribute('class')).toContain('border');
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
            // The tree renders icon-only status (no status text), so the detail pane's
            // status-pill test-id is the unique handle for the panel's status — assert on
            // it rather than on a text query that a tree badge could also satisfy.
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
        const { getByText, getByTestId } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());
        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('active'));

        setStatus('verifying');
        const es = FakeEventSource.instances.at(-1);
        expect(es).toBeDefined();
        es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));

        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('verifying'));
    });

    test('an unrelated SSE frame does not refresh the detail panel', async () => {
        const { setStatus } = installMutatingDetailMock();
        const { getByText, getByTestId } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());
        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('active'));

        setStatus('verifying');
        const es = FakeEventSource.instances.at(-1);
        es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'task.updated' }) }));
        await new Promise((r) => setTimeout(r, 20));

        expect(getByTestId('status-pill').textContent).toBe('active');
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
