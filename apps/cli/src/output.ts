import { echo, echoError } from '@gobing-ai/ts-utils';

/**
 * ADR-091 envelope helpers live in `@gobing-ai/spur-app` (task 0697): the four
 * service-emitting verbs (`agent list`, `agent doctor`, `rule run`, `rule validate`)
 * emit from `packages/app`, and `packages/app` may not import `apps/cli` — that edge
 * is circular against the workspace graph. Moving the helpers down and re-exporting
 * them here keeps all 99 CLI call sites adopted at task 0693 unchanged.
 */
export {
    type CliEnvelope,
    type EnvelopeCapableOutput,
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
