import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { PlanFileSummary } from '../../../src/lib/plan-client';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';

const MockMDEditor = Object.assign(
    function MockEditor({ value }: { value?: string }) {
        return <textarea value={value} readOnly aria-label="markdown editor" />;
    },
    {
        Markdown: function MockMarkdown({ source }: { source?: string }) {
            return <div data-testid="mock-markdown">{source}</div>;
        },
    },
);

mock.module('@uiw/react-md-editor', () => ({ default: MockMDEditor }));

import { module as plansModule } from '../../../src/modules/plans/index';
import PlanFileList from '../../../src/modules/plans/PlanFileList';
import PlansShell from '../../../src/modules/plans/PlansShell';
import PlanToc, { extractHeadings } from '../../../src/modules/plans/PlanToc';

function setInputValue(input: Element, value: string): void {
    const holder = input as unknown as Record<string, Record<string, unknown> | undefined>;
    const key = Object.keys(holder).find((k) => k.startsWith('__reactProps$'));
    const props = key ? holder[key] : undefined;
    const onChange = props?.onChange as ((e: { target: { value: string } }) => void) | undefined;
    if (!onChange) throw new Error('onChange not found on input');
    act(() => onChange({ target: { value } }));
}

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

afterAll(async () => {
    resetFetchForTesting();
    await teardownHappyDom();
});

describe('plans module definition', () => {
    test('conforms to WebModule contract with order 24 (between History 20 and Designs 25)', () => {
        expect(plansModule.id).toBe('plans');
        expect(plansModule.name).toBe('Plans');
        expect(plansModule.sidebarLabel).toBe('Plans');
        expect(plansModule.route).toBe('plans');
        expect(plansModule.icon).toBe('🗺️');
        expect(plansModule.order).toBe(24);
        expect(typeof plansModule.component).toBe('function');
    });
});

describe('PlanToc extraction and rendering', () => {
    test('extractHeadings parses headings and ignores fenced code blocks', () => {
        const md = `
# 02 Roadmap — Spur

Introduction text.

\`\`\`markdown
# Not a real heading
\`\`\`

## Phase 0 — Re-Foundation
Content 1.

### Exit Criteria with **bold** and \`code\`
Content 2.

## Phase 0 — Re-Foundation
Duplicate title.
`;
        const headings = extractHeadings(md);
        expect(headings.length).toBe(4);

        expect(headings[0]).toEqual({
            id: '02-roadmap-spur',
            text: '02 Roadmap — Spur',
            level: 1,
        });

        expect(headings[1]).toEqual({
            id: 'phase-0-re-foundation',
            text: 'Phase 0 — Re-Foundation',
            level: 2,
        });

        expect(headings[2]).toEqual({
            id: 'exit-criteria-with-bold-and-code',
            text: 'Exit Criteria with bold and code',
            level: 3,
        });

        expect(headings[3]).toEqual({
            id: 'phase-0-re-foundation-1',
            text: 'Phase 0 — Re-Foundation',
            level: 2,
        });
    });

    test('PlanToc renders empty state when markdown has no headings', () => {
        const { getByText } = render(<PlanToc markdown="Just plain text with no headings." />);
        expect(getByText('No headings in document.')).toBeDefined();
    });

    test('PlanToc renders headings and triggers smooth scroll on click', () => {
        const md = '# Section One\n\n## Section Two\n\nContent';
        const scrollIntoViewMock = mock(() => {});
        const headingEl = document.createElement('h1');
        headingEl.id = 'section-one';
        headingEl.scrollIntoView = scrollIntoViewMock;
        document.body.appendChild(headingEl);

        const { getByText } = render(<PlanToc markdown={md} />);
        const btn = getByText('Section One');
        expect(btn).toBeDefined();

        fireEvent.click(btn);
        expect(scrollIntoViewMock).toHaveBeenCalled();
        document.body.removeChild(headingEl);
    });
});

describe('PlanFileList', () => {
    const mockFiles: PlanFileSummary[] = [
        {
            id: 'docs/02_ROADMAP.md',
            path: 'docs/02_ROADMAP.md',
            name: '02_ROADMAP.md',
            title: '02 Roadmap — Spur',
            category: 'roadmap',
        },
        {
            id: 'docs/plans/2026-09-21-next-gen.md',
            path: 'docs/plans/2026-09-21-next-gen.md',
            name: '2026-09-21-next-gen.md',
            title: 'Next Gen Workflows',
            category: 'plan',
        },
        {
            id: 'docs/plans/2026-06-10-rd3-migration.md',
            path: 'docs/plans/2026-06-10-rd3-migration.md',
            name: '2026-06-10-rd3-migration.md',
            title: 'RD3 Migration Plan',
            category: 'plan',
        },
    ];

    test('renders grouped roadmap and execution plans', () => {
        const onSelect = mock(() => {});
        const { getByText, getByTestId } = render(
            <PlanFileList files={mockFiles} selectedPath="docs/02_ROADMAP.md" onSelect={onSelect} />,
        );

        expect(getByTestId('plan-file-list')).toBeDefined();
        expect(getByText('Core Roadmap')).toBeDefined();
        expect(getByText('Execution Plans')).toBeDefined();
        expect(getByText('02 Roadmap — Spur')).toBeDefined();
        expect(getByText('Next Gen Workflows')).toBeDefined();
        expect(getByText('RD3 Migration Plan')).toBeDefined();

        fireEvent.click(getByText('Next Gen Workflows'));
        expect(onSelect).toHaveBeenCalledWith('docs/plans/2026-09-21-next-gen.md');
    });

    test('filters documents via search input and allows clearing', async () => {
        const onSelect = mock(() => {});
        const { getByPlaceholderText, queryByText, getByText, getByLabelText } = render(
            <PlanFileList files={mockFiles} selectedPath={null} onSelect={onSelect} />,
        );

        const input = getByPlaceholderText('Filter plans...');
        setInputValue(input, 'next gen');

        expect(getByText('Next Gen Workflows')).toBeDefined();
        expect(queryByText('RD3 Migration Plan')).toBeNull();
        expect(queryByText('02 Roadmap — Spur')).toBeNull();

        // Clear filter
        const clearBtn = getByLabelText('Clear filter');
        fireEvent.click(clearBtn);

        expect(getByText('Next Gen Workflows')).toBeDefined();
        expect(getByText('RD3 Migration Plan')).toBeDefined();
        expect(getByText('02 Roadmap — Spur')).toBeDefined();
    });
});

describe('PlansShell layout and interactions', () => {
    const sampleFiles: PlanFileSummary[] = [
        {
            id: 'docs/02_ROADMAP.md',
            path: 'docs/02_ROADMAP.md',
            name: '02_ROADMAP.md',
            title: '02 Roadmap — Spur',
            category: 'roadmap',
        },
        {
            id: 'docs/plans/2026-09-21-next-gen.md',
            path: 'docs/plans/2026-09-21-next-gen.md',
            name: '2026-09-21-next-gen.md',
            title: 'Next Gen Workflows',
            category: 'plan',
        },
    ];

    beforeEach(() => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/api/project/plans/file')) {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        path: 'docs/02_ROADMAP.md',
                        title: '02 Roadmap — Spur',
                        content: '# 02 Roadmap — Spur\n\n## Phase 0\n\nFoundation established.',
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (url.includes('/api/project/plans')) {
                return new Response(JSON.stringify({ files: sampleFiles, total: sampleFiles.length }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' },
                });
            }
            return new Response('not found', { status: 404 });
        }) as unknown as typeof fetch);
    });

    test('renders three-zone layout with left dock, adaptive main panel, and automatic right TOC dock', async () => {
        const { getByTestId, getByText } = render(
            <MemoryRouter initialEntries={['/board/plans?file=docs/02_ROADMAP.md']}>
                <PlansShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('plan-files-dock')).toBeDefined();
            expect(getByTestId('plan-workspace')).toBeDefined();
        });

        // Left dock is docked with responsive width on laptop, floating outside on large screens
        const leftDock = getByTestId('plan-files-dock');
        expect(leftDock.className).toContain('w-64');
        expect(leftDock.className).toContain('3xl:absolute');
        expect(leftDock.className).toContain('3xl:right-[calc(100%_+_12px)]');

        // Main panel dynamically takes flex-1 to adapt to laptop screen width, w-full on large screens
        const workspace = getByTestId('plan-workspace');
        expect(workspace.className).toContain('flex-1');
        expect(workspace.className).toContain('3xl:w-full');

        // Main panel renders content
        await waitFor(() => {
            expect(getByText('Phase 0')).toBeDefined();
        });

        // Right TOC dock is AUTOMATICALLY present when document is selected with responsive width on laptop, floating on large screens
        const rightTocDock = getByTestId('plan-toc-dock');
        expect(rightTocDock).toBeDefined();
        expect(rightTocDock.className).toContain('w-64');
        expect(rightTocDock.className).toContain('3xl:absolute');
        expect(rightTocDock.className).toContain('3xl:left-[calc(100%_+_12px)]');
    });

    test('toggles right TOC dock when header button or close button is clicked', async () => {
        const { getByTestId, queryByTestId, getByLabelText } = render(
            <MemoryRouter initialEntries={['/board/plans?file=docs/02_ROADMAP.md']}>
                <PlansShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('plan-toc-dock')).toBeDefined();
        });

        // Click close on TOC dock
        const closeBtn = getByLabelText('Close table of contents');
        fireEvent.click(closeBtn);
        expect(queryByTestId('plan-toc-dock')).toBeNull();

        // Re-open from header toggle
        const toggleBtn = getByLabelText('Expand table of contents');
        fireEvent.click(toggleBtn);
        expect(getByTestId('plan-toc-dock')).toBeDefined();
    });

    test('collapses left file list dock when toggle button is clicked', async () => {
        const { getByTestId, getByLabelText } = render(
            <MemoryRouter initialEntries={['/board/plans']}>
                <PlansShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('plan-files-dock')).toBeDefined();
        });

        const toggleBtn = getByLabelText('Collapse plan file list');
        expect(getByTestId('plan-files-dock').hasAttribute('hidden')).toBe(false);

        fireEvent.click(toggleBtn);
        expect(getByTestId('plan-files-dock').hasAttribute('hidden')).toBe(true);
    });

    test('hides right TOC dock when no file is selected', async () => {
        // Empty files mock
        setFetchForTesting((async () => {
            return new Response(JSON.stringify({ files: [], total: 0 }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }) as unknown as typeof fetch);

        const { queryByTestId, getByText } = render(
            <MemoryRouter initialEntries={['/board/plans']}>
                <PlansShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByText('Select a plan document to view')).toBeDefined();
        });

        // Right TOC dock is NOT rendered when nothing is selected
        expect(queryByTestId('plan-toc-dock')).toBeNull();
    });
});
