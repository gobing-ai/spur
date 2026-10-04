import { describe, expect, spyOn, test } from 'bun:test';
import { DESKTOP_EXTERNAL_CHANNEL, DESKTOP_WINDOW_CHANNEL } from '../src/ipc';
import { dialog, FakeWindow, ipcMain, shell } from './fixtures/electron';

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
            nodeIntegrationInSubFrames: false,
            sandbox: true,
            webSecurity: true,
        });
        expect(win.webContents.openHandler?.({ url: 'file:///tmp/blocked' })).toEqual({ action: 'deny' });
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
            ipcMain.emit(DESKTOP_WINDOW_CHANNEL, { sender, senderFrame: win.mainFrame }, action);
        send('minimize', {});
        ipcMain.emit(DESKTOP_WINDOW_CHANNEL, { sender: win.webContents, senderFrame: {} }, 'close');
        expect(win.closed).toBe(false);
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

test('macOS uses hidden title bar with native traffic lights', () => {
    const win = createMainWindow({
        url: 'http://127.0.0.1:1234/board',
        preloadPath: '/preload.cjs',
        platform: 'darwin',
    }) as unknown as FakeWindow;
    expect(win.options.frame).toBeUndefined();
    expect(win.options.titleBarStyle).toBe('hidden');
    expect(win.options.trafficLightPosition).toEqual({ x: 12, y: 12 });
});

test('permissions are denied and external links use only HTTP(S) without credentials', async () => {
    const open = spyOn(shell, 'openExternal').mockResolvedValue();
    const error = spyOn(dialog, 'showErrorBox').mockImplementation(() => {});
    try {
        const win = createMainWindow({
            url: 'http://127.0.0.1:1234/board',
            preloadPath: '/preload.cjs',
        }) as unknown as FakeWindow;
        expect(win.webContents.session.checkPermission?.()).toBe(false);
        let allowed: boolean | undefined;
        win.webContents.session.requestPermission?.(win.webContents, 'media', (value) => {
            allowed = value;
        });
        expect(allowed).toBe(false);
        for (const url of ['file:///tmp/x', 'javascript:alert(1)', 'not a URL', 'https://user:pass@example.com']) {
            expect(win.webContents.openHandler?.({ url })).toEqual({ action: 'deny' });
        }
        expect(open).not.toHaveBeenCalled();
        expect(win.webContents.openHandler?.({ url: 'https://example.com/page' })).toEqual({ action: 'deny' });
        expect(open).not.toHaveBeenCalled();
        const send = (url: unknown, senderFrame: unknown = win.mainFrame) =>
            ipcMain.emit(DESKTOP_EXTERNAL_CHANNEL, { sender: win.webContents, senderFrame }, url);
        send('https://example.com/page', { url: 'https://untrusted.example' });
        expect(open).not.toHaveBeenCalled();
        send('https://user:pass@example.com');
        send('file:///tmp/x');
        send('not a URL');
        send(123);
        expect(open).not.toHaveBeenCalled();
        send('https://example.com/page');
        expect(open).toHaveBeenCalledWith('https://example.com/page');
        open.mockRejectedValueOnce(new Error('browser unavailable'));
        send('http://example.com');
        await Promise.resolve();
        expect(error).toHaveBeenCalledWith('Unable to open link', 'The system browser could not open this link.');
        win.emit('closed');
        send('https://example.com/after-close');
        expect(open).toHaveBeenCalledTimes(2);
    } finally {
        open.mockRestore();
        error.mockRestore();
    }
});
