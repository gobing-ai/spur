import { describe, expect, test } from 'bun:test';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { classifyDispatch } from '../../src';

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
