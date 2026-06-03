/**
 * Thin-wrapper integration tests for apps/cli/src/commands/history.ts.
 * Behavioral tests for HistoryService live in packages/app/tests/services/history-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { runHistoryCommand } from '../../src/commands/history';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('runHistoryCommand dispatch', () => {
    test('unknown subcommand returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runHistoryCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('analyze subcommand returns a number', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runHistoryCommand('analyze', ctx, { json: true }, []);
        expect(typeof exitCode).toBe('number');
    });
});
