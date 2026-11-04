import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SearchRequest } from '@gobing-ai/spur-contracts';
import { buildZgArgs, parseZgQuery, parseZgStatus, ZgOutputError } from '../../src/services/search-zg';

const fx = (name: string) => readFileSync(join(import.meta.dir, '../fixtures/zg', name), 'utf8');
const req = (overrides: Partial<SearchRequest> = {}): SearchRequest => ({
    query: 'q',
    mode: 'auto',
    scope: 'all',
    limit: 10,
    globs: [],
    regex: false,
    ...overrides,
});

describe('buildZgArgs (design §3: flags take values, --hybrid always explicit)', () => {
    test('emits --hybrid <q> --limit <n> --preview short plus -g per glob in order', () => {
        expect(buildZgArgs(req({ query: 'paused resume', limit: 3 }), ['*.md', 'src/**'])).toEqual([
            '--hybrid',
            'paused resume',
            '--limit',
            '3',
            '--preview',
            'short',
            '-g',
            '*.md',
            '-g',
            'src/**',
        ]);
    });

    test('no globs → no -g flags', () => {
        expect(buildZgArgs(req({ limit: 10 }), [])).toEqual(['--hybrid', 'q', '--limit', '10', '--preview', 'short']);
    });
});

describe('parseZgQuery against golden zg 0.3.0 fixtures', () => {
    test('query-hybrid.txt → 3 ranked hits with ranges, symbol and snippet', () => {
        const hits = parseZgQuery(fx('query-hybrid.txt'), '0.3.0');
        expect(hits).toHaveLength(3);
        expect(hits[0]).toMatchObject({
            rank: 1,
            path: 'packages/app/tests/services/agent-quota-updates.test.ts',
            startLine: 537,
            endLine: 537,
            symbol: '[function] alpha',
            snippet: "alpha = cfg.agent.executors.find((entry) => entry.name === 'alpha')",
            matchedBy: ['fuzzy'],
        });
        expect(hits.map((h) => h.rank)).toEqual([1, 2, 3]);
        expect(hits[2]?.path).toBe('apps/web/tests/modules/discover.test.ts');
    });

    test('query-limit20.txt → 20 hits; "…" truncation, docs heading/scope metadata, empty source lines', () => {
        const hits = parseZgQuery(fx('query-limit20.txt'), '0.3.0');
        expect(hits).toHaveLength(20);
        expect(hits[14]).toMatchObject({
            rank: 15,
            path: 'docs/tasks2/0267_process-watch-list-filters-and-teamid-tagging.md',
            startLine: 30,
            endLine: 43,
            heading: 'Acceptance Criteria',
        });
        expect(hits[14]?.snippet).not.toContain('\u2026');
        expect(hits[19]?.endLine).toBe(42);
    });
});

const hit = (rank: number, path: string, ...rest: string[]) => [`#${rank} ${path}`, ...rest, ''];

describe('parseZgQuery edge grammar', () => {
    test('"No matches." and whitespace-only stdout parse to an empty array', () => {
        expect(parseZgQuery('No matches.\n', '0.3.0')).toEqual([]);
        expect(parseZgQuery('\n  \n', '0.3.0')).toEqual([]);
    });

    test('single-line hit path:12 without range → endLine equals startLine', () => {
        const hits = parseZgQuery(hit(1, 'docs/x.md:12', '  12: hello').join('\n'), '0.3.0');
        expect(hits[0]).toMatchObject({ startLine: 12, endLine: 12, snippet: 'hello' });
    });

    test('multi-line source, "..." elision and heading metadata', () => {
        const out = hit(1, 'docs/x.md:1-10', 'heading: Intro', '  1: first', '  ...', '  10: last').join('\n');
        expect(parseZgQuery(out, '0.3.0')[0]).toMatchObject({ heading: 'Intro', snippet: 'first\nlast' });
    });

    test('group separator lines are tolerated', () => {
        const out = ['-- query 1/1: q --', ...hit(1, 'docs/x.md:1', '  1: a')].join('\n');
        expect(parseZgQuery(out, '0.3.0')).toHaveLength(1);
    });

    test('snippet is capped at 300 characters', () => {
        const out = hit(1, 'docs/x.md:1', `  1: ${'x'.repeat(500)}`).join('\n');
        expect(parseZgQuery(out, '0.3.0')[0]?.snippet.length).toBe(300);
    });
});

describe('parseZgQuery fails loudly on unrecognized output (R7 / AC7)', () => {
    test('malformed.txt throws ZgOutputError with version + sample', () => {
        try {
            parseZgQuery(fx('malformed.txt'), '0.3.0');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(ZgOutputError);
            const e = error as ZgOutputError;
            expect(e.zgVersion).toBe('0.3.0');
            expect(e.sample).toContain('search results for');
        }
    });

    test('zg 0.2.2 grammar is rejected, not misparsed', () => {
        expect(() => parseZgQuery(fx('legacy-0.2.2-query.txt'), '0.2.2')).toThrow(ZgOutputError);
    });

    test('out-of-sequence ranks throw', () => {
        const out = [...hit(1, 'docs/x.md:1', '  1: a'), ...hit(3, 'docs/y.md:2', '  2: b')].join('\n');
        expect(() => parseZgQuery(out, '0.3.0')).toThrow(ZgOutputError);
    });

    test('an unindented non-metadata line inside a hit throws', () => {
        expect(() => parseZgQuery(hit(1, 'docs/x.md:1', '1\tfirst').join('\n'), '0.3.0')).toThrow(ZgOutputError);
    });
});

describe('parseZgStatus mapping', () => {
    test("leading '!' → stale", () => {
        expect(parseZgStatus(fx('status-stale.txt'))).toBe('stale');
    });
    test("leading '?' → missing", () => {
        expect(parseZgStatus(fx('status-missing.txt'))).toBe('missing');
    });
    test('zg 0.3.0 ready coverage bar → ready', () => {
        expect(parseZgStatus(fx('status-ready-0.3.txt'))).toBe('ready');
    });
    test('zg 0.3.0 "Coverage Unavailable (index not configured)" → missing', () => {
        expect(parseZgStatus(fx('status-missing-0.3.txt'))).toBe('missing');
    });
    test('ready glyph → ready', () => {
        expect(parseZgStatus('✓ Workspace index is fresh\n  Storage .zvec-grep/index.zvec\n')).toBe('ready');
    });
    test('blank/empty output → unknown', () => {
        expect(parseZgStatus('')).toBe('unknown');
        expect(parseZgStatus('\n\n')).toBe('unknown');
    });
});
