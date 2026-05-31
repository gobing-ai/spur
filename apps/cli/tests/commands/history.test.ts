import { describe, expect, test } from 'bun:test';
import { runHistoryCommand } from '../../src/commands/history';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('history command', () => {
    test('no subcommand shows usage', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runHistoryCommand(undefined, ctx, {}, []);
        expect(exitCode).toBe(1);
    });
});
