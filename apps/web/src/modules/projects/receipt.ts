/**
 * Global-input receipt states (0844 R5/R6, feature G63).
 *
 * A CLOSED, twelve-state vocabulary rendered from a pure client-side
 * classifier over the frozen `/api/project/requests` wire. Every non-nominal
 * state is distinctly labeled with its one available action; a run exit is
 * never presented as a verified result (G63 R6). Labels are ported from the
 * prototype's STATUS table (`docs/prototypes/g6-projects/index.html`) so 0845
 * asserts the same strings.
 */
import type { ProjectFleetSnapshot } from './useProjectContext';

/**
 * The frozen reason unions (0834 / 0838), restated structurally — the web
 * package does not depend on `@gobing-ai/spur-app`, and receipt rendering only
 * needs the names, matched against the server's serialized strings.
 */
type DeliveryHoldReason = 'delivery-failed' | 'attempts-exhausted' | 'outcome-unknown' | 'run-exit-only';
type StrategyHoldReason =
    | 'rest-after-drain'
    | 'executor-unavailable'
    | 'unauthorized'
    | 'not-ready'
    | 'unmet-dependency'
    | 'no-idle-instance';

/** Wire shape of one `GET /api/project/requests` row — frozen by the task spec. */
export interface RequestReceipt {
    /** Matches `ConversationEntry.id` (0841). */
    messageId: string;
    /** `inbox_messages.request_key` (0832). */
    requestKey: string | null;
    /** The inbox row's status, verbatim. */
    deliveryStatus: string;
    injectAttempts: number;
    injectError: string | null;
    /** `coordination_runs.run_id` (0833). */
    runId: string | null;
    /** `coordination_runs.task_id` (0833). */
    taskId: string | null;
    outcome: 'run-exit-only' | 'errored' | 'verified' | null;
    /** 0834's delivery classification, null when the row resolved. */
    reason: DeliveryHoldReason | null;
    /** 0838's strategy hold for `taskId`, null when none. */
    hold: StrategyHoldReason | null;
}

/** Receipt lifecycle vocabulary for a submitted global-input request (0844); every non-nominal state is named and actionable (R5). */
export type RequestReceiptState =
    | 'pending' // POST in flight; no durable acceptance yet
    | 'queued-awaiting-orchestrator'
    | 'orchestrator-missing'
    | 'orchestrator-offline'
    | 'executor-unavailable'
    | 'rest-held'
    | 'blocked'
    | 'accepted-working'
    | 'failed-delivery'
    | 'outcome-unknown'
    | 'completed-exit-only'
    | 'completed-verified';

/** Icon + label + meaning + action + tone for one receipt state; paired cues, never color alone (R5, G63 R7). */
export interface ReceiptLabel {
    /** Paired with text; never color alone (R5, G63 R7). */
    icon: string;
    label: string;
    /** What was observed. */
    meaning: string;
    /** The one action actually available in this state. */
    action: string;
    tone: 'ok' | 'warn' | 'err';
}

/** The closed receipt-vocabulary map: one label row per `RequestReceiptState` (0844). */
export const RECEIPT_LABELS: Readonly<Record<RequestReceiptState, ReceiptLabel>> = {
    pending: {
        icon: '◐',
        label: 'pending',
        meaning: 'Receipt captured; waiting for durable acceptance. The submitted revision clears only on acceptance.',
        action: 'wait — the request is being persisted',
        tone: 'warn',
    },
    'queued-awaiting-orchestrator': {
        icon: '⏸',
        label: 'queued-awaiting-orchestrator',
        meaning: 'Durable receipt exists but no active orchestrator has consumed it. NOT “working”. ',
        action: 'bind/restore an orchestrator (Agents → Planner · Scout)',
        tone: 'warn',
    },
    'orchestrator-missing': {
        icon: '⏸',
        label: 'orchestrator-missing',
        meaning: 'No orchestrator instance is bound, so the durable request cannot be consumed.',
        action: 'bind/restore an orchestrator (Agents → Planner · Scout)',
        tone: 'warn',
    },
    'orchestrator-offline': {
        icon: '⏸',
        label: 'orchestrator-offline',
        meaning: 'The orchestrator’s claim is held but stale — it is not consuming the queue.',
        action: 'start the orchestrator member (Agents tab)',
        tone: 'warn',
    },
    'executor-unavailable': {
        icon: '⊘',
        label: 'executor-unavailable',
        meaning:
            'No executor tier can serve the addressed member, so the request was not accepted; the draft is preserved.',
        action: 'fix the member’s executor binding, then retry — same payload, same requestId',
        tone: 'err',
    },
    'rest-held': {
        icon: '⏳',
        label: 'rest-held',
        meaning: 'Rest accepted the request into a visible hold.',
        action: 'release from rest (Agents) or let rest wake it; results from already-running work keep arriving',
        tone: 'warn',
    },
    blocked: {
        icon: '⛔',
        label: 'blocked',
        meaning:
            'The strategy is holding the task on a first-class condition (unauthorized, not-ready, unmet-dependency, no idle instance).',
        action: 'inspect Activity for the pending signal, then unblock',
        tone: 'warn',
    },
    'accepted-working': {
        icon: '▶',
        label: 'accepted · executor working',
        meaning: 'Durable acceptance; an executor is working. This is occupancy, NOT a verified result.',
        action: 'wait for the run receipt',
        tone: 'ok',
    },
    'failed-delivery': {
        icon: '✕',
        label: 'failed-delivery',
        meaning: 'The run could not accept this payload; the draft is preserved.',
        action: 'Retry keeps the SAME requestId for this immutable payload; editing text first creates a NEW requestId',
        tone: 'err',
    },
    'outcome-unknown': {
        icon: '?',
        label: 'outcome-unknown',
        meaning: 'The run consumed the request without ever reporting a receipt.',
        action: 'inspect Messages/Activity and reconcile before any resend — a blind retry would duplicate the payload',
        tone: 'err',
    },
    'completed-exit-only': {
        icon: '✓',
        label: 'run exit 0 recorded (unverified)',
        meaning: 'A process exit code is not proof of success (run exit ≠ verified result).',
        action: 'reconcile in Messages/Activity; only then mark the result verified',
        tone: 'warn',
    },
    'completed-verified': {
        icon: '✓',
        label: 'completed · verified result',
        meaning: 'Result received and reconciled against the original request.',
        action: 'none — this request is finished',
        tone: 'ok',
    },
};

/**
 * Classification precedence (R5/R6), first match wins. Run state is read
 * before project state deliberately: once a run exists, what the project's
 * strategy would do next says nothing about a request that has already been
 * consumed. `capabilityState: 'unknown'` does NOT select executor-unavailable
 * (EXECUTION_CAPABILITY_STATES makes unknown non-permissive-and-non-damning),
 * so it falls through to queued-awaiting-orchestrator.
 */
export function classifyReceipt(
    receipt: RequestReceipt | null,
    fleet: ProjectFleetSnapshot | null,
    inFlight: boolean,
): RequestReceiptState {
    // 1. The POST is in flight and nothing durable is observable yet.
    if (inFlight && receipt === null) return 'pending';

    const deliveryStatus = receipt?.deliveryStatus ?? 'queued'; // durable row not yet observed → project facts decide
    const reason = receipt?.reason ?? null;
    const outcome = receipt?.outcome ?? null;
    const hold = receipt?.hold ?? null;

    // 2-7. Delivery/run verdicts first.
    if (deliveryStatus === 'failed') return 'failed-delivery';
    if (reason === 'outcome-unknown') return 'outcome-unknown';
    if (reason === 'attempts-exhausted') return 'failed-delivery';
    if (outcome === 'verified') return 'completed-verified';
    if (outcome === 'run-exit-only') return 'completed-exit-only';
    if (outcome === 'errored') return 'failed-delivery';

    // 8-10. First-class strategy holds (0838).
    if (hold === 'rest-after-drain') return 'rest-held';
    if (hold === 'executor-unavailable') return 'executor-unavailable';
    if (hold !== null) return 'blocked';

    // 11. Consumed and in flight.
    if (deliveryStatus === 'injected' || deliveryStatus === 'delivered') return 'accepted-working';

    // 12-16. Project facts decide for unconsumed rows.
    const orchState = fleet?.orchestrator.state ?? null;
    if (deliveryStatus === 'queued' && (orchState === 'missing' || orchState === 'unresolvable')) {
        return 'orchestrator-missing';
    }
    if (deliveryStatus === 'queued' && orchState === 'bound-offline') return 'orchestrator-offline';
    const instanceId = fleet?.orchestrator.instanceId;
    const orchestratorMember =
        fleet !== null && instanceId !== undefined ? fleet.members.find((m) => m.instanceId === instanceId) : undefined;
    if (
        deliveryStatus === 'queued' &&
        orchestratorMember !== undefined &&
        (orchestratorMember.enabled === false || orchestratorMember.capabilityState === 'unavailable')
    ) {
        return 'executor-unavailable';
    }
    if (deliveryStatus === 'queued' && fleet?.strategy?.name === 'rest') return 'rest-held';
    return 'queued-awaiting-orchestrator';
}
