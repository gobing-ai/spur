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
    test('emits query --hybrid <q> --limit <n> plus -g per glob in order', () => {
        expect(buildZgArgs(req({ query: 'paused resume', limit: 3 }), ['*.md', 'src/**'])).toEqual([
            'query',
            '--hybrid',
            'paused resume',
            '--limit',
            '3',
            '-g',
            '*.md',
            '-g',
            'src/**',
        ]);
    });

    test('no globs → no -g flags', () => {
        expect(buildZgArgs(req({ limit: 10 }), [])).toEqual(['query', '--hybrid', 'q', '--limit', '10']);
    });
});

describe('parseZgQuery against golden zg 0.2.2 fixtures', () => {
    test('query-hybrid.txt → 3 ranked hits with ranges and fts+vector', () => {
        const hits = parseZgQuery(fx('query-hybrid.txt'), '0.2.2');
        expect(hits).toHaveLength(3);
        expect(hits[0]).toMatchObject({
            rank: 1,
            path: 'docs/tasks/0063_W3_spur_workflow_continue_HITL_resume.md',
            startLine: 46,
            endLine: 58,
            matchedBy: ['fuzzy'],
            heading: 'Solution',
        });
        expect(hits[2]?.path).toContain('0063_W3');
        expect(hits[2]?.startLine).toBe(109);
        expect(hits[2]?.endLine).toBe(129);
        expect(hits.every((h) => h.matchedBy[0] === 'fuzzy')).toBe(true);
        expect(hits.every((h) => typeof h.snippet === 'string' && h.snippet.length > 0)).toBe(true);
    });

    test('query-docs-heading.txt → heading metadata captured', () => {
        const hits = parseZgQuery(fx('query-docs-heading.txt'), '0.2.2');
        expect(hits).toHaveLength(3);
        expect(hits[0]?.heading).toBe('spur task batch-plan');
        expect(hits[0]?.path).toBe('docs/help2/task.md');
    });

    test('query-code-symbols.txt → symbol metadata (raw remainder) and ranges', () => {
        const hits = parseZgQuery(fx('query-code-symbols.txt'), '0.2.2');
        expect(hits).toHaveLength(5);
        expect(hits[0]?.symbol).toContain('formatDenialMessage');
        expect(hits[0]?.startLine).toBe(295);
        expect(hits[0]?.endLine).toBe(344);
        expect(hits[1]?.startLine).toBe(1938);
        expect(hits[1]?.endLine).toBe(1999);
    });
});

describe('parseZgQuery edge grammar', () => {
    test('hits: 0 parses to an empty array', () => {
        const out = ['query groups (1):', 'Q1 [primary]: q', 'hits: 0', ''].join('\n');
        expect(parseZgQuery(out, '0.2.2')).toEqual([]);
    });

    test('whitespace-only stdout parses to an empty array', () => {
        expect(parseZgQuery('\n  \n', '0.2.2')).toEqual([]);
    });

    test('single-line hit path:12 without range → endLine equals startLine', () => {
        const out = [
            'query groups (1):',
            'Q1 [primary]: q',
            'hits: 1',
            '',
            '#1 matchedBy=vector docs/x.md:12',
            '12\thello',
        ].join('\n');
        const hits = parseZgQuery(out, '0.2.2');
        expect(hits[0]?.startLine).toBe(12);
        expect(hits[0]?.endLine).toBe(12);
        expect(hits[0]?.snippet).toBe('hello');
    });

    test('literal "..." elision lines are ignored in snippets', () => {
        const out = [
            'query groups (1):',
            'Q1 [primary]: q',
            'hits: 1',
            '',
            '#1 matchedBy=fts docs/x.md:1-10',
            '1\tfirst',
            '...',
            '10\tlast',
        ].join('\n');
        expect(parseZgQuery(out, '0.2.2')[0]?.snippet).toBe('first\nlast');
    });

    test('snippet is capped at 300 characters', () => {
        const line = `1\t${'x'.repeat(500)}`;
        const out = ['query groups (1):', 'Q1 [primary]: q', 'hits: 1', '', '#1 matchedBy=fts docs/x.md:1', line].join(
            '\n',
        );
        expect(parseZgQuery(out, '0.2.2')[0]?.snippet.length).toBe(300);
    });
});

describe('parseZgQuery fails loudly on unrecognized output (R7 / AC7)', () => {
    test('malformed.txt (no "query groups (" header) throws ZgOutputError with version + sample', () => {
        const raw = fx('malformed.txt');
        try {
            parseZgQuery(raw, '0.2.2');
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(ZgOutputError);
            const e = error as ZgOutputError;
            expect(e.zgVersion).toBe('0.2.2');
            expect(e.sample).toContain('search results for');
        }
    });

    test('parsed hit count disagreeing with the hits: count throws', () => {
        const out = [
            'query groups (1):',
            'Q1 [primary]: q',
            'hits: 3',
            '',
            '#1 matchedBy=fts docs/x.md:1',
            '1\tfirst',
            '#2 matchedBy=fts docs/y.md:2',
            '2\tsecond',
        ].join('\n');
        expect(() => parseZgQuery(out, '0.2.2')).toThrow(ZgOutputError);
    });

    test('a hit header failing the documented regex throws', () => {
        const out = [
            'query groups (1):',
            'Q1 [primary]: q',
            'hits: 1',
            '',
            '#1 matchedBy=weird docs/x.md:1',
            '1\tfirst',
        ].join('\n');
        expect(() => parseZgQuery(out, '0.2.2')).toThrow(ZgOutputError);
    });

    test('hit blocks with no hits: count line throws (cannot validate)', () => {
        const out = ['query groups (1):', 'Q1 [primary]: q', '', '#1 matchedBy=fts docs/x.md:1', '1\tfirst'].join('\n');
        expect(() => parseZgQuery(out, '0.2.2')).toThrow(ZgOutputError);
    });
});

describe('parseZgStatus first-glyph mapping', () => {
    test("leading '!' → stale", () => {
        expect(parseZgStatus(fx('status-stale.txt'))).toBe('stale');
    });
    test("leading '?' → missing", () => {
        expect(parseZgStatus(fx('status-missing.txt'))).toBe('missing');
    });
    test('ready glyph → ready', () => {
        expect(parseZgStatus('✓ Workspace index is fresh\n  Storage .zvec-grep/index.zvec\n')).toBe('ready');
    });
    test('blank/empty output → unknown', () => {
        expect(parseZgStatus('')).toBe('unknown');
        expect(parseZgStatus('\n\n')).toBe('unknown');
    });
});
