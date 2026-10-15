import { describe, expect, test } from 'bun:test';
import {
    parseArtifactRefs,
    sanitizeInvocationArgv,
    traceSafePrompt,
} from '../../src/services/agent-invocation-sanitize';

describe('traceSafePrompt', () => {
    test('free-form prompts are fully redacted to a length marker', () => {
        expect(traceSafePrompt('fix the login bug')).toBe('[redacted prompt: 17 chars]');
    });

    test('slash commands keep their identity and safe tokens, other tokens are redacted', () => {
        expect(traceSafePrompt('/sp:dev-run 0042 --auto secret-arg')).toBe('/sp:dev-run 0042 --auto [redacted]');
    });
});

describe('parseArtifactRefs', () => {
    test('returns the array, and [] for a non-array or malformed column', () => {
        expect(parseArtifactRefs('[{"kind":"file","path":"a"}]')).toEqual([{ kind: 'file', path: 'a' }] as never);
        expect(parseArtifactRefs('{"kind":"file"}')).toEqual([]);
        expect(parseArtifactRefs('not json')).toEqual([]);
    });
});

describe('sanitizeInvocationArgv', () => {
    test('redacts the value after a sensitive flag and inline sensitive values', () => {
        expect(sanitizeInvocationArgv(['--token', 'abc', '--api-key=xyz', '-p'], undefined, undefined)).toEqual([
            '--token',
            '[redacted]',
            '--api-key=[redacted]',
            '-p',
        ]);
    });

    test('replaces the raw prompt with its trace form and scrubs bearer / key-shaped tokens', () => {
        expect(
            sanitizeInvocationArgv(
                ['run', 'do the thing', 'Bearer abc.def', 'ghp_abcdefghijklmnop'],
                'do the thing',
                '[redacted prompt: 12 chars]',
            ),
        ).toEqual(['run', '[redacted prompt: 12 chars]', 'Bearer [redacted]', '[redacted]']);
    });
});
