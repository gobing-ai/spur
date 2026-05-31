import { describe, expect, test } from 'bun:test';
import { runWorkflowCommand } from '../../src/commands/workflow';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('workflow command', () => {
    test('no subcommand shows usage', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runWorkflowCommand(undefined, ctx, {}, []);
        expect(exitCode).toBe(1);
    });
});
