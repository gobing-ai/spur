import { expect, test } from 'bun:test';
import { DESKTOP_WINDOW_CHANNEL } from '../src/ipc';
import { exposed, ipcMessages } from './electron-fixture';

test('preload handles an unavailable document root and exposes only window actions', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    let ready: (() => void) | undefined;
    const document = {
        documentElement: undefined as { dataset: Record<string, string> } | undefined,
        addEventListener: (_event: string, handler: () => void) => {
            ready = handler;
        },
    };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
    try {
        await import('../src/preload');
        document.documentElement = { dataset: {} };
        ready?.();
        expect(document.documentElement.dataset.spurDesktop).toBe('1');
        const api = exposed.spurDesktop as {
            platform: string;
            minimize(): void;
            toggleMaximize(): void;
            close(): void;
        };
        expect(api.platform).toBe(process.platform);
        api.minimize();
        api.toggleMaximize();
        api.close();
        expect(ipcMessages).toEqual([
            [DESKTOP_WINDOW_CHANNEL, 'minimize'],
            [DESKTOP_WINDOW_CHANNEL, 'toggle-maximize'],
            [DESKTOP_WINDOW_CHANNEL, 'close'],
        ]);
    } finally {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else Reflect.deleteProperty(globalThis, 'document');
    }
});
