import { echo, echoError } from '@gobing-ai/ts-utils';

// ADR-091 envelope helpers (task 0697): the implementation moved down to `packages/app`
// so service-layer emitters (`agent list`/`doctor`, `rule run`/`validate`) honor the same
// seam; `apps/cli` depends on `@gobing-ai/spur-app`, so the re-export carries the 99
// adopted call sites under `apps/cli/src/commands/` unchanged.
export {
    type CliEnvelope,
    type EnvelopeErrorPayload,
    type EnvelopeOptions,
    envelopeEnabled,
    toEnvelopeError,
    toEnvelopeJson,
    writeJsonError,
} from '@gobing-ai/spur-app';

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
