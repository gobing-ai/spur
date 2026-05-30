import { echo, echoError } from '@gobing-ai/ts-utils';

/** Output sink used by CLI commands and tests. */
export interface CommandOutput {
    write(message: string): void;
    error(message: string): void;
}

/** Console-backed command output using shared ts-utils output helpers. */
export const consoleOutput: CommandOutput = {
    write(message: string): void {
        echo(message);
    },
    error(message: string): void {
        echoError(message);
    },
};

/** JSON stringify helper that keeps command output stable for automation. */
export function toJson(value: unknown): string {
    return JSON.stringify(value, null, 2);
}
