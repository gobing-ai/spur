import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../src/context';
import { buildProgram, main } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * Task 1388 R3/R4 — the five legacy top-level nouns are gone. `self` is the only home for
 * init/maintain/migrate/serve/status, driven through the real commander program.
 */
const output: CommandOutput = { write: () => {}, error: () => {} };

function program() {
    return buildProgram(createCliContext({ output }), output);
}

describe('legacy top-level nouns are removed (task 1388)', () => {
    test('none of the five nouns is registered at the top level', () => {
        const names = program().commands.map((command) => command.name());
        for (const legacy of ['serve', 'status', 'init', 'maintain', 'migrate']) {
            expect(names, legacy).not.toContain(legacy);
        }
    });

    test('`self` still registers all five verbs', () => {
        const self = program().commands.find((command) => command.name() === 'self');
        if (self === undefined) throw new Error('self noun missing');
        const verbs = self.commands.map((command) => command.name());
        for (const verb of ['serve', 'status', 'init', 'maintain', 'migrate']) {
            expect(verbs, verb).toContain(verb);
        }
    });

    test('the CLI entry point rejects retired aliases even on boot-free invocations', async () => {
        for (const argv of [['serve', '--port', 'invalid'], ['status'], ['migrate', '--check']]) {
            let error = '';
            const code = await main([...argv, '--no-logo'], {
                output: {
                    ...output,
                    error: (message) => {
                        error += message;
                    },
                },
            });
            expect(code, argv[0]).toBe(1);
            expect(error, argv[0]).toContain('unknown command');
        }
    });
});
