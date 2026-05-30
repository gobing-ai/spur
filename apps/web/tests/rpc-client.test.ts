import { describe, expect, test } from 'bun:test';
import { resolveApiUrl } from '../src/lib/rpc-client';

describe('rpc client', () => {
    test('prefers explicit public API URL', () => {
        expect(resolveApiUrl('https://api.example.test')).toBe('https://api.example.test');
    });
});
