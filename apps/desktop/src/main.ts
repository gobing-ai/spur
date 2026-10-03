import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog } from 'electron';
import { resolveLayout } from './layout';
import { DesktopStartupAborted, type RunningDesktopServer, startDesktopServer } from './server-process';
import { createMainWindow, registerWindowIpc } from './window';

// Thin shell only. Do not import the server, bun:sqlite, or startServer.
// The child process is the sole SQLite owner (<projectRoot>/.spur/spur.db).

const preloadPath = fileURLToPath(new URL('./preload.cjs', import.meta.url));

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    let server: RunningDesktopServer | undefined;
    let quitting = false;
    let startupStarted = false;
    const startupAbort = new AbortController();

    const stopServer = async (): Promise<void> => {
        const current = server;
        server = undefined;
        await current?.stop();
    };

    app.on('second-instance', () => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.focus();
    });

    app.on('before-quit', (event) => {
        // Quit during `startDesktopServer()` must kill the child even though `server`
        // is not assigned until health succeeds. Abort reaches the in-progress spawn.
        if (quitting) return;
        if (!server && !startupStarted) return;
        event.preventDefault();
        quitting = true;
        startupAbort.abort();
        void stopServer().finally(() => app.quit());
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

    app.whenReady()
        .then(async () => {
            startupStarted = true;
            if (startupAbort.signal.aborted) return;
            const here = dirname(fileURLToPath(import.meta.url));
            const layout = resolveLayout({
                isPackaged: app.isPackaged,
                cwd: process.cwd(),
                execDir: here,
                resourcesPath: process.resourcesPath,
                env: process.env,
                argv: process.argv,
            });
            server = await startDesktopServer({
                layout,
                signal: startupAbort.signal,
                launchCwd: process.cwd(),
            });
            if (startupAbort.signal.aborted) {
                await stopServer();
                return;
            }
            registerWindowIpc();
            createMainWindow({ url: `${server.url}/board`, preloadPath });
        })
        .catch((error: unknown) => {
            if (quitting || error instanceof DesktopStartupAborted) {
                quitting = true;
                void stopServer().finally(() => app.quit());
                return;
            }
            dialog.showErrorBox('Spur desktop', errorText(error));
            quitting = true;
            void stopServer().finally(() => app.quit());
        });
}
