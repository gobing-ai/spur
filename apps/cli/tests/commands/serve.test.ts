import { describe, expect, test } from 'bun:test';
import { registerServeCommand } from '../../src/commands/serve';
import type { CliContext } from '../../src/context';

describe('registerServeCommand', () => {
    test('registers without throwing', () => {
        const mockCtx = {
            cwd: '/tmp/test',
            output: { write: () => {}, error: () => {} },
            setExitCode: () => {},
        } as unknown as CliContext;

        // Build a mock commander chain that returns `this` at each step.
        const cmds: string[] = [];
        const chain = {
            summary: function () {
                return this;
            },
            option: function () {
                return this;
            },
            action: (_fn: () => void) => {
                // Don't execute the action — just verify registration
                return chain;
            },
        };

        const mockProgram = {
            command: (name: string) => {
                cmds.push(name);
                return chain;
            },
        };

        expect(() => {
            registerServeCommand(mockProgram as never, mockCtx);
        }).not.toThrow();
        expect(cmds).toContain('serve');
    });
});
