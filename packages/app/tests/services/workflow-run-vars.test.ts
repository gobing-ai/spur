import { describe, expect, test } from 'bun:test';
import {
    mapFleetExecutorVar,
    mergeWorkflowRunVars,
    resolveDefaultAgentVar,
} from '../../src/services/workflow-run-vars';

describe('mergeWorkflowRunVars', () => {
    test('overlays caller vars on string defaults and ignores non-string defaults', () => {
        expect(mergeWorkflowRunVars({ a: '1', b: '2', n: 3 }, { b: 'x' })).toEqual({ a: '1', b: 'x' });
        expect(mergeWorkflowRunVars(undefined, undefined)).toEqual({});
    });

    test('refuses to blank a declared non-empty var', () => {
        expect(() => mergeWorkflowRunVars({ spurBin: 'spur', z: 'q' }, { z: '', spurBin: '' })).toThrow(
            '--vars leaves declared vars unset: spurBin, z',
        );
    });
});

describe('mapFleetExecutorVar', () => {
    test('maps --agent fleet to the executor var and passes everything else through', () => {
        expect(mapFleetExecutorVar({ agent: 'fleet', x: '1' })).toEqual({ x: '1', executor: 'fleet' });
        expect(mapFleetExecutorVar({ agent: 'claude' })).toEqual({ agent: 'claude' });
        expect(mapFleetExecutorVar(undefined)).toEqual({});
    });
});

describe('resolveDefaultAgentVar', () => {
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);

    test('a caller agent seeds implementAgent; no configured default adds nothing else', () => {
        expect(resolveDefaultAgentVar(null, { agent: 'codex' }, warn)).toEqual({ implementAgent: 'codex' });
    });

    test('a valid agent.default fills both vars, never overriding caller choices', () => {
        const config = { agent: { default: 'claude' } } as never;
        expect(resolveDefaultAgentVar(config, undefined, warn)).toEqual({ agent: 'claude', implementAgent: 'claude' });
        expect(resolveDefaultAgentVar(config, { implementAgent: 'codex' }, warn)).toEqual({ agent: 'claude' });
    });

    test('a role or configured executor name is a valid default', () => {
        expect(resolveDefaultAgentVar({ agent: { default: 'coder' } } as never, undefined, warn).agent).toBe('coder');
        const exec = { agent: { default: 'cc-fast', executors: [{ name: 'cc-fast', agent: 'claude' }] } } as never;
        expect(resolveDefaultAgentVar(exec, undefined, warn).agent).toBe('cc-fast');
    });

    test('an unknown default warns once and injects nothing', () => {
        warnings.length = 0;
        expect(resolveDefaultAgentVar({ agent: { default: 'nope-xyz' } } as never, undefined, warn)).toEqual({});
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('agent.default "nope-xyz"');
    });
});
