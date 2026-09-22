import { describe, expect, test } from 'bun:test';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { renderWorkflowMermaid } from '../../src/workflow/mermaid-render';

describe('packages/app renderWorkflowMermaid', () => {
    const sm: WorkflowDef = {
        kind: 'state-machine',
        name: 'test-sm',
        initialState: 'init',
        terminalStates: ['done'],
        failureStates: ['failed'],
        states: [{ id: 'init' }, { id: 'done' }, { id: 'failed' }],
        transitions: [
            { from: 'init', to: 'done', trigger: 'success' },
            { from: 'init', to: 'failed', trigger: 'error' },
        ],
    };

    test('supports unfenced output when fenced: false', () => {
        const out = renderWorkflowMermaid(sm, { fenced: false });
        expect(out.startsWith('```')).toBe(false);
        expect(out.endsWith('```')).toBe(false);
        expect(out.startsWith('flowchart TD')).toBe(true);
        expect(out).toContain('class done terminal;');
    });

    test('supports LR direction', () => {
        const out = renderWorkflowMermaid(sm, { fenced: false, direction: 'LR' });
        expect(out.startsWith('flowchart LR')).toBe(true);
    });

    test('defaults to fenced TD flowchart', () => {
        const out = renderWorkflowMermaid(sm);
        expect(out.startsWith('```mermaid')).toBe(true);
        expect(out.endsWith('```')).toBe(true);
        expect(out).toContain('flowchart TD');
    });
});
