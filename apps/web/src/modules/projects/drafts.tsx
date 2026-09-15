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
import type { ConversationRef } from './conversation';
import { sameRef } from './conversation';
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
    refs: ConversationRef[];
    revision: number;
    pending?: DraftPending;
}

export function emptyDraft(path: string): DraftRecord {
    return { path, text: '', refs: [], revision: 0 };
}

function isRef(value: unknown): value is ConversationRef {
    if (value === null || typeof value !== 'object') return false;
    const r = value as Record<string, unknown>;
    if (r.kind === 'task') return typeof r.wbs === 'string' && r.wbs.length > 0;
    if (r.kind === 'feature') return typeof r.id === 'string' && r.id.length > 0;
    return false;
}

/** Shape-check a parsed record; anything but the exact v1 shape is no draft. */
function parseDraftRecord(parsed: unknown): DraftRecord | null {
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const r = parsed as Record<string, unknown>;
    if (typeof r.path !== 'string' || typeof r.text !== 'string') return null;
    if (typeof r.revision !== 'number' || !Number.isFinite(r.revision)) return null;
    if (!Array.isArray(r.refs) || !r.refs.every((ref) => isRef(ref))) return null;
    // `pending` (0844) is additive and optional; consumers re-validate it
    // (typeof requestKey === 'string') rather than the loader dropping it.
    return { ...r, path: r.path, text: r.text, refs: r.refs, revision: r.revision } as DraftRecord;
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
    addRef(ref: ConversationRef): void; // deduplicates by kind + id
    removeRef(ref: ConversationRef): void;
    /**
     * Persist the submission identity for the CURRENT revision (0844 R1/R3):
     * called before the POST so a crash mid-submit still lets the retry reuse
     * the key. The revision is intentionally unchanged — pending rides on the
     * revision it was minted for.
     */
    persistPending(requestKey: string): void;
    /**
     * Clear exactly the submitted revision (0844 R2): a no-op when any newer
     * edit has landed since submission (`revision !== submittedRevision`) —
     * the newer edit survives verbatim, checked against LIVE state inside the
     * functional update.
     */
    clearSubmitted(submittedRevision: number): void;
}

const noopDraft: ConversationDraft = {
    draft: emptyDraft(''),
    setText: () => {},
    addRef: () => {},
    removeRef: () => {},
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
                    if (prev.path === '') return prev; // identity not resolved yet — nothing to guard or persist
                    const next = { ...prev, text, revision: prev.revision + 1 };
                    saveDraft(next);
                    return next;
                }),
            addRef: (ref) =>
                setDraft((prev) => {
                    if (prev.path === '') return prev;
                    if (prev.refs.some((r) => sameRef(r, ref))) return prev; // dedupe by kind + id
                    const next = { ...prev, refs: [...prev.refs, ref], revision: prev.revision + 1 };
                    saveDraft(next);
                    return next;
                }),
            removeRef: (ref) =>
                setDraft((prev) => {
                    if (prev.path === '') return prev;
                    if (!prev.refs.some((r) => sameRef(r, ref))) return prev;
                    const next = {
                        ...prev,
                        refs: prev.refs.filter((r) => !sameRef(r, ref)),
                        revision: prev.revision + 1,
                    };
                    saveDraft(next);
                    return next;
                }),
            persistPending: (requestKey) =>
                setDraft((prev) => {
                    if (prev.path === '') return prev;
                    const next = { ...prev, pending: { requestKey, revision: prev.revision } };
                    saveDraft(next);
                    return next;
                }),
            clearSubmitted: (submittedRevision) =>
                setDraft((prev) => {
                    if (prev.path === '') return prev;
                    if (prev.revision !== submittedRevision) return prev; // newer edit exists — leave it alone (R2)
                    const next = { path: prev.path, text: '', refs: [], revision: prev.revision + 1 };
                    saveDraft(next);
                    return next;
                }),
        }),
        [draft],
    );

    return <ConversationDraftContext.Provider value={value}>{children}</ConversationDraftContext.Provider>;
}
