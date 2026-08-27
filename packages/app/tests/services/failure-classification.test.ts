import { describe, expect, test } from 'bun:test';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { classifyDispatch, permissionFailureEvidence } from '../../src';

function result(stderr: string, overrides: Partial<AgentRunResult> = {}): AgentRunResult {
    return {
        exitCode: 1,
        stdout: '',
        stderr,
        durationMs: 1,
        ...overrides,
    };
}

describe('0503 failure classification registry', () => {
    test.each([
        ['anthropic', "You've hit your weekly limit · resets Aug 12 at 6pm", 'resource-exhaustion'],
        ['grok', 'API error (status 402 Payment Required): Grok Build usage balance exhausted', 'resource-exhaustion'],
        ['openai', 'HTTP 429 Too Many Requests', 'resource-exhaustion'],
        ['volc', 'HTTP status 401', 'auth'],
        ['zai', 'status 403', 'auth'],
        ['ollama', 'request exceeds the maximum context length', 'resource-exhaustion'],
        ['gemini', 'Gemini usage limit exceeded', 'resource-exhaustion'],
    ] as const)('%s literal classifies as %s', (_provider, message, expected) => {
        expect(classifyDispatch(result(message))).toBe(expected);
    });

    test('HTTP-status-only 529 classifies as resource exhaustion', () => {
        expect(classifyDispatch(result('status 529'))).toBe('resource-exhaustion');
    });

    test('ordinary stderr noise and exit-code-only evidence remain unclassified', () => {
        expect(classifyDispatch(result('warning: deprecated'))).toBeUndefined();
        expect(classifyDispatch(result('', { exitCode: 3 }))).toBeUndefined();
    });

    test('successful dispatch output never classifies', () => {
        expect(classifyDispatch(result('HTTP 429 Too Many Requests', { exitCode: 0 }))).toBeUndefined();
    });

    test('termination signal classifies as timeout before provider text', () => {
        expect(classifyDispatch(result('status 401', { signal: 'SIGTERM' }))).toBe('timeout');
    });
});

// ---------------------------------------------------------------------------
// Tests: pattern precision + permission failures (task 0687)
// ---------------------------------------------------------------------------

describe('0687 pattern precision — prose only, never a code identifier', () => {
    test('the camelCase identifier `contextWindow` in a crash dump is not resource exhaustion', () => {
        // The 2026-08-26 dogfood: a pi/kimi dispatch died on a sandbox EPERM and dumped its
        // bundled JS. `context[_ -]?(?:length|window)` made the optional separator match
        // `contextWindow`, so a bundler symbol read as a token-budget failure.
        const dump = 'var VIRTUAL_MODULES={};function getContextWindow(){return maxContextWindow}';
        expect(classifyDispatch(result(dump))).toBeUndefined();
    });

    test('the prose forms of the same signal still classify', () => {
        expect(classifyDispatch(result('request exceeds the maximum context length'))).toBe('resource-exhaustion');
        expect(classifyDispatch(result('context window exhausted'))).toBe('resource-exhaustion');
        expect(classifyDispatch(result('context_length limit hit'))).toBe('resource-exhaustion');
    });

    test('an incidental mention of `quota` is not resource exhaustion', () => {
        expect(classifyDispatch(result('note: the quota directory was not found'))).toBeUndefined();
        expect(classifyDispatch(result('reading /etc/quota.conf'))).toBeUndefined();
    });

    test('quota beside an exhaustion verb still classifies', () => {
        expect(classifyDispatch(result('quota exceeded'))).toBe('resource-exhaustion');
        expect(classifyDispatch(result('you have exceeded your current quota'))).toBe('resource-exhaustion');
    });
});

describe('0687 R9 permission failures never escalate', () => {
    test.each([
        "EPERM: operation not permitted, mkdir '/Users/x/.pi/agent/settings.json.lock'",
        'Couldn\'t create session: Permission denied.: {"code":"FS_PERMISSION_DENIED"}',
        'Failed to start: listen tcp 127.0.0.1:0: bind: operation not permitted',
    ])('%s is not an escalation signal', (stderr) => {
        expect(classifyDispatch(result(stderr))).toBeUndefined();
    });

    test('a permission denial wins over a co-occurring quota pattern', () => {
        // A crashing CLI can print both; escalating to a costlier tier cannot grant a
        // permission, so the ladder must stop and let the real error stand.
        const mixed = 'HTTP 429 Too Many Requests\nEPERM: operation not permitted, mkdir';
        expect(classifyDispatch(result(mixed))).toBeUndefined();
    });

    test('permissionFailureEvidence returns the offending line for verbatim surfacing', () => {
        const stderr = ['starting up', "EPERM: operation not permitted, mkdir '/Users/x/.pi'", 'exiting'].join('\n');
        expect(permissionFailureEvidence(stderr)).toBe("EPERM: operation not permitted, mkdir '/Users/x/.pi'");
    });

    test('permissionFailureEvidence is undefined for ordinary stderr', () => {
        expect(permissionFailureEvidence('warning: deprecated flag')).toBeUndefined();
    });
});
