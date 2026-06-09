import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from '@commander-js/extra-typings';
import type { PluginListEntry } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { main } from '../../src';
import { type PluginServiceFactory, registerPluginCommand } from '../../src/commands/plugin';
import type { CliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

interface CapturedOutput {
    output: CommandOutput;
    _output: string[];
    _errors: string[];
}

function makeOutput(): CapturedOutput {
    const output: string[] = [];
    const errors: string[] = [];
    return {
        output: {
            write: (msg: string) => output.push(msg),
            error: (msg: string) => errors.push(msg),
        },
        _output: output,
        _errors: errors,
    };
}

describe('runPluginCommand', () => {
    let tmpDir: string;

    beforeAll(() => {
        tmpDir = join(tmpdir(), `spur-cli-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('list outputs "No plugins" when plugin discovery is deferred', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'list'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(0);
        expect(cap._output.some((l) => l.includes('No plugins'))).toBe(true);
    });

    it('list --json outputs empty JSON array', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'list', '--json'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(0);
        const parsed = JSON.parse(cap._output.join('\n'));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toHaveLength(0);
    });

    it('default verb shows "No plugins" when empty', async () => {
        const cap = makeOutput();
        const code = await main(['plugin'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(0);
        expect(cap._output.some((l) => l.includes('No plugins'))).toBe(true);
    });

    it('info <name> returns "not found" for any name', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'info', 'tcp'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(1);
        expect(cap._errors.some((l) => l.includes('not found'))).toBe(true);
    });

    it('info missing name returns error', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'info'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(1);
    });

    it('info unknown plugin returns error', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'info', 'nope'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(1);
        expect(cap._errors.some((l) => l.includes('not found'))).toBe(true);
    });

    it('default subcommand runs list', async () => {
        const cap = makeOutput();
        const code = await main(['plugin'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(0);
    });

    it('unknown subcommand returns error', async () => {
        const cap = makeOutput();
        const code = await main(['plugin', 'bad'], {
            cwd: tmpDir,
            output: cap.output,
            dbUrl: ':memory:',
        });
        expect(code).toBe(1);
    });
});

// ── Populated-plugin display paths ───────────────────────────────────
//
// PluginService is a deferred no-op stub today (returns []/null), so the
// command's row-rendering branches (default verb, `list` text, `info` found)
// are unreachable through the real service. These tests drive
// registerPluginCommand directly with an injected fake factory, exercising the
// display code that ships and will be reached once discovery is re-enabled
// (ADR-012 amendment 2026-06-09). They encode the intended formatting, not the
// stub's temporary emptiness. Direct injection (not mock.module) keeps the fake
// scoped to this suite — a module mock would leak into the app-layer
// PluginService tests in the same `bun test` run.

const FAKE_ENTRY: PluginListEntry = {
    name: 'tcp',
    version: '1.2.0',
    source: 'local',
    status: 'loaded',
    dir: '/plugins/tcp',
};

function fakeFactory(entries: PluginListEntry[], info: PluginListEntry | null): PluginServiceFactory {
    return () => ({
        list: async () => entries,
        info: async () => info,
    });
}

/** Build a minimal CliContext sufficient for the plugin command's display paths. */
function stubContext(output: CommandOutput, setExitCode: (code: number) => void): CliContext {
    return {
        cwd: process.cwd(),
        env: process.env,
        fs: createNodeFileSystem(),
        output,
        setExitCode,
        getDb: async () => {
            throw new Error('getDb is not used by the plugin command');
        },
    };
}

/** Register the plugin command on a fresh program and run `spur plugin <argv>`. */
async function runPlugin(
    argv: string[],
    factory: PluginServiceFactory,
): Promise<{ out: string[]; err: string[]; code: number }> {
    const out: string[] = [];
    const err: string[] = [];
    let code = 0;
    const output: CommandOutput = { write: (m) => out.push(m), error: (m) => err.push(m) };
    const context = stubContext(output, (c) => {
        code = c;
    });
    const program = new Command();
    program.name('spur').exitOverride();
    registerPluginCommand(program, context, factory);
    await program.parseAsync(['plugin', ...argv], { from: 'user' });
    return { out, err, code };
}

describe('registerPluginCommand — populated', () => {
    it('default verb prints a row per loaded plugin', async () => {
        const { out, code } = await runPlugin([], fakeFactory([FAKE_ENTRY], FAKE_ENTRY));
        expect(code).toBe(0);
        expect(out.some((l) => l.includes('tcp') && l.includes('1.2.0') && l.includes('loaded'))).toBe(true);
    });

    it('list (text) prints a row per loaded plugin', async () => {
        const { out, code } = await runPlugin(['list'], fakeFactory([FAKE_ENTRY], FAKE_ENTRY));
        expect(code).toBe(0);
        expect(out.some((l) => l.includes('tcp') && l.includes('local'))).toBe(true);
    });

    it('list --json emits the populated array', async () => {
        const { out, code } = await runPlugin(['list', '--json'], fakeFactory([FAKE_ENTRY], FAKE_ENTRY));
        expect(code).toBe(0);
        const parsed = JSON.parse(out.join('\n'));
        expect(parsed).toHaveLength(1);
        expect(parsed[0].name).toBe('tcp');
    });

    it('info (text) prints the manifest fields when found', async () => {
        const { out, code } = await runPlugin(['info', 'tcp'], fakeFactory([FAKE_ENTRY], FAKE_ENTRY));
        expect(code).toBe(0);
        expect(out.some((l) => l.includes('Name:') && l.includes('tcp'))).toBe(true);
        expect(out.some((l) => l.includes('Path:') && l.includes('/plugins/tcp'))).toBe(true);
    });

    it('info --json emits the entry when found', async () => {
        const { out, code } = await runPlugin(['info', 'tcp', '--json'], fakeFactory([FAKE_ENTRY], FAKE_ENTRY));
        expect(code).toBe(0);
        const parsed = JSON.parse(out.join('\n'));
        expect(parsed.name).toBe('tcp');
        expect(parsed.dir).toBe('/plugins/tcp');
    });
});
