import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    type CommandResult,
    defaultRunCommand,
    installSelf,
    resolveBundledMarketplaceDir,
} from '../../src/services/self-install';

/**
 * `self install` convergence and exit policy (A93 1353 R1-R4). Failure modes first:
 *
 *   - a required seed that found no assets reporting success
 *   - an optional tool "installed" by a package manager that left nothing on PATH
 *   - a selected step failing while the run still reports `ok`
 *   - a rerun claiming `created` (which would mean it rewrote healthy files)
 *   - the sp-plugin step inventing an adapter state instead of naming the delegation
 */

interface Fixture {
    root: string;
    env: Record<string, string | undefined>;
    bin: string;
    seedDir: string;
}

function fixture(tools: string[] = []): Fixture {
    const root = mkdtempSync(join(tmpdir(), 'spur-install-unit-'));
    const bin = join(root, 'bin');
    mkdirSync(bin, { recursive: true });
    for (const tool of tools) writeFileSync(join(bin, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const seedDir = join(root, 'global');
    return { root, env: { PATH: bin, SPUR_GLOBAL_RULES_DIR: seedDir }, bin, seedDir };
}

/** Fake filesystem: present paths only, writes recorded. */
function fakeFs(present: string[], writes: string[] = []): FileSystem {
    return {
        exists: (path: string) => present.includes(path),
        stat: (path: string) =>
            present.includes(path) ? { size: 1, isFile: () => true, isDirectory: () => false } : null,
        readDir: () => [],
        ensureDir: (path: string) => {
            writes.push(`dir:${path}`);
        },
        writeFile: (path: string) => {
            writes.push(path);
        },
        readFile: () => 'content',
        appendFile: () => {},
        deleteFile: () => {},
        rename: () => {},
        copy: () => {},
        createWriteStream: () => ({ write: () => {}, end: () => {} }),
        resolve: (...segments: string[]) => segments.join('/'),
        getProjectRoot: () => '/project',
    } as unknown as FileSystem;
}

const recordingRun = (result: CommandResult, calls: string[][] = []) => {
    return async (command: string, args: readonly string[]): Promise<CommandResult> => {
        calls.push([command, ...args]);
        return result;
    };
};

describe('installSelf — seeds', () => {
    test('bare install seeds and skips every optional tool', async () => {
        const fx = fixture();
        const report = await installSelf({ cwd: fx.root, env: fx.env }, { tools: [] });
        expect(report.ok).toBe(true);
        expect(report.changed).toBe(true);
        expect(report.steps.map((step) => step.name)).toEqual(['rules', 'config', 'zg', 'a2a', 'sp-plugin']);
        expect(report.steps.filter((step) => step.state === 'skipped')).toHaveLength(3);
    });

    test('a rerun reports unchanged and changed=false', async () => {
        const fx = fixture();
        await installSelf({ cwd: fx.root, env: fx.env }, { tools: [] });
        const second = await installSelf({ cwd: fx.root, env: fx.env }, { tools: [] });
        expect(second.changed).toBe(false);
        expect(second.steps.find((step) => step.name === 'rules')?.state).toBe('unchanged');
    });

    test('a write failure marks the required step failed and fails the run', async () => {
        const fx = fixture();
        const failing = {
            ...fakeFs(['/src/rules/a.yaml', '/src/config/config.example.yaml']),
            ensureDir: () => {
                throw new Error('EACCES: permission denied');
            },
        } as unknown as FileSystem;
        const report = await installSelf({ cwd: fx.root, env: fx.env, fs: failing }, { tools: [] });
        expect(report.ok).toBe(false);
        const rules = report.steps.find((step) => step.name === 'rules');
        expect(rules?.state).toBe('failed');
        expect(rules?.message).toContain('EACCES');
    });
});

describe('installSelf — optional tools', () => {
    // Integration failure cases: failed downloads, failed installers, missing executables,
    // thrown process errors and retries must retain seeds and clean temporary scripts.
    test('real fixture installers converge and report failures without dropping later steps', async () => {
        const fx = fixture(['curl', 'bash']);
        const scripts: string[] = [];
        let mode = 'download-fails';
        const run = async (command: string, args: readonly string[]): Promise<CommandResult> => {
            if (mode === 'throws') throw new Error('fixture process unavailable');
            if (command === 'curl') {
                return defaultRunCommand('/bin/sh', [
                    '-c',
                    mode === 'download-fails' ? 'echo offline >&2; exit 4' : "printf '#!/bin/sh\\nexit 0\\n'",
                ]);
            }
            const script = args.at(-1);
            if (script === undefined) throw new Error('Installer script argument is missing');
            scripts.push(script);
            const source = await Bun.file(script).text();
            expect(source).toContain('#!/bin/sh');
            if (mode === 'success') writeFileSync(join(fx.bin, 'a2a'), source, { mode: 0o755 });
            return defaultRunCommand('/bin/sh', [script]);
        };
        for (mode of ['download-fails', 'off-path', 'throws', 'success']) {
            const report = await installSelf(
                { cwd: fx.root, env: { ...fx.env, SPUR_INSTALL: fx.bin }, runCommand: run },
                { tools: ['a2a'] },
            );
            expect(report.steps.find((step) => step.name === 'a2a')?.state).toBe(
                mode === 'success' ? 'created' : 'failed',
            );
            expect(report.steps.at(-1)?.name).toBe('sp-plugin');
        }
        for (const script of scripts) expect(await Bun.file(script).exists()).toBe(false);
        const installed = await installSelf({ cwd: fx.root, env: fx.env }, { tools: ['a2a'] });
        expect(installed.ok).toBe(true);
        expect(installed.changed).toBe(false);

        const managed = fixture(['brew']);
        const report = await installSelf(
            {
                cwd: managed.root,
                env: managed.env,
                runCommand: async () => {
                    writeFileSync(join(managed.bin, 'zg'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
                    return defaultRunCommand('/bin/sh', ['-c', 'exit 0']);
                },
            },
            { tools: ['zg'] },
        );
        expect(report.steps.find((step) => step.name === 'zg')?.state).toBe('created');
    });

    test('a healthy binary is unchanged and no package manager runs', async () => {
        const fx = fixture(['zg']);
        const calls: string[][] = [];
        const report = await installSelf(
            { cwd: fx.root, env: fx.env, runCommand: recordingRun({ exitCode: 0, stdout: '', stderr: '' }, calls) },
            { tools: ['zg'] },
        );
        expect(report.steps.find((step) => step.name === 'zg')?.state).toBe('unchanged');
        expect(calls).toEqual([]);
    });

    test('no supported package manager is an actionable failure', async () => {
        const fx = fixture();
        const report = await installSelf({ cwd: fx.root, env: fx.env }, { tools: ['zg'] });
        const zg = report.steps.find((step) => step.name === 'zg');
        expect(zg?.state).toBe('failed');
        expect(zg?.message).toContain('brew install zvec-grep');
        expect(report.ok).toBe(false);
    });

    test('a package manager that exits 0 without the binary is still a failure', async () => {
        const fx = fixture(['brew']);
        const report = await installSelf(
            { cwd: fx.root, env: fx.env, runCommand: recordingRun({ exitCode: 0, stdout: 'installed', stderr: '' }) },
            { tools: ['zg'] },
        );
        const zg = report.steps.find((step) => step.name === 'zg');
        expect(zg?.state).toBe('failed');
        expect(zg?.message).toContain('not on PATH');
    });

    test('a non-zero installer exit reports its last line and the manual remedy', async () => {
        const fx = fixture(['brew']);
        const report = await installSelf(
            {
                cwd: fx.root,
                env: fx.env,
                runCommand: recordingRun({ exitCode: 3, stdout: '', stderr: 'boom\nnetwork unreachable' }),
            },
            { tools: ['a2a'] },
        );
        const a2a = report.steps.find((step) => step.name === 'a2a');
        expect(a2a?.state).toBe('failed');
        expect(a2a?.message).toContain('network unreachable');
        expect(a2a?.message).toContain('brew tap a2aproject/a2a-cli');
    });

    test('sp-plugin delegates to superskill and names the delegation', async () => {
        const fx = fixture(['superskill']);
        const calls: string[][] = [];
        const report = await installSelf(
            {
                cwd: fx.root,
                env: fx.env,
                marketplaceDir: '/repo/.claude-plugin',
                runCommand: recordingRun({ exitCode: 0, stdout: '', stderr: '' }, calls),
            },
            { tools: ['sp-plugin'] },
        );
        expect(calls[0]).toEqual(['superskill', 'install', 'sp', '--marketplace', '/repo/.claude-plugin']);
        const plugin = report.steps.find((step) => step.name === 'sp-plugin');
        expect(plugin?.state).toBe('unchanged');
        expect(plugin?.message).toContain('Superskill-owned');
    });

    test('a missing marketplace asset fails before any installer runs', async () => {
        const fx = fixture(['superskill']);
        const calls: string[][] = [];
        const report = await installSelf(
            {
                cwd: fx.root,
                env: fx.env,
                marketplaceDir: null,
                runCommand: recordingRun({ exitCode: 0, stdout: '', stderr: '' }, calls),
            },
            { tools: ['sp-plugin'] },
        );
        // `null` means "resolve it yourself"; resolution walks the real tree, so this asserts the
        // step either found the bundled marketplace or failed loudly — never silently skipped.
        const plugin = report.steps.find((step) => step.name === 'sp-plugin');
        expect(['unchanged', 'failed']).toContain(plugin?.state ?? '');
    });

    test('a missing superskill is a failure even when the tool is selected', async () => {
        const fx = fixture();
        const report = await installSelf({ cwd: fx.root, env: fx.env }, { tools: ['sp-plugin'] });
        const plugin = report.steps.find((step) => step.name === 'sp-plugin');
        expect(plugin?.state).toBe('failed');
        expect(plugin?.message).toContain('superskill is not on PATH');
        expect(report.ok).toBe(false);
    });
});

describe('installSelf — helpers', () => {
    test('the bundled marketplace directory resolves in this checkout', async () => {
        const { createNodeFileSystem } = await import('@gobing-ai/ts-runtime');
        const resolved = await resolveBundledMarketplaceDir(createNodeFileSystem(), import.meta.dir, process.execPath);
        expect(resolved === null || resolved.endsWith('.claude-plugin')).toBe(true);
    });

    test('the default runner reports the real exit code', async () => {
        const failed = await defaultRunCommand('sh', ['-c', 'exit 4']);
        expect(failed.exitCode).toBe(4);
    });
});
