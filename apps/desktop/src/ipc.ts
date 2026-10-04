/** Channel shared by the preload bridge and the Electron main process. */
export const DESKTOP_WINDOW_CHANNEL = 'desktop:window';

/** Actions the preload is allowed to request. Anything else is ignored. */
export const WINDOW_ACTIONS = ['minimize', 'toggle-maximize', 'close'] as const;

/** Window action the renderer may request through the preload bridge. */
export type WindowAction = (typeof WINDOW_ACTIONS)[number];

/** True when `value` is a window action the main process will honor. */
export function isWindowAction(value: unknown): value is WindowAction {
    return typeof value === 'string' && (WINDOW_ACTIONS as readonly string[]).includes(value);
}

/** True when a navigation target stays on the child server origin. */
export function isSameOrigin(target: string, origin: string): boolean {
    try {
        return new URL(target).origin === origin;
    } catch {
        return false;
    }
}

/** Private trusted-click channel; never exposed on the renderer bridge. */
export const DESKTOP_EXTERNAL_CHANNEL = 'desktop:external-link';
