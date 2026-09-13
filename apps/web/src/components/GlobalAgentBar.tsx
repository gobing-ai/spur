import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { Badge, Button, Textarea } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../lib/rpc-client';
import { encodeRequestEnvelope, OPERATOR_AGENT_ID } from '../modules/projects/conversation';
import { useConversationDraft } from '../modules/projects/drafts';
import { classifyReceipt, RECEIPT_LABELS } from '../modules/projects/receipt';
import { useProjectContext } from '../modules/projects/useProjectContext';
import { useProjectRequests } from '../modules/projects/useProjectRequests';
import type { WebModule } from '../modules/types';

export interface GlobalAgentBarProps {
    /** Module resolved from the current /board/<route> segment; undefined off a module route. */
    activeModule?: WebModule;
}

/** The one key that submits the composer (G63 R7 / 0845 R1). */
const COMPOSER_SUBMIT_KEY = 'Enter';
/** Legacy composition signal some IMEs still emit on the composition-ending Enter (R1). */
const IME_KEYCODE = 229;

/**
 * One submit decision for the composer keyboard (0845 R1): plain Enter
 * submits; Shift+Enter and an Enter that ends an IME composition never do.
 * BOTH composition signals are checked — `isComposing` is the standard one
 * happy-dom honours, `keyCode === 229` the legacy one some IMEs emit; checking
 * only one is the exact defect R1 names.
 */
function shouldSubmit(e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean {
    return (
        e.key === COMPOSER_SUBMIT_KEY &&
        !e.shiftKey &&
        !e.nativeEvent.isComposing &&
        e.nativeEvent.keyCode !== IME_KEYCODE
    );
}

const MODULE_CHIPS: Record<string, readonly string[]> = {
    features: ['Decompose feature', 'Verify acceptance criteria'],
    tasks: ['Run task', 'Check readiness', 'Refine requirements'],
    observability: ['Explain recent failure', 'Audit doctor status'],
    history: ['Summarize session', 'Find recurring bottlenecks'],
};

/** No orchestrator instance bound (0836 vocabulary): submission cannot be delivered. */
function orchestratorUnbound(fleet: ReturnType<typeof useProjectContext>['fleet']): boolean {
    if (!fleet) return true;
    const { state, instanceId } = fleet.orchestrator;
    return state === 'missing' || state === 'unresolvable' || !instanceId;
}

/**
 * Foldable global orchestrator agent bar (feature A7 / task 0779; submission
 * and receipt states are 0844). Mounted globally by `BoardLayout` — inside
 * `ProjectProvider` + `ConversationDraftProvider` — so it is available on
 * every Board route (R7) and submits the SAME shared draft the Conversation
 * view renders: no second composer, no second draft store.
 *
 * Submission persists the request identity (`pending`) BEFORE the POST (R1),
 * clears only the submitted revision (R2), and keeps the draft + identity on
 * a failed ack so a retry reuses the same requestKey (R3). Results render from
 * the closed receipt vocabulary (`receipt.ts`); a run exit is never shown as a
 * verified result.
 */
export default function GlobalAgentBar({ activeModule }: GlobalAgentBarProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [inFlight, setInFlight] = useState(false);
    /** `msgId` of the last accepted submission — joins the thread to the results feed. */
    const [lastMessageId, setLastMessageId] = useState<string | null>(null);

    const project = useProjectContext();
    const { draft, setText, persistPending, clearSubmitted } = useConversationDraft();
    const instanceId = project.fleet?.orchestrator?.instanceId;
    const unbound = orchestratorUnbound(project.fleet);
    const { requests, failed: feedFailed } = useProjectRequests(instanceId ?? null);

    const contextLabel = activeModule?.sidebarLabel ?? activeModule?.name ?? 'Board';
    const chips = activeModule?.id ? MODULE_CHIPS[activeModule.id] : undefined;

    const receipt = lastMessageId !== null ? (requests.get(lastMessageId) ?? null) : null;
    const receiptState = classifyReceipt(receipt, project.fleet, inFlight);
    const label = RECEIPT_LABELS[receiptState];
    const showReceipt = inFlight || lastMessageId !== null;
    // R3 announcement: the same words the visible strip shows — label plus its
    // one action — written into a stable polite region so a transition made
    // while the bar is collapsed is still announced (0845).
    const liveText = showReceipt ? `${label.label} — Next: ${label.action}` : '';

    const handleSubmit = async () => {
        const path = project.path;
        if (path === null || instanceId === undefined || inFlight) return;
        const text = draft.text;
        if (text.trim().length === 0) return;
        const submitted = { text, refs: draft.refs, revision: draft.revision };
        // Reuse the pending identity only when it was minted for THIS revision
        // (R3): an edited payload mints a new key. Consumer-side guard — the
        // loader keeps `pending` additive and unvalidated.
        const pending =
            draft.pending !== undefined &&
            typeof draft.pending.requestKey === 'string' &&
            draft.pending.requestKey.length > 0 &&
            draft.pending.revision === draft.revision
                ? draft.pending
                : undefined;
        const requestKey = pending !== undefined ? pending.requestKey : crypto.randomUUID();
        // Durable identity BEFORE the POST (R1): a crash mid-submit leaves the
        // retry able to reuse the same key instead of writing a duplicate.
        persistPending(requestKey);
        setInFlight(true);
        setLastMessageId(null);
        try {
            const res = await fetchWithTimeout(
                new Request(`${resolveApiUrl()}/messages`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        to: instanceId,
                        from: OPERATOR_AGENT_ID,
                        body: encodeRequestEnvelope(submitted.text, submitted.refs),
                        requestKey,
                        projectPath: path,
                    }),
                }),
            );
            if (!res.ok) return; // failed ack — draft + pending stay intact (R3)
            const payload: unknown = await res.json().catch(() => null);
            const msgId = (payload as { msgId?: unknown } | null)?.msgId;
            setLastMessageId(typeof msgId === 'string' ? msgId : null);
            // Clear ONLY the submitted revision (R2): a no-op when a newer
            // edit exists, so the newer edit survives.
            clearSubmitted(submitted.revision);
        } catch {
            // Network failure — same as a failed ack: draft + pending intact (R3).
        } finally {
            setInFlight(false);
        }
    };

    const handleChipClick = (chipText: string) => {
        setText(chipText);
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="agent-bar-input"]');
        input?.focus();
    };

    if (!isOpen) {
        return (
            <>
                {/* R3: present in BOTH branches — a receipt that changes while the
                bar is folded is still announced (0845). */}
                <div role="status" aria-live="polite" className="sr-only" data-agent-bar-live>
                    {liveText}
                </div>
                <Button
                    variant="ghost"
                    className="fixed bottom-6 right-6 z-30 h-12 w-12 rounded-full backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl text-xl"
                    onClick={() => setIsOpen(true)}
                    aria-label="Open agent prompt bar"
                    aria-expanded={false}
                    data-testid="agent-bar-dock"
                >
                    ✨
                </Button>
            </>
        );
    }

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-30 w-[calc(100vw-2rem)] max-w-[84rem] backdrop-blur-md bg-base-100/80 border border-spur-border shadow-2xl rounded-2xl p-2.5 flex flex-col gap-2"
            data-testid="agent-bar"
        >
            <div role="status" aria-live="polite" className="sr-only" data-agent-bar-live>
                {liveText}
            </div>
            <div className="flex items-center gap-2">
                <Badge variant="outline" size="sm" className="shrink-0 font-mono">
                    agent · stub
                </Badge>
                <Badge variant="neutral" size="sm" className="shrink-0 font-mono" data-testid="agent-bar-context">
                    Context: {contextLabel}
                </Badge>
                <Textarea
                    rows={1}
                    value={draft.text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        // R1: preventDefault BEFORE submit so a submitting Enter
                        // never also inserts a newline; on false the event is left
                        // alone so Shift+Enter inserts the newline natively. One
                        // submit path — the same handleSubmit the Send button uses.
                        if (!shouldSubmit(e)) return;
                        e.preventDefault();
                        void handleSubmit();
                    }}
                    placeholder="Ask a coding agent to refine or implement this feature…"
                    aria-label="Agent prompt"
                    className="flex-1 min-h-9 resize-none bg-transparent"
                    data-testid="agent-bar-input"
                />
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDrawerOpen((prev) => !prev)}
                    aria-label="Toggle execution telemetry drawer"
                    aria-expanded={drawerOpen}
                    data-testid="agent-bar-drawer-toggle"
                >
                    ⚡
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    disabled={draft.text.trim().length === 0 || unbound}
                    onClick={() => void handleSubmit()}
                >
                    Send
                </Button>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setIsOpen(false)}
                    aria-label="Collapse agent prompt bar"
                    aria-expanded={true}
                >
                    ▾
                </Button>
            </div>

            {unbound && (
                <div
                    data-testid="agent-bar-orchestrator-missing"
                    role="status"
                    className="px-1 text-xs text-spur-text-muted"
                >
                    Orchestrator unavailable — no orchestrator instance is bound to this project, so requests cannot be
                    delivered yet.
                </div>
            )}

            {chips && chips.length > 0 && (
                <div data-testid="agent-bar-chips" className="flex items-center gap-1.5 flex-wrap px-1">
                    {chips.map((chip) => (
                        <button
                            key={chip}
                            type="button"
                            onClick={() => handleChipClick(chip)}
                            className="text-xs px-2.5 py-0.5 rounded-full border border-spur-border bg-spur-surface/80 hover:bg-spur-border/40 text-spur-text-muted hover:text-spur-text transition-colors"
                        >
                            {chip}
                        </button>
                    ))}
                </div>
            )}

            {drawerOpen && (
                <div
                    data-testid="agent-bar-drawer"
                    className="rounded-lg border border-spur-border bg-spur-surface/60 p-2.5 text-xs text-spur-text-muted"
                >
                    <div role="status">Streamed telemetry and tool calls are not wired yet.</div>
                </div>
            )}

            {showReceipt && (
                <div
                    data-receipt-state={receiptState}
                    role="status"
                    className={`rounded-lg px-2.5 py-1 text-xs ${
                        label.tone === 'err'
                            ? 'bg-spur-error/10 text-spur-error'
                            : label.tone === 'warn'
                              ? 'bg-spur-warning/10 text-spur-warning'
                              : 'bg-spur-success/10 text-spur-success'
                    }`}
                >
                    <span aria-hidden="true" className="mr-1">
                        {label.icon}
                    </span>
                    <span className="font-medium">{label.label}</span>
                    <span className="text-spur-text-muted">
                        {' '}
                        — {label.meaning} Next: {label.action}.
                    </span>
                    {feedFailed && <span className="text-spur-text-muted"> (results feed unavailable)</span>}
                </div>
            )}
        </div>
    );
}
