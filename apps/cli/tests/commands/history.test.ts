import { describe, expect, test } from 'bun:test';
import { runHistoryCommand } from '../../src/commands/history';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput } from '../helpers';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('history command', () => {
    test('no subcommand shows usage', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runHistoryCommand(undefined, ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('report is exposed as a temporary TODO marker', async () => {
        const output = createCapturedOutput();
        const ctx = createCliContext({ output });

        expect(await runHistoryCommand('report', ctx, {}, [])).toBe(0);
        expect(output.messages.at(-1)).toContain('TODO: spur history report');
    });
});
