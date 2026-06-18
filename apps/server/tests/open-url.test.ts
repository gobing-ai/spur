import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openUrl } from '../src/open-url';

const originalSpawn = Bun.spawn;
const originalPlatform = process.platform;

let spawnCalls: { argv: string[]; options: unknown }[];

beforeEach(() => {
    spawnCalls = [];
    // @ts-expect-error — Bun.spawn mock for test isolation
    Bun.spawn = (argv: string[], options?: unknown) => {
        spawnCalls.push({ argv, options });
        return { killed: false, pid: 0, exited: Promise.resolve(0) };
    };
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
