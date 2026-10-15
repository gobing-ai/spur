/**
 * context-owner — host-native session owner derivation (task 1159), ported to
 * `@gobing-ai/spur-app/hooks` for `spur self hook` (script-absorption PR-2a).
 */

import { describe, expect, test } from 'bun:test';
import { claudeHookOwnerFromPayloadText, claudeSessionOwner } from '../../src/hooks/context-owner';

describe('claudeSessionOwner', () => {
    test('prefers the payload session_id (trimmed) over CLAUDE_CODE_SESSION_ID', () => {
        expect(claudeSessionOwner({ session_id: ' s-1 ' }, { CLAUDE_CODE_SESSION_ID: 'env-1' })).toEqual({
            host: 'claude',
            sessionId: 's-1',
        });
    });

    test('falls back to CLAUDE_CODE_SESSION_ID when the payload id is absent, empty or not a string', () => {
        const env = { CLAUDE_CODE_SESSION_ID: 'env-1' };
        for (const payload of [{}, { session_id: '' }, { session_id: 42 }, null, 'text']) {
            expect(claudeSessionOwner(payload, env)).toEqual({ host: 'claude', sessionId: 'env-1' });
        }
    });

    test('returns null when neither source yields a nonempty id', () => {
        expect(claudeSessionOwner({ session_id: '  ' }, { CLAUDE_CODE_SESSION_ID: '  ' })).toBeNull();
        expect(claudeSessionOwner(undefined, {})).toBeNull();
    });
});

describe('claudeHookOwnerFromPayloadText', () => {
    test('parses a valid payload', () => {
        expect(claudeHookOwnerFromPayloadText('{"session_id":"abc"}', {})).toEqual({
            host: 'claude',
            sessionId: 'abc',
        });
    });

    test('malformed or empty stdin degrades to the env-only fallback instead of throwing', () => {
        expect(claudeHookOwnerFromPayloadText('{not json', { CLAUDE_CODE_SESSION_ID: 'env-2' })).toEqual({
            host: 'claude',
            sessionId: 'env-2',
        });
        expect(claudeHookOwnerFromPayloadText('', {})).toBeNull();
    });
});
