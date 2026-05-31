import { describe, expect, test } from 'bun:test';
import { runMigrateCommand } from '../../src/commands/migrate';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('migrate command', () => {
    test('runs migration with in-memory db', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runMigrateCommand(ctx, {});
        expect(exitCode).toBe(0);
    });
});
