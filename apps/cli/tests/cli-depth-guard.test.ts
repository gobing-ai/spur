import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * Task 1290 R5 — every public command is `spur <noun> <verb>`: no command, hidden or visible, may sit at
 * depth ≥3. The tree under test is the dispatcher's own `buildProgram`, `self` included, so a newly nested
 * verb fails here the moment it lands.
 */

interface CmdLike {
    name(): string;
    commands: CmdLike[];
}

function deepCommands(): string[] {
    const output: CommandOutput = { write: () => {}, error: () => {} };
    const program = buildProgram(createCliContext({ output }), output) as unknown as CmdLike;
    const found: string[] = [];
    const walk = (cmd: CmdLike, path: string[]): void => {
        for (const sub of cmd.commands) {
            const next = [...path, sub.name()];
            if (next.length >= 3) found.push(next.join(' '));
            walk(sub, next);
        }
    };
    walk(program, []);
    return found;
}

describe('CLI two-level depth guard (task 1290 R5)', () => {
    test('no command, hidden or visible, sits at depth ≥3', () => {
        expect(deepCommands()).toEqual([]);
    });
});
