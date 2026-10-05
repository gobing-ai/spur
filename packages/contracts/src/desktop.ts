/** Parent-only process control message carried on the inherited Node/Bun JSON IPC channel. */
export interface DesktopServerControlMessage {
    type: 'spur.desktop.shutdown';
}

/** Startup failure sent only to the parent that owns the inherited IPC descriptor. */
export interface DesktopServerStartupErrorMessage {
    type: 'spur.desktop.startup-error';
    message: string;
}
