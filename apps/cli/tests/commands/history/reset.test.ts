/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */

import { describe, expect, spyOn, test } from 'bun:test';
import { HistoryService } from '@gobing-ai/spur-app';
import { main } from '../../../src';
import type { CommandOutput } from '../../../src/output';

function capturingOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        output: { write: (s: string) => lines.push(s), error: (s: string) => lines.push(s) },
    };
}

describe('history command', () => {
    test('reset refuses without --yes (text)', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory');
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(1);
        expect(lines.join('')).toContain('refusing to wipe history tables without --yes');
        // The guard fires before the database-backed service is constructed.
        expect(spy).not.toHaveBeenCalled();
    });

    test('reset refuses without --yes (enveloped json emits structured usage error)', async () => {
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--json', '--json-envelope'], {
            output,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        const parsed = JSON.parse(lines.join('')) as {
            ok: boolean;
            error?: { code: string; details?: { cliCode?: string } };
        };
        expect(parsed.ok).toBe(false);
        expect(parsed.error?.code).toBe('INTERNAL_ERROR');
        expect(parsed.error?.details?.cliCode).toBe('usage');
    });

    test('reset --yes reports cleared/skipped and warns on unlisted tables (text)', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory').mockResolvedValueOnce({
            cleared: ['history_message', 'history_etl_pi'],
            skipped: ['history_board_daily'],
            unknown: ['history_zz_rogue'],
        });
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--yes'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const joined = lines.join('');
        expect(joined).toContain('cleared 2 history tables (1 not present)');
        expect(joined).toContain('WARNING: 1 unlisted history_* table(s) left intact: history_zz_rogue');
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('reset --yes --json emits the structured result', async () => {
        const spy = spyOn(HistoryService.prototype, 'resetHistory').mockResolvedValueOnce({
            cleared: ['history_message'],
            skipped: [],
            unknown: [],
        });
        const { output, lines } = capturingOutput();

        const exitCode = await main(['history', 'reset', '--yes', '--json'], { output, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join('')) as {
            cleared: string[];
            skipped: string[];
            unknown: string[];
            clearedCount: number;
        };
        expect(parsed.cleared).toEqual(['history_message']);
        expect(parsed.skipped).toEqual([]);
        expect(parsed.unknown).toEqual([]);
        expect(parsed.clearedCount).toBe(1);
        spy.mockRestore();
    });
});
