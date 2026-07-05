import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { bannerText, main, runCli } from '../../src';
import { noopSetExitCode } from '../../src/context';
import { gitContext } from '../../src/git-context';
import { consoleOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI dispatch and status', () => {
    test('renders help, version, and unknown command output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        // Top-level help is rendered by commander's standard flat command list.
        // All 10 nouns appear alphabetically under "Commands:".
        const helpOutput = output.messages.join('\n');
        expect(output.messages.some((m) => m.includes('agent'))).toBe(true);
        expect(helpOutput).toContain('Options:');
        expect(helpOutput).toContain('Commands:');
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
        const commands = ['init', 'status', 'migrate', 'agent', 'message', 'team', 'rule', 'history', 'workflow'];

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
        // Resolve the repo root (4 levels up: commands → tests → cli → apps → repo root).
        const repoRoot = `${import.meta.dir}/../../../..`;
        const git = await gitContext(repoRoot);
        expect(git.root).not.toBeNull();
        expect(git.root).toBeString();
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

    test('runCli returns exit code from main', async () => {
        // runCli() writes the banner + delegates to main() with process.argv.
        // Under `bun test`, process.argv has no spur command, so Commander falls
        // through to top-level help. Redirect consoleOutput so neither the banner
        // nor the help text leaks into the test runner's stdout.
        const stdout = createBufferTarget();
        const stderr = createBufferTarget();
        const restore = setDefaultOutputTargets({ stdout, stderr });
        try {
            const exitCode = await runCli();
            // runCli delegates to main() with process.argv.
            expect(typeof exitCode).toBe('number');
        } finally {
            restore();
        }
    });

    test('noopSetExitCode is callable', () => {
        noopSetExitCode(0);
        noopSetExitCode(1);
    });
});
