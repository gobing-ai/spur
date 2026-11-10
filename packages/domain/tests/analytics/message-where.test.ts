import { describe, expect, test } from 'bun:test';
import type { ArtifactSelector } from '../../src/analytics/artifact';
import { buildMessageWhereClauses as viaFacade } from '../../src/analytics/forensic-query';
import { buildMessageWhereClauses, escapeLike } from '../../src/analytics/message-where';

const BASE: ArtifactSelector = { since: null, until: null, sources: null, sessionId: null, runId: null, taskWbs: null };

describe('message-where', () => {
    test('escapeLike escapes the ESCAPE char and LIKE wildcards', () => {
        expect(escapeLike('a!b%c_d')).toBe('a!!b!%c!_d');
    });

    test('empty selector yields no clauses', () => {
        expect(buildMessageWhereClauses(BASE, 'm')).toEqual({ clauses: [], params: [] });
    });

    test('scalar + list filters are alias-parameterized', () => {
        const { clauses, params } = buildMessageWhereClauses(
            {
                ...BASE,
                since: '2026-11-08T00:00:00.000-08:00',
                until: '2026-11-08T23:59:59.999-08:00',
                sources: ['claude'],
                models: ['x', 'y'],
                sessionId: 's1',
            },
            'm2',
        );
        // 1326: an instant bound is a sargable TEXT range on the raw column plus the exact parse.
        expect(clauses).toContain('m2.ts >= ?');
        expect(clauses).toContain('julianday(m2.ts) >= julianday(?)');
        expect(clauses).toContain('m2.ts <= ?');
        expect(clauses).toContain('julianday(m2.ts) <= julianday(?)');
        expect(clauses).toContain('m2.source IN (?)');
        expect(clauses).toContain('m2.model IN (?, ?)');
        expect(clauses).toContain('m2.session_id = ?');
        expect(params).toEqual([
            '2026-11-08T07:59:59.000Z',
            '2026-11-08T00:00:00.000-08:00',
            '2026-11-09T08:00:00.999Z',
            '2026-11-08T23:59:59.999-08:00',
            'claude',
            'x',
            'y',
            's1',
        ]);
    });

    test('tools and skills become EXISTS subqueries; skills are LIKE-escaped', () => {
        const { clauses, params } = buildMessageWhereClauses(
            { ...BASE, tools: [' Bash ', ''], skills: ['a_b', 'unknown'] },
            'm',
        );
        expect(clauses).toHaveLength(2);
        expect(clauses.every((c) => c.startsWith('EXISTS'))).toBe(true);
        expect(params.slice(0, 4)).toEqual(['Bash', 'unknown', 'Bash', 'unknown']);
        expect(params.slice(4)).toEqual(['%a!_b%', '%a!_b%']);
    });

    test('forensic-query keeps re-exporting the builder', () => {
        expect(viaFacade).toBe(buildMessageWhereClauses);
    });
});
