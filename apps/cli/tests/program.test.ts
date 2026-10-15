/** PR-L lazy CLI loading — noun scoping and the shared root program. */

import { describe, expect, test } from 'bun:test';
import { CLI_CONFIG } from '../src/config';
import { createCliContext } from '../src/context';
import type { CommandOutput } from '../src/output';
import { buildProgram, createRootProgram, REGISTRATION_STEPS, resolveRegistrationScope } from '../src/program';

const silent: CommandOutput = { write: () => {}, error: () => {} };
const names = (program: { commands: readonly { name(): string }[] }) => program.commands.map((cmd) => cmd.name());

describe('resolveRegistrationScope', () => {
    test('narrows to a known noun, skipping value-less global flags', () => {
        expect(resolveRegistrationScope(['task', 'show', '0001'])).toBe('task');
        expect(resolveRegistrationScope(['--no-logo', '-v', 'workflow', 'run'])).toBe('workflow');
        expect(resolveRegistrationScope(['--cli-verbose', 'self', 'status'])).toBe('self');
        expect(resolveRegistrationScope(['init', '--name', 'x'])).toBe('init');
    });

    test('widens to the full tree for root help, help, version, unknown nouns and unknown flags', () => {
        for (const argv of [
            [],
            ['--help'],
            ['-h', 'task'],
            ['help', 'task'],
            ['--version'],
            ['nope'],
            ['--', 'task'],
            ['-x', 'task'],
        ]) {
            expect(resolveRegistrationScope(argv)).toBeNull();
        }
    });
});

describe('buildProgram', () => {
    const context = createCliContext({ output: silent });

    test('without argv registers every step in order (the tree root help renders)', async () => {
        const program = await buildProgram(context, silent);
        expect(names(program)).toEqual(REGISTRATION_STEPS.map((step) => step.noun));
        const self = program.commands.find((cmd) => cmd.name() === 'self');
        expect(self?.commands.map((cmd) => cmd.name())).toEqual([
            'init',
            'maintain',
            'migrate',
            'serve',
            'status',
            'hook',
        ]);
    });

    test('a noun invocation registers only that noun', async () => {
        expect(names(await buildProgram(context, silent, ['task', 'list']))).toEqual(['task']);
        expect(names(await buildProgram(context, silent, ['--no-logo', 'self', 'status']))).toEqual(['self']);
        expect(names(await buildProgram(context, silent, ['status']))).toEqual(['status']);
    });

    test('an unknown noun loads the full tree so suggestions see every sibling', async () => {
        expect(names(await buildProgram(context, silent, ['tsak']))).toHaveLength(REGISTRATION_STEPS.length);
    });
});

describe('createRootProgram', () => {
    test('owns the version and the global options, and prints through the injected output', async () => {
        const lines: string[] = [];
        const program = createRootProgram({ write: (m) => lines.push(m), error: (m) => lines.push(m) });
        expect(program.options.map((option) => option.long)).toEqual(['--version', '--cli-verbose', '--no-logo']);
        await expect(program.parseAsync(['--version'], { from: 'user' })).rejects.toMatchObject({ exitCode: 0 });
        expect(lines.join('').trim()).toBe(CLI_CONFIG.binaryVersion);
    });
});
