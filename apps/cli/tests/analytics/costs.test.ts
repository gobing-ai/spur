import { describe, expect, test } from 'bun:test';
import { byCostDesc, byDateAsc } from '../../src/analytics/costs';

describe('analytics costs', () => {
    test('byDateAsc sorts by date ascending', () => {
        const items = [{ date: '2026-05-31' }, { date: '2026-05-30' }, { date: '2026-06-01' }];
        const sorted = [...items].sort(byDateAsc);
        expect(sorted.map((i) => i.date)).toEqual(['2026-05-30', '2026-05-31', '2026-06-01']);
    });

    test('byCostDesc sorts tuples by cost descending', () => {
        const items: Array<[string, { costUsd: number }]> = [
            ['a', { costUsd: 10 }],
            ['b', { costUsd: 50 }],
            ['c', { costUsd: 5 }],
        ];
        const sorted = [...items].sort(byCostDesc);
        expect(sorted.map(([, s]) => s.costUsd)).toEqual([50, 10, 5]);
    });
});
