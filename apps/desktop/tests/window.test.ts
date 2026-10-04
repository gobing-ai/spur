import { describe, expect, test } from 'bun:test';
import { DESKTOP_WINDOW_CHANNEL } from '../src/ipc';
import { FakeWindow, ipcMain } from './fixtures/electron';

const { createMainWindow, registerWindowIpc } = await import('../src/window');

describe('desktop window', () => {
    test('isolates the renderer and prevents navigation outside the server origin', () => {
        const win = createMainWindow({
            url: 'http://127.0.0.1:1234/board',
            preloadPath: '/preload.cjs',
        }) as unknown as FakeWindow;
        expect(win.options.webPreferences).toEqual({
            preload: '/preload.cjs',
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        });
        expect(win.webContents.openHandler?.()).toEqual({ action: 'deny' });
        let blocked = false;
        const event = {
            preventDefault: () => {
                blocked = true;
            },
        };
        win.webContents.emit('will-navigate', event, 'https://example.com');
        expect(blocked).toBe(true);
        blocked = false;
        win.webContents.emit('will-navigate', event, 'http://127.0.0.1:1234/board/tasks');
        expect(blocked).toBe(false);
        win.emit('ready-to-show');
        expect(win.shown).toBe(true);
    });
    test('IPC ignores unknown senders/actions and controls only the sender window', () => {
        ipcMain.removeAllListeners();
        registerWindowIpc();
        const win = new FakeWindow({});
        const send = (action: unknown, sender: unknown = win.webContents) =>
            ipcMain.emit(DESKTOP_WINDOW_CHANNEL, { sender }, action);
        send('minimize', {});
        send('arbitrary');
        expect(win.minimized).toBe(false);
        send('minimize');
        expect(win.minimized).toBe(true);
        send('toggle-maximize');
        expect(win.maximized).toBe(true);
        send('toggle-maximize');
        expect(win.maximized).toBe(false);
        send('close');
        expect(win.closed).toBe(true);
    });
});

test('non-macOS windows reserve native title bar controls', () => {
    const win = createMainWindow({
        url: 'http://127.0.0.1:1234/board',
        preloadPath: '/preload.cjs',
        platform: 'win32',
    }) as unknown as FakeWindow;
    expect(win.options.titleBarOverlay).toEqual({ color: '#1a1d27', symbolColor: '#e2e8f0', height: 36 });
});
