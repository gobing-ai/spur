import { describe, expect, test } from 'bun:test';
import { assertNoRawAggregation, recordStatements } from './statement-recorder';

describe('statement-recorder assertNoRawAggregation (0743 R8)', () => {
    test('permits a record_hash point lookup on the raw tables', () => {
        const sqls = [
            `SELECT * FROM history_message WHERE record_hash = ?`,
            `SELECT * FROM history_tool_call WHERE message_hash = ? AND record_hash = ?`,
            `SELECT m.* FROM history_message m WHERE m.record_hash IN (?, ?)`,
            `SELECT imported_at AS newest FROM history_message ORDER BY rowid DESC LIMIT 1`,
        ];
        expect(assertNoRawAggregation(sqls)).toEqual([]);
    });

    test('fails on a raw GROUP BY over history_message', () => {
        const sqls = [
            `SELECT source, COUNT(*) AS n FROM history_message GROUP BY source`,
            `SELECT session_id, SUM(input_tokens) FROM history_tool_call GROUP BY session_id`,
        ];
        const violations = assertNoRawAggregation(sqls);
        expect(violations.length).toBe(2);
        expect(violations[0]?.table).toBe('history_message');
        expect(violations[1]?.table).toBe('history_tool_call');
    });

    test('fails on a bare aggregate over the raw tables without GROUP BY', () => {
        const sqls = [`SELECT COUNT(*) AS n FROM history_message`, `SELECT SUM(tool_calls) FROM history_tool_call`];
        expect(assertNoRawAggregation(sqls).length).toBe(2);
    });

    test('ignores statements that never touch the raw tables', () => {
        const sqls = [
            `SELECT bucket_start, SUM(messages) FROM history_board_message_5m GROUP BY bucket_start`,
            `SELECT * FROM history_board_dimension_daily WHERE dimension = 'model'`,
        ];
        expect(assertNoRawAggregation(sqls)).toEqual([]);
    });

    test('recordStatements wraps a DbAdapter and captures executed SQL', async () => {
        const { createDbAdapter } = await import('@gobing-ai/ts-db');
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const { db: recorded, statements } = recordStatements(db);
        await recorded.exec('CREATE TABLE t (id TEXT PRIMARY KEY)');
        await recorded.queryAll('SELECT id FROM t');
        await recorded.run('INSERT INTO t (id) VALUES (?)', 'x');
        expect(statements.some((s) => s.includes('CREATE TABLE t'))).toBe(true);
        expect(statements.some((s) => s.includes('SELECT id FROM t'))).toBe(true);
        expect(statements.some((s) => s.includes('INSERT INTO t'))).toBe(true);
        db.close();
    });
});
