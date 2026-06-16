import { describe, expect, test } from 'bun:test';
import { output } from '../src/output';

describe('output', () => {
    test('passes through values (cast through unknown)', () => {
        const data = { ok: true as const, items: [1, 2, 3] };
        const result = output(data);
        expect(result).toBe(data);
    });
});
