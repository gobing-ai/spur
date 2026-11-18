import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../../../src/context';
import { buildProgram } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * Task 1387 R3 — the deprecated `spur self daemon <action>` alias is gone. Driven through the real
 * commander program (`buildProgram`), so the assertion is the CLI's own unknown-command path, not a
 * stub: no deprecation notice, no hidden verb, one spelling per action.
 */
function program() {
    const out: string[] = [];
    const output: CommandOutput = {
        write: (message: string) => {
            out.push(message);
        },
        error: (message: string) => {
            out.push(message);
        },
    };
    const context = createCliContext({ output });
    // Commander writes its own errors to stderr and sets exitCode; capture both.
    const errors: string[] = [];
    const previous = process.exitCode;
    const restore = () => {
        process.exitCode = previous;
    };
    return { built: buildProgram(context, output), out, errors, restore };
}

describe('spur self daemon — removed (task 1387)', () => {
    test('the alias is not registered on the self noun', () => {
        const { built, restore } = program();
        try {
            const self = built.commands.find((command) => command.name() === 'self');
            if (self === undefined) throw new Error('self noun missing');
            expect(self.commands.map((command) => command.name())).not.toContain('daemon');
        } finally {
            restore();
        }
    });

    test('`spur self daemon status` is an unknown command', async () => {
        const { built } = program();
        // Commander's unknown-command path throws for a debug-style invocation.
        let message = '';
        try {
            await built.parseAsync(['node', 'spur', 'self', 'daemon', 'status'], { from: 'node' });
        } catch (error) {
            message = error instanceof Error ? error.message : String(error);
        }
        process.exitCode = 0;
        expect(message).toContain('unknown command');
        expect(message).toContain('daemon');
    });
});
