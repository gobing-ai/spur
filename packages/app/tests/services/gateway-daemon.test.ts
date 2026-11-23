import { describe, expect, it } from 'bun:test';
import type { FileSystem, ProcessExecutor, ProcessOptions, ProcessResult } from '@gobing-ai/ts-runtime';
import {
    GATEWAY_LABEL,
    type GatewayDaemonDeps,
    gatewayDaemonStatus,
    gatewayPlistPath,
    installGatewayDaemon,
    parsePrintOutput,
    renderGatewayPlist,
    uninstallGatewayDaemon,
} from '../../src/services/gateway-daemon';

/** In-memory FileSystem: only what the daemon touches. */
function memoryFs(initial: Record<string, string> = {}): FileSystem & { files: Map<string, string> } {
    const files = new Map(Object.entries(initial));
    return {
        files,
        exists: (path: string) => files.has(path),
        readFile: (path: string) => {
            const value = files.get(path);
            if (value === undefined) throw new Error(`ENOENT ${path}`);
            return value;
        },
        writeFile: (path: string, content: string) => void files.set(path, content),
        appendFile: (path: string, content: string) => void files.set(path, `${files.get(path) ?? ''}${content}`),
        ensureDir: () => {},
        readDir: () => [],
        deleteFile: (path: string) => void files.delete(path),
        rename: (src: string, dest: string) => {
            const value = files.get(src);
            if (value === undefined) throw new Error(`ENOENT ${src}`);
            files.delete(src);
            files.set(dest, value);
        },
        copy: (src: string, dest: string) => void files.set(dest, files.get(src) ?? ''),
        stat: (path: string) => (files.has(path) ? { size: 1, mtimeMs: 0, isDirectory: false, isFile: true } : null),
        createWriteStream: () => ({ write: () => {}, end: () => {} }),
    } as unknown as FileSystem & { files: Map<string, string> };
}

interface ExecCall {
    command: string;
    args: string[];
}

/** Scripted executor: each launchctl call pops the next scripted result. */
function scriptedExec(script: Array<Partial<ProcessResult>> = []): {
    exec: ProcessExecutor;
    calls: ExecCall[];
} {
    const calls: ExecCall[] = [];
    const exec = {
        run: async (options: ProcessOptions): Promise<ProcessResult> => {
            calls.push({ command: options.command, args: options.args ?? [] });
            const next = script.shift() ?? { exitCode: 0, stdout: '', stderr: '' };
            return {
                command: options.command,
                args: options.args ?? [],
                exitCode: next.exitCode ?? 0,
                stdout: next.stdout ?? '',
                stderr: next.stderr ?? '',
                durationMs: 1,
            };
        },
        runStreaming: () => {
            throw new Error('runStreaming is not used by the daemon');
        },
    } as unknown as ProcessExecutor;
    return { exec, calls };
}

function makeDeps(overrides: Partial<GatewayDaemonDeps> = {}): GatewayDaemonDeps & {
    fs: FileSystem & { files: Map<string, string> };
    exec: ProcessExecutor;
    calls: ExecCall[];
} {
    const fs = memoryFs({ '/opt/spur': '' });
    const { exec, calls } = scriptedExec();
    return {
        platform: 'darwin',
        uid: 501,
        home: '/Users/tester',
        path: '/opt/homebrew/bin:/usr/bin:/bin',
        spurArgv: ['/opt/spur'],
        port: 3000,
        exec,
        fs,
        probeGateway: async () => 'free',
        ...overrides,
        ...(overrides.exec ? {} : { exec }),
        ...(overrides.fs ? {} : { fs }),
        calls,
    } as GatewayDaemonDeps & {
        fs: FileSystem & { files: Map<string, string> };
        exec: ProcessExecutor;
        calls: ExecCall[];
    };
}

const PLIST = gatewayPlistPath('/Users/tester');

describe('renderGatewayPlist (K4 R9)', () => {
    it('renders the always-on agent with the absolute gateway command', () => {
        const plist = renderGatewayPlist({
            home: '/Users/tester',
            path: '/opt/homebrew/bin:/usr/bin',
            spurArgv: ['/opt/homebrew/bin/bun', '/opt/spur/apps/cli/src/index.ts'],
            port: 3111,
        });
        expect(plist).toContain(`<string>${GATEWAY_LABEL}</string>`);
        expect(plist).toContain('<key>RunAtLoad</key>\n    <true/>');
        expect(plist).toContain('<key>KeepAlive</key>\n    <true/>');
        expect(plist).toContain('<key>AbandonProcessGroup</key>\n    <true/>');
        expect(plist).toContain('<key>ThrottleInterval</key>\n    <integer>10</integer>');
        expect(plist).toContain('/Users/tester/Library/Logs/spur/gateway.out.log');
        expect(plist).toContain('/Users/tester/Library/Logs/spur/gateway.err.log');
        for (const arg of [
            '/opt/homebrew/bin/bun',
            '/opt/spur/apps/cli/src/index.ts',
            'self',
            'serve',
            '--gateway',
            '--port',
            '3111',
            '--no-open',
        ]) {
            expect(plist).toContain(`<string>${arg}</string>`);
        }
    });

    it('XML-escapes PATH values', () => {
        const plist = renderGatewayPlist({
            home: '/Users/tester',
            path: '/weird&path/<bin>',
            spurArgv: ['/opt/spur'],
            port: 3000,
        });
        expect(plist).toContain('/weird&amp;path/&lt;bin&gt;');
        expect(plist).not.toContain('/weird&path/<bin>');
    });
});

describe('installGatewayDaemon (K4 R9/R10)', () => {
    it('refuses a non-macOS platform naming it, writing nothing', async () => {
        const deps = makeDeps({ platform: 'linux' });
        await expect(installGatewayDaemon(deps)).rejects.toThrow(/linux/);
        expect(deps.fs.files.has(PLIST)).toBe(false);
        expect(deps.calls).toEqual([]);
    });

    it('refuses a port held by another listener', async () => {
        const deps = makeDeps({ probeGateway: async () => 'foreign' });
        await expect(installGatewayDaemon(deps)).rejects.toThrow('Gateway port 3000 is in use by another process');
        expect(deps.fs.files.has(PLIST)).toBe(false);
    });

    it('writes the plist atomically and bootstraps it', async () => {
        const deps = makeDeps();
        // `print` answers "not loaded" (113) for a fresh install, then bootstrap succeeds.
        const { exec, calls } = scriptedExec([{ exitCode: 113 }, { exitCode: 0 }]);
        const result = await installGatewayDaemon({ ...deps, exec });
        expect(result).toEqual({ status: 'installed', plistPath: PLIST });
        expect(deps.fs.files.get(PLIST)).toBe(renderGatewayPlist(deps));
        expect(deps.fs.files.has(`${PLIST}.tmp`)).toBe(false);
        expect(calls.map((call) => call.args)).toEqual([
            ['print', 'gui/501/ai.gobing.spur.gateway'],
            ['bootstrap', 'gui/501', PLIST],
        ]);
    });

    it('treats an identical re-install as unchanged and does not bootout', async () => {
        const deps = makeDeps({ fs: memoryFs({ '/opt/spur': '', [PLIST]: '' }) });
        (deps.fs as unknown as { files: Map<string, string> }).files.set(PLIST, renderGatewayPlist(deps));
        const { exec, calls } = scriptedExec([{ exitCode: 0, stdout: 'pid = 4242\n' }]);
        const withLoaded = { ...deps, exec };
        const result = await installGatewayDaemon(withLoaded);
        expect(result.status).toBe('unchanged');
        expect(calls.map((call) => call.args[0])).toEqual(['print']);
    });

    it('boots out, waits for the unload, then bootstraps when the plist changed', async () => {
        const deps = makeDeps();
        // print(loaded) → bootout → print(wait: still loaded) → print(wait: gone) → bootstrap.
        const { exec, calls } = scriptedExec([
            { exitCode: 0, stdout: 'pid = 4242\n' },
            { exitCode: 0 },
            { exitCode: 0, stdout: 'pid = 4242\n' },
            { exitCode: 113 },
            { exitCode: 0 },
        ]);
        const result = await installGatewayDaemon({ ...deps, exec });
        expect(result.status).toBe('installed');
        expect(calls.map((call) => call.args[0])).toEqual(['print', 'bootout', 'print', 'print', 'bootstrap']);
    });

    it('retries a bootstrap that launchd answered with EINPROGRESS', async () => {
        const deps = makeDeps();
        const { exec, calls } = scriptedExec([
            { exitCode: 0, stdout: 'pid = 4242\n' },
            { exitCode: 0 },
            { exitCode: 113 },
            { exitCode: 5, stderr: 'Bootstrap failed: 5: Input/output error' },
            { exitCode: 0 },
        ]);
        const result = await installGatewayDaemon({ ...deps, exec });
        expect(result.status).toBe('installed');
        expect(calls.map((call) => call.args[0])).toEqual(['print', 'bootout', 'print', 'bootstrap', 'bootstrap']);
    });

    it('restores the previous plist instead of deleting it when an update cannot bootstrap', async () => {
        const previous = '<?xml version="1.0"?><plist><!-- previous agent on 3000 --></plist>';
        const deps = makeDeps({ fs: memoryFs({ '/opt/spur': '', [PLIST]: previous }) });
        (deps.fs as unknown as { files: Map<string, string> }).files.set(PLIST, previous);
        // print(loaded) → bootout → print(wait: gone) → bootstrap fails → retry fails → restore + bootstrap.
        const { exec, calls } = scriptedExec([
            { exitCode: 0, stdout: 'pid = 4242\n' },
            { exitCode: 0 },
            { exitCode: 113 },
            { exitCode: 5, stderr: 'Bootstrap failed: 5: Input/output error' },
            { exitCode: 5, stderr: 'Bootstrap failed: 5: Input/output error' },
            { exitCode: 0 },
        ]);
        await expect(installGatewayDaemon({ ...deps, exec })).rejects.toThrow(
            /previous LaunchAgent was restored and is running/,
        );
        expect(deps.fs.files.get(PLIST)).toBe(previous);
        expect(calls.map((call) => call.args[0])).toEqual([
            'print',
            'bootout',
            'print',
            'bootstrap',
            'bootstrap',
            'bootstrap',
        ]);
    });

    it('removes the plist and reports stderr when bootstrap fails', async () => {
        const deps = makeDeps();
        const { exec } = scriptedExec([
            { exitCode: 113 },
            { exitCode: 5, stderr: 'Bootstrap failed: 5: Input/output error' },
        ]);
        await expect(installGatewayDaemon({ ...deps, exec })).rejects.toThrow(/Bootstrap failed: 5/);
        expect(deps.fs.files.has(PLIST)).toBe(false);
    });
});

describe('uninstallGatewayDaemon (K4 R9)', () => {
    it('boots out and removes an installed agent', async () => {
        const deps = makeDeps({ fs: memoryFs({ '/opt/spur': '', [PLIST]: 'x' }) });
        const { exec, calls } = scriptedExec([{ exitCode: 0, stdout: 'pid = 1\n' }, { exitCode: 0 }]);
        const result = await uninstallGatewayDaemon({ ...deps, exec });
        expect(result.status).toBe('removed');
        expect(deps.fs.files.has(PLIST)).toBe(false);
        expect(calls.map((call) => call.args[0])).toEqual(['print', 'bootout']);
    });

    it('reports absent when nothing is installed or loaded (exit 0)', async () => {
        const deps = makeDeps();
        const { exec } = scriptedExec([{ exitCode: 113 }]);
        expect((await uninstallGatewayDaemon({ ...deps, exec })).status).toBe('absent');
    });
});

describe('gatewayDaemonStatus (K4 R9/R10)', () => {
    it('parses launchctl state and the gateway health', async () => {
        const deps = makeDeps({ fs: memoryFs({ '/opt/spur': '', [PLIST]: 'x' }) });
        const { exec } = scriptedExec([
            { exitCode: 0, stdout: '\tstate = running\n\tpid = 913\n\tlast exit code = 0\n' },
        ]);
        const result = await gatewayDaemonStatus({
            ...deps,
            exec,
            fetchHealth: (async () => Response.json({ ok: true, gateway: true })) as unknown as typeof fetch,
        });
        expect(result.installed).toBe(true);
        expect(result.loaded).toBe(true);
        expect(result.pid).toBe(913);
        expect(result.lastExit).toBe(0);
        expect(result.binaryExists).toBe(true);
        expect(result.health).toEqual({ ok: true, gateway: true });
    });

    it('survives garbage launchctl output and reports a missing binary', async () => {
        const deps = makeDeps({ fs: memoryFs({ [PLIST]: 'x' }) });
        const { exec } = scriptedExec([{ exitCode: 0, stdout: 'not a print payload' }]);
        const result = await gatewayDaemonStatus({
            ...deps,
            exec,
            fetchHealth: (async () => {
                throw new Error('ECONNREFUSED');
            }) as unknown as typeof fetch,
        });
        expect(result.loaded).toBe(true);
        expect(result.pid).toBeNull();
        expect(result.lastExit).toBeNull();
        expect(result.health).toBeNull();
        expect(result.binaryExists).toBe(false);
    });

    it('refuses a non-macOS platform', async () => {
        await expect(gatewayDaemonStatus(makeDeps({ platform: 'win32' }))).rejects.toThrow(/win32/);
    });

    it('parses a print payload leniently', () => {
        expect(parsePrintOutput('')).toEqual({ pid: null, lastExit: null });
        expect(parsePrintOutput('pid = 12\nlast exit code = 78\n')).toEqual({ pid: 12, lastExit: 78 });
    });
});
