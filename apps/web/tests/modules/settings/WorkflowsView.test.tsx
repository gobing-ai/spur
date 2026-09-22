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

    test('renders view subtabs (YAML and Diagram) and dropdown', async () => {
        const { container } = render(<WorkflowsView />);
        const subtabs = container.querySelector('[data-view-subtabs]');
        expect(subtabs).not.toBeNull();

        const yamlTab = container.querySelector('[data-subtab="yaml"]');
        const diagramTab = container.querySelector('[data-subtab="diagram"]');
        expect(yamlTab).not.toBeNull();
        expect(diagramTab).not.toBeNull();

        await waitFor(() => {
            const options = container.querySelectorAll('option');
            expect(options.length).toBe(3);
        });
    });

    test('displays YAML view by default with syntax viewer', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });

        expect(container.textContent).toContain('task-pipeline');
        expect(container.textContent).toContain('.spur/workflows/task-pipeline.yaml');
        expect(container.textContent).toContain('name: task-pipeline');
    });

    test('switches to Diagram view when Diagram subtab is clicked', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });

        const diagramTab = container.querySelector('[data-subtab="diagram"]') as HTMLButtonElement;
        fireEvent.click(diagramTab);

        await waitFor(() => {
            expect(container.querySelector('[data-testid="workflow-diagram-view"]')).not.toBeNull();
        });

        // Zoom controls should be present in diagram mode
        expect(container.querySelector('[data-testid="zoom-in-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="zoom-out-btn"]')).not.toBeNull();
        expect(container.querySelector('[data-testid="zoom-reset-btn"]')).not.toBeNull();
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
        expect(container.textContent).toContain('name: wrapup-pipeline');
    });

    test('displays validation error banner for invalid workflow in Diagram view', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            const options = container.querySelectorAll('option');
            expect(options.length).toBe(3);
        });

        const select = container.querySelector('[data-testid="workflow-select"]') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'broken-pipeline' } });

        const diagramTab = container.querySelector('[data-subtab="diagram"]') as HTMLButtonElement;
        fireEvent.click(diagramTab);

        await waitFor(() => {
            expect(container.textContent).toContain('Workflow failed validation');
            expect(container.textContent).toContain('Missing initialState');
        });
    });

    test('handles zoom controls in Diagram view', async () => {
        const { container } = render(<WorkflowsView />);

        await waitFor(() => {
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });

        const diagramTab = container.querySelector('[data-subtab="diagram"]') as HTMLButtonElement;
        fireEvent.click(diagramTab);

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

    test('handles copy button click', async () => {
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
            expect(container.querySelector('[data-yaml-viewer]')).not.toBeNull();
        });
    });
});
