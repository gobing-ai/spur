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

    test('renders action-kind badges, classes, tooltips, and dashed shell guards', () => {
        const wf: WorkflowDef = {
            kind: 'state-machine',
            name: 'rich-sm',
            initialState: 'precheck',
            terminalStates: ['done'],
            failureStates: ['failed'],
            states: [
                {
                    id: 'precheck',
                    description: 'Verify readiness',
                    onEnter: [{ kind: 'shell', options: { command: 'bun run spur-check' } }],
                },
                {
                    id: 'implement',
                    description: 'Run agent coder',
                    onEnter: [{ kind: 'agent.run', options: { agent: 'sp:super-coder', prompt: 'Implement task' } }],
                },
                {
                    id: 'approve',
                    description: 'Human approval',
                    onEnter: [{ kind: 'hitl.confirm', options: { question: 'Approve changes?' } }],
                },
                {
                    id: 'done',
                    description: 'Success state',
                },
                {
                    id: 'failed',
                    description: 'Failure state',
                },
            ],
            transitions: [
                {
                    from: 'precheck',
                    to: 'implement',
                    guard: { kind: 'shell', options: { command: 'git status --porcelain' } },
                    description: 'Check passed',
                },
                {
                    from: 'implement',
                    to: 'approve',
                    trigger: 'ready',
                },
                {
                    from: 'approve',
                    to: 'done',
                    guard: { kind: 'always' },
                },
                {
                    from: 'precheck',
                    to: 'failed',
                    description: 'Failed check',
                },
            ],
        };

        const out = renderWorkflowMermaid(wf);
        // Badges
        expect(out).toContain('💻 precheck');
        expect(out).toContain('🤖 implement');
        expect(out).toContain('👤 approve');

        // Classes
        expect(out).toContain('class implement nodeAgent;');
        expect(out).toContain('class approve nodeHitl;');
        expect(out).toContain('class precheck initial;');
        expect(out).toContain('class done terminal;');
        expect(out).toContain('class failed failure;');

        // Tooltip click directives
        expect(out).toContain('click implement href "javascript:void(0)"');
        expect(out).toContain('agent(sp:super-coder): Implement task');
        expect(out).toContain('click precheck href "javascript:void(0)"');
        expect(out).toContain('shell: bun run spur-check');
        expect(out).toContain('click approve href "javascript:void(0)"');
        expect(out).toContain('hitl: Approve changes?');

        // Dashed shell guard edge with clean description
        expect(out).toContain('precheck -.->|"Check passed"| implement');
        // Trigger edge
        expect(out).toContain('implement -->|"[ready]"| approve');
    });

    test('transition-flow: renders action badges and tooltips', () => {
        const flow: WorkflowDef = {
            kind: 'transition-flow',
            name: 'rich-flow',
            initialNode: 'start',
            terminalNodes: ['end'],
            nodes: [
                {
                    id: 'start',
                    type: 'action',
                    action: { kind: 'shell', options: { command: 'echo hello' } },
                },
                {
                    id: 'gate1',
                    type: 'gate',
                },
                {
                    id: 'end',
                    type: 'action',
                },
            ],
            edges: [
                {
                    from: 'start',
                    to: 'gate1',
                    condition: { kind: 'shell' },
                    description: 'shell guard edge',
                },
                {
                    from: 'gate1',
                    to: 'end',
                    condition: { kind: 'action-ok' },
                },
            ],
        };

        const out = renderWorkflowMermaid(flow);
        expect(out).toContain('class start initial;');
        expect(out).toContain('class gate1 gate;');
        expect(out).toContain('class end terminal;');
        expect(out).toContain('start -.->|"shell guard edge"| gate1');
        expect(out).toContain('gate1 -->|"[action-ok]"| end');
        expect(out).toContain('click start href "javascript:void(0)" "shell: echo hello"');
    });
});
