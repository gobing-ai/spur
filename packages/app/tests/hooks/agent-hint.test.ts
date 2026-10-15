/**
 * agent-hint — the single host-agent/model candidate chain shared by every hook (task 0480 R4),
 * ported to `@gobing-ai/spur-app/hooks` for `spur self hook` (script-absorption PR-2a).
 */

import { describe, expect, test } from 'bun:test';
import { resolveAgentHint, resolveModelHint } from '../../src/hooks/agent-hint';

describe('resolveAgentHint', () => {
    test('walks SPUR_AGENT → CLAUDE_CODE_ENTRYPOINT → TERM_PROGRAM → SPUR_DEFAULT_AGENT in order', () => {
        const full = { SPUR_AGENT: 'a', CLAUDE_CODE_ENTRYPOINT: 'b', TERM_PROGRAM: 'c', SPUR_DEFAULT_AGENT: 'd' };
        expect(resolveAgentHint(full)).toBe('a');
        expect(resolveAgentHint({ ...full, SPUR_AGENT: undefined })).toBe('b');
        expect(resolveAgentHint({ TERM_PROGRAM: 'c', SPUR_DEFAULT_AGENT: 'd' })).toBe('c');
        expect(resolveAgentHint({ SPUR_DEFAULT_AGENT: 'd' })).toBe('d');
    });

    test('skips blank candidates and trims the winner', () => {
        expect(resolveAgentHint({ SPUR_AGENT: '   ', TERM_PROGRAM: '  claude  ' })).toBe('claude');
    });

    test('returns the fallback (default undefined) when nothing matches', () => {
        expect(resolveAgentHint({})).toBeUndefined();
        expect(resolveAgentHint({}, 'pi')).toBe('pi');
    });
});

describe('resolveModelHint', () => {
    test('walks SPUR_MODEL → ANTHROPIC_MODEL → OPENAI_MODEL → CLAUDE_MODEL in order', () => {
        const full = { SPUR_MODEL: 'm1', ANTHROPIC_MODEL: 'm2', OPENAI_MODEL: 'm3', CLAUDE_MODEL: 'm4' };
        expect(resolveModelHint(full)).toBe('m1');
        expect(resolveModelHint({ ANTHROPIC_MODEL: 'm2', OPENAI_MODEL: 'm3' })).toBe('m2');
        expect(resolveModelHint({ OPENAI_MODEL: ' m3 ', CLAUDE_MODEL: 'm4' })).toBe('m3');
        expect(resolveModelHint({ CLAUDE_MODEL: 'm4' })).toBe('m4');
    });

    test('returns the fallback when every candidate is blank', () => {
        expect(resolveModelHint({ SPUR_MODEL: '' })).toBeUndefined();
        expect(resolveModelHint({ SPUR_MODEL: ' ' }, 'unknown')).toBe('unknown');
    });
});
