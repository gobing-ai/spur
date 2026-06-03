import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { bannerText, dispatch, helpText, main } from '../../src';
import { createCliContext } from '../../src/context';
import { gitContext } from '../../src/git-context';
import { consoleOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI dispatch and status', () => {
    test('renders help, version, and unknown command output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toContain('0.1.0');
        expect(output.messages.at(-1)).not.toContain('spur 0.1.0');
        expect(helpText()).toContain('Global options:');
        expect(helpText()).toContain('agent list');
        expect(helpText()).toContain('agent doctor');
        expect(helpText()).toContain('rule validate');
        expect(helpText()).toContain('rule list');
        expect(helpText()).toContain('history report');
        expect(helpText()).not.toContain('--version');
        expect(helpText()).not.toContain('workspace');
        expect(helpText()).not.toContain('inspect');
        expect(bannerText()).toContain('___');
        expect(bannerText()).not.toContain('spur CLI v0.1.0');

        expect(await main(['version'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toBe('0.1.0');

        expect(await main(['unknown'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Unknown command');

        // Team-mode command groups are advertised in help.
        expect(helpText()).toContain('message send');
        expect(helpText()).toContain('team assign');
        expect(helpText()).toContain('agent create');
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

        expect(await main(['status', 'missing.txt'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('path does not exist');
    });

    test('dispatches unknown commands with an explicit context', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const context = createCliContext({ cwd, output, dbUrl: ':memory:' });

        expect(await dispatch(['workspace'], context)).toBe(1);
        expect(output.errors.at(-1)).toContain('Unknown command');
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
});
