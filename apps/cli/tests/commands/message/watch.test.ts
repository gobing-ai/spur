/**
 * G11 1268 — `spur message watch` registers on the message noun.
 *
 * The verb's end-to-end contract lives in the noun-level `tests/commands/message.test.ts`; this
 * module test fails if the command stops registering or loses its summary.
 */
import { describe, expect, test } from 'bun:test';
import { Command } from '@commander-js/extra-typings';
import { registerMessageCommand } from '../../../src/commands/message';
import type { CliContext } from '../../../src/context';

describe('spur message watch', () => {
    test('is registered on the message noun', () => {
        const program = new Command();
        registerMessageCommand(program, {} as CliContext);
        const noun = program.commands[0];
        const names = (noun?.commands ?? []).map((command) => command.name());
        expect(names).toContain('watch');
    });
});
