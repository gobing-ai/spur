/**
 * 1263 R2/R3 — the outcome module's own contracts.
 *
 * The CLI E2E covers the verb end to end; this pins the two rules the module exists for: an outcome
 * for an unknown invocation is refused (no decision to score), and the first write wins.
 */
import { describe, expect, test } from 'bun:test';
import { applyCliMigrations, SystemEventDao } from '@gobing-ai/spur-domain';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import {
    DECISION_OUTCOME_PATTERN,
    recordDecisionOutcome,
    reviewSeverityOutcome,
    UnknownDecisionInvocationError,
} from '../../src/decision/decision-outcome';

const T = '2026-10-19T00:00:00.000Z';

async function daoWithEnd(invocationId: string): Promise<{ dao: SystemEventDao; adapter: DbAdapter }> {
    const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(adapter);
    const dao = new SystemEventDao(adapter);
    await dao.insert({
        id: 'end-1',
        event_name: 'decision.end',
        occurred_at: T,
        run_id: 'run-1',
        payload_json: JSON.stringify({
            schemaVersion: 2,
            data: {
                caller: 'workflow',
                decisionId: 'failure-class',
                maker: 'typesafe',
                invocationId,
                source: 'model',
                value: 'fix',
                durationMs: 3,
            },
            context: {},
            presentation: {},
        }),
    });
    return { dao, adapter };
}

describe('recordDecisionOutcome (task 1263 R2)', () => {
    test('AC2: refuses an unknown invocation id before any write', async () => {
        const { dao, adapter } = await daoWithEnd('inv-1');
        await expect(recordDecisionOutcome({ dao }, { invocationId: 'inv-missing', outcome: 'fixed' })).rejects.toThrow(
            UnknownDecisionInvocationError,
        );
        expect(await dao.decisionOutcomeByInvocation('inv-missing')).toBeUndefined();
        adapter.close();
    });

    test('AC2: records onto the decision run and keeps the first outcome', async () => {
        const { dao, adapter } = await daoWithEnd('inv-1');
        const first = await recordDecisionOutcome({ dao }, { invocationId: 'inv-1', outcome: 'fixed', source: 'test' });
        expect(first).toEqual({ invocationId: 'inv-1', decisionId: 'failure-class', outcome: 'fixed', recorded: true });
        // The row is the ledger's own envelope shape, on the decision's run.
        const rows = await adapter.queryAll<{ run_id: string; payload_json: string }>(
            "SELECT run_id, payload_json FROM system_events WHERE event_name = 'decision.outcome'",
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]?.run_id).toBe('run-1');
        expect(JSON.parse(rows[0]?.payload_json ?? '{}')).toMatchObject({
            schemaVersion: 2,
            data: { invocationId: 'inv-1', decisionId: 'failure-class', outcome: 'fixed', source: 'test' },
        });

        const replay = await recordDecisionOutcome({ dao }, { invocationId: 'inv-1', outcome: 'not-fixed' });
        expect(replay).toMatchObject({ outcome: 'fixed', recorded: false });
        adapter.close();
    });

    test('the outcome vocabulary is a bounded lowercase slug', () => {
        for (const ok of ['fixed', 'not-fixed', 'p2', 'none']) expect(DECISION_OUTCOME_PATTERN.test(ok)).toBe(true);
        for (const bad of ['Fixed', 'not fixed', '', 'p2;rm -rf /', 'x'.repeat(33)]) {
            expect(DECISION_OUTCOME_PATTERN.test(bad)).toBe(false);
        }
    });
});

describe('reviewSeverityOutcome (task 1263 R3b)', () => {
    function reviewSection(rows: string): string {
        return [
            '## 1263. Fixture',
            '',
            '### Review',
            '',
            '| Priority | Location | Finding | Disposition |',
            '|---|---|---|---|',
            ...rows.split('\n'),
            '',
        ].join('\n');
    }

    test('AC3: the worst finding wins and resolved rows still count', () => {
        expect(
            reviewSeverityOutcome(
                reviewSection('| P2 | `a.ts:1` | Still open. | OPEN |\n| P4 | `b.ts:2` | Nit. | OPEN |'),
            ),
        ).toBe('p2');
        // A fixed P2 was still in the diff (Q&A): the question is whether the change was risky.
        expect(reviewSeverityOutcome(reviewSection('| P2 | `a.ts:1` | Fixed later. | FIXED |'))).toBe('p2');
    });

    test('a review with no finding row reports none; a priority-less row reports the mildest', () => {
        expect(reviewSeverityOutcome(reviewSection('| — | — | No findings. | — |'))).toBe('none');
        // A row without a P1-P4 priority is not a finding the parser admits.
        expect(reviewSeverityOutcome(reviewSection('| housekeeping | `c.ts:3` | Tidy up. | OPEN |'))).toBe('none');
        expect(reviewSeverityOutcome('## 1263. Fixture\n\n### Review\n\nNothing to report.\n')).toBe('none');
    });
});
