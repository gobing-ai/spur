import { describe, expect, test } from 'bun:test';
import { runInspectCommand } from '../../src/commands/inspect';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('inspect command', () => {
    test('throws on missing file path', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        await expect(runInspectCommand(ctx, {}, [])).rejects.toThrow('inspect requires a file path');
    });
});
