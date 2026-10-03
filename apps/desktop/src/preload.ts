import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_WINDOW_CHANNEL, type WindowAction } from './ipc';

function send(action: WindowAction): void {
    ipcRenderer.send(DESKTOP_WINDOW_CHANNEL, action);
}

contextBridge.exposeInMainWorld('spurDesktop', {
    platform: process.platform,
    minimize(): void {
        send('minimize');
    },
    toggleMaximize(): void {
        send('toggle-maximize');
    },
    close(): void {
        send('close');
    },
});

/** Gate the Board drag strip. Browsers and the Cloudflare worker never set this. */
function markDesktop(): void {
    document.documentElement.dataset.spurDesktop = '1';
    document.documentElement.dataset.spurDesktopPlatform = process.platform;
}

markDesktop();
document.addEventListener('DOMContentLoaded', markDesktop);
