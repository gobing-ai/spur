import { describe, expect, test } from 'bun:test';
import { runInitCommand } from '../../src/commands/init';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('init command', () => {
    test('initializes project scaffold', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runInitCommand(ctx, {});
        expect(exitCode).toBe(0);
    });
});
