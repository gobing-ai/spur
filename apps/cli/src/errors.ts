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

function isSqliteBusy(error: unknown): boolean {
    if (error instanceof Error) {
        const maybeCode = (error as Error & { code?: unknown }).code;
        return maybeCode === 'SQLITE_BUSY' || /\bSQLITE_BUSY\b/i.test(error.message);
    }
    return typeof error === 'string' && /\bSQLITE_BUSY\b/i.test(error);
}

/** Convert unknown thrown values into a readable error message. */
export function errorMessage(error: unknown): string {
    if (isSqliteBusy(error)) {
        return 'SQLite database is busy; another Spur process is holding the lock. Retry after the other command finishes.';
    }
    return error instanceof Error ? error.message : String(error);
}
