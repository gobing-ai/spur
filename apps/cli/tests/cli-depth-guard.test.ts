import { describe, expect, test } from 'bun:test';
import { createCliContext } from '../src/context';
import { buildProgram } from '../src/index';
import type { CommandOutput } from '../src/output';

/**
 * Task 1290 R5 — every public command is `spur <noun> <verb>`: no visible command may sit at depth ≥3.
 * The only depth-3 commands allowed are the hidden one-release deprecated shims listed below; drop an
 * entry when its shim is removed. The tree under test is the dispatcher's own `buildProgram`, `self`
 * included, so a newly nested verb fails here the moment it lands.
 */
const SHIM_ALLOWLIST = new Set([
    'agent dogfood gate',
    'agent dogfood validate-report',
    'workflow commit-guard start',
    'workflow commit-guard stage',
    'workflow commit-guard check',
]);

interface CmdLike {
    name(): string;
    commands: CmdLike[];
    _hidden?: boolean;
}

function deepCommands(): Array<{ path: string; hidden: boolean }> {
    const output: CommandOutput = { write: () => {}, error: () => {} };
    const program = buildProgram(createCliContext({ output }), output) as unknown as CmdLike;
    const found: Array<{ path: string; hidden: boolean }> = [];
    const walk = (cmd: CmdLike, path: string[], hidden: boolean): void => {
        for (const sub of cmd.commands) {
            const next = [...path, sub.name()];
            const subHidden = hidden || sub._hidden === true;
            if (next.length >= 3) found.push({ path: next.join(' '), hidden: subHidden });
            walk(sub, next, subHidden);
        }
    };
    walk(program, [], false);
    return found;
}

describe('CLI two-level depth guard (task 1290 R5)', () => {
    const deep = deepCommands();

    test('no visible command sits at depth ≥3', () => {
        expect(deep.filter((c) => !c.hidden).map((c) => c.path)).toEqual([]);
    });

    test('hidden depth-3 commands are only the allow-listed deprecated shims', () => {
        expect(deep.filter((c) => c.hidden && !SHIM_ALLOWLIST.has(c.path)).map((c) => c.path)).toEqual([]);
    });
});
