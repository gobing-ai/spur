/** User-facing command failure with a controlled process exit code. */
export class CommandError extends Error {
    constructor(
        message: string,
        public readonly exitCode = 1,
    ) {
        super(message);
        this.name = 'CommandError';
    }
}

/** Convert unknown thrown values into a readable error message. */
export function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
