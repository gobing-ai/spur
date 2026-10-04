import { mock } from 'bun:test';
import { EventEmitter } from 'node:events';

export class FakeWindow extends EventEmitter {
    static windows: FakeWindow[] = [];
    static getAllWindows(): FakeWindow[] {
        return FakeWindow.windows;
    }
    static fromWebContents(sender: unknown): FakeWindow | undefined {
        return FakeWindow.windows.find((win) => win.webContents === sender);
    }
    minimized = false;
    maximized = false;
    closed = false;
    shown = false;
    focused = false;
    url = '';
    webContents = Object.assign(new EventEmitter(), {
        openHandler: undefined as (() => { action: string }) | undefined,
        setWindowOpenHandler: (handler: () => { action: string }) => {
            this.webContents.openHandler = handler;
        },
    });
    constructor(public options: Record<string, unknown>) {
        super();
        FakeWindow.windows.push(this);
    }
    loadURL(url: string): Promise<void> {
        this.url = url;
        return Promise.resolve();
    }
    show(): void {
        this.shown = true;
    }
    focus(): void {
        this.focused = true;
    }
    minimize(): void {
        this.minimized = true;
    }
    isMinimized(): boolean {
        return this.minimized;
    }
    restore(): void {
        this.minimized = false;
    }
    maximize(): void {
        this.maximized = true;
    }
    unmaximize(): void {
        this.maximized = false;
    }
    isMaximized(): boolean {
        return this.maximized;
    }
    close(): void {
        this.closed = true;
    }
}
export const ipcMain = new EventEmitter();
export const ipcMessages: unknown[][] = [];
export const exposed: Record<string, unknown> = {};
export const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    requestSingleInstanceLock: () => false,
    quit: () => {},
    whenReady: () => Promise.resolve(),
});
export const dialog = {
    showErrorBox: () => {},
    showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
};
mock.module('electron', () => ({
    BrowserWindow: FakeWindow,
    ipcMain,
    app,
    dialog,
    contextBridge: {
        exposeInMainWorld: (name: string, api: unknown) => {
            exposed[name] = api;
        },
    },
    ipcRenderer: {
        send: (...args: unknown[]) => {
            ipcMessages.push(args);
        },
    },
}));
