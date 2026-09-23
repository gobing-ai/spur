import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { DesignFileSummary } from '../../../src/lib/design-client';
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

import DesignFileList from '../../../src/modules/designs/DesignFileList';
import DesignsShell from '../../../src/modules/designs/DesignsShell';
import DesignToc, { extractHeadings } from '../../../src/modules/designs/DesignToc';
import { module as designsModule } from '../../../src/modules/designs/index';

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

describe('designs module definition', () => {
    test('conforms to WebModule contract with order 25 (between History 20 and Features 30)', () => {
        expect(designsModule.id).toBe('designs');
        expect(designsModule.name).toBe('Designs');
        expect(designsModule.sidebarLabel).toBe('Designs');
        expect(designsModule.route).toBe('designs');
        expect(designsModule.icon).toBe('📐');
        expect(designsModule.order).toBe(25);
        expect(typeof designsModule.component).toBe('function');
    });
});

describe('DesignToc extraction and rendering', () => {
    test('extractHeadings parses headings and ignores fenced code blocks', () => {
        const md = `
# Main Title

Introduction text.

\`\`\`markdown
# Not a real heading
\`\`\`

## Section One
Content 1.

### Subsection **bold** and \`code\`
Content 2.

## Section One
Duplicate title.
`;
        const headings = extractHeadings(md);
        expect(headings.length).toBe(4);

        expect(headings[0]).toEqual({
            id: 'main-title',
            text: 'Main Title',
            level: 1,
        });

        expect(headings[1]).toEqual({
            id: 'section-one',
            text: 'Section One',
            level: 2,
        });

        expect(headings[2]).toEqual({
            id: 'subsection-bold-and-code',
            text: 'Subsection bold and code',
            level: 3,
        });

        // Duplicate title receives suffix
        expect(headings[3]).toEqual({
            id: 'section-one-1',
            text: 'Section One',
            level: 2,
        });
    });

    test('DesignToc renders empty state when markdown has no headings', () => {
        const { getByText } = render(<DesignToc markdown="Just plain text without headers." />);
        expect(getByText('No headings in document.')).toBeDefined();
    });

    test('DesignToc renders headings and triggers smooth scroll on click', () => {
        const md = `# Overview\n\n## Architecture\n\n### Data Flow`;
        const target = document.createElement('div');
        target.id = 'architecture';
        let scrolled = false;
        target.scrollIntoView = () => {
            scrolled = true;
        };
        document.body.appendChild(target);

        const { getByText } = render(<DesignToc markdown={md} />);
        expect(getByText('Overview')).toBeDefined();
        const archBtn = getByText('Architecture');
        expect(archBtn).toBeDefined();

        fireEvent.click(archBtn);
        expect(scrolled).toBe(true);

        document.body.removeChild(target);
    });
});

describe('DesignFileList', () => {
    const mockFiles: DesignFileSummary[] = [
        {
            id: 'DESIGN.md',
            path: 'DESIGN.md',
            name: 'DESIGN.md',
            title: 'UI/UX Design System',
            category: 'root',
        },
        {
            id: 'docs/04_DESIGN.md',
            path: 'docs/04_DESIGN.md',
            name: '04_DESIGN.md',
            title: 'Concrete Surfaces & Contracts',
            category: 'architecture',
        },
        {
            id: 'docs/design/workflow.md',
            path: 'docs/design/workflow.md',
            name: 'workflow.md',
            title: 'Workflow Execution Model',
            category: 'satellite',
        },
    ];

    test('renders grouped core documents and satellites', () => {
        let selected = 'DESIGN.md';
        const { getByText } = render(
            <DesignFileList files={mockFiles} selectedPath={selected} onSelect={(p) => (selected = p)} />,
        );

        expect(getByText('Core Specifications')).toBeDefined();
        expect(getByText('Design Satellites')).toBeDefined();
        expect(getByText('UI/UX Design System')).toBeDefined();
        expect(getByText('Concrete Surfaces & Contracts')).toBeDefined();
        expect(getByText('Workflow Execution Model')).toBeDefined();

        // Tooltip shows file.name while list item displays design name
        const designBtn = getByText('UI/UX Design System').closest('button');
        expect(designBtn?.getAttribute('title')).toBe('DESIGN.md');
        const workflowBtn = getByText('Workflow Execution Model').closest('button');
        expect(workflowBtn?.getAttribute('title')).toBe('workflow.md');
    });

    test('filters documents via search input and allows clearing', () => {
        const { getByPlaceholderText, getByText, queryByText, getByLabelText } = render(
            <DesignFileList files={mockFiles} selectedPath={null} onSelect={() => {}} />,
        );

        const input = getByPlaceholderText('Filter design docs...');
        setInputValue(input, 'workflow');

        expect(getByText('Workflow Execution Model')).toBeDefined();
        expect(queryByText('UI/UX Design System')).toBeNull();

        // Clear filter
        fireEvent.click(getByLabelText('Clear filter'));
        expect(getByText('UI/UX Design System')).toBeDefined();
    });
});

describe('DesignsShell layout and interactions', () => {
    const sampleFiles: DesignFileSummary[] = [
        {
            id: 'DESIGN.md',
            path: 'DESIGN.md',
            name: 'DESIGN.md',
            title: 'UI/UX Design System',
            category: 'root',
        },
        {
            id: 'docs/04_DESIGN.md',
            path: 'docs/04_DESIGN.md',
            name: '04_DESIGN.md',
            title: 'Concrete Surfaces & Contracts',
            category: 'architecture',
        },
    ];

    beforeEach(() => {
        setFetchForTesting((async (req: RequestInfo | URL) => {
            const url = typeof req === 'string' ? req : req instanceof Request ? req.url : req.toString();
            if (url.includes('/api/project/designs/file')) {
                return new Response(
                    JSON.stringify({
                        ok: true,
                        path: 'DESIGN.md',
                        title: 'UI/UX Design System',
                        content: '# UI/UX Design System\n\n## Tokens\n\nColors and spacing.',
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } },
                );
            }
            if (url.includes('/api/project/designs')) {
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
            <MemoryRouter initialEntries={['/board/designs?file=DESIGN.md']}>
                <DesignsShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('design-files-dock')).toBeDefined();
            expect(getByTestId('design-workspace')).toBeDefined();
        });

        // Left dock is docked with responsive width on laptop, floating outside on large screens
        const leftDock = getByTestId('design-files-dock');
        expect(leftDock.className).toContain('w-64');
        expect(leftDock.className).toContain('3xl:absolute');
        expect(leftDock.className).toContain('3xl:right-[calc(100%_+_12px)]');

        // Main panel dynamically takes flex-1 to adapt to laptop screen width, w-full on large screens
        const workspace = getByTestId('design-workspace');
        expect(workspace.className).toContain('flex-1');
        expect(workspace.className).toContain('3xl:w-full');

        // Main panel renders content
        await waitFor(() => {
            expect(getByText('Tokens')).toBeDefined();
        });

        // Right TOC dock is AUTOMATICALLY present when document is selected with responsive width on laptop, floating on large screens
        const rightTocDock = getByTestId('design-toc-dock');
        expect(rightTocDock).toBeDefined();
        expect(rightTocDock.className).toContain('w-64');
        expect(rightTocDock.className).toContain('3xl:absolute');
        expect(rightTocDock.className).toContain('3xl:left-[calc(100%_+_12px)]');
    });

    test('toggles right TOC dock when header button or close button is clicked', async () => {
        const { getByTestId, queryByTestId, getByLabelText } = render(
            <MemoryRouter initialEntries={['/board/designs?file=DESIGN.md']}>
                <DesignsShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('design-toc-dock')).toBeDefined();
        });

        // Click close on TOC dock
        const closeBtn = getByLabelText('Close table of contents');
        fireEvent.click(closeBtn);
        expect(queryByTestId('design-toc-dock')).toBeNull();

        // Re-open from header toggle
        const toggleBtn = getByLabelText('Expand table of contents');
        fireEvent.click(toggleBtn);
        expect(getByTestId('design-toc-dock')).toBeDefined();
    });

    test('collapses left file list dock when toggle button is clicked', async () => {
        const { getByTestId, getByLabelText } = render(
            <MemoryRouter initialEntries={['/board/designs']}>
                <DesignsShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByTestId('design-files-dock')).toBeDefined();
        });

        const toggleBtn = getByLabelText('Collapse design file list');
        expect(getByTestId('design-files-dock').hasAttribute('hidden')).toBe(false);

        fireEvent.click(toggleBtn);
        expect(getByTestId('design-files-dock').hasAttribute('hidden')).toBe(true);
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
            <MemoryRouter initialEntries={['/board/designs']}>
                <DesignsShell />
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(getByText('Select a design document to view')).toBeDefined();
        });

        // Right TOC dock is NOT rendered when nothing is selected
        expect(queryByTestId('design-toc-dock')).toBeNull();
    });
});
