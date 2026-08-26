import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { FEATURE_STATUSES as DOMAIN_FEATURE_STATUSES } from '@gobing-ai/spur-domain/schema';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { FeatureSummary } from '../../../src/lib/feature-types';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import { isWebModule } from '../../../src/modules/discover';

import FeatureDetail from '../../../src/modules/features/FeatureDetail';
import FeaturesShell from '../../../src/modules/features/FeaturesShell';
import FeatureTree from '../../../src/modules/features/FeatureTree';
import FloatingAgentBar from '../../../src/modules/features/FloatingAgentBar';
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
        // F is a parent (has child F1), so it has a fold button + row button; F1 is a leaf with a row button.
        const rowButtons = container.querySelectorAll('button[class*="truncate"], button.flex-1');
        expect(rowButtons.length).toBe(2);
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
        const button = container.querySelector('[data-feature-tree] button.flex-1');
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
        // Depth indentation stays on the row wrapper div, so the slot indents with its row.
        const rowDivs = Array.from(container.querySelectorAll('[data-feature-tree] li > div'));
        expect(rowDivs.map((d) => d.getAttribute('style'))).toEqual([
            'padding-left: calc(0.25rem + 0px);',
            'padding-left: calc(0.25rem + 16px);',
            'padding-left: calc(0.25rem + 32px);',
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

    test('renders root features sorted A→Z regardless of input order', () => {
        // Multiple top-level IDs (DD-14 single-letter roots) must sort ascending too —
        // only children were sorted before, so Z appeared above A when the API listed Z first.
        const features: FeatureSummary[] = [
            { id: 'Z', name: 'Zeta', status: 'active' },
            { id: 'A', name: 'Alpha', status: 'draft' },
            { id: 'M', name: 'Mu', status: 'done' },
            { id: 'A1', name: 'Alpha child', status: 'active' },
        ];
        const { container } = render(<FeatureTree features={features} selectedId={null} onSelect={() => {}} />);
        const ids = Array.from(container.querySelectorAll('[data-feature-tree] button span.font-mono')).map(
            (span) => span.textContent,
        );
        expect(ids).toEqual(['A', 'A1', 'M', 'Z']);
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

    test('refreshKey reload does not stick on Loading body when feature is already painted', async () => {
        // Regression: SSE refreshKey + post-action reloadFeature raced on beginLoad;
        // the effect set loadingBody=true and a superseded finally never cleared it.
        installFeatureFetchMock();
        const { rerender, getByText, queryByText, getByTestId } = render(
            <FeatureDetail featureId="F" refreshKey={0} />,
        );
        await waitFor(() => expect(getByText('active')).toBeDefined());
        expect(queryByText('Loading body…')).toBeNull();
        expect(getByTestId('feature-body-section').textContent).not.toContain('Loading body…');

        rerender(<FeatureDetail featureId="F" refreshKey={1} />);
        // Must not blank the body into a permanent spinner on background refresh.
        await waitFor(() => expect(getByText('active')).toBeDefined());
        expect(queryByText('Loading body…')).toBeNull();
    });

    test('Complete FSM action updates status and shows in-panel success feedback', async () => {
        let status = 'verifying';
        setFetchForTesting((async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F/status') && method === 'PATCH') {
                status = 'done';
                return jsonResponse({ ok: true, data: { status: 'done' } });
            }
            if (url.includes('/features/F')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status,
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByLabelText, getByText, getByTestId, queryByLabelText, queryByText } = render(
            <FeatureDetail featureId="F" />,
        );
        await waitFor(() => expect(getByText('verifying')).toBeDefined());
        expect(getByLabelText('Complete')).toBeDefined();

        fireEvent.click(getByLabelText('Complete'));

        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('done'));
        await waitFor(() => expect(getByTestId('action-feedback').getAttribute('data-kind')).toBe('ok'));
        // Terminal status has no Complete button.
        expect(queryByLabelText('Complete')).toBeNull();
        // Body must not be stuck loading after the transition reload.
        expect(queryByText('Loading body…')).toBeNull();
    });

    test('failed FSM transition shows in-panel error feedback (not silent)', async () => {
        setFetchForTesting((async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F/status') && method === 'PATCH') {
                return jsonResponse({ error: { message: 'guard denied: incomplete linked work' } }, 400);
            }
            if (url.includes('/features/F')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: 'verifying',
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByLabelText, getByText, getByTestId } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByText('verifying')).toBeDefined());

        fireEvent.click(getByLabelText('Complete'));

        await waitFor(() => {
            const feedback = getByTestId('action-feedback');
            expect(feedback.getAttribute('data-kind')).toBe('error');
            expect(feedback.textContent).toContain('guard denied');
        });
        // Status unchanged; Complete still available.
        expect(getByTestId('status-pill').textContent).toBe('verifying');
        expect(getByLabelText('Complete')).toBeDefined();
    });

    // ── Child features section (task 0525: list and link child features) ──

    /** Expand the foldable metadata pane — the child section lives inside it. */
    function openMetadata(container: HTMLElement) {
        const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Metadata'),
        );
        expect(toggle).toBeDefined();
        if (toggle) fireEvent.click(toggle);
    }

    test('R1: renders Child features (N) with each direct child id, name, and status icon', async () => {
        installFeatureFetchMock();
        const children: FeatureSummary[] = [
            { id: 'F1', name: 'Project switcher', status: 'done' },
            { id: 'F2', name: 'Status filter', status: 'active' },
        ];
        const { getByText, container } = render(<FeatureDetail featureId="F" childFeatures={children} />);
        await waitFor(() => expect(getByText('active')).toBeDefined());

        openMetadata(container);
        expect(getByText('Child features (2)')).toBeDefined();
        expect(getByText('F1')).toBeDefined();
        expect(getByText('Project switcher')).toBeDefined();
        expect(getByText('F2')).toBeDefined();
        expect(getByText('Status filter')).toBeDefined();

        // Each row leads with the child's FeatureStatusIcon (role="img", labelled).
        const section = getByText('Child features (2)').parentElement;
        expect(section).not.toBeNull();
        const iconLabels = Array.from(section?.querySelectorAll('[role="img"]') ?? []).map((el) =>
            el.getAttribute('aria-label'),
        );
        expect(iconLabels).toContain('Done');
        expect(iconLabels).toContain('Active');
    });

    test('R2: child row is a button with the Open child feature accessible name; click selects the child', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/K')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'K',
                        name: 'Umbrella',
                        status: 'active',
                        frontmatter: {},
                        filePath: 'docs/features/K.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }
            return jsonResponse({ ok: true, data: [] });
        }) as unknown as typeof fetch);
        const children: FeatureSummary[] = [{ id: 'K1', name: 'Project switcher', status: 'backlog' }];
        const selected: string[] = [];
        const { getByText, getByRole, container } = render(
            <FeatureDetail featureId="K" childFeatures={children} onSelectFeature={(id) => selected.push(id)} />,
        );
        await waitFor(() => expect(getByText('active')).toBeDefined());

        openMetadata(container);
        const row = getByRole('button', { name: 'Open child feature K1: Project switcher' });
        expect(row.getAttribute('type')).toBe('button');
        fireEvent.click(row);
        expect(selected).toEqual(['K1']);
    });

    test('R3: umbrella with zero linked tasks still provides a navigable child row', async () => {
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] }); // no linked tasks
            if (url.includes('/features/K')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'K',
                        name: 'Umbrella',
                        status: 'active',
                        frontmatter: {},
                        filePath: 'docs/features/K.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }
            return jsonResponse({ ok: true, data: [] });
        }) as unknown as typeof fetch);
        const children: FeatureSummary[] = [{ id: 'K1', name: 'Project switcher', status: 'backlog' }];
        const selected: string[] = [];
        const { getByText, getByRole, container } = render(
            <FeatureDetail featureId="K" childFeatures={children} onSelectFeature={(id) => selected.push(id)} />,
        );
        await waitFor(() => expect(getByText('active')).toBeDefined());

        openMetadata(container);
        expect(getByText('No linked tasks')).toBeDefined();
        const row = getByRole('button', { name: 'Open child feature K1: Project switcher' });
        fireEvent.click(row);
        expect(selected).toEqual(['K1']);
    });

    test('R4: no children renders no Child features section and no empty-state text', async () => {
        installFeatureFetchMock();
        const { getByText, queryByText, container } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByText('active')).toBeDefined());

        openMetadata(container);
        expect(queryByText(/Child features/)).toBeNull();
        expect(queryByText(/No child features/i)).toBeNull();
    });

    test('0644 R2: metadata drawer is folded by default, opens with aria-expanded flip, and closes on Escape', async () => {
        installFeatureFetchMock();
        const { getByTestId, getByLabelText, container } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('active'));

        const panel = getByTestId('feature-metadata-panel');
        const toggle = getByTestId('metadata-toggle');
        // Folded by default: hidden, and its focusable rows are not in the DOM/tab order.
        expect(panel.getAttribute('aria-hidden')).toBe('true');
        expect(panel.querySelectorAll('button')).toHaveLength(0);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');

        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(getByTestId('feature-metadata-panel').getAttribute('aria-hidden')).toBe('false');
        expect(getByTestId('metadata-status').textContent).toBe('active');

        fireEvent.keyDown(document, { key: 'Escape' });
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelectorAll('#feature-metadata-panel button')).toHaveLength(0);

        // Open again and close via close icon in panel header
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        const closeBtn = getByLabelText('Close metadata');
        fireEvent.click(closeBtn);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelectorAll('#feature-metadata-panel button')).toHaveLength(0);
    });

    test('0644 R2 (P3): Escape with a confirmation modal open leaves the metadata drawer open', async () => {
        installFeatureFetchMock();
        const { getByTestId, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('active'));

        const toggle = getByTestId('metadata-toggle');
        fireEvent.click(toggle);
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        fireEvent.click(getByLabelText('Cancel')); // opens the z-50 cancel confirmation modal
        fireEvent.keyDown(document, { key: 'Escape' }); // modal-owned key; drawer must not fold
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
    });

    test('F841 R1/R2: body editor and preview are full-width and editing controls appear in the header before Metadata', async () => {
        installFeatureFetchMock();
        const { getByTestId, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());
        // Body preview is full-width without max-w-4xl reading cap
        expect(getByTestId('body-preview').getAttribute('class')).toContain('w-full');
        expect(getByTestId('body-preview').getAttribute('class')).not.toContain('max-w-4xl');

        // Header Edit button appears immediately before Metadata toggle
        const editButton = getByLabelText('Edit body');
        expect(editButton).toBeDefined();
        const metadataToggle = getByTestId('metadata-toggle');
        expect(editButton.nextElementSibling).toBe(metadataToggle);

        // Clicking Edit enters edit mode: Edit is replaced by Save then Cancel immediately before Metadata
        fireEvent.click(editButton);
        const editor = getByTestId('body-editor');
        expect(editor.getAttribute('class')).toContain('w-full');
        expect(editor.getAttribute('class')).not.toContain('max-w-4xl');
        expect(editor.getAttribute('class')).toContain('flex-1');
        expect(editor.getAttribute('class')).toContain('min-h-0');

        const saveButton = getByLabelText('Save body');
        const cancelButton = getByLabelText('Cancel edit');
        expect(saveButton).toBeDefined();
        expect(cancelButton).toBeDefined();
        expect(saveButton.nextElementSibling).toBe(cancelButton);
        expect(cancelButton.nextElementSibling).toBe(metadataToggle);

        // Clicking Cancel returns to preview mode and restores Edit before Metadata
        fireEvent.click(cancelButton);
        expect(getByTestId('body-preview')).toBeDefined();
        expect(getByLabelText('Edit body').nextElementSibling).toBe(metadataToggle);
    });

    test('0644 R3: per-status primary and hazard action tiers render', async () => {
        const expectedPrimary: Record<string, string> = {
            backlog: 'Start',
            active: 'Verify',
            verifying: 'Complete',
            blocked: 'Unblock',
        };
        for (const [status, primaryLabel] of Object.entries(expectedPrimary)) {
            setFetchForTesting((async (input: RequestInfo | URL) => {
                const url = input instanceof Request ? input.url : String(input);
                if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status,
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nx',
                    },
                });
            }) as unknown as typeof fetch);
            const { getByLabelText, unmount } = render(<FeatureDetail featureId="F" />);
            await waitFor(() => expect(getByLabelText(primaryLabel)).toBeDefined());
            expect(getByLabelText(primaryLabel).getAttribute('data-action-tier')).toBe('primary');
            expect(getByLabelText('Cancel').getAttribute('data-action-tier')).toBe('hazard');
            if (status === 'active') {
                expect(getByLabelText('+ Child').getAttribute('data-action-tier')).toBe('secondary');
                expect(getByLabelText('Block').getAttribute('data-action-tier')).toBe('hazard');
            }
            if (status === 'verifying') {
                expect(getByLabelText('Rework').getAttribute('data-action-tier')).toBe('hazard');
            }
            unmount();
        }
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

    test('R5: detail child rows derive from the unfiltered list — visible even under a status filter', async () => {
        installFeatureFetchMock(); // list: F (active), F1 (done) — F1 is a direct child of F
        const { getByText, getByRole, getByLabelText, queryByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        // Filter the tree to 'active' — hides F1 ('done') from the sidebar.
        fireEvent.click(getByLabelText('Filter features by status'));
        const activeOption = Array.from(container.querySelectorAll('[data-filter-menu] button')).find((b) =>
            b.textContent?.includes('active'),
        );
        expect(activeOption).toBeDefined();
        if (activeOption) fireEvent.click(activeOption);
        expect(queryByText('Child')).toBeNull();

        // Select Root: the detail pane still lists the filtered-out child F1.
        fireEvent.click(getByText('Root'));
        // Detail loads async; wait for the metadata toggle before expanding.
        await waitFor(() => {
            const toggle = Array.from(container.querySelectorAll('button')).find((b) =>
                b.textContent?.includes('Metadata'),
            );
            expect(toggle).toBeDefined();
        });
        const metadataToggle = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Metadata'),
        );
        if (metadataToggle) fireEvent.click(metadataToggle);

        await waitFor(() => expect(getByText('Child features (1)')).toBeDefined());
        expect(getByRole('button', { name: 'Open child feature F1: Child' })).toBeDefined();
    });

    test('R1/R2: module header renders icon, title, subtitle, and the action container', async () => {
        installFeatureFetchMock();
        const { getByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        expect(container.querySelector('[data-features-actions]')).not.toBeNull();
        expect(container.textContent).toContain('🎯');
        expect(getByText('Features')).toBeDefined();
        expect(getByText('Hierarchical feature roadmap, acceptance criteria, and lifecycle progression')).toBeDefined();
    });

    test('R3: toggle collapses and re-expands the tree dock and flips aria-expanded', async () => {
        installFeatureFetchMock();
        const { getByLabelText, getByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        const toggle = getByLabelText('Collapse feature tree');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(toggle.getAttribute('aria-controls')).toBe('feature-tree-dock');
        expect(container.querySelector('#feature-tree-dock')?.hasAttribute('hidden')).toBe(false);

        // Collapse: tree dock overlay sets native hidden attribute (non-modal overlay).
        fireEvent.click(toggle);
        const collapsed = getByLabelText('Expand feature tree');
        expect(collapsed.getAttribute('aria-expanded')).toBe('false');
        expect(container.querySelector('#feature-tree-dock')?.hasAttribute('hidden')).toBe(true);

        // Re-expand: tree dock overlay removes hidden attribute.
        fireEvent.click(collapsed);
        expect(getByLabelText('Collapse feature tree').getAttribute('aria-expanded')).toBe('true');
        expect(container.querySelector('#feature-tree-dock')?.hasAttribute('hidden')).toBe(false);
    });

    test('layout: tree floats as an overlay at the body panel left side, outside it, without consuming body width', async () => {
        installFeatureFetchMock();
        const { getByText, container } = render(<FeaturesShell />);

        await waitFor(() => expect(getByText('Root')).toBeDefined());

        const dock = container.querySelector('#feature-tree-dock');
        const workspace = container.querySelector('[data-testid="detail-workspace"]');
        expect(dock).not.toBeNull();
        expect(workspace).not.toBeNull();
        // The tree is a separate floating panel OUTSIDE the body panel — never contained
        // by it, so it cannot consume the body's layout width.
        expect(workspace?.contains(dock)).toBe(false);
        // Floating overlay anchored to the body panel's left side, aligned to its
        // top/bottom (below the module header).
        const dockClass = dock?.getAttribute('class') ?? '';
        expect(dockClass).toContain('absolute');
        expect(dockClass).toContain('z-20');
        expect(dockClass).toContain('right-[calc(100%_+_12px)]');
        expect(dockClass).toContain('top-0');
        expect(dockClass).toContain('bottom-0');
        expect(dockClass).not.toContain('shrink-0');
        // The body keeps the full container width (matches the header width).
        expect(workspace?.className).toContain('w-full');
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
        // Wrap the external SSE dispatch in `act` so the async tree refetch
        // (`void load()` → `setFeatures`) and the detail nudge both flush
        // inside the test boundary rather than after the test returns.
        await act(async () => {
            es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));
        });
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
/**
 * Read a node's React fiber props and invoke `onChange` directly — happy-dom +
 * React 19 do not deliver fireEvent.change to a controlled textarea's onChange
 * (capricorn86/happy-dom#856); matches the teams/MemberTerminal convention.
 */
function setPromptValue(textarea: Element, value: string): void {
    const holder = textarea as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (!onChange) throw new Error('onChange not found on agent-bar-input');
    act(() => onChange({ target: { value } }));
}

describe('FloatingAgentBar', () => {
    test('F841 R7/R8: folded by default as a spirit dock, opens to wider 84rem glass bar, and collapses back', () => {
        const { getByTestId, getByLabelText, queryByTestId } = render(<FloatingAgentBar />);
        // Starts folded
        expect(queryByTestId('agent-bar')).toBeNull();
        const dock = getByTestId('agent-bar-dock');
        expect(dock.className).toContain('fixed');
        expect(dock.className).toContain('bottom-6');
        expect(dock.className).toContain('right-6');
        expect(dock.className).toContain('z-30');

        // Click to open
        fireEvent.click(dock);
        const bar = getByTestId('agent-bar');
        expect(bar.className).toContain('fixed');
        expect(bar.className).toContain('backdrop-blur-md');
        expect(bar.className).toContain('bg-base-100/80');
        expect(bar.className).toContain('w-[calc(100vw-2rem)]');
        expect(bar.className).toContain('max-w-[84rem]');
        expect(bar.className).toContain('z-30');

        // Collapse back
        fireEvent.click(getByLabelText('Collapse agent prompt bar'));
        expect(queryByTestId('agent-bar')).toBeNull();
        expect(getByTestId('agent-bar-dock')).toBeDefined();
    });

    test('Send is disabled while the prompt is empty, enabled once text is entered', () => {
        const { getByTestId, getByText } = render(<FloatingAgentBar />);
        // Open the bar
        fireEvent.click(getByTestId('agent-bar-dock'));
        const send = getByText('Send') as HTMLButtonElement;
        expect(send.disabled).toBe(true);
        setPromptValue(getByTestId('agent-bar-input'), 'refine this feature');
        expect((send as HTMLButtonElement).disabled).toBe(false);
    });

    test('submitting clears the field and surfaces the stub notice', () => {
        const { getByTestId, getByText, getByRole } = render(<FloatingAgentBar />);
        // Open the bar
        fireEvent.click(getByTestId('agent-bar-dock'));
        const input = getByTestId('agent-bar-input') as HTMLTextAreaElement;
        setPromptValue(input, 'implement F84');
        fireEvent.click(getByText('Send'));
        expect(input.value).toBe('');
        expect(getByRole('status').textContent).toContain('Agent dispatch is not wired yet');
    });

    test('renders alongside the shell empty-state placeholder with no feature selected', async () => {
        setFetchForTesting((async () => jsonResponse({ ok: true, data: [] })) as unknown as typeof fetch);
        const { getByText, getByTestId } = render(<FeaturesShell />);
        await waitFor(() => expect(getByText('Select a feature to view details')).toBeDefined());
        expect(getByTestId('agent-bar-dock')).not.toBeNull();
    });
});

// ── F841 Acceptance Criteria Scenarios (R1-R15) ──

describe('F841 Acceptance Criteria', () => {
    test('R1: Feature Tree floats as an overlay at the detail workspace left, outside it, without resizing the body', async () => {
        installFeatureFetchMock();
        const { getByText, getByLabelText, container } = render(<FeaturesShell />);
        await waitFor(() => expect(getByText('Root')).toBeDefined());

        // Select feature
        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(container.querySelector('[data-testid="body-preview"]')).not.toBeNull());

        const treeDock = container.querySelector('#feature-tree-dock');
        // The tree is a floating overlay OUTSIDE the detail workspace — never contained
        // by it, so it consumes no body layout width.
        const detailWorkspace = container.querySelector('[data-testid="detail-workspace"]');
        expect(detailWorkspace).not.toBeNull();
        expect(detailWorkspace?.contains(treeDock)).toBe(false);

        // Floating overlay anchored to the body's left, aligned to its top/bottom
        // (below the module header), not a layout sibling.
        expect(treeDock?.className).toContain('absolute');
        expect(treeDock?.className).toContain('z-20');
        expect(treeDock?.className).toContain('right-[calc(100%_+_12px)]');
        expect(treeDock?.className).toContain('top-0');
        expect(treeDock?.className).toContain('bottom-0');
        expect(treeDock?.className).not.toContain('shrink-0');

        // The body keeps the full container width (matches the header width).
        expect(detailWorkspace?.className).toContain('w-full');

        // Toggle tree closed via header toggle
        const toggle = getByLabelText('Collapse feature tree');
        fireEvent.click(toggle);
        expect(treeDock?.hasAttribute('hidden')).toBe(true);

        // Toggle tree open via header toggle
        fireEvent.click(getByLabelText('Expand feature tree'));
        expect(treeDock?.hasAttribute('hidden')).toBe(false);

        // Preview remains full-width
        const preview = container.querySelector('[data-testid="body-preview"]');
        expect(preview?.className).toContain('w-full');
        expect(preview?.className).not.toContain('max-w-4xl');
    });

    test('R2: Metadata opens as a right overlay without altering editor/preview width', async () => {
        installFeatureFetchMock();
        const { getByTestId, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        const metadataToggle = getByTestId('metadata-toggle');
        const metadataPanel = getByTestId('feature-metadata-panel');
        expect(metadataPanel.className).toContain('absolute');
        expect(metadataPanel.className).toContain('right-0');

        // Open metadata
        fireEvent.click(metadataToggle);
        expect(metadataToggle.getAttribute('aria-expanded')).toBe('true');
        expect(metadataPanel.getAttribute('aria-hidden')).toBe('false');

        // Close metadata via header close button
        const closeBtn = getByLabelText('Close metadata');
        fireEvent.click(closeBtn);
        expect(metadataToggle.getAttribute('aria-expanded')).toBe('false');

        // Switch to edit mode
        fireEvent.click(getByLabelText('Edit body'));
        const editor = getByTestId('body-editor');
        expect(editor.className).toContain('w-full');
        expect(editor.className).not.toContain('max-w-4xl');
    });

    test('R3 & R4: Header Edit/Save/Cancel action slot substitution', async () => {
        installFeatureFetchMock();
        const { getByTestId, getByLabelText, queryByText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        // No BODY label in body area
        expect(queryByText('Body')).toBeNull();

        // Edit button is immediately before Metadata
        const editBtn = getByLabelText('Edit body');
        const metaBtn = getByTestId('metadata-toggle');
        expect(editBtn.nextElementSibling).toBe(metaBtn);

        // Click Edit -> enters edit mode
        fireEvent.click(editBtn);
        const saveBtn = getByLabelText('Save body');
        const cancelBtn = getByLabelText('Cancel edit');
        expect(saveBtn.nextElementSibling).toBe(cancelBtn);
        expect(cancelBtn.nextElementSibling).toBe(metaBtn);
    });

    test('R5: Saving from header sends body update request and returns to preview', async () => {
        let savedBody: string | null = null;
        setFetchForTesting((async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            const method = input instanceof Request ? input.method : (init?.method ?? 'GET');
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F/body') && method === 'PATCH') {
                const bodyText = input instanceof Request ? await input.clone().text() : String(init?.body);
                const bodyJson = JSON.parse(bodyText) as { body: string };
                savedBody = bodyJson.body;
                return jsonResponse({ ok: true, data: {} });
            }
            if (url.includes('/features/F')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: 'active',
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nPersisted content',
                    },
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByTestId, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        const saveBtn = getByLabelText('Save body');
        fireEvent.click(saveBtn);

        await waitFor(() => expect(savedBody).not.toBeNull());
        expect(getByTestId('body-preview')).toBeDefined();
        expect(getByLabelText('Edit body')).toBeDefined();
    });

    test('R6: Cancelling from header discards body draft without sending request', async () => {
        let patchCalled = false;
        setFetchForTesting((async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F/body') && init?.method === 'PATCH') {
                patchCalled = true;
                return jsonResponse({ ok: true, data: {} });
            }
            if (url.includes('/features/F')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: 'active',
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nOriginal content',
                    },
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByTestId, getByLabelText } = render(<FeatureDetail featureId="F" />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        fireEvent.click(getByLabelText('Edit body'));
        fireEvent.click(getByLabelText('Cancel edit'));

        expect(patchCalled).toBe(false);
        expect(getByTestId('body-preview')).toBeDefined();
        expect(getByLabelText('Edit body')).toBeDefined();
    });

    test('R9 & R10: Branch fold control accessibility, recursive descendant omission, and independent branch state', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child 1', status: 'active' },
            { id: 'F1A', name: 'Grandchild', status: 'done' },
            { id: 'G', name: 'Other Root', status: 'backlog' },
            { id: 'G1', name: 'Other Child', status: 'backlog' },
        ];

        const { queryByText, getByLabelText } = render(
            <FeatureTree features={features} selectedId={null} onSelect={() => {}} />,
        );

        // Parent nodes F, F1, G have fold controls; leaf nodes F1A, G1 do not
        const foldF = getByLabelText('Collapse F: Root');
        const foldF1 = getByLabelText('Collapse F1: Child 1');
        const foldG = getByLabelText('Collapse G: Other Root');
        expect(foldF.getAttribute('aria-expanded')).toBe('true');
        expect(foldF.getAttribute('aria-controls')).toBe('feature-tree-children-F');
        expect(foldF1.getAttribute('aria-expanded')).toBe('true');
        expect(foldG.getAttribute('aria-expanded')).toBe('true');

        // Fold parent F
        fireEvent.click(foldF);
        expect(foldF.getAttribute('aria-expanded')).toBe('false');
        expect(foldF.getAttribute('aria-label')).toBe('Expand F: Root');

        // Recursive descendants F1 and F1A are removed from DOM
        expect(queryByText('Child 1')).toBeNull();
        expect(queryByText('Grandchild')).toBeNull();

        // Other branch G and G1 remains visible
        expect(queryByText('Other Root')).not.toBeNull();
        expect(queryByText('Other Child')).not.toBeNull();
    });

    test('R11: Reopening ancestor branch restores preserved nested fold state', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child 1', status: 'active' },
            { id: 'F1A', name: 'Grandchild 1A', status: 'done' },
            { id: 'F2', name: 'Child 2', status: 'active' },
            { id: 'F2A', name: 'Grandchild 2A', status: 'done' },
        ];

        const { queryByText, getByLabelText } = render(
            <FeatureTree features={features} selectedId={null} onSelect={() => {}} />,
        );

        // Fold nested branch F1
        fireEvent.click(getByLabelText('Collapse F1: Child 1'));
        expect(queryByText('Grandchild 1A')).toBeNull();
        expect(queryByText('Grandchild 2A')).not.toBeNull();

        // Fold root ancestor F
        fireEvent.click(getByLabelText('Collapse F: Root'));
        expect(queryByText('Child 1')).toBeNull();
        expect(queryByText('Child 2')).toBeNull();

        // Reopen root ancestor F
        fireEvent.click(getByLabelText('Expand F: Root'));
        expect(queryByText('Child 1')).not.toBeNull();
        expect(queryByText('Child 2')).not.toBeNull();
        // F1 was folded before, so its grandchild remains hidden
        expect(queryByText('Grandchild 1A')).toBeNull();
        // F2 was expanded, so its grandchild is visible
        expect(queryByText('Grandchild 2A')).not.toBeNull();
    });

    test('R12: Selecting a parent row does not change its fold state', () => {
        const features: FeatureSummary[] = [
            { id: 'F', name: 'Root', status: 'active' },
            { id: 'F1', name: 'Child 1', status: 'active' },
        ];
        const selected: string[] = [];
        const { getByText, getByLabelText } = render(
            <FeatureTree features={features} selectedId={null} onSelect={(id) => selected.push(id)} />,
        );

        const foldBtn = getByLabelText('Collapse F: Root');
        expect(foldBtn.getAttribute('aria-expanded')).toBe('true');

        // Click row text
        fireEvent.click(getByText('Root'));
        expect(selected).toEqual(['F']);
        // Fold state unchanged
        expect(foldBtn.getAttribute('aria-expanded')).toBe('true');
        expect(getByText('Child 1')).toBeDefined();
    });

    test('R13: Presentation controls preserve selection, status filter, and draft without API calls', async () => {
        const calls: string[] = [];
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            calls.push(url);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F')) {
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: 'Root',
                        status: 'active',
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Goal\nInitial',
                    },
                });
            }
            if (url.includes('/features')) {
                return jsonResponse({
                    ok: true,
                    data: [
                        { id: 'F', name: 'Root', status: 'active' },
                        { id: 'F1', name: 'Child', status: 'active' },
                    ],
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByText, getByLabelText, getByTestId, container } = render(<FeaturesShell />);
        await waitFor(() => expect(getByText('Root')).toBeDefined());

        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(container.querySelector('[data-testid="body-preview"]')).not.toBeNull());

        // Enter edit mode
        fireEvent.click(getByLabelText('Edit body'));

        const callsBeforeToggles = calls.length;

        // Toggle tree overlay
        fireEvent.click(getByLabelText('Collapse feature tree'));
        fireEvent.click(getByLabelText('Expand feature tree'));

        // Toggle branch fold
        fireEvent.click(getByLabelText('Collapse F: Root'));
        fireEvent.click(getByLabelText('Expand F: Root'));

        // Toggle metadata overlay
        const metaToggle = getByTestId('metadata-toggle');
        fireEvent.click(metaToggle);
        fireEvent.click(metaToggle);

        // Toggle floating prompt
        const promptDock = getByTestId('agent-bar-dock');
        fireEvent.click(promptDock);
        fireEvent.click(getByLabelText('Collapse agent prompt bar'));

        // No additional network requests were made during presentation toggles
        expect(calls.length).toBe(callsBeforeToggles);
        // Editor is still in edit mode
        expect(container.querySelector('[data-testid="body-editor"]')).not.toBeNull();
    });

    test('R14: Same-feature refresh in edit mode preserves unsaved draft buffers', async () => {
        let fetchCount = 0;
        setFetchForTesting((async (input: RequestInfo | URL) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes('/tasks')) return jsonResponse({ ok: true, data: [] });
            if (url.includes('/features/F')) {
                fetchCount++;
                return jsonResponse({
                    ok: true,
                    data: {
                        id: 'F',
                        name: `Root v${fetchCount}`,
                        status: fetchCount === 1 ? 'active' : 'verifying',
                        frontmatter: {},
                        filePath: 'docs/features/F.md',
                        content: '---\n---\n\n## Server Body',
                    },
                });
            }
            return jsonResponse({ ok: true, data: {} });
        }) as unknown as typeof fetch);

        const { getByTestId, getByLabelText, rerender } = render(<FeatureDetail featureId="F" refreshKey={0} />);
        await waitFor(() => expect(getByTestId('body-preview')).toBeDefined());

        // Enter edit mode
        fireEvent.click(getByLabelText('Edit body'));
        expect(getByTestId('body-editor')).toBeDefined();

        // Trigger same-feature refreshKey reload while in edit mode
        rerender(<FeatureDetail featureId="F" refreshKey={1} />);
        await waitFor(() => expect(getByTestId('status-pill').textContent).toBe('verifying'));

        // Editor is still in edit mode, not overwritten by server preview
        expect(getByTestId('body-editor')).toBeDefined();
        expect(getByLabelText('Save body')).toBeDefined();
    });

    test('R15: Planning SSE events refresh the tree and selected detail', async () => {
        const calls = installFeatureFetchMock();
        const { getByText } = render(<FeaturesShell />);
        await waitFor(() => expect(getByText('Root')).toBeDefined());

        fireEvent.click(getByText('Root'));
        await waitFor(() => expect(calls.some((url) => url.includes('/features/F'))).toBe(true));

        const es = FakeEventSource.instances[0];
        expect(es).toBeDefined();

        // Send feature.updated event
        const callsBefore = calls.length;
        act(() => {
            es?.onmessage?.(new MessageEvent('message', { data: JSON.stringify({ eventName: 'feature.updated' }) }));
        });

        await waitFor(() => expect(calls.length).toBeGreaterThan(callsBefore));
    });
});
