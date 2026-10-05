import { afterEach, expect, spyOn, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { getEnvVars } from '@gobing-ai/spur-config';
import * as processes from '../src/server-process';
import { app, dialog, FakeWindow, ipcMain } from './fixtures/electron';

const { startDesktopShell } = await import('../src/main');
const originalProject = getEnvVars().SPUR_PROJECT_ROOT;
const originalMode = getEnvVars().SPUR_DESKTOP_MODE;
let restoreSpawn: (() => void) | undefined;
let quits = 0;
let stops = 0;
const errors: string[] = [];
let launch: processes.StartDesktopServerOptions | undefined;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 10));

function setup(): void {
    app.removeAllListeners();
    ipcMain.removeAllListeners();
    FakeWindow.windows = [];
    quits = 0;
    stops = 0;
    errors.length = 0;
    launch = undefined;
    app.isPackaged = false;
    app.requestSingleInstanceLock = () => true;
    app.whenReady = () => Promise.resolve();
    app.quit = () => {
        let prevented = false;
        app.emit('before-quit', {
            preventDefault: () => {
                prevented = true;
            },
        });
        if (!prevented) quits += 1;
    };
    dialog.showErrorBox = (_title: string, message: string) => {
        errors.push(message);
    };
    getEnvVars().SPUR_PROJECT_ROOT = tmpdir();
    delete getEnvVars().SPUR_DESKTOP_MODE;
}

function stubSpawn(implementation?: typeof processes.startDesktopServer): void {
    const spy = spyOn(processes, 'startDesktopServer').mockImplementation(
        implementation ??
            (async (options) => {
                launch = options;
                return {
                    port: 1234,
                    url: 'http://127.0.0.1:1234',
                    kind: 'dev-cli',
                    ownership: 'owned',
                    pid: 4242,
                    stop: async () => {
                        stops += 1;
                    },
                };
            }),
    );
    restoreSpawn = () => spy.mockRestore();
}

afterEach(() => {
    restoreSpawn?.();
    restoreSpawn = undefined;
    app.removeAllListeners();
    ipcMain.removeAllListeners();
    if (originalProject === undefined) delete getEnvVars().SPUR_PROJECT_ROOT;
    else getEnvVars().SPUR_PROJECT_ROOT = originalProject;
    if (originalMode === undefined) delete getEnvVars().SPUR_DESKTOP_MODE;
    else getEnvVars().SPUR_DESKTOP_MODE = originalMode;
});

test('a second desktop process quits without starting a server', () => {
    setup();
    app.requestSingleInstanceLock = () => false;
    stubSpawn();
    startDesktopShell();
    expect(quits).toBe(1);
    expect(launch).toBeUndefined();
});

test('ready shell focuses/restores its window and waits for stop on close', async () => {
    setup();
    stubSpawn();
    startDesktopShell();
    await tick();
    const win = FakeWindow.windows[0];
    if (!win) throw new Error('No desktop window');
    win.minimize();
    app.emit('second-instance');
    expect(win.minimized).toBe(false);
    expect(win.focused).toBe(true);
    app.emit('second-instance');
    app.emit('window-all-closed');
    await tick();
    expect(stops).toBe(1);
    expect(quits).toBe(1);
});

test('packaged launch selects a directory and cancellation starts no child', async () => {
    for (const canceled of [false, true]) {
        setup();
        app.isPackaged = true;
        delete getEnvVars().SPUR_PROJECT_ROOT;
        dialog.showOpenDialog = async () => ({ canceled, filePaths: canceled ? [] : [tmpdir()] });
        stubSpawn();
        startDesktopShell();
        await tick();
        if (canceled) {
            expect(launch).toBeUndefined();
            expect(quits).toBe(1);
        } else {
            expect(launch?.layout.projectRoot).toBe(tmpdir());
            app.quit();
            await tick();
        }
        restoreSpawn?.();
        restoreSpawn = undefined;
    }
});

test('quit during startup waits until the pending child is stopped', async () => {
    setup();
    let stopped = false;
    stubSpawn(async (options) => {
        launch = options;
        return await new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => {
                setTimeout(() => {
                    stopped = true;
                    reject(new processes.DesktopStartupAborted());
                }, 20);
            });
        });
    });
    startDesktopShell();
    await tick();
    app.emit('second-instance'); // no window yet
    app.quit();
    expect(quits).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(stopped).toBe(true);
    expect(quits).toBe(1);
    expect(errors).toEqual([]);
});

test('a child returned after abort is stopped before quit', async () => {
    setup();
    stubSpawn(async (options) => {
        launch = options;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return {
            port: 1234,
            url: 'http://127.0.0.1:1234',
            kind: 'dev-cli',
            ownership: 'owned',
            pid: 4242,
            stop: async () => {
                stops += 1;
            },
        };
    });
    startDesktopShell();
    await tick();
    app.quit();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(stops).toBe(1);
    expect(quits).toBe(1);
    expect(FakeWindow.windows.length).toBe(0);
});

test('startup errors and unexpected exits report failures and quit', async () => {
    setup();
    stubSpawn(async () => {
        throw 'cannot spawn';
    });
    startDesktopShell();
    await tick();
    expect(errors).toEqual(['cannot spawn']);
    expect(quits).toBe(1);
    restoreSpawn?.();
    restoreSpawn = undefined;
    setup();
    stubSpawn();
    startDesktopShell();
    await tick();
    launch?.onUnexpectedExit?.(new Error('server crashed'));
    await tick();
    launch?.onUnexpectedExit?.(new Error('already quitting'));
    expect(errors).toEqual(['server crashed']);
    expect(stops).toBe(1);
    expect(quits).toBe(1);
});

test('quit before readiness does not start a child', async () => {
    setup();
    let ready: (() => void) | undefined;
    app.whenReady = () =>
        new Promise((resolve) => {
            ready = resolve;
        });
    stubSpawn();
    startDesktopShell();
    app.quit();
    expect(quits).toBe(1);
    app.emit('before-quit', { preventDefault: () => {} });
    ready?.();
    await tick();
    // Real Electron exits before ready. Avoid leaking this test's fake server.
    app.quit();
    await tick();
});
