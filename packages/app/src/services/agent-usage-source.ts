/**
 * Usage-source seam for the `spur agent usage` producer (B6 0892 R5): one
 * interface, one implementation. The operator named a second candidate source
 * in the original idea; until one materializes this stays a deliberately
 * small seam — the producer depends on `UsageSource`, never on codexbar.
 *
 * Capture is fail-closed by contract (0892 R3): a missing binary or an
 * unusable capture throws {@link UsageSourceError} before the producer
 * touches the snapshot or any observation row. A non-zero EXIT CODE with a
 * parsable payload is NOT an error — codexbar exits 1 whenever any provider
 * fails, even when the array is valid (verified against CodexBar 0.60.4).
 */

/** Raw transport-level capture from one source run. Exit code is advisory. */
export interface UsageCapture {
    /** Process exit code; producers must not treat non-zero as failure by itself. */
    exitCode: number;
    /** Raw stdout — expected to be a JSON array of provider entries. */
    stdout: string;
    /** Raw stderr, surfaced verbatim on fail-closed exits. */
    stderr: string;
}

/** One external usage source. `name` labels snapshots and output. */
export interface UsageSource {
    /** Stable source id (snapshot `source` field). */
    readonly name: string;
    /** Run one capture. Throws {@link UsageSourceError} when the capture is unusable. */
    capture: () => Promise<UsageCapture>;
}

/** Fail-closed capture failure: missing binary, spawn failure, or unusable transport. */
export class UsageSourceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'UsageSourceError';
    }
}

/**
 * The spawn-based implementation (`CodexbarUsageSource`) lives in the CLI layer
 * (apps/cli) — `packages/app` forbids process spawn; the producer receives the
 * source via dependency injection (0892 boundary remediation).
 */
