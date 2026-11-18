import { describe, expect, test } from 'bun:test';
import type { FileSystem, ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import { readDaemonStatusOrNull, runDaemonAction } from '../../../src/commands/self/shared';
import type { CliContext } from '../../../src/context';

/**
 * The daemon helpers that survive the alias removal (task 1387). `spur self daemon <action>` is
 * gone — `daemon-removed.test.ts` asserts that through the real commander program; the lifecycle
 * itself is proven in `packages/app/tests/services/gateway-daemon.test.ts` and the flat verbs'
 * own tests (`install.test.ts`, `uninstall.test.ts`, `status.e2e.test.ts`).
 */
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

const DARWIN = {
    platform: 'darwin' as const,
    uid: 501,
    home: '/Users/tester',
    path: '/opt/homebrew/bin:/usr/bin',
    spurArgv: ['/opt/spur'],
    port: 3111,
};

describe('daemon helpers (K4 R9/R10)', () => {
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
});

/**
 * The three flat verbs share one action function (`install --daemon`, `uninstall`, `status`). The
 * commander alias that used to drive it is gone, so the action is covered directly here — the exit
 * code, the `--json` shape and the "nothing written on refusal" rule are still proven.
 */
describe('runDaemonAction (K4 R9/R10, direct)', () => {
    const capture = () => {
        const out: string[] = [];
        return {
            out,
            context: {
                output: {
                    write: (m: string) => {
                        out.push(m);
                    },
                    error: (m: string) => {
                        out.push(m);
                    },
                },
            } as unknown as CliContext,
        };
    };

    test('install reports the plist path as JSON', async () => {
        const fs = memoryFs();
        const { out, context } = capture();
        const { exitCode } = await runDaemonAction(
            'install',
            context,
            { json: true },
            {
                ...DARWIN,
                fs,
                exec: fakeExec(),
                probeGateway: async () => 'free',
            },
        );
        expect(exitCode).toBe(0);
        expect(JSON.parse(out.join('')).ok).toBe(true);
        expect(fs.files.size).toBeGreaterThan(0);
    });

    test('install refusal writes nothing and exits 1', async () => {
        const fs = memoryFs();
        const { out, context } = capture();
        const { exitCode } = await runDaemonAction(
            'install',
            context,
            {},
            {
                ...DARWIN,
                platform: 'linux',
                fs,
                exec: fakeExec(),
                probeGateway: async () => 'free',
            },
        );
        expect(exitCode).toBe(1);
        expect(out.join('')).toContain('linux');
        expect(fs.files.size).toBe(0);
    });

    test('status renders the human summary and the JSON shape', async () => {
        const plist = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';
        const fs = memoryFs({ [plist]: 'plist', '/opt/spur': '' });
        const json = capture();
        const status = await runDaemonAction(
            'status',
            json.context,
            { json: true },
            {
                ...DARWIN,
                fs,
                exec: fakeExec([0]),
                probeGateway: async () => 'gateway',
            },
        );
        expect(status.exitCode).toBe(0);
        expect(JSON.parse(json.out.join('')).action).toBe('status');

        const human = capture();
        await runDaemonAction(
            'status',
            human.context,
            {},
            {
                ...DARWIN,
                fs,
                exec: fakeExec([0]),
                probeGateway: async () => 'gateway',
            },
        );
        expect(human.out.join('')).toContain('LaunchAgent:');
    });

    test('uninstall reports removed then absent', async () => {
        const plist = '/Users/tester/Library/LaunchAgents/ai.gobing.spur.gateway.plist';
        const fs = memoryFs({ [plist]: 'plist', '/opt/spur': '' });
        const first = capture();
        const removed = await runDaemonAction(
            'uninstall',
            first.context,
            {},
            {
                ...DARWIN,
                fs,
                exec: fakeExec([0, 0]),
                probeGateway: async () => 'free',
            },
        );
        expect(removed.exitCode).toBe(0);
        expect(first.out.join('')).toMatch(/removed|not installed/i);

        const second = capture();
        const absent = await runDaemonAction(
            'uninstall',
            second.context,
            { json: true },
            {
                ...DARWIN,
                fs: memoryFs(),
                exec: fakeExec([0, 0]),
                probeGateway: async () => 'free',
            },
        );
        expect(absent.exitCode).toBe(0);
        expect(JSON.parse(second.out.join('')).ok).toBe(true);
    });
});

describe('runDaemonAction — remaining branches', () => {
    const capture = () => {
        const out: string[] = [];
        return {
            out,
            context: {
                output: {
                    write: (m: string) => {
                        out.push(m);
                    },
                    error: (m: string) => {
                        out.push(m);
                    },
                },
            } as unknown as CliContext,
        };
    };

    test('status on an uninstalled daemon names the plist and stays exit 0', async () => {
        const { out, context } = capture();
        const result = await runDaemonAction(
            'status',
            context,
            {},
            {
                ...DARWIN,
                fs: memoryFs(),
                exec: fakeExec([0]),
                probeGateway: async () => 'free',
            },
        );
        expect(result.exitCode).toBe(0);
        expect(out.join('')).toContain('not installed');
    });

    const throwingExec = () =>
        ({
            run: async () => {
                throw new Error('probe exploded');
            },
            runStreaming: () => {
                throw new Error('unused');
            },
        }) as unknown as ProcessExecutor;

    test('a failing service call exits 1 and renders the JSON error shape', async () => {
        const { out, context } = capture();
        const result = await runDaemonAction(
            'status',
            context,
            { json: true },
            {
                ...DARWIN,
                fs: memoryFs(),
                exec: throwingExec(),
                probeGateway: async () => 'free',
            },
        );
        expect(result.exitCode).toBe(1);
        const parsed = JSON.parse(out.join('')) as { ok: boolean; error: string };
        expect(parsed.ok).toBe(false);
        expect(parsed.error).toContain('probe exploded');
    });

    test('a failing service call in human mode writes the Error: line', async () => {
        const { out, context } = capture();
        await runDaemonAction(
            'status',
            context,
            {},
            {
                ...DARWIN,
                fs: memoryFs(),
                exec: throwingExec(),
                probeGateway: async () => 'free',
            },
        );
        expect(out.join('')).toContain('Error: probe exploded');
    });
});
