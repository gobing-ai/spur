/**
 * A94 surface shape (task 1415 R5).
 *
 * The consent for this feature is narrow: every new command is exactly `spur <noun> <verb>`, with
 * only the flags its wave declared. This test builds the real program and asserts both halves, so a
 * later refactor cannot quietly turn a leaf into a nested group or add an unconsumed flag:
 *   - a leaf under its noun (`commands.length === 0`, no nested subcommand group);
 *   - no option outside the consented set plus the shared `--json` / `--json-envelope` /
 *     `--source-root`.
 */
import { describe, expect, test } from 'bun:test';
import type { Command } from '@commander-js/extra-typings';
import { buildProgram } from '../apps/cli/src/index';

/** Shared flags every A94 verb may carry. */
const SHARED = ['json', 'jsonEnvelope', 'sourceRoot', 'help', 'noLogo', 'cliVerbose', 'logo'];

/** One verb, its noun, and the flags its wave consented to. */
const SURFACES: Array<{ noun: string; verb: string; flags: string[] }> = [
    { noun: 'builder', verb: 'bundle-plugins', flags: [] },
    { noun: 'builder', verb: 'bundle-laya-worker', flags: [] },
    { noun: 'builder', verb: 'emit-board-types', flags: [] },
    { noun: 'builder', verb: 'emit-migration-sql', flags: [] },
    { noun: 'builder', verb: 'check-deps', flags: ['scope'] },
    { noun: 'rule', verb: 'check-shims', flags: ['manifest'] },
    { noun: 'rule', verb: 'certify-coverage', flags: ['lcov'] },
    { noun: 'rule', verb: 'check-coverage-cert', flags: ['lcov'] },
    { noun: 'workflow', verb: 'eval', flags: ['fixture', 'runs', 'label', 'keep', 'dryRun'] },
    { noun: 'workflow', verb: 'promote-check', flags: ['candidates', 'workflowsDir', 'db', 'now'] },
    { noun: 'workflow', verb: 'promote-evaluate', flags: ['candidates', 'workflowsDir', 'db', 'now'] },
    { noun: 'workflow', verb: 'promote-resolve', flags: ['decision', 'candidates', 'workflowsDir'] },
    { noun: 'agent', verb: 'doctor-hosts', flags: ['agents', 'out'] },
];

/** Build the program once, without touching a project database or config file. */
function program(): Command {
    const output = { write: () => {}, error: () => {} };
    return buildProgram(
        {
            cwd: process.cwd(),
            env: {},
            output,
            fs: {} as never,
            getDb: async () => {
                throw new Error('surface shape must not open a database');
            },
            setExitCode: () => {},
            loadAgentConfig: async () => null,
        } as never,
        output as never,
    );
}

/** Every option name a command declares (long flags only, commander's internal key). */
function optionNames(command: Command): string[] {
    return command.options.flatMap((option) => {
        const name = (option as unknown as { attributeName(): string; long?: string }).attributeName();
        void (option as unknown as { long?: string }).long;
        return [name];
    });
}

describe('A94 commands are exactly `spur <noun> <verb>`', () => {
    const built = program();

    test.each(SURFACES)('$noun $verb is a leaf under its noun', ({ noun, verb }) => {
        const parent = built.commands.find((command) => command.name() === noun);
        expect(parent, `noun ${noun} is not registered`).toBeDefined();
        const leaf = parent?.commands.find((command) => command.name() === verb);
        expect(leaf, `${noun} ${verb} is not registered`).toBeDefined();
        // A nested group would have children; the surface rule allows none.
        expect(leaf?.commands ?? []).toHaveLength(0);
    });

    test.each(SURFACES)('$noun $verb declares only its consented flags', ({ noun, verb, flags }) => {
        const parent = built.commands.find((command) => command.name() === noun);
        const leaf = parent?.commands.find((command) => command.name() === verb);
        const declared = optionNames(leaf as Command);
        const allowed = new Set([...flags, ...SHARED]);
        expect(declared.filter((name) => !allowed.has(name))).toEqual([]);
    });
});
