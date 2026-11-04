/**
 * Per-project composer draft (0841 R2/R5, feature G63).
 *
 * One record, not a map: the Board origin serves exactly one project (0840),
 * so the stored `path` is a GUARD, not an index — `ProjectRegistry` can hand a
 * previously used port to a different project and browser storage is keyed by
 * origin, so path equality is the only thing distinguishing them. Every
 * storage access is wrapped: corrupt or unavailable storage degrades to an
 * empty draft (prototype ST-1) — never an error state, never a toast.
 *
 * `ConversationDraftContext` is provided by `BoardLayout` (beside
 * `ProjectProvider`) because `GlobalAgentBar` (0844) mounts outside the
 * module; a context owned by `ConversationView` would unmount exactly when it
 * needs it.
 */
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useProjectContext } from './useProjectContext';

export const DRAFT_STORAGE_KEY = 'spur.board.projects.draft.v1';

/**
 * Durable submission identity (0844 R1/R3): the request key minted for the
 * draft revision it was minted from. Persisted BEFORE the POST so a crash
 * mid-submit still lets the retry reuse the identity instead of writing a
 * duplicate request.
 */
export interface DraftPending {
    requestKey: string;
    revision: number;
}

export interface DraftRecord {
    path: string;
    text: string;
    revision: number;
    pending?: DraftPending;
}

export function emptyDraft(path: string): DraftRecord {
    return { path, text: '', revision: 0 };
}

/** Shape-check a parsed record; anything but the exact v1 shape is no draft. */
function parseDraftRecord(parsed: unknown): DraftRecord | null {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.path !== 'string' || typeof r.text !== 'string') return null;
    if (typeof r.revision !== 'number' || !Number.isFinite(r.revision)) return null;
    // `pending` (0844) is additive and optional; consumers re-validate it
    // (typeof requestKey === 'string') rather than the loader dropping it. A legacy
    // `refs` key (retired with the SPUR-REQUEST/1 envelope, G11 1269) is ignored, not rejected.
    const draft: DraftRecord = { path: r.path, text: r.text, revision: r.revision };
    if (r.pending !== undefined) draft.pending = r.pending as DraftPending;
    return draft;
}

/**
 * Load the draft for `servedPath`, never throwing. The stored record is
 * returned only when its `path` matches the served path — any other outcome
 * (absent key, invalid JSON, wrong shape, path mismatch) yields an empty
 * draft, and a shape-valid-but-foreign or garbage record is overwritten so
 * port reuse cannot resurrect another project's draft.
 */
export function loadDraft(servedPath: string): DraftRecord {
    try {
        const raw = globalThis.localStorage?.getItem(DRAFT_STORAGE_KEY);
        if (raw === null || raw === undefined) return emptyDraft(servedPath);
        const rec = parseDraftRecord(JSON.parse(raw));
        if (rec === null || rec.path !== servedPath) {
            saveDraft(emptyDraft(servedPath));
            return emptyDraft(servedPath);
        }
        return rec;
    } catch {
        return emptyDraft(servedPath);
    }
}

/** Persist the draft; any storage failure is swallowed (R5 — storage is best-effort). */
export function saveDraft(draft: DraftRecord): void {
    try {
        globalThis.localStorage?.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
    } catch {
        // Unavailable/quota-exceeded storage degrades to an unsaved draft.
    }
}

/** The shared composer draft — provided by BoardLayout, consumed by the views. */
export interface ConversationDraft {
    draft: DraftRecord;
    setText(text: string): void;
    /**
     * Persist the submission identity for the CURRENT revision (0844 R1/R3):
     * called before the POST so a crash mid-submit still lets the retry reuse
     * the key. The revision is intentionally unchanged — pending rides on the
     * revision it was minted for.
     */
    persistPending(requestKey: string): void;
    /**
     * Clear exactly the submitted revision (0844 R2): a no-op when any newer
     * edit has landed since submission or the served project changed —
     * the newer edit survives verbatim, checked against LIVE state inside the
     * functional update.
     */
    clearSubmitted(submittedRevision: number, submittedPath: string): void;
}

const noopDraft: ConversationDraft = {
    draft: emptyDraft(''),
    setText: () => {},
    persistPending: () => {},
    clearSubmitted: () => {},
};

export const ConversationDraftContext = createContext<ConversationDraft>(noopDraft);

export function useConversationDraft(): ConversationDraft {
    return useContext(ConversationDraftContext);
}

/**
 * Provider mounted in `BoardLayout` beside `ProjectProvider`. Holds the draft
 * record; the views render it. Context writes use functional updates so a
 * concurrent state landing (0840 review F2 pattern) is never clobbered, and
 * each mutation persists the record through the same guarded save.
 */
export function ConversationDraftProvider({ children }: { children: ReactNode }) {
    const project = useProjectContext();
    const servedPath = project.path;
    const [draft, setDraft] = useState<DraftRecord>(() => emptyDraft(''));

    // Re-load whenever the served identity resolves or changes — loadDraft's
    // path guard is what clears a foreign project's stale record.
    useEffect(() => {
        if (servedPath === null) return;
        setDraft(loadDraft(servedPath));
    }, [servedPath]);

    const value = useMemo<ConversationDraft>(
        () => ({
            draft,
            setText: (text) =>
                setDraft((prev) => {
                    if (prev.path !== servedPath) return prev;
                    const next = { ...prev, text, revision: prev.revision + 1 };
                    saveDraft(next);
                    return next;
                }),
            persistPending: (requestKey) =>
                setDraft((prev) => {
                    if (prev.path !== draft.path || prev.revision !== draft.revision) return prev;
                    const next = { ...prev, pending: { requestKey, revision: prev.revision } };
                    saveDraft(next);
                    return next;
                }),
            clearSubmitted: (submittedRevision, submittedPath) =>
                setDraft((prev) => {
                    if (prev.path !== submittedPath) return prev;
                    if (prev.revision !== submittedRevision) return prev; // newer edit exists — leave it alone (R2)
                    const next = { path: prev.path, text: '', revision: prev.revision + 1 };
                    saveDraft(next);
                    return next;
                }),
        }),
        [draft, servedPath],
    );

    return <ConversationDraftContext.Provider value={value}>{children}</ConversationDraftContext.Provider>;
}
