import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import MDEditor from '@uiw/react-md-editor';
import { useEffect, useState } from 'react';
import { api } from '../../lib/rpc-client';
import type { TaskSummary } from './types';
import { useTasks } from './useTasks';

/** Actions offered per task status. The server is the validation authority — this is UX only. */
const STATUS_ACTIONS: Record<string, readonly string[]> = {
    backlog: ['refine', 'plan'],
    todo: ['plan', 'run', 'decompose'],
    wip: ['run', 'verify', 'evaluate'],
    testing: ['verify', 'evaluate'],
    blocked: ['refine'],
};

/** Label for each action button. */
const ACTION_LABELS: Record<string, string> = {
    refine: 'Refine',
    plan: 'Plan',
    run: 'Run',
    verify: 'Verify',
    decompose: 'Decompose',
    evaluate: 'Evaluate',
};

interface Props {
    /** Selected task, resolved by the container from the polled list (null when nothing is selected). */
    task: TaskSummary | null;
    onTransition: (wbs: string, toStatus: string) => void;
}

type BodyMode = 'preview' | 'edit';

/**
 * Right-panel task detail — frontmatter, status transitions, and the markdown body.
 * The body is fetched via `api.task.show` on selection and rendered with @uiw/react-md-editor.
 * Inline editing (Save/Cancel) calls the body-write API (0090); a server denial reverts and
 * surfaces an error via the `api-error` CustomEvent (same surface as KanbanBoard).
 */
const LIFECYCLE = ['backlog', 'todo', 'wip', 'testing', 'done'] as const;

/** Off-track states that don't map to a lifecycle position. */
const OFF_TRACK = new Set(['blocked', 'cancelled']);

export default function TaskDetail({ task, onTransition }: Props) {
    const [serverBody, setServerBody] = useState('');
    const [draftBody, setDraftBody] = useState('');
    const [mode, setMode] = useState<BodyMode>('preview');
    const [loadingBody, setLoadingBody] = useState(false);
    const [saving, setSaving] = useState(false);
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
    const [showMetadata, setShowMetadata] = useState(true);

    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const { setTasks } = useTasks();

    // R4: depends on wbs only — the 5s poll refreshes the list (new object refs)
    // but wbs is stable, so the editor is never clobbered by a poll.
    const wbs = task?.wbs;
    useEffect(() => {
        if (!wbs) {
            setServerBody('');
            setDraftBody('');
            setMode('preview');
            return;
        }

        let cancelled = false;
        setLoadingBody(true);
        api.task
            .show({ wbs })
            .then((res) => {
                if (cancelled) return;
                const { content, frontmatter: fm } = res.data;
                setServerBody(content);
                setDraftBody(content);
                setFrontmatter(fm);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : 'Failed to load task body';
                if (typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
                }
            })
            .finally(() => {
                if (!cancelled) setLoadingBody(false);
            });
        return () => {
            cancelled = true;
        };
    }, [wbs]);

    if (!task) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Select a task to view details
            </div>
        );
    }

    const handleEdit = () => {
        setDraftBody(serverBody);
        setMode('edit');
    };

    const handleCancel = () => {
        setDraftBody(serverBody);
        setMode('preview');
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await api.task.body({ wbs: task.wbs, body: draftBody });
            setServerBody(draftBody);
            setMode('preview');
            // Re-fetch so the rendered body matches the persisted server state.
            const res = await api.task.show({ wbs: task.wbs });
            const content = res.data.content;
            setServerBody(content);
            setDraftBody(content);
        } catch (err: unknown) {
            // R3: revert to server state and surface the error — never silently drop the edit.
            setDraftBody(serverBody);
            setMode('preview');
            const msg = err instanceof Error ? err.message : 'Save failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setSaving(false);
        }
    };

    const handleAction = async (action: string) => {
        setActionLoading(action);
        try {
            await api.task.action({ wbs: task.wbs, action } as Parameters<typeof api.task.action>[0]);
            // Trigger an immediate refresh so status/progress changes surface without waiting for the 5s poll.
            const res = await api.task.list({});
            setTasks((res.data as unknown as TaskSummary[]) ?? []);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Action failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setActionLoading(null);
        }
    };

    const lifecycleIndex = (status: string): number => {
        const idx = LIFECYCLE.indexOf(status as (typeof LIFECYCLE)[number]);
        return idx >= 0 ? idx : -1;
    };

    const formatDate = (raw: unknown): string => {
        if (!raw) return '';
        try {
            const d = new Date(raw as string);
            if (Number.isNaN(d.getTime())) return '';
            return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        } catch {
            return '';
        }
    };

    const relativeDays = (raw: unknown): string => {
        if (!raw) return '';
        try {
            const d = new Date(raw as string);
            if (Number.isNaN(d.getTime())) return '';
            const diff = Date.now() - d.getTime();
            const days = Math.floor(diff / 86400000);
            if (days === 0) return 'today';
            if (days === 1) return 'yesterday';
            if (days < 30) return `${days}d ago`;
            if (days < 365) return `${Math.floor(days / 30)}mo ago`;
            return `${Math.floor(days / 365)}y ago`;
        } catch {
            return '';
        }
    };

    const tags = Array.isArray(frontmatter.tags) ? (frontmatter.tags as string[]) : [];
    const created = formatDate(frontmatter.created_at);
    const createdRel = relativeDays(frontmatter.created_at);
    const updated = formatDate(frontmatter.updated_at);
    const updatedRel = relativeDays(frontmatter.updated_at);
    const statusIdx = lifecycleIndex(task.status);
    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-spur-border shrink-0">
                <h3 className="text-sm font-semibold text-spur-text mb-1">{task.wbs}</h3>
                <p className="text-sm text-spur-text">{task.name}</p>
            </div>

            {/* Workflow action buttons — contextual to task status */}
            {(() => {
                const allowed = STATUS_ACTIONS[task.status];
                if (!allowed || allowed.length === 0) return null;
                return (
                    <div className="p-3 border-b border-spur-border shrink-0">
                        <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide mb-2 block">
                            Actions
                        </span>
                        <div className="flex flex-wrap gap-1">
                            {allowed.map((action) => (
                                <button
                                    key={action}
                                    type="button"
                                    onClick={() => handleAction(action)}
                                    disabled={actionLoading === action}
                                    className="btn btn-xs btn-accent"
                                    aria-label={ACTION_LABELS[action]}
                                >
                                    {actionLoading === action ? '…' : ACTION_LABELS[action]}
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })()}

            <div className="p-3 border-b border-spur-border shrink-0">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide mb-2 block">
                    Status
                </span>
                <div className="flex flex-wrap gap-1">
                    {(TASK_STATUSES as readonly string[]).map((s: string) => {
                        const isCancelled = s === 'cancelled';
                        return (
                            <button
                                key={s}
                                type="button"
                                onClick={() => (isCancelled ? setShowCancelModal(true) : onTransition(task.wbs, s))}
                                className={`btn btn-xs ${task.status === s ? 'btn-primary' : 'btn-ghost'}`}
                            >
                                {s}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Metadata pane — collapsible */}
            <div className="border-b border-spur-border shrink-0">
                <button
                    type="button"
                    onClick={() => setShowMetadata((v) => !v)}
                    className="flex items-center justify-between w-full p-3 text-xs font-semibold text-spur-text-muted uppercase tracking-wide hover:text-spur-text transition-colors"
                    aria-expanded={showMetadata}
                >
                    <span>Metadata</span>
                    <svg
                        className={`w-3 h-3 transition-transform ${showMetadata ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                    >
                        <title>{showMetadata ? 'Collapse metadata' : 'Expand metadata'}</title>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                </button>
                {showMetadata && (
                    <div className="px-3 pb-3 space-y-3">
                        {/* Phase progress */}
                        <div>
                            <span className="text-xs text-spur-text-muted block mb-1.5">Progress</span>
                            {OFF_TRACK.has(task.status) ? (
                                <span className="badge badge-warning badge-xs">{task.status}</span>
                            ) : (
                                <div className="flex items-center gap-1">
                                    {LIFECYCLE.map((phase, i) => {
                                        const isDone = i <= statusIdx;
                                        const isCurrent = i === statusIdx;
                                        return (
                                            <div key={phase} className="flex items-center gap-1 flex-1 last:flex-none">
                                                <div
                                                    className={`h-1.5 rounded-full flex-1 ${
                                                        isDone ? 'bg-spur-accent' : 'bg-spur-border'
                                                    } ${isCurrent ? 'ring-1 ring-spur-accent/50' : ''}`}
                                                    title={phase}
                                                />
                                                {i < LIFECYCLE.length - 1 && (
                                                    <span className="text-[10px] text-spur-text-muted w-0" />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                            <div className="flex justify-between mt-0.5">
                                {LIFECYCLE.map((phase) => (
                                    <span key={phase} className="text-[10px] text-spur-text-muted">
                                        {phase}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Dates */}
                        {(created || updated) && (
                            <div className="space-y-1.5">
                                <span className="text-xs text-spur-text-muted block">Dates</span>
                                {created && (
                                    <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-spur-text-muted w-14 shrink-0">Created</span>
                                        <span className="text-spur-text">{created}</span>
                                        <span className="text-spur-text-muted">({createdRel})</span>
                                    </div>
                                )}
                                {updated && (
                                    <div className="flex items-center gap-1.5 text-xs">
                                        <span className="text-spur-text-muted w-14 shrink-0">Updated</span>
                                        <span className="text-spur-text">{updated}</span>
                                        <span className="text-spur-text-muted">({updatedRel})</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Tags */}
                        {tags.length > 0 && (
                            <div>
                                <span className="text-xs text-spur-text-muted block mb-1.5">Tags</span>
                                <div className="flex flex-wrap gap-1">
                                    {tags.map((t) => (
                                        <span key={t} className="badge badge-outline badge-xs text-spur-text-muted">
                                            {t}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Priority / Feature / File */}
                        <div className="space-y-1.5">
                            {task.priority && (
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-spur-text-muted w-14 shrink-0">Priority</span>
                                    <span className="badge badge-outline badge-xs">{task.priority}</span>
                                </div>
                            )}
                            {task.featureId && (
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-spur-text-muted w-14 shrink-0">Feature</span>
                                    <span className="text-spur-text">{task.featureId}</span>
                                </div>
                            )}
                            <div className="flex items-center gap-1.5 text-xs">
                                <span className="text-spur-text-muted w-14 shrink-0">File</span>
                                <span className="text-spur-text font-mono truncate">{task.filePath}</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-y-auto p-3" data-testid="task-body-section">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Body</span>
                    <div className="flex gap-1">
                        {mode === 'preview' ? (
                            <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={handleEdit}
                                disabled={loadingBody}
                                aria-label="Edit body"
                            >
                                Edit
                            </button>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className="btn btn-xs btn-primary"
                                    onClick={handleSave}
                                    disabled={saving}
                                    aria-label="Save body"
                                >
                                    {saving ? 'Saving…' : 'Save'}
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-xs btn-ghost"
                                    onClick={handleCancel}
                                    disabled={saving}
                                    aria-label="Cancel edit"
                                >
                                    Cancel
                                </button>
                            </>
                        )}
                    </div>
                </div>
                {loadingBody ? (
                    <div className="flex items-center gap-2 text-sm text-spur-text-muted">
                        <span className="loading loading-spinner loading-xs text-spur-accent" />
                        Loading body…
                    </div>
                ) : mode === 'edit' ? (
                    <div data-testid="body-editor">
                        <MDEditor value={draftBody} onChange={(val) => setDraftBody(val ?? '')} height={400} />
                    </div>
                ) : (
                    <div data-testid="body-preview">
                        <MDEditor.Markdown source={serverBody} />
                    </div>
                )}
            </div>

            {/* Cancel confirmation modal (R4) */}
            {showCancelModal && (
                // biome-ignore lint/a11y/noStaticElementInteractions: role=presentation with onClick is the standard modal backdrop pattern
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onClick={() => setShowCancelModal(false)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setShowCancelModal(false);
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Confirm cancel task"
                        className="bg-spur-surface border border-spur-border rounded-lg shadow-xl p-4 mx-4 max-w-xs w-full"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setShowCancelModal(false);
                        }}
                    >
                        <p className="text-sm text-spur-text mb-4">
                            Cancel task <strong>{task.wbs}</strong>? This marks it as cancelled and cannot be undone
                            from the board.
                        </p>
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                className="btn btn-xs btn-ghost"
                                onClick={() => setShowCancelModal(false)}
                            >
                                Keep
                            </button>
                            <button
                                type="button"
                                className="btn btn-xs btn-error"
                                onClick={() => {
                                    setShowCancelModal(false);
                                    onTransition(task.wbs, 'cancelled');
                                }}
                            >
                                Cancel task
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
