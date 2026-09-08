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

/**
 * Canonical Spur project database path used in the SQLITE_BUSY diagnostics.
 * Static text only — no process inspection at the error seam (sandboxed CLIs
 * may lack `lsof`/`ps`); the user-facing remediation hint is always available.
 */
const SQLITE_BUSY_DB_PATH = '.spur/spur.db';

/**
 * User-facing remediation hint for SQLITE_BUSY failures. The hint names the
 * db path so the holder can be identified (`lsof .spur/spur.db`) and the two
 * ways to release it (stop a stale Spur process or `spur serve`). Static text
 * only — never shell-out from the error seam.
 */
const SQLITE_BUSY_REMEDIATION =
    'identify the holder: lsof .spur/spur.db; stop the stale Spur process or spur serve, then retry';

/** Convert unknown thrown values into a readable error message. */
export function errorMessage(error: unknown): string {
    if (isSqliteBusy(error)) {
        return (
            `SQLite database ${SQLITE_BUSY_DB_PATH} is busy; another Spur process is holding the lock. ` +
            `${SQLITE_BUSY_REMEDIATION}.`
        );
    }
    return error instanceof Error ? error.message : String(error);
}

/** Exported for the unit test that forces a SQLITE_BUSY-coded error through errorMessage(). */
export const SQLITE_BUSY_MESSAGE_CONSTANTS = Object.freeze({
    dbPath: SQLITE_BUSY_DB_PATH,
    remediation: SQLITE_BUSY_REMEDIATION,
});
