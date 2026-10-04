import { contextBridge, ipcRenderer } from 'electron';
import { DESKTOP_EXTERNAL_CHANNEL, DESKTOP_WINDOW_CHANNEL, type WindowAction } from './ipc';

function send(action: WindowAction): void {
    ipcRenderer.send(DESKTOP_WINDOW_CHANNEL, action);
}

/** Gate the Board drag strip. Browsers and the Cloudflare worker never set this. */
function markDesktop(): void {
    document.documentElement.dataset.spurDesktop = '1';
    document.documentElement.dataset.spurDesktopPlatform = process.platform;
}

/** Expose shell controls and drag markers only in the Board main frame. */
export function initializePreload(): void {
    if (!process.isMainFrame) return;
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

    if (document.documentElement) markDesktop();
    document.addEventListener('DOMContentLoaded', markDesktop);
    document.addEventListener(
        'click',
        (event) => {
            if (!event.isTrusted || event.button !== 0 || event.defaultPrevented) return;
            const element = event.target instanceof Element ? event.target : null;
            const link = element?.closest('a[href]');
            if (!(link instanceof HTMLAnchorElement)) return;
            const url = new URL(link.href, location.href);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return;
            if (url.origin === location.origin && link.target !== '_blank' && !event.metaKey && !event.ctrlKey) return;
            event.preventDefault();
            ipcRenderer.send(DESKTOP_EXTERNAL_CHANNEL, url.href);
        },
        true,
    );
}

initializePreload();
