import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { bannerText, main } from '../../src';
import { noopSetExitCode } from '../../src/context';
import { gitContext } from '../../src/git-context';
import { consoleOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI dispatch and status', () => {
    test('renders help, version, and unknown command output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        // Top-level help is rendered across commander's blocks (Options) plus the
        // domain-grouped command listing appended via addHelpText; join to assert.
        const helpOutput = output.messages.join('\n');
        expect(output.messages.some((m) => m.includes('agent'))).toBe(true);
        expect(helpOutput).toContain('Options:');
        expect(helpOutput).toContain('Commands:');
        // Domain group headers (R5) — guards against a regression to commander's flat list.
        expect(helpOutput).toContain('Harness');
        expect(helpOutput).toContain('Policy');
        expect(helpOutput).toContain('Extension');
        expect(helpOutput).toContain('Project');
        expect(helpOutput).toContain('agent');
        expect(helpOutput).toContain('rule');
        expect(helpOutput).toContain('history');
        expect(helpOutput).toContain('init');
        expect(helpOutput).toContain('--version');
        expect(helpOutput).not.toContain('workspace');
        expect(bannerText()).toContain('___');

        expect(await main(['version'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toMatch(/unknown command/);

        expect(await main(['unknown'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toMatch(/unknown command/i);

        // Commander shows noun names + summaries in top-level help.
        expect(helpOutput).toContain('message');
        expect(helpOutput).toContain('team');
        expect(helpOutput).toContain('agent');
    });

    test('renders command-scoped help for rule commands', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['rule', '--help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        const ruleHelp = output.messages.at(-1);
        expect(ruleHelp).toContain('spur rule');
        expect(ruleHelp).toContain('run');
        expect(ruleHelp).not.toContain('Global options:');

        expect(await main(['rule', 'help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toBe(ruleHelp);

        expect(await main(['help', 'rule'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toBe(ruleHelp);
    });

    test('renders command-scoped help for every existing command', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const commands = [
            'init',
            'status',
            'migrate',
            'agent',
            'message',
            'team',
            'rule',
            'history',
            'workflow',
            'plugin',
        ];

        for (const command of commands) {
            // --help flag
            expect(await main([command, '--help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
            const fromFlag = output.messages.at(-1);
            expect(fromFlag).toContain(command);
            expect(fromFlag).not.toContain('Global options:');

            // top-level help <cmd>
            expect(await main(['help', command], { cwd, output, dbUrl: ':memory:' })).toBe(0);
            expect(output.messages.at(-1)).toBe(fromFlag);
        }
    });

    test('dispatches message and team command groups', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        // message send → enqueue (routed through dispatch).
        expect(
            await main(['message', 'send', '--to', 'planner', 'hi', '--json'], { cwd, output, dbUrl: ':memory:' }),
        ).toBe(0);
        expect(JSON.parse(output.messages.at(-1) ?? '{}').toId).toBe('planner');

        // team status on a specless project routes through dispatch and exits 0.
        expect(await main(['team', 'status'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toMatch(/No agent specs found/);
    });

    test('status reports optional path metadata and missing path errors', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await Bun.write(join(cwd, 'sample.txt'), 'sample');

        expect(await main(['status', 'sample.txt', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        const status = JSON.parse(output.messages.at(-1) ?? '{}') as {
            target: { path: string; size: number; isFile: boolean; isDirectory: boolean };
        };
        expect(status.target).toEqual({ path: 'sample.txt', size: 6, isFile: true, isDirectory: false });

        output.messages.length = 0;
        expect(await main(['status', 'missing.txt'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('path does not exist');
    });

    test('dispatches unknown commands with an explicit context', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['workspace'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toMatch(/unknown command/i);
    });

    test('resolves git context in a repository', async () => {
        const git = await gitContext(new URL('../../../..', import.meta.url).pathname);
        expect(git.root).toContain('spur-new');
    });

    test('console output writes to the process default targets', () => {
        const stdout = createBufferTarget();
        const stderr = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout, stderr });
        try {
            consoleOutput.write('to-stdout');
            consoleOutput.error('to-stderr');
        } finally {
            restore();
        }
        expect(stdout.text()).toBe('to-stdout\n');
        expect(stderr.text()).toBe('to-stderr\n');
    });

    test('noopSetExitCode is callable', () => {
        noopSetExitCode(0);
        noopSetExitCode(1);
    });
});
