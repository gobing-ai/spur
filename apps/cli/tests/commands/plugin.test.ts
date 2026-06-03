import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeLogger } from '@gobing-ai/ts-infra';
import { type FileSystem, NodeFileSystem } from '@gobing-ai/ts-runtime';
import { runPluginCommand } from '../../src/commands/plugin';
import type { CliContext } from '../../src/context';

type TestCtx = CliContext & { _output: string[]; _errors: string[] };

function makeContext(cwd: string, fsOverride?: FileSystem): TestCtx {
    const output: string[] = [];
    const errors: string[] = [];
    const fs = fsOverride ?? new NodeFileSystem();
    return {
        cwd,
        env: process.env as Record<string, string | undefined>,
        fs,
        output: {
            write: (msg: string) => output.push(msg),
            error: (msg: string) => errors.push(msg),
        } as CliContext['output'],
        getDb: async () => {
            throw new Error('db not available in test');
        },
        _output: output,
        _errors: errors,
    } as TestCtx;
}

function setupPluginDir(base: string): void {
    const dir = join(base, '.spur', 'plugins', 'tcp');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.yaml'), 'name: tcp\nversion: 1.0.0\ntrust: local\n');
}

function mockModuleLoader(): (id: string) => Promise<Record<string, unknown>> {
    return async () => ({ default: { name: 'tcp', version: '1.0.0', trust: 'local', onLoad() {} } });
}

describe('runPluginCommand', () => {
    let tmpDir: string;
    let load: (id: string) => Promise<Record<string, unknown>>;

    beforeAll(() => {
        initializeLogger('error');
        load = mockModuleLoader();
        tmpDir = join(tmpdir(), `spur-cli-${randomUUID()}`);
        mkdirSync(tmpDir, { recursive: true });
        setupPluginDir(tmpDir);
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
        initializeLogger('info');
    });

    it('list outputs plugin entries', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('list', ctx, {}, [], load);
        expect(code).toBe(0);
        expect(ctx._output.some((l) => l.includes('tcp'))).toBe(true);
    });

    it('list --json outputs valid JSON', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('list', ctx, { json: true }, [], load);
        expect(code).toBe(0);
        const parsed = JSON.parse(ctx._output.join('\n'));
        expect(Array.isArray(parsed)).toBe(true);
    });

    it('list shows "No plugins" when empty', async () => {
        const empty = join(tmpdir(), `spur-empty-${randomUUID()}`);
        mkdirSync(empty, { recursive: true });
        const ctx = makeContext(empty);
        const code = await runPluginCommand('list', ctx, {}, [], load);
        expect(code).toBe(0);
        expect(ctx._output.some((l) => l.includes('No plugins'))).toBe(true);
        rmSync(empty, { recursive: true, force: true });
    });

    it('list handles broken readFile (error path)', async () => {
        const realFs = new NodeFileSystem();
        const brokenFs = Object.create(realFs) as FileSystem;
        brokenFs.readFile = async () => {
            throw new Error('INJECTED ERROR');
        };
        const ctx = makeContext(tmpDir, brokenFs);
        const code = await runPluginCommand('list', ctx, {}, [], load);
        expect(code).toBe(1);
        expect(ctx._errors.some((l) => l.includes('INJECTED ERROR'))).toBe(true);
    });

    it('info <name> shows details', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('info', ctx, {}, ['tcp'], load);
        expect(code).toBe(0);
        expect(ctx._output.some((l) => l.includes('tcp'))).toBe(true);
    });

    it('info <name> --json outputs valid JSON', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('info', ctx, { json: true }, ['tcp'], load);
        expect(code).toBe(0);
        const parsed = JSON.parse(ctx._output.join('\n'));
        expect(parsed.name).toBe('tcp');
    });

    it('info handles broken readFile (error path)', async () => {
        const realFs = new NodeFileSystem();
        const brokenFs = Object.create(realFs) as FileSystem;
        brokenFs.readFile = async () => {
            throw new Error('DISK FAILURE');
        };
        const ctx = makeContext(tmpDir, brokenFs);
        const code = await runPluginCommand('info', ctx, {}, ['tcp'], load);
        expect(code).toBe(1);
        expect(ctx._errors.some((l) => l.includes('DISK FAILURE'))).toBe(true);
    });

    it('info missing name returns error', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('info', ctx, {}, [], load);
        expect(code).toBe(1);
    });

    it('info unknown plugin returns error', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('info', ctx, {}, ['nope'], load);
        expect(code).toBe(1);
        expect(ctx._errors.some((l) => l.includes('not found'))).toBe(true);
    });

    it('default subcommand runs list', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand(undefined, ctx, {}, [], load);
        expect(code).toBe(0);
    });

    it('unknown subcommand returns error', async () => {
        const ctx = makeContext(tmpDir);
        const code = await runPluginCommand('bad', ctx, {}, [], load);
        expect(code).toBe(1);
    });
});
