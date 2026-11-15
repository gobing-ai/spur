import { describe, expect, test } from 'bun:test';
import { Help } from 'commander';
import { createCliContext } from '../../../src/context';
import { buildProgram } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * Task 1335 R1/R2 / ADR-148: the fleet plumbing verbs are hidden from default `spur agent --help`
 * (they are called by hooks, skills and guests — never typed by a user dispatching work), while
 * staying registered: the verb runs unchanged and `<verb> --help` still prints its help.
 *
 * Visibility is asserted through commander's own `Help.visibleCommands` — the list the help text is
 * rendered from — never by scanning prose (descriptions legitimately contain the words "report" and
 * "wait").
 *
 * `loop` is the existing precedent; these four join it.
 */
const PLUMBING = ['join', 'leave', 'wait', 'report', 'loop'] as const;
const DAILY = ['run', 'list', 'status', 'doctor', 'trace', 'start', 'stop', 'usage'] as const;

interface CmdLike {
    name(): string;
    helpInformation(): string;
    description(): string;
    commands: CmdLike[];
}

function agentCommand(): CmdLike {
    const output: CommandOutput = { write: () => {}, error: () => {} };
    const program = buildProgram(createCliContext({ output }), output) as unknown as CmdLike;
    const agent = program.commands.find((command) => command.name() === 'agent');
    if (agent === undefined) throw new Error('spur agent is not registered');
    return agent;
}

function visibleVerbNames(agent: CmdLike): string[] {
    // biome-ignore lint/suspicious/noExplicitAny: commander's Help type is not exported structurally.
    return new Help().visibleCommands(agent as any).map((command) => command.name());
}

describe('spur agent — fleet plumbing verb visibility (1335)', () => {
    test('R1: default help lists the daily verbs and omits the plumbing ones', () => {
        const visible = visibleVerbNames(agentCommand());
        for (const verb of PLUMBING) expect(visible).not.toContain(verb);
        for (const verb of DAILY) expect(visible).toContain(verb);
    });

    test('R1: the rendered help text carries no plumbing row', () => {
        const help = agentCommand().helpInformation();
        // A listed verb occupies its own row right after the indentation; a description
        // mentioning "report" or "wait" does not start a row.
        for (const verb of PLUMBING) {
            expect(new RegExp(`^\\s{2}${verb}(\\s|\\[|$)`, 'm').test(help)).toBe(false);
        }
    });

    test('R2: every hidden verb stays registered and keeps its own help and description', () => {
        const agent = agentCommand();
        for (const verb of PLUMBING) {
            const sub = agent.commands.find((command) => command.name() === verb);
            expect(sub).toBeDefined();
            // Hiding is not removal: the help path and the description are unchanged.
            expect(sub?.helpInformation()).toContain('Usage:');
            expect((sub?.description() ?? '').length).toBeGreaterThan(0);
        }
    });
});
