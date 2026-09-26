import { describe, expect, test } from 'bun:test';
import type { WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import {
    COMPOSITION_CAPS,
    collectAgentRunRoleViolations,
    collectDecideViolations,
    collectTerminalReasonViolations,
    countLogicalCommands,
} from '../../src/workflow/composition-lint';

// 0962: the composition lint is pure over `WorkflowDef`. These drive it directly — no
// WorkflowAppService instance — which is the test-surface gain the extraction was for.
// The service's validate() wiring is covered by the all-workflows sweep in spur-check.

function sm(
    states: object[],
    transitions: object[] = [],
    vars: Record<string, unknown> = {},
    failureStates: string[] = [],
): WorkflowDef {
    return {
        kind: 'state-machine',
        states: states as never,
        transitions: transitions as never,
        vars,
        failureStates,
    } as unknown as WorkflowDef;
}

describe('countLogicalCommands (ADR-115)', () => {
    test('splits on newline, semicolon, && and ||', () => {
        expect(countLogicalCommands('a && b || c')).toBe(3);
        expect(countLogicalCommands('a; b\nc')).toBe(3);
    });

    test('ignores blank lines, comment-only lines and structure tokens', () => {
        expect(countLogicalCommands('if x; then y; fi')).toBe(2);
        expect(countLogicalCommands('\n# comment\n')).toBe(0);
    });
});

describe('COMPOSITION_CAPS (ADR-115 parity anchor)', () => {
    test('carries the tier caps the advisory is measured against', () => {
        expect(COMPOSITION_CAPS.shell).toEqual({ warnAbove: 5, errorAbove: 10, charsErrorAbove: 800 });
        expect(COMPOSITION_CAPS.guard).toEqual({ warnAbove: 3, errorAbove: 5 });
        expect(COMPOSITION_CAPS.agentRunInput).toEqual({ charsErrorAbove: 1000, lowSeverityBelow: 200 });
    });
});

describe('collectAgentRunRoleViolations (0538 R2)', () => {
    test('flags an agent.run step with no declared role', () => {
        const def = sm([{ id: 'implement', onEnter: [{ kind: 'agent.run', options: { agent: 'auto' } }] }]);
        const v = collectAgentRunRoleViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('declares no role');
    });

    test('accepts a declared role from the closed vocabulary', () => {
        const def = sm([{ id: 'implement', onEnter: [{ kind: 'agent.run', options: { role: 'coder' } }] }]);
        expect(collectAgentRunRoleViolations(def)).toEqual([]);
    });
});

describe('collectTerminalReasonViolations (0937 R3)', () => {
    test('flags an edge into a failureState with no terminalReason', () => {
        const def = sm([{ id: 'precheck' }], [{ from: 'precheck', to: 'failed', guard: { kind: 'always' } }], {}, [
            'failed',
        ]);
        const v = collectTerminalReasonViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('without a declared terminalReason');
    });

    test('accepts an edge carrying a declared terminalReason', () => {
        const def = sm(
            [{ id: 'precheck' }],
            [{ from: 'precheck', to: 'failed', terminalReason: 'failed-check', guard: { kind: 'always' } }],
            {},
            ['failed'],
        );
        expect(collectTerminalReasonViolations(def)).toEqual([]);
    });
});

describe('collectDecideViolations (0941 R6)', () => {
    test('flags a decide action whose options fail the runner schema', () => {
        const def = sm([{ id: 'triage', onEnter: [{ kind: 'decide', options: { method: 'choice' } }] }]);
        const v = collectDecideViolations(def);
        expect(v.length).toBe(1);
        expect(v[0]).toContain('Invalid decide action at triage/decide[0]');
    });

    test('accepts a decide action parsed by the shared schema', () => {
        const def = sm([
            {
                id: 'triage',
                onEnter: [
                    {
                        kind: 'decide',
                        options: {
                            id: 'task-triage',
                            method: 'choice',
                            question: 'lane?',
                            choices: ['low', 'standard'],
                            default: 'standard',
                            resultFile: '.spur/run/0962-triage.decision',
                        },
                    },
                ],
            },
        ]);
        expect(collectDecideViolations(def)).toEqual([]);
    });
});
