/**
 * Minimal self-contained logger for the embedded daily-summary script.
 *
 * The skill script stays self-contained (no CLI extraction, no monorepo coupling), so it carries its
 * own tiny logger rather than importing the host plugin's. API mirrors the logger subset the script
 * and test use: `logger.{info,warn,error}` and `enableLogger(console, file)`.
 */

type Channels = { console: boolean; file: boolean };

const state: Channels = { console: true, file: false };

/** Toggle output channels. Only the console channel is honoured here (no file appender by design). */
export function enableLogger(consoleOn: boolean, fileOn: boolean): void {
    state.console = consoleOn;
    state.file = fileOn;
}

function emit(stream: 'log' | 'warn' | 'error', message: string): void {
    if (!state.console) return;
    console[stream](message);
}

export const logger = {
    info: (message: string): void => emit('log', message),
    warn: (message: string): void => emit('warn', message),
    error: (message: string): void => emit('error', message),
};
