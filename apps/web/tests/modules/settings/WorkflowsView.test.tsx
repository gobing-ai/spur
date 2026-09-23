registerHappyDom();

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { ProjectWorkflowsResponse } from '@gobing-ai/spur-contracts';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import WorkflowsView from '../../../src/modules/settings/WorkflowsView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

// Mock mermaid: its real ESM render path needs a full DOM + worker support that
// happy-dom does not implement.
mock.module('mermaid', () => ({
    default: {
        initialize: () => {},
        render: (_id: string, code: string) => Promise.resolve({ svg: `<svg data-testid="mock-svg">${code}</svg>` }),
    },
}));

afterAll(teardownHappyDom);

afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

const MOCK_WORKFLOWS: ProjectWorkflowsResponse = {
    workflows: [
        {
            name: 'task-pipeline',
            kind: 'state-machine',
            version: '3',
            description: 'Standard task pipeline',
            path: '.spur/workflows/task-pipeline.yaml',
            source: 'registered',
            valid: true,
            rawYaml: 'name: task-pipeline\nkind: state-machine\nversion: "3"\n',
            mermaidDiagram: 'flowchart TD\n    precheck --> implement\n',
        },
        {
            name: 'wrapup-pipeline',
            kind: 'state-machine',
            version: '4',
            description: 'Wrapup pipeline',
            path: '.spur/workflows/wrapup-pipeline.yaml',
            source: 'registered',
            valid: true,
            rawYaml: 'name: wrapup-pipeline\nkind: state-machine\nversion: "4"\n',
            mermaidDiagram: 'flowchart TD\n    doc-sync --> metrics\n',
        },
        {
            name: 'broken-pipeline',
            kind: 'state-machine',
            version: null,
            description: 'Broken pipeline',
            path: '.spur/workflows/broken-pipeline.yaml',
            source: 'project',
            valid: false,
            error: 'Missing initialState',
            rawYaml: 'name: broken-pipeline\n',
            mermaidDiagram: '',
        },
    ],
    total: 3,
};

describe('WorkflowsView', () => {
    beforeEach(() => {
        setFetchForTesting(((input: RequestInfo | URL) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
            if (url.includes('/project/workflows')) {
                return Promise.resolve(new Response(JSON.stringify(MOCK_WORKFLOWS), { status: 200 }));
            }
            return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
        }) as unknown as typeof fetch);
    });

    test('renders controls bar with dropdown, copy button, and view yaml button', async () => {
        const { container } = render(<WorkflowsView />);
        const copyBtn = container.querySelector('[data-testid="copy-workflow-btn"]');
        const viewYamlBtn = container.querySelector('[data-testid="view-yaml-btn"]');
        expect(copyBtn).not.toBeNull();
        expect(viewYamlBtn).not.toBeNull();

        // subtabs YAML / Diagram should no longer exist
        expect(container.querySelector('[data-view-subtabs]')).toBeNull();
        expect(container.querySelector('[data-subtab="yaml"]')).toBeNull();
        expect(container.querySelector('[data-subtab="diagram"]')).toBeNull();

        await waitFor(() => {
            const options = container.querySelectorAll('option');
            expect(options.length).toBe(3);
        });
    });

    test('displays Diagram view directly by default', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="workflow-diagram-view"]')).not.toBeNull();
        });

        // Zoom and direction controls should be present directly
        expect(container.querySelector('[data-testid="zoom-in-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="zoom-out-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="zoom-reset-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="direction-td-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="direction-lr-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="diagram-legend"]')).not.toBeNull();

        expect(container.textContent).toContain('task-pipeline');
        expect(container.textContent).toContain('.spur/workflows/task-pipeline.yaml');
    });

    test('opens and closes YAML floating window with syntax highlighting', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="view-yaml-btn"]')).not.toBeNull();
        });

        // Modal should initially not be in the DOM
        expect(container.querySelector('[data-testid="yaml-modal"]')).toBeNull();

        // Click View YAML button
        const viewYamlBtn = container.querySelector('[data-testid="view-yaml-btn"]') as HTMLButtonElement;
        fireEvent.click(viewYamlBtn);

        // Modal opens
        await waitFor(() => {
            expect(container.querySelector('[data-testid="yaml-modal"]')).not.toBeNull();
        });

        const yamlModal = container.querySelector('[data-testid="yaml-modal"]');
        expect(yamlModal).not.toBeNull();
        expect(yamlModal?.querySelector('[data-yaml-viewer]')).not.toBeNull();
        expect(yamlModal?.textContent).toContain('name: task-pipeline');

        // Close via close button
        const closeBtn = container.querySelector('[data-testid="close-yaml-modal-btn"]') as HTMLButtonElement;
        fireEvent.click(closeBtn);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="yaml-modal"]')).toBeNull();
        });

        // Re-open and close via Escape key
        fireEvent.click(viewYamlBtn);
        await waitFor(() => {
            expect(container.querySelector('[data-testid="yaml-modal"]')).not.toBeNull();
        });
        fireEvent.keyDown(window, { key: 'Escape' });
        await waitFor(() => {
            expect(container.querySelector('[data-testid="yaml-modal"]')).toBeNull();
        });
    });

    test('switching dropdown selects another workflow', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            const options = container.querySelectorAll('option');
            expect(options.length).toBe(3);
        });

        const select = container.querySelector('[data-testid="workflow-select"]') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'wrapup-pipeline' } });

        await waitFor(() => {
            expect(container.textContent).toContain('.spur/workflows/wrapup-pipeline.yaml');
        });

        // Open YAML modal to confirm it displays selected workflow's yaml
        const viewYamlBtn = container.querySelector('[data-testid="view-yaml-btn"]') as HTMLButtonElement;
        fireEvent.click(viewYamlBtn);

        await waitFor(() => {
            const yamlModal = container.querySelector('[data-testid="yaml-modal"]');
            expect(yamlModal?.textContent).toContain('name: wrapup-pipeline');
        });
    });

    test('displays validation error banner for invalid workflow and allows inspect in YAML', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            const options = container.querySelectorAll('option');
            expect(options.length).toBe(3);
        });

        const select = container.querySelector('[data-testid="workflow-select"]') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'broken-pipeline' } });

        await waitFor(() => {
            expect(container.textContent).toContain('Workflow failed validation');
            expect(container.textContent).toContain('Missing initialState');
        });

        // Clicking "Inspect in YAML" button opens the floating modal
        const inspectBtn = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Inspect in YAML'),
        ) as HTMLButtonElement;
        expect(inspectBtn).toBeDefined();
        fireEvent.click(inspectBtn);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="yaml-modal"]')).not.toBeNull();
            expect(container.querySelector('[data-testid="yaml-modal"]')?.textContent).toContain(
                'name: broken-pipeline',
            );
        });
    });

    test('handles zoom controls in Diagram view', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="zoom-reset-btn"]')).not.toBeNull();
        });

        const zoomReset = container.querySelector('[data-testid="zoom-reset-btn"]') as HTMLButtonElement;
        const zoomIn = container.querySelector('[data-testid="zoom-in-btn"]') as HTMLButtonElement;
        const zoomOut = container.querySelector('[data-testid="zoom-out-btn"]') as HTMLButtonElement;

        expect(zoomReset.textContent).toBe('100%');

        fireEvent.click(zoomIn);
        expect(zoomReset.textContent).toBe('115%');

        fireEvent.click(zoomOut);
        expect(zoomReset.textContent).toBe('100%');
    });

    test('handles copy button click with raw YAML', async () => {
        let copiedText = '';
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: (text: string) => {
                    copiedText = text;
                    return Promise.resolve();
                },
            },
            writable: true,
            configurable: true,
        });

        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="copy-workflow-btn"]')).not.toBeNull();
        });

        const copyBtn = container.querySelector('[data-testid="copy-workflow-btn"]') as HTMLButtonElement;
        fireEvent.click(copyBtn);

        await waitFor(() => {
            expect(copiedText).toContain('name: task-pipeline');
        });
    });

    test('handles direction layout toggle (TD vs LR)', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="direction-lr-btn"]')).not.toBeNull();
        });

        const tdBtn = container.querySelector('[data-testid="direction-td-btn"]') as HTMLButtonElement;
        const lrBtn = container.querySelector('[data-testid="direction-lr-btn"]') as HTMLButtonElement;

        expect(tdBtn.className).toContain('bg-spur-accent');
        expect(lrBtn.className).not.toContain('bg-spur-accent');

        // Switch to LR
        fireEvent.click(lrBtn);
        expect(lrBtn.className).toContain('bg-spur-accent');
        expect(tdBtn.className).not.toContain('bg-spur-accent');
    });

    test('displays error message and allows retry on fetch error', async () => {
        let attempts = 0;
        setFetchForTesting((() => {
            attempts++;
            if (attempts === 1) {
                return Promise.reject(new Error('Network offline'));
            }
            return Promise.resolve(new Response(JSON.stringify(MOCK_WORKFLOWS), { status: 200 }));
        }) as unknown as typeof fetch);

        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.textContent).toContain('Failed to load workflows');
            expect(container.textContent).toContain('Network offline');
        });

        const retryBtn = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Retry'),
        ) as HTMLButtonElement;
        expect(retryBtn).toBeDefined();
        fireEvent.click(retryBtn);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="workflow-diagram-view"]')).not.toBeNull();
        });
    });
});
