import { describe, expect, test } from 'bun:test';
import { runAgentCommand } from '../../src/commands/agent';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('agent command', () => {
    test('unknown subcommand returns error', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('list subcommand returns exit code', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('list', ctx, {}, []);
        expect(typeof exitCode).toBe('number');
    });
});
