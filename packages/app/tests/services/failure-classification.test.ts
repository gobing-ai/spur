import { describe, expect, test } from 'bun:test';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';
import { classifyDispatch, permissionFailureEvidence, rescueEvidenceTail } from '../../src';

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

/**
 * 1260 R1 — the reported provider refusals are recognized by the EXISTING classifier so they can
 * enter the already-configured replacement ladder. Precision is part of the requirement: incidental
 * identifiers, quoted vocabulary, successful output, generic failures and OS permission denials must
 * not newly trigger a match.
 */
describe('reported provider refusals (1260 R1)', () => {
    const fail = (stderr: string) => classifyDispatch({ exitCode: 1, stdout: '', stderr });

    test('session-limit and AccountQuotaExceeded refusals classify as resource-exhaustion', () => {
        expect(fail("You've hit your session limit · resets 1:10am")).toBe('resource-exhaustion');
        expect(fail('AccountQuotaExceeded: allowance resets at 05:23 +0800')).toBe('resource-exhaustion');
    });

    test('an OAuth refresh failure with invalid_grant classifies as auth', () => {
        expect(fail('OAuth refresh failed for openai: invalid_grant')).toBe('auth');
    });

    test('a bare identifier or an unrelated mention does not match', () => {
        expect(fail('tool output included invalid_grant in a log line')).toBeUndefined();
        // The quota phrase needs its reset/allowance wording; a quoted code alone is not evidence.
        expect(fail('assertion failed: expected AccountQuotaExceeded to be exported')).toBeUndefined();
        expect(fail('OAuth refresh failed for openai: network unreachable')).toBeUndefined();
    });

    test('success, ordinary task failure and permission denial keep their existing precedence', () => {
        expect(classifyDispatch({ exitCode: 0, stdout: "You've hit your session limit", stderr: '' })).toBeUndefined();
        expect(fail('TypeError: cannot read properties of undefined')).toBeUndefined();
        expect(fail('EACCES: permission denied, open /tmp/x/privacy')).toBeUndefined();
    });
});

/**
 * 1264 R2/AC5 — the rescue evidence contract.
 *
 * The tail is what a maker sees, so the redaction must happen on the FULL text before the cut:
 * `redactAndBound` keeps the head, and tailing first would slice a secret at the boundary and send
 * its unmatched fragment off-box.
 */
describe('rescueEvidenceTail (1264 R2)', () => {
    const SECRET = 'sk-live-abcdef123456';

    test('AC5: a secret straddling the tail boundary is redacted, not sliced', () => {
        // Place the secret so a 4096-character tail would cut it in half.
        const filler = 'x'.repeat(4086);
        const text = `${filler}${SECRET}tail-after-secret`;
        const tail = rescueEvidenceTail(text, [SECRET]);
        expect(tail.length).toBeLessThanOrEqual(4096);
        expect(tail).not.toContain('abcdef123456');
        expect(tail).not.toContain(SECRET);
        // The redacted marker survives the cut, which is what proves the order.
        expect(tail).toContain('[REDACTED]');
    });

    test('the tail keeps the newest failure lines and a short text passes through', () => {
        const text = ['early noise', 'last line: credits depleted'].join('\n');
        expect(rescueEvidenceTail(text, [])).toBe(text);
        const long = `${'a'.repeat(5000)}END`;
        expect(rescueEvidenceTail(long, [])).toBe(`…${'a'.repeat(4095).slice(0, 4095)}END`.slice(-4096));
        expect(rescueEvidenceTail(long, []).endsWith('END')).toBe(true);
    });
});
