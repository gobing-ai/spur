/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMigratedDb, type HistoryArtifact } from '@gobing-ai/spur-domain';
import { main } from '../../../src';
import type { CommandOutput } from '../../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

function capturingOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        output: { write: (s: string) => lines.push(s), error: (s: string) => lines.push(s) },
    };
}

function makeTmpCwd(): string {
    return mkdtempSync(join(tmpdir(), 'spur-hist-'));
}

describe('history command', () => {
    test('analyze subcommand returns a number', async () => {
        const exitCode = await main(['history', 'analyze', '--json'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(typeof exitCode).toBe('number');
    });

    test('1131 R4 — analyze --session with zero matches exits 2 and warns session-not-found', async () => {
        const cwd = makeTmpCwd();
        const dbUrl = join(cwd, 'hist.db');
        const db = await createMigratedDb({ url: dbUrl });
        await db.run(
            `INSERT INTO history_message (record_hash, source, source_file, source_line, session_id, seq,
                 role, record_type, disposition, ts, model, input_tokens, output_tokens, cost_usd,
                 provenance, duration_ms, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            'pi-m1',
            'pi',
            '2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b.jsonl',
            1,
            '2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b',
            1,
            'user',
            'message',
            'conversation',
            '2026-10-07T22:44:40Z',
            null,
            null,
            null,
            null,
            'agent',
            null,
            '2026-10-08T00:00:00Z',
        );
        db.close();
        const { output, lines } = capturingOutput();

        const exitCode = await main(
            ['history', 'analyze', '--session', '01a1188a-36d8-72ae-b267-dac37608899b', '--json'],
            { output, cwd, dbUrl },
        );

        expect(exitCode).toBe(2);
        const parsed = JSON.parse(lines.join('')) as HistoryArtifact;
        const warning = parsed.warnings.find((w) => w.code === 'session-not-found');
        expect(warning?.detail).toContain('2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b');

        // The exact stored id keeps the zero-warning exit 0 contract.
        const exact = await main(
            [
                'history',
                'analyze',
                '--session',
                '2026-10-07T22-44-33-625Z_01a1188a-36d8-72ae-b267-dac37608899b',
                '--json',
            ],
            { output: nullOutput(), cwd, dbUrl },
        );
        expect(exact).toBe(0);
        rmSync(cwd, { recursive: true, force: true });
    });

    test('analyze subcommand formatted text output (non-json)', async () => {
        const cwd = makeTmpCwd();
        const { output, lines } = capturingOutput();
        try {
            const exitCode = await main(['history', 'analyze'], {
                output,
                cwd,
                dbUrl: ':memory:',
            });
            expect(exitCode).toBe(0);
            const joined = lines.join('');
            expect(joined).toContain('Total:');
            expect(joined).toContain('$0.00');
        } finally {
            rmSync(cwd, { recursive: true, force: true });
        }
    });
});
