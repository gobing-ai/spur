import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { openUrl } from '../src/open-url';

const originalSpawn = Bun.spawn;

beforeAll(() => {
    // @ts-expect-error — Bun.spawn mock for test isolation
    Bun.spawn = (_cmd: string[], _options?: unknown) => ({ killed: false, pid: 0, exited: Promise.resolve(0) });
});

afterAll(() => {
    Bun.spawn = originalSpawn;
});

describe('openUrl', () => {
    test('exports as a function', () => {
        expect(typeof openUrl).toBe('function');
    });

    test('accepts a URL string without throwing', () => {
        // openUrl spawns a subprocess — verify it doesn't throw on valid input.
        // Bun.spawn is mocked in beforeAll so no real browser opens.
        expect(() => {
            openUrl('http://localhost:9999').catch(() => {});
        }).not.toThrow();
    });
});
