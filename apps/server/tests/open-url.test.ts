import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openUrl } from '../src/open-url';

const originalSpawn = Bun.spawn;
const originalPlatform = process.platform;

let spawnCalls: { argv: string[]; options: unknown }[];

beforeEach(() => {
    spawnCalls = [];
    // Passthrough mock: only intercept browser-open argv. On Bun, execa uses
    // Bun.spawn — a total stub hangs concurrent ProcessExecutor tests.
    Bun.spawn = ((first: unknown, second?: unknown) => {
        if (Array.isArray(first)) {
            const argv = first.map(String);
            const bin = argv[0];
            if (bin === 'open' || bin === 'cmd' || bin === 'xdg-open') {
                spawnCalls.push({ argv, options: second });
                return { killed: false, pid: 0, exited: Promise.resolve(0) };
            }
        }
        return (originalSpawn as (...args: unknown[]) => unknown)(first, second);
    }) as typeof Bun.spawn;
});

afterEach(() => {
    Bun.spawn = originalSpawn;
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
});

describe('openUrl', () => {
    test('on darwin, spawns `open <url>` with ignored stdio', async () => {
        Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
        await openUrl('http://localhost:9999');
        expect(spawnCalls).toHaveLength(1);
        expect(spawnCalls[0]?.argv).toEqual(['open', 'http://localhost:9999']);
        expect(spawnCalls[0]?.options).toEqual({ stdio: ['ignore', 'ignore', 'ignore'] });
    });

    test('on win32, spawns `cmd /c start "" <url>`', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
        await openUrl('http://localhost:9999');
        expect(spawnCalls).toHaveLength(1);
        // `start` is a cmd.exe builtin — the empty `""` title arg stops `start`
        // from consuming the URL as a window title.
        expect(spawnCalls[0]?.argv).toEqual(['cmd', '/c', 'start', '', 'http://localhost:9999']);
    });

    test('on linux, spawns `xdg-open <url>`', async () => {
        Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
        await openUrl('http://localhost:9999');
        expect(spawnCalls).toHaveLength(1);
        expect(spawnCalls[0]?.argv).toEqual(['xdg-open', 'http://localhost:9999']);
    });

    test('exports as a function', () => {
        expect(typeof openUrl).toBe('function');
    });
});
