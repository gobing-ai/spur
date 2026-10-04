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
    readonly mainFrame = { url: '' };
    webContents = Object.assign(new EventEmitter(), {
        mainFrame: this.mainFrame,
        session: {
            checkPermission: undefined as (() => boolean) | undefined,
            requestPermission: undefined as
                | ((_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void)
                | undefined,
            setPermissionCheckHandler: (handler: () => boolean) => {
                this.webContents.session.checkPermission = handler;
            },
            setPermissionRequestHandler: (
                handler: (_contents: unknown, _permission: string, callback: (allowed: boolean) => void) => void,
            ) => {
                this.webContents.session.requestPermission = handler;
            },
        },
        openHandler: undefined as ((details: { url: string }) => { action: string }) | undefined,
        setWindowOpenHandler: (handler: (details: { url: string }) => { action: string }) => {
            this.webContents.openHandler = handler;
        },
    });
    constructor(public options: Record<string, unknown>) {
        super();
        FakeWindow.windows.push(this);
    }
    loadURL(url: string): Promise<void> {
        this.url = url;
        this.mainFrame.url = url;
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
    requestSingleInstanceLock: (): boolean => false,
    quit: () => {},
    whenReady: () => Promise.resolve(),
});
export const dialog = {
    showErrorBox: (_title: string, _message: string) => {},
    showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
};
export const shell = { openExternal: async (_url: string): Promise<void> => {} };
mock.module('electron', () => ({
    BrowserWindow: FakeWindow,
    ipcMain,
    app,
    dialog,
    shell,
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
