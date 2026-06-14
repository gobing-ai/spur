/**
 * Feature lifecycle engine adapter — bridges `LifecyclePort` to `ts-dual-workflow-engine`.
 *
 * Design §5.2: run binding `feature:<id>`, create-or-attach, requestTransition.
 * DD-04: file-wins rehydration on missing/disagreeing engine state.
 *
 * Feature status vocabulary: backlog → active → verifying → done (or blocked/cancelled).
 * Differs from tasks: no `todo`/`wip`/`testing`; instead `active` (being worked on)
 * and `verifying` (under review).
 *
 * **Upstream gate:** ts-libs 0033 (E1 durable named runs) + 0034 (E2 external
 * transition API). Until released, this adapter delegates to schema-only
 * validation; replace // TODO(0059) blocks with real engine calls once the
 * dependency ships.
 */

import type { EntityRef, LifecyclePort, TransitionResult } from '../services/planning-write-service';

/** Canonical feature statuses — mirrors FEATURE_STATUSES in @spur/domain. */
const CANONICAL_FEATURE_STATUSES = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'] as const;

/** Options for constructing the feature lifecycle engine adapter. */
export interface FeatureLifecycleAdapterOptions {
    /** Engine instance (unavailable until ts-libs 0033/0034 ship). */
    engine?: unknown;
    /** DB adapter for feature_run_links persistence. */
    db?: unknown;
}

/**
 * Engine-backed lifecycle port for features. Validates transitions against the
 * engine's state-machine graph and enforces guards (feature check on
 * active→verifying etc.).
 *
 * When the engine is unavailable, falls back to schema-only validation
 * (same behavior as SchemaLifecyclePort but with feature status vocabulary).
 */
export class FeatureLifecycleAdapter implements LifecyclePort {
    // TODO(0059): add private engine + db fields once ts-libs 0033/0034 ship
    constructor(_opts: FeatureLifecycleAdapterOptions = {}) {}

    /**
     * Request a lifecycle transition for a feature.
     *
     * With engine available (post ts-libs 0033/0034):
     * 1. createOrAttach(`feature:<id>`, feature-lifecycle definition)
     * 2. Write feature_run_links row (kind=lifecycle)
     * 3. requestTransition(currentStatus → to)
     * 4. If denied, return { allowed: false, report: guard details }
     *
     * Without engine: validates status vocabulary only (fallback).
     *
     * Feature state machine includes guards:
     * - active→verifying: feature check must pass
     * - backlog→active: at most one P0 feature active (one-active-goal rule)
     * - verifying→done: all children must be done
     */
    requestTransition(_ref: EntityRef, currentStatus: string, to: string): TransitionResult {
        // TODO(0059): wire engine createOrAttach + requestTransition once ts-libs 0033/0034 ship

        // Schema-only fallback: validate status vocabulary
        const canonical = CANONICAL_FEATURE_STATUSES as readonly string[];
        if (!canonical.includes(to)) {
            return {
                allowed: false,
                from: currentStatus,
                to,
                report: `unknown feature status: ${to} (allowed: ${canonical.join(', ')})`,
            };
        }
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
        // TODO(0059): query engine state, compare, re-seed if mismatched
    }
}
