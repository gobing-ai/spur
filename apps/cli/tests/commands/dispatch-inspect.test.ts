import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch, helpText, main } from '../../src';
import { createCliContext } from '../../src/context';
import { gitContext } from '../../src/git-context';
import { consoleOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

describe('CLI dispatch and inspect', () => {
    test('renders help, version, and unknown command output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toContain('spur 0.1.0');
        expect(helpText()).toContain('workspace add');

        expect(await main(['version'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        expect(output.messages.at(-1)).toBe('0.1.0');

        expect(await main(['unknown'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('Unknown command');
    });

    test('inspects files and reports missing file errors', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        await Bun.write(join(cwd, 'sample.txt'), 'sample');

        expect(await main(['inspect', 'sample.txt', '--json'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        const inspected = JSON.parse(output.messages.at(-1) ?? '{}') as {
            path: string;
            size: number;
            isFile: boolean;
            isDirectory: boolean;
        };
        expect(inspected).toEqual({ path: 'sample.txt', size: 6, isFile: true, isDirectory: false });

        expect(await main(['inspect', 'missing.txt'], { cwd, output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.at(-1)).toContain('file does not exist');
    });

    test('dispatches with an explicit context', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const context = createCliContext({ cwd, output, dbUrl: ':memory:' });

        expect(await dispatch(['workspace'], context)).toBe(0);
        expect(output.messages.at(-1)).toBe('No workspaces registered');
    });

    test('resolves git context in a repository', async () => {
        const git = await gitContext(new URL('../../../..', import.meta.url).pathname);
        expect(git.root).toContain('spur-new');
    });

    test('exposes console output implementation', () => {
        expect(() => consoleOutput.write('')).not.toThrow();
        expect(() => consoleOutput.error('')).not.toThrow();
    });
});
