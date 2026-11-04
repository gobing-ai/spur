import { describe, expect, test } from 'bun:test';
import { contract, searchContract, searchRequestSchema, searchStatusResponseSchema } from '../src';

describe('searchContract (task 1285)', () => {
    test('schemas accept a full request and infer the documented DTO shape', () => {
        const parsed = searchRequestSchema.parse({
            query: 'paused workflow resume',
            mode: 'auto',
            scope: 'docs',
            limit: 25,
            globs: ['src/**'],
            regex: true,
        });
        expect(parsed).toEqual({
            query: 'paused workflow resume',
            mode: 'auto',
            scope: 'docs',
            limit: 25,
            globs: ['src/**'],
            regex: true,
        });
    });

    test('minimal request (query only) parses — optional transport fields', () => {
        expect(searchRequestSchema.parse({ query: 'x' })).toEqual({ query: 'x' });
    });

    test('rejects invalid mode, scope, limit bounds, and empty query', () => {
        expect(() => searchRequestSchema.parse({ query: 'x', mode: 'regex' })).toThrow();
        expect(() => searchRequestSchema.parse({ query: 'x', scope: 'everything' })).toThrow();
        expect(() => searchRequestSchema.parse({ query: 'x', limit: 0 })).toThrow();
        expect(() => searchRequestSchema.parse({ query: 'x', limit: 101 })).toThrow();
        expect(() => searchRequestSchema.parse({ query: '   ' })).toThrow();
    });

    test('searchStatusResponseSchema validates a full status payload', () => {
        const status = searchStatusResponseSchema.parse({
            ok: true,
            data: {
                rg: { available: true, version: 'ripgrep 15.2.0' },
                zg: { available: true, version: '0.3.0', index: 'stale', hint: 'zg --index' },
            },
        });
        expect(status.data.zg.index).toBe('stale');
        const bare = searchStatusResponseSchema.parse({
            ok: true,
            data: { rg: { available: false }, zg: { available: false, index: 'unknown' } },
        });
        expect(bare.data.zg.hint).toBeUndefined();
    });

    test('searchContract exposes search and searchStatus routes', () => {
        expect(Object.keys(searchContract).sort()).toEqual(['search', 'searchStatus']);
    });

    test('search contract is mounted into the public contract under query/status (1287 scope)', () => {
        expect(Object.keys(contract.search).sort()).toEqual(['query', 'status']);
        expect(contract.search.query).toBe(searchContract.search);
        expect(contract.search.status).toBe(searchContract.searchStatus);
    });
});
