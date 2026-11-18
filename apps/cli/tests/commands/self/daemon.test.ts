import { describe, expect, test } from 'bun:test';
import type { FileSystem, ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import { readDaemonStatusOrNull, registerDaemonCommand } from '../../../src/commands/self/daemon';
import type { CliContext } from '../../../src/context';

/**
 * K4 R9/R10 at the CLI boundary: exit codes, `--json` shape, and the "nothing written on refusal"
 * rule. The lifecycle itself (plist bytes, launchctl argv, port/platform refusals) is proven with
 * injected seams in `packages/app/tests/services/gateway-daemon.test.ts`; here the verb is driven
 * through the same seams so no test touches the operator's LaunchAgents.
 */
type ActionFn = (action: string, opts: { port?: number; json?: boolean }) => Promise<void>;

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

function capture(overrides: Parameters<typeof registerDaemonCommand>[2]): {
    action: ActionFn;
    out: string[];
    exit: number[];
} {
    let action: ActionFn | undefined;
    const chain = {
        summary: () => chain,
        argument: () => chain,
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
    registerDaemonCommand({ command: () => chain } as never, context, overrides);
    if (!action) throw new Error('daemon action not registered');
    return { action, out, exit };
}

const DARWIN = {
    platform: 'darwin' as const,
    uid: 501,
    home: '/Users/tester',
    path: '/opt/homebrew/bin:/usr/bin',
    spurArgv: ['/opt/spur'],
    port: 3111,
};

describe('spur self daemon (K4 R9/R10)', () => {
    test('rejects an unknown action with exit 2 and names the valid ones', async () => {
        const { action, out, exit } = capture({
            ...DARWIN,
            fs: memoryFs(),
            exec: fakeExec(),
            probeGateway: async () => 'free',
        });
        await action('explode', {});
        expect(exit).toEqual([2]);
        expect(out.join('')).toContain('install, uninstall or status');
    });

    test('install reports the plist path as JSON', async () => {
        const fs = memoryFs();
        const { action, out, exit } = capture({
            ...DARWIN,
            fs,
            exec: fakeExec([113, 0]),
            probeGateway: async () => 'free',
        });
        await action('install', { json: true });
        expect(exit).toEqual([]);
        const payload = JSON.parse(out.at(-1) ?? '{}');
        expect(payload.ok).toBe(true);
        expect(payload.status).toBe('installed');
        expect(payload.plistPath).toBe('/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist');
        expect(fs.files.has(payload.plistPath)).toBe(true);
    });

    test('install reports the plist path as plain text without --json', async () => {
        const fs = memoryFs();
        const { action, out, exit } = capture({
            ...DARWIN,
            fs,
            exec: fakeExec([113, 0]),
            probeGateway: async () => 'free',
        });
        await action('install', {});
        expect(exit).toEqual([]);
        expect(out.join('')).toContain('Gateway LaunchAgent installed: ');
        expect(fs.files.size).toBe(1);
    });

    test('install failure exits 1 with the reason and writes nothing', async () => {
        const fs = memoryFs();
        const { action, out, exit } = capture({
            ...DARWIN,
            fs,
            exec: fakeExec(),
            probeGateway: async () => 'foreign',
        });
        await action('install', {});
        expect(exit).toEqual([1]);
        expect(out.join('')).toContain('Gateway port 3111 is in use by another process');
        expect(fs.files.size).toBe(0);
    });

    test('readDaemonStatusOrNull omits the daemon off macOS', async () => {
        const result = await readDaemonStatusOrNull('linux');
        expect(result).toBeNull();
    });

    test('readDaemonStatusOrNull reports the daemon on macOS', async () => {
        const plist = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';
        const result = await readDaemonStatusOrNull('darwin', {
            ...DARWIN,
            fs: memoryFs({ [plist]: 'plist', '/opt/spur': '' }),
            exec: fakeExec([0]),
            probeGateway: async () => 'gateway',
        });
        expect(result?.installed).toBe(true);
    });

    test('readDaemonStatusOrNull degrades a failing reader to null', async () => {
        const result = await readDaemonStatusOrNull('darwin', {
            ...DARWIN,
            fs: {
                ...memoryFs(),
                exists: () => {
                    throw new Error('fs down');
                },
            } as unknown as FileSystem,
            exec: fakeExec(),
            probeGateway: async () => 'gateway',
        });
        expect(result).toBeNull();
    });

    test('a non-macOS host exits 1 naming the platform', async () => {
        const { action, out, exit } = capture({
            ...DARWIN,
            platform: 'linux',
            fs: memoryFs(),
            exec: fakeExec(),
            probeGateway: async () => 'free',
        });
        await action('install', { json: true });
        expect(exit).toEqual([1]);
        expect(out.join('')).toContain('linux');
    });

    test('status prints the human summary and the JSON shape', async () => {
        const plist = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';
        const fs = memoryFs({ [plist]: 'plist', '/opt/spur': '' });
        const human = capture({ ...DARWIN, fs, exec: fakeExec([0]), probeGateway: async () => 'gateway' });
        await human.action('status', {});
        expect(human.out.join('\n')).toContain('loaded: true');
        expect(human.out.join('\n')).toContain('gateway health: unreachable');

        const json = capture({ ...DARWIN, fs, exec: fakeExec([0]), probeGateway: async () => 'gateway' });
        await json.action('status', { json: true });
        const payload = JSON.parse(json.out.at(-1) ?? '{}');
        expect(payload.installed).toBe(true);
        expect(payload.loaded).toBe(true);
        expect(payload.binaryExists).toBe(true);
    });

    test('status warns when the plist binary moved, and reports not-installed', async () => {
        const moved = capture({
            ...DARWIN,
            fs: memoryFs({ '/opt/spur': '' }),
            exec: fakeExec([113]),
            probeGateway: async () => 'gateway',
            spurArgv: ['/gone'],
        });
        await moved.action('status', {});
        expect(moved.out.join('\n')).toContain('not installed');

        const missingBinary = capture({
            ...DARWIN,
            spurArgv: ['/gone'],
            fs: memoryFs({ '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist': 'x' }),
            exec: fakeExec([0]),
            probeGateway: async () => 'gateway',
        });
        await missingBinary.action('status', {});
        expect(missingBinary.out.join('\n')).toContain('no longer exists');
    });

    test('uninstall reports removed then absent', async () => {
        const plist = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';
        const fs = memoryFs({ [plist]: 'x' });
        const first = capture({ ...DARWIN, fs, exec: fakeExec([113]), probeGateway: async () => 'free' });
        await first.action('uninstall', { json: true });
        expect(JSON.parse(first.out.at(-1) ?? '{}').status).toBe('removed');
        expect(fs.files.has(plist)).toBe(false);

        const second = capture({ ...DARWIN, fs, exec: fakeExec([113]), probeGateway: async () => 'free' });
        await second.action('uninstall', {});
        expect(second.out.join('')).toContain('was not installed');
    });
});
