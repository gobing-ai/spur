import { describe, expect, test } from 'bun:test';
import { buildTimeRangeClauses } from '../../src/analytics/selector-time-range';

// Golden strings are the exact predicates buildRollupWhere and dayClauses emitted before 1310
// consolidated them (1309 report predicateVectors); any drift changes the SQL the readers run.
const DAY = 'DATE(?)';
const TS = "strftime('%Y-%m-%dT%H:%M:%SZ', ?)";

describe('buildTimeRangeClauses (1310)', () => {
    test('no bounds emit no predicate and no parameter', () => {
        expect(buildTimeRangeClauses({ since: null, until: null }, { column: 'd.day', grain: 'day' })).toEqual({
            clauses: [],
            params: [],
        });
    });

    test('a lower bound alone is inclusive and keeps its parameter', () => {
        expect(buildTimeRangeClauses({ since: 'S', until: null }, { column: 'd.day', grain: 'day' })).toEqual({
            clauses: [`d.day >= ${DAY}`],
            params: ['S'],
        });
    });

    test('an upper bound alone is inclusive and keeps its parameter', () => {
        expect(buildTimeRangeClauses({ since: null, until: 'U' }, { column: 'r.ts', grain: 'timestamp' })).toEqual({
            clauses: [`r.ts <= ${TS}`],
            params: ['U'],
        });
    });

    test('both bounds keep since-then-until order for clauses and parameters', () => {
        expect(buildTimeRangeClauses({ since: 'S', until: 'U' }, { column: 'r.day', grain: 'day' })).toEqual({
            clauses: [`r.day >= ${DAY}`, `r.day <= ${DAY}`],
            params: ['S', 'U'],
        });
        expect(buildTimeRangeClauses({ since: 'S', until: 'U' }, { column: 'r.hour', grain: 'timestamp' })).toEqual({
            clauses: [`r.hour >= ${TS}`, `r.hour <= ${TS}`],
            params: ['S', 'U'],
        });
    });

    test('an empty-string bound is a bound, not an absent one', () => {
        // Callers distinguish only null; '' must reach SQL exactly as before consolidation.
        expect(buildTimeRangeClauses({ since: '', until: null }, { column: 'd.day', grain: 'day' }).params).toEqual([
            '',
        ]);
    });

    // 1326: a local-offset selector bound must select the same rows as its UTC equivalent, which
    // TEXT comparison cannot do — both sides parse to instants instead.
    test('instant grain parses both sides and keeps the raw parameters', () => {
        // Unparseable bounds (the 'S'/'U' placeholders here) get no sargable prefilter — only the
        // exact predicate — so correctness never depends on the widening.
        expect(buildTimeRangeClauses({ since: 'S', until: 'U' }, { column: 'm.ts', grain: 'instant' })).toEqual({
            clauses: ['julianday(m.ts) >= julianday(?)', 'julianday(m.ts) <= julianday(?)'],
            params: ['S', 'U'],
        });
        expect(buildTimeRangeClauses({ since: null, until: 'U' }, { column: 'occurred_at', grain: 'instant' })).toEqual(
            {
                clauses: ['julianday(occurred_at) <= julianday(?)'],
                params: ['U'],
            },
        );
    });

    test('instant grain keeps the predicate sargable with a one-second-widened TEXT range', () => {
        // Without the prefilter the plan is a full covering-index scan (measured 25.7s vs 1.2s
        // on a bounded daily analyze), so the range clause must stay on the raw column.
        expect(
            buildTimeRangeClauses(
                { since: '2026-11-08T00:00:00.000-08:00', until: '2026-11-08T23:59:59.999-08:00' },
                { column: 'm.ts', grain: 'instant' },
            ),
        ).toEqual({
            clauses: ['m.ts >= ?', 'julianday(m.ts) >= julianday(?)', 'm.ts <= ?', 'julianday(m.ts) <= julianday(?)'],
            params: [
                '2026-11-08T07:59:59.000Z',
                '2026-11-08T00:00:00.000-08:00',
                '2026-11-09T08:00:00.999Z',
                '2026-11-08T23:59:59.999-08:00',
            ],
        });
    });

    test.each(['d.day; DROP TABLE x', 'day)', 'a.b.c', '', "d.day OR '1'='1'"])(
        'a column that is not a plain [alias.]identifier is refused: %p',
        (column) => {
            expect(() => buildTimeRangeClauses({ since: 'S', until: null }, { column, grain: 'day' })).toThrow(
                /column/,
            );
        },
    );
});
