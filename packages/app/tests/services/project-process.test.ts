import { afterEach, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    classifyPortBindError,
    findListeningPid,
    isPortAvailable,
    isPortLive,
    normalizeProjectPath,
    portBindingAvailable,
    probePort,
    sendSignalToPid,
    setPortProbeForTests,
    setProcessHelpersForTests,
} from '../../src/services/project-process';
import * as registry from '../../src/services/project-registry';

afterEach(() => {
    setPortProbeForTests(undefined);
    setProcessHelpersForTests(undefined);
});

describe('project-process helpers (leaf shared by registry and stop)', () => {
    test('the registry re-exports the same bindings', () => {
        expect(registry.findListeningPid).toBe(findListeningPid);
        expect(registry.setPortProbeForTests).toBe(setPortProbeForTests);
    });

    test('classifyPortBindError maps in-use codes and denies the rest', () => {
        expect(classifyPortBindError({ code: 'EADDRINUSE' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EADDRNOTAVAIL' })).toBe('in-use');
        expect(classifyPortBindError({ code: 'EACCES' })).toBe('denied');
        expect(classifyPortBindError(null)).toBe('denied');
    });

    test('normalizeProjectPath expands ~ and keeps a missing path as resolved', () => {
        expect(normalizeProjectPath('~')).toBe(normalizeProjectPath(homedir()));
        expect(normalizeProjectPath('  /definitely/not/here  ')).toBe('/definitely/not/here');
        expect(normalizeProjectPath('~/x-not-there')).toBe(join(homedir(), 'x-not-there'));
    });

    test('probe and pid seams short-circuit the real system calls', async () => {
        setPortProbeForTests(async (port) => (port === 1 ? 'in-use' : 'available'));
        expect(await probePort(1)).toBe('in-use');
        expect(await isPortAvailable(2)).toBe(true);
        setProcessHelpersForTests({ pidFinder: () => 4242 });
        expect(await findListeningPid(9999)).toBe(4242);
        setProcessHelpersForTests(undefined);
        expect(await findListeningPid(0)).toBeUndefined();
    });
});

type Reply = { exitCode: number; stdout?: string; stderr?: string } | Error;

/** Scripted executor: answers each command name from the table (throws for an Error). */
function fakeExecutor(table: Record<string, Reply>): ProcessExecutor {
    return {
        run: async ({ command }: { command: string }) => {
            const reply = table[command];
            if (reply === undefined || reply instanceof Error) throw reply ?? new Error(`no ${command}`);
            return { stdout: '', stderr: '', ...reply };
        },
    } as unknown as ProcessExecutor;
}

describe('findListeningPid platform fallbacks', () => {
    test('lsof: first non-self pid wins', async () => {
        const ex = fakeExecutor({ lsof: { exitCode: 0, stdout: `${process.pid}\nabc\n4242\n` } });
        expect(await findListeningPid(3001, ex, 'linux')).toBe(4242);
    });

    test('lsof failure falls back to fuser (stdout or stderr), skipping self', async () => {
        const viaStderr = fakeExecutor({
            lsof: new Error('ENOENT'),
            fuser: { exitCode: 0, stderr: ` ${process.pid} 5151` },
        });
        expect(await findListeningPid(3001, viaStderr, 'linux')).toBe(5151);
        const none = fakeExecutor({ lsof: { exitCode: 1 }, fuser: new Error('ENOENT') });
        expect(await findListeningPid(3001, none, 'linux')).toBeUndefined();
        const onlySelf = fakeExecutor({ lsof: { exitCode: 1 }, fuser: { exitCode: 0, stdout: `${process.pid}` } });
        expect(await findListeningPid(3001, onlySelf, 'linux')).toBeUndefined();
    });

    test('win32 reads the LISTENING owner pid from netstat -ano', async () => {
        const rows = [
            '  TCP    0.0.0.0:80      0.0.0.0:0   LISTENING   11',
            '  UDP    0.0.0.0:3001    *:*                     12',
            '  TCP    [::]:3001       [::]:0      LISTENING   6262',
        ].join('\r\n');
        expect(await findListeningPid(3001, fakeExecutor({ netstat: { exitCode: 0, stdout: rows } }), 'win32')).toBe(
            6262,
        );
        expect(await findListeningPid(3001, fakeExecutor({ netstat: new Error('nope') }), 'win32')).toBeUndefined();
    });

    test('out-of-range ports short-circuit', async () => {
        expect(await findListeningPid(0, fakeExecutor({}), 'linux')).toBeUndefined();
        expect(await findListeningPid(70000, fakeExecutor({}), 'linux')).toBeUndefined();
    });
});

describe('sendSignalToPid', () => {
    test('uses the injected killer when set', () => {
        const seen: Array<[number, string]> = [];
        setProcessHelpersForTests({
            processKiller: (pid, sig) => {
                seen.push([pid, sig]);
                return false;
            },
        });
        expect(sendSignalToPid(123, 'SIGTERM')).toBe(false);
        expect(seen).toEqual([[123, 'SIGTERM']]);
    });

    test('real kill: signal 0 to self succeeds, an impossible pid fails', () => {
        expect(sendSignalToPid(process.pid, 0 as unknown as NodeJS.Signals)).toBe(true);
        expect(sendSignalToPid(2 ** 30, 'SIGTERM')).toBe(false);
    });
});

describe('real socket probes', () => {
    test('isPortLive sees a listener and not a closed port; bind probe works', async () => {
        const server: Server = createServer();
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as { port: number }).port;
        try {
            expect(await isPortLive(port)).toBe(true);
            expect(await probePort(port)).toBe('in-use');
        } finally {
            await new Promise<void>((r) => server.close(() => r()));
        }
        expect(await isPortLive(port, 100)).toBe(false);
        expect(await isPortLive(0)).toBe(false);
        expect(await probePort(port)).toBe('available');
        expect(await probePort(0)).toBe('denied');
        expect(await portBindingAvailable()).toBe(true);
    });

    test('portBindingAvailable honours the probe seam', async () => {
        setPortProbeForTests(async () => 'denied');
        expect(await portBindingAvailable()).toBe(false);
        expect(await isPortLive(1)).toBe(false);
        setPortProbeForTests(async () => 'available');
        expect(await portBindingAvailable()).toBe(true);
    });
});
