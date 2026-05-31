import { describe, expect, test } from 'bun:test';
import { runRuleCommand } from '../../src/commands/rule';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('rule command', () => {
    test('unknown subcommand returns error', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('unknown-cmd', ctx, {}, ['.']);
        expect(exitCode).toBe(1);
    });

    test('rule run with preset works', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runRuleCommand('run', ctx, { preset: 'recommended' }, ['.']);
        // May pass or fail depending on findings, but should not throw
        expect(typeof exitCode).toBe('number');
    });
});
