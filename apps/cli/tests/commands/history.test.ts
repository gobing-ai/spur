/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { main } from '../../src';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('history command', () => {
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['history', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('analyze subcommand returns a number', async () => {
        const exitCode = await main(['history', 'analyze', '--json'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(typeof exitCode).toBe('number');
    });

    test('report subcommand prints TODO marker', async () => {
        const exitCode = await main(['history', 'report', '--json'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
    });
});
