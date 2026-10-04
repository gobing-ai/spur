import { BrowserWindow, ipcMain } from 'electron';
import { DESKTOP_WINDOW_CHANNEL, isSameOrigin, isWindowAction } from './ipc';

/** Frameless window that loads the Board. IPC is registered separately and stays on the preload bridge. */
export function createMainWindow(options: {
    url: string;
    preloadPath: string;
    platform?: NodeJS.Platform;
}): BrowserWindow {
    const win = new BrowserWindow({
        width: 1280,
        height: 840,
        minWidth: 880,
        minHeight: 600,
        show: false,
        backgroundColor: '#0f1117',
        frame: false,
        titleBarStyle: 'hidden',
        trafficLightPosition: { x: 12, y: 12 },
        ...((options.platform ?? process.platform) === 'darwin'
            ? {}
            : {
                  titleBarOverlay: {
                      color: '#1a1d27',
                      symbolColor: '#e2e8f0',
                      height: 36,
                  },
              }),
        webPreferences: {
            preload: options.preloadPath,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
        },
    });

    const origin = new URL(options.url).origin;
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, url) => {
        if (!isSameOrigin(url, origin)) event.preventDefault();
    });
    win.once('ready-to-show', () => {
        win.show();
    });
    void win.loadURL(options.url);
    return win;
}

/** Honor only the three window actions the preload exposes. */
export function registerWindowIpc(): void {
    ipcMain.on(DESKTOP_WINDOW_CHANNEL, (event, action: unknown) => {
        if (!isWindowAction(action)) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return;
        if (action === 'minimize') win.minimize();
        else if (action === 'toggle-maximize') {
            if (win.isMaximized()) win.unmaximize();
            else win.maximize();
        } else win.close();
    });
}
