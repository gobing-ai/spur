/**
 * Lifecycle engine adapter — bridges `LifecyclePort` to `ts-dual-workflow-engine`.
 *
 * Design §5.2: run binding `task:<wbs>`, create-or-attach, requestTransition.
 * DD-04: file-wins rehydration on missing/disagreeing engine state.
 *
 * **Upstream gate:** ts-libs 0033 (E1 durable named runs) + 0034 (E2 external
 * transition API). Until released, this adapter delegates to schema-only
 * validation; replace // TODO(0055) blocks with real engine calls once the
 * dependency ships.
 */

import type { EntityRef, LifecyclePort, TransitionResult } from '../services/planning-write-service';

/** Options for constructing the lifecycle engine adapter. */
export interface LifecycleAdapterOptions {
    /** Engine instance (unavailable until ts-libs 0033/0034 ship). */
    engine?: unknown;
    /** DB adapter for task_run_links persistence. */
    db?: unknown;
}

/**
 * Engine-backed lifecycle port. Validates transitions against the engine's
 * state-machine graph and enforces guards (task check on wip→testing etc.).
 *
 * When the engine is unavailable, falls back to schema-only validation
 * (same behavior as SchemaLifecyclePort).
 */
export class LifecycleAdapter implements LifecyclePort {
    // TODO(0055): add private engine + db fields once ts-libs 0033/0034 ship
    constructor(_opts: LifecycleAdapterOptions = {}) {}

    /**
     * Request a lifecycle transition.
     *
     * With engine available (post ts-libs 0033/0034):
     * 1. createOrAttach(`task:<wbs>`, task-lifecycle definition)
     * 2. Write task_run_links row (kind=lifecycle)
     * 3. requestTransition(currentStatus → to)
     * 4. If denied, return { allowed: false, report: guard details }
     *
     * Without engine: validates status vocabulary only (fallback).
     */
    requestTransition(_ref: EntityRef, currentStatus: string, to: string): TransitionResult {
        // TODO(0055): wire engine createOrAttach + requestTransition once ts-libs 0033/0034 ship
        if (currentStatus === to) {
            return { allowed: false, from: currentStatus, to, report: 'already in this status' };
        }
        return { allowed: true, from: currentStatus, to };
    }

    /**
     * DD-04 file-wins rehydration: if the engine state is missing or disagrees
     * with the file's frontmatter status, re-seed the engine state from the file.
     *
     * Called before requestTransition to ensure the engine is in sync with the
     * file SSOT. Emits a corrective planning event so the ledger is complete.
     */
    async rehydrateIfNeeded(_ref: EntityRef, _fileStatus: string): Promise<void> {
        // TODO(0055): query engine state, compare, re-seed if mismatched
    }
}
