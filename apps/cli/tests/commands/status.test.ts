import { describe, expect, test } from 'bun:test';
import { runStatusCommand } from '../../src/commands/status';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('status command', () => {
    test('reports project status', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runStatusCommand(ctx, {});
        expect(typeof exitCode).toBe('number');
    });
});
