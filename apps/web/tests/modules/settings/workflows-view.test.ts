/**
 * 1441 R2 — the MCP exposure declaration badge in Settings › Workflows.
 *
 * The failure modes: a badge on a definition that merely mentions exposure (a string `'true'`, an
 * absent flag), and a badge on a workflow that failed validation.
 */
import { afterAll, afterEach, expect, test } from 'bun:test';
import { cleanup, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { resetFetchForTesting, setFetchForTesting } from '../../../src/lib/rpc-client';
import WorkflowsView from '../../../src/modules/settings/WorkflowsView';
import { registerHappyDom, teardownHappyDom } from '../../happy-dom';

registerHappyDom();
afterAll(teardownHappyDom);
afterEach(() => {
    cleanup();
    resetFetchForTesting();
});

const workflow = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    name: 'sample-flow',
    kind: 'state-machine',
    version: null,
    description: null,
    path: '.spur/workflows/sample-flow.yaml',
    source: 'project',
    valid: true,
    rawYaml: 'name: sample-flow\n',
    mermaidDiagram: 'flowchart TD\n  start --> done\n',
    ...overrides,
});

/** Render the view over one workflow listing and return the container. */
async function renderWith(entries: Array<Record<string, unknown>>) {
    setFetchForTesting(
        (async () =>
            new Response(JSON.stringify({ workflows: entries, total: entries.length }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            })) as unknown as typeof fetch,
    );
    return render(createElement(WorkflowsView));
}

test('a valid definition that declares boolean expose true shows the badge', async () => {
    const view = await renderWith([workflow({ mcpExposureDeclared: true })]);
    await waitFor(() => expect(view.getByTestId('workflow-mcp-exposure')).toBeTruthy());
    expect(view.getByTestId('workflow-mcp-exposure').textContent).toContain('MCP exposure declared');
});

test('an omitted flag renders no badge', async () => {
    const view = await renderWith([workflow({})]);
    await waitFor(() => expect(view.container.textContent).toContain('sample-flow'));
    expect(view.queryByTestId('workflow-mcp-exposure')).toBeNull();
});

test('an invalid definition renders no badge even when the flag is present', async () => {
    const view = await renderWith([workflow({ valid: false, error: 'states: nope', mcpExposureDeclared: false })]);
    await waitFor(() => expect(view.container.textContent).toContain('sample-flow'));
    expect(view.queryByTestId('workflow-mcp-exposure')).toBeNull();
});
