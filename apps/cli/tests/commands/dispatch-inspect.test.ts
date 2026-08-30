import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createBufferTarget, setDefaultOutputTargets } from '@gobing-ai/ts-utils';
import { bannerText, main, runCli, shouldRenderBanner } from '../../src';
import { noopSetExitCode } from '../../src/context';
import { gitContext } from '../../src/git-context';
import { consoleOutput } from '../../src/output';
import { createCapturedOutput, createTempProject, runCli as runCliSubprocess } from '../helpers';

describe('CLI dispatch and status', () => {
    test('renders help, version, and unknown command output', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        // Top-level help is rendered by commander's standard flat command list.
        // The visible noun groups appear under "Commands:"; the legacy standalone nouns
        // (init/migrate/serve/status) are hidden aliases over `spur self <verb>`.
        const helpOutput = output.messages.join('\n');
        expect(output.messages.some((m) => m.includes('agent'))).toBe(true);
        expect(helpOutput).toContain('Options:');
        expect(helpOutput).toContain('Commands:');
        expect(helpOutput).toContain('agent');
        expect(helpOutput).toContain('rule');
        expect(helpOutput).toContain('history');
        expect(helpOutput).toContain('self');
        expect(helpOutput).toContain('--version');
        expect(helpOutput).not.toContain('workspace');
        // The four legacy standalone nouns are hidden from the top-level listing.
        expect(helpOutput).not.toContain('spur init');
        expect(helpOutput).not.toContain('spur migrate');
        expect(helpOutput).not.toContain('spur serve');
        expect(helpOutput).not.toContain('spur status');
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
        // init so .spur/config.yaml exists — status.ok is Spur-config health
        await main(['init', '--name', 'fixture'], { cwd, output, dbUrl: ':memory:' });
        output.messages.length = 0;
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

describe('startup banner policy (A31/0719)', () => {
    const bannerFirstLine =
        bannerText()
            .split('\n')
            .find((line) => line.trim() !== '') ?? '';

    test('shouldRenderBanner is exact-token: suppression tokens match, near-misses do not (R2/R5)', () => {
        // Default human mode renders.
        expect(shouldRenderBanner([])).toBe(true);
        expect(shouldRenderBanner(['task', 'show', '0719'])).toBe(true);
        // Each exact suppression token wins, wherever it sits.
        for (const token of ['--no-logo', '--json', '--quiet', '--silent']) {
            expect(shouldRenderBanner([token])).toBe(false);
            expect(shouldRenderBanner([token, 'task', 'show', '0719'])).toBe(false);
            expect(shouldRenderBanner(['task', 'show', '0719', token])).toBe(false);
        }
        // Similar tokens are NOT suppression tokens — logo stays on.
        for (const nearMiss of [
            '--no-logos',
            '--no_logo',
            '--no-logo=1',
            '--NO-LOGO',
            '--jsonx',
            '--JSON',
            '--quietly',
            '--silent=1',
        ]) {
            expect(shouldRenderBanner([nearMiss])).toBe(true);
        }
    });

    test('root help lists --no-logo exactly once, and the option is accepted before and after the command path (R1)', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();

        expect(await main(['help'], { cwd, output, dbUrl: ':memory:' })).toBe(0);
        const helpOutput = output.messages.join('\n');
        expect(helpOutput.match(/--no-logo/g)).toHaveLength(1);
        // main() itself never renders the banner (R4 programmatic contract).
        expect(helpOutput).not.toContain(bannerFirstLine);

        // Placement: accepted as a root option both before and after nested tokens.
        expect(await main(['--no-logo', 'help'], { cwd, output: createCapturedOutput(), dbUrl: ':memory:' })).toBe(0);
        expect(await main(['help', '--no-logo'], { cwd, output: createCapturedOutput(), dbUrl: ':memory:' })).toBe(0);
    });

    test('runCli renders the banner once by default; exact --no-logo suppresses it with output and exit status unchanged (R2/R4)', async () => {
        const dir = await createTempProject();
        try {
            await runCliSubprocess(['init', '--name', 'fixture'], dir);
            // Human mode: the logo renders exactly once before command output.
            const human = await runCliSubprocess(['status'], dir);
            expect(human.code).toBe(0);
            expect(human.stdout.split(bannerFirstLine)).toHaveLength(2);

            // Explicit suppression: logo absent, command output and exit code intact.
            const suppressed = await runCliSubprocess(['status', '--no-logo'], dir);
            expect(suppressed.code).toBe(0);
            expect(suppressed.stdout).not.toContain(bannerFirstLine);
            expect(suppressed.stdout.length).toBeGreaterThan(0);
        } finally {
            await Bun.spawn(['rm', '-rf', dir]).exited;
        }
    });

    test('runCli keeps --json stdout JSON-first, including early config failures (R3)', async () => {
        // Automatic suppression on a healthy project: stdout begins with the JSON document.
        const dir = await createTempProject();
        try {
            await runCliSubprocess(['init', '--name', 'fixture'], dir);
            const ok = await runCliSubprocess(['status', '--json'], dir);
            expect(ok.code).toBe(0);
            expect(ok.stdout.startsWith('{')).toBe(true);
            expect(ok.stdout).not.toContain(bannerFirstLine);
        } finally {
            await Bun.spawn(['rm', '-rf', dir]).exited;
        }

        // Early config failure: the JSON error envelope is the first stdout byte — no banner.
        const broken = await createTempProject();
        await Bun.write(join(broken, '.spur', 'config.yaml'), 'this is: not: valid: yaml: [unclosed\n');
        try {
            const failing = await runCliSubprocess(['status', '--json'], broken);
            expect(failing.code).not.toBe(0);
            expect(failing.stdout.startsWith('{')).toBe(true);
            expect(failing.stdout).not.toContain(bannerFirstLine);
            const envelope = JSON.parse(failing.stdout) as { error?: { code?: string } };
            expect(envelope.error?.code).toBe('config');
        } finally {
            await Bun.spawn(['rm', '-rf', broken]).exited;
        }
    });
});
