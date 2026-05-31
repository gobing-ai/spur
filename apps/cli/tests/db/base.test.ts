import { describe, expect, test } from 'bun:test';
import { createId } from '../../src/db/base';

describe('db base', () => {
    test('createId generates prefixed id', () => {
        const id = createId('test');
        expect(id.startsWith('test_')).toBeTrue();
        expect(id.length).toBeGreaterThan(10);
    });

    test('createId produces unique ids', () => {
        const ids = new Set(Array.from({ length: 100 }, () => createId('u')));
        expect(ids.size).toBe(100);
    });
});
