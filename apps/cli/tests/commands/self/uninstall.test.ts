import { describe, expect, test } from 'bun:test';
import type { FileSystem, ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import { registerUninstallCommand } from '../../../src/commands/self/uninstall';
import type { CliContext } from '../../../src/context';

/**
 * The flattened daemon surface: `spur self uninstall` owns the LaunchAgent removal, so the verb has
 * to render the same "removed / was not installed" outcomes the deprecated `self daemon uninstall`
 * produced — proven with the same injected seams (no test touches the operator's LaunchAgents).
 */
type ActionFn = (opts: { port?: number; json?: boolean; daemon?: boolean; with?: string[] }) => Promise<void>;

function memoryFs(initial: Record<string, string> = {}): FileSystem & { files: Map<string, string> } {
    const files = new Map(Object.entries(initial));
    return {
        files,
        exists: (path: string) => files.has(path),
        readFile: (path: string) => files.get(path) ?? '',
        writeFile: (path: string, content: string) => void files.set(path, content),
        appendFile: () => {},
        ensureDir: () => {},
        readDir: () => [],
        deleteFile: (path: string) => void files.delete(path),
        rename: (src: string, dest: string) => {
            files.set(dest, files.get(src) ?? '');
            files.delete(src);
        },
        copy: () => {},
        stat: () => null,
        createWriteStream: () => ({ write: () => {}, end: () => {} }),
    } as unknown as FileSystem & { files: Map<string, string> };
}

function fakeExec(exitCodes: number[] = []): ProcessExecutor {
    return {
        run: async (options: ProcessOptions): Promise<ProcessResult> => ({
            command: options.command,
            args: options.args ?? [],
            exitCode: exitCodes.shift() ?? 0,
            stdout: '',
            stderr: '',
            durationMs: 1,
        }),
        runStreaming: () => {
            throw new Error('unused');
        },
    } as unknown as ProcessExecutor;
}

const PLIST = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';

/**
 * Register the verb and drive it. The host facts (home, platform, exec, fs) are injected through the
 * module-level seam that `runDaemonAction` resolves, so nothing here calls real `launchctl`.
 */
function capture(overrides: {
    fs: FileSystem;
    exec: ProcessExecutor;
    plistExists: boolean;
    platform?: NodeJS.Platform;
}): {
    action: ActionFn;
    out: string[];
    exit: number[];
} {
    let action: ActionFn | undefined;
    const chain = {
        summary: () => chain,
        description: () => chain,
        option: () => chain,
        action: (fn: ActionFn) => {
            action = fn;
            return chain;
        },
    };
    const out: string[] = [];
    const exit: number[] = [];
    const context = {
        cwd: process.cwd(),
        output: {
            write: (m: string) => {
                out.push(m);
            },
            error: (m: string) => {
                out.push(m);
            },
        },
        setExitCode: (code: number) => {
            exit.push(code);
        },
    } as unknown as CliContext;
    const fs = overrides.fs;
    if (!overrides.plistExists) fs.deleteFile(PLIST);
    registerUninstallCommand({ command: () => chain } as never, context, {
        platform: overrides.platform ?? 'darwin',
        uid: 501,
        home: '/Users/tester',
        path: '/opt/homebrew/bin:/usr/bin',
        spurArgv: ['/opt/spur'],
        port: 3111,
        fs: overrides.fs,
        exec: overrides.exec,
        probeGateway: async () => 'free',
    });
    if (!action) throw new Error('uninstall action not registered');
    return { action, out, exit };
}

describe('spur self uninstall (K4 R9/R10 flatter surface)', () => {
    test('removes the LaunchAgent and names the plist it deleted', async () => {
        const fs = memoryFs({ [PLIST]: '<plist/>' });
        const { action, out, exit } = capture({ fs, exec: fakeExec([0, 0]), plistExists: true });
        await action({});
        expect(exit).toEqual([]);
        expect(out.join('\n')).toContain(`Gateway LaunchAgent removed: ${PLIST}`);
        expect(fs.files.has(PLIST)).toBe(false);
    });

    test('reports "not installed" when there is nothing to remove', async () => {
        const fs = memoryFs();
        const { action, out, exit } = capture({ fs, exec: fakeExec([113]), plistExists: false });
        await action({});
        expect(exit).toEqual([]);
        expect(out.join('\n')).toContain('was not installed');
    });

    test('--daemon is accepted as the explicit spelling of the same target', async () => {
        const fs = memoryFs({ [PLIST]: '<plist/>' });
        const { action, out } = capture({ fs, exec: fakeExec([0, 0]), plistExists: true });
        await action({ daemon: true });
        expect(out.join('\n')).toContain('removed');
    });

    test('--json reports the removal as a machine-readable result', async () => {
        const fs = memoryFs({ [PLIST]: '<plist/>' });
        const { action, out, exit } = capture({ fs, exec: fakeExec([0, 0]), plistExists: true });
        await action({ json: true });
        expect(exit).toEqual([]);
        expect(JSON.parse(out.at(-1) ?? '{}')).toMatchObject({ ok: true, action: 'uninstall', status: 'removed' });
    });

    test('a failure exits 1 and names the cause on the error channel', async () => {
        const { action, out, exit } = capture({
            fs: memoryFs(),
            exec: fakeExec(),
            plistExists: false,
            platform: 'linux',
        });
        await action({});
        expect(exit).toEqual([1]);
        expect(out.join('\n')).toMatch(/^Error: /);
    });

    test('a failure under --json is an ok:false result, not a crash', async () => {
        const { action, out, exit } = capture({
            fs: memoryFs(),
            exec: fakeExec(),
            plistExists: false,
            platform: 'linux',
        });
        await action({ json: true });
        expect(exit).toEqual([1]);
        const payload = JSON.parse(out.at(-1) ?? '{}') as { ok: boolean; action: string; error: string };
        expect(payload).toMatchObject({ ok: false, action: 'uninstall' });
        expect(payload.error).not.toBe('');
    });
});

describe('spur self install --daemon (K4 R9/R10 flatter surface)', () => {
    test('runs the machine setup and then the LaunchAgent install', async () => {
        const { registerInstallCommand } = await import('../../../src/commands/self/install');
        const fs = memoryFs({ [PLIST]: '' });
        let action: ActionFn | undefined;
        const chain = {
            summary: () => chain,
            description: () => chain,
            option: () => chain,
            action: (fn: ActionFn) => {
                action = fn;
                return chain;
            },
        };
        const out: string[] = [];
        const exit: number[] = [];
        const context = {
            cwd: process.cwd(),
            env: {},
            fs,
            output: {
                write: (m: string) => {
                    out.push(m);
                },
                error: (m: string) => {
                    out.push(m);
                },
            },
            setExitCode: (code: number) => {
                exit.push(code);
            },
        } as unknown as CliContext;
        registerInstallCommand({ command: () => chain } as never, context, {
            platform: 'darwin',
            uid: 501,
            home: '/Users/tester',
            path: '/usr/bin',
            spurArgv: ['/opt/spur'],
            port: 3111,
            fs,
            exec: fakeExec([113, 0]),
            probeGateway: async () => 'free',
        });
        if (!action) throw new Error('install action not registered');
        await action({ with: [], daemon: true, json: true });
        expect(exit).toEqual([]);
        const daemonLine = out.find((line) => line.includes('"action":"install"') || line.includes('plistPath'));
        expect(daemonLine ?? out.join('\n')).toContain('ai.gobing.spur.gateway.plist');
    });
});
