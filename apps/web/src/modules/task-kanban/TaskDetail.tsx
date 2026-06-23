import { taskStatusIcon } from '@gobing-ai/spur-domain/schema';
import MDEditor from '@uiw/react-md-editor';
import { Button } from '@/ui';
// Base theme for the markdown preview/editor (.wmde-markdown) + bundled Prism
// token colors. Without this import code blocks render unstyled (0101 #4).
import '@uiw/react-md-editor/markdown-editor.css';
import { useEffect, useState } from 'react';
import { api } from '../../lib/rpc-client';
import MarkdownBody from './MarkdownBody';
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
    /** Dismiss the docked panel. Rendered as the ✕ in this component's header. */
    onClose?: () => void;
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

export default function TaskDetail({ task, onTransition, onClose }: Props) {
    const [serverBody, setServerBody] = useState('');
    const [draftBody, setDraftBody] = useState('');
    const [mode, setMode] = useState<BodyMode>('preview');
    const [loadingBody, setLoadingBody] = useState(false);
    const [saving, setSaving] = useState(false);
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
    // Folded by default — matches the legacy detail panel (0101 #2).
    const [showMetadata, setShowMetadata] = useState(false);

    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [actionModal, setActionModal] = useState<string | null>(null);
    const [selectedChannel, setSelectedChannel] = useState<string>('claude');
    const [skipDeps, setSkipDeps] = useState(false);
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
    const handleAction = (action: string) => {
        setActionModal(action);
    };

    const dispatchAction = async () => {
        if (!actionModal || !task) return;
        setActionLoading(actionModal);
        setActionModal(null);
        try {
            await api.task.action({
                wbs: task.wbs,
                action: actionModal as Parameters<typeof api.task.action>[0]['action'],
                channel: selectedChannel,
                skipDeps,
            } as Parameters<typeof api.task.action>[0]);
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
    const estimatedHours = frontmatter.estimated_hours as number | undefined;
    const implProgress = frontmatter.impl_progress as Record<string, string> | undefined;
    const IMPL_PHASES = ['planning', 'design', 'implementation', 'review', 'testing'] as const;
    const implProgressColor = (state: string): string => {
        if (state === 'done') return 'bg-green-500';
        if (state === 'in_progress') return 'bg-amber-500';
        return 'bg-gray-400';
    };
    return (
        <div className="flex flex-col h-full">
            {/* Header — title, status pill, and contextual action buttons (legacy parity) */}
            <div className="flex items-start justify-between gap-3 p-3 border-b border-spur-border shrink-0">
                <div className="flex flex-col gap-1 overflow-hidden">
                    <h3 className="text-sm font-semibold text-spur-text truncate">
                        {task.wbs} — {task.name}
                    </h3>
                    {/* Status pill + key frontmatter chips (Tags / Priority / Feature) */}
                    <div className="flex flex-wrap items-center gap-1" data-testid="header-chips">
                        <span
                            className="px-2 py-0.5 rounded-full border border-spur-border text-xs text-spur-text-muted"
                            data-testid="status-pill"
                        >
                            {taskStatusIcon(task.status)} {task.status}
                        </span>
                        {task.priority && (
                            <span className="px-2 py-0.5 rounded-full bg-spur-accent/15 text-xs text-spur-accent">
                                {task.priority}
                            </span>
                        )}
                        {task.featureId && (
                            <span className="px-2 py-0.5 rounded-full bg-spur-info/15 text-xs text-spur-info">
                                {task.featureId}
                            </span>
                        )}
                        {tags.map((t) => (
                            <span
                                key={t}
                                className="px-2 py-0.5 rounded-full border border-spur-border text-xs text-spur-text-muted"
                            >
                                {t}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1 shrink-0">
                    {(STATUS_ACTIONS[task.status] ?? []).map((action) => (
                        <Button
                            key={action}
                            variant="accent"
                            size="xs"
                            onClick={() => handleAction(action)}
                            disabled={actionLoading === action}
                            aria-label={ACTION_LABELS[action]}
                        >
                            {actionLoading === action ? '…' : ACTION_LABELS[action]}
                        </Button>
                    ))}
                    {task.status !== 'cancelled' && task.status !== 'done' && (
                        <Button
                            variant="error"
                            size="xs"
                            onClick={() => setShowCancelModal(true)}
                            data-testid="header-cancel"
                        >
                            Cancel
                        </Button>
                    )}
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted"
                            onClick={onClose}
                            aria-label="Close detail"
                        >
                            ✕
                        </Button>
                    )}
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
                        {/* Status — plaintext with its icon (read-only here) */}
                        <div>
                            <span className="text-xs text-spur-text-muted block mb-1.5">Status</span>
                            <span className="text-sm text-spur-text" data-testid="metadata-status">
                                {taskStatusIcon(task.status)} {task.status}
                            </span>
                        </div>
                        {/* Phase progress */}
                        <div>
                            <span className="text-xs text-spur-text-muted block mb-1.5">Progress</span>
                            {implProgress ? (
                                <div className="space-y-1">
                                    {IMPL_PHASES.map((phase) => {
                                        const state = implProgress[phase] ?? 'pending';
                                        return (
                                            <div key={phase} className="flex items-center gap-2">
                                                <span className="text-[10px] text-spur-text-muted w-20 shrink-0">
                                                    {phase}
                                                </span>
                                                <div className="flex-1 h-1.5 rounded-full bg-spur-border overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full ${implProgressColor(state)}`}
                                                        style={{
                                                            width:
                                                                state === 'done'
                                                                    ? '100%'
                                                                    : state === 'in_progress'
                                                                      ? '50%'
                                                                      : '0%',
                                                        }}
                                                    />
                                                </div>
                                                <span className="text-[10px] text-spur-text-muted w-16 shrink-0">
                                                    {state}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : OFF_TRACK.has(task.status) ? (
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
                            {!implProgress && (
                                <div className="flex justify-between mt-0.5">
                                    {LIFECYCLE.map((phase) => (
                                        <span key={phase} className="text-[10px] text-spur-text-muted">
                                            {phase}
                                        </span>
                                    ))}
                                </div>
                            )}
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
                            {estimatedHours !== undefined && (
                                <div className="flex items-center gap-1.5 text-xs">
                                    <span className="text-spur-text-muted w-14 shrink-0">Est. Hours</span>
                                    <span className="text-spur-text">{estimatedHours}h</span>
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

            <div className="flex-1 flex flex-col overflow-hidden p-3" data-testid="task-body-section">
                <div className="flex items-center justify-between mb-2 shrink-0">
                    <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">Body</span>
                    <div className="flex gap-1">
                        {mode === 'preview' ? (
                            <Button
                                variant="ghost"
                                size="xs"
                                onClick={handleEdit}
                                disabled={loadingBody}
                                aria-label="Edit body"
                            >
                                Edit
                            </Button>
                        ) : (
                            <>
                                <Button
                                    variant="primary"
                                    size="xs"
                                    onClick={handleSave}
                                    disabled={saving}
                                    aria-label="Save body"
                                >
                                    {saving ? 'Saving…' : 'Save'}
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="xs"
                                    onClick={handleCancel}
                                    disabled={saving}
                                    aria-label="Cancel edit"
                                >
                                    Cancel
                                </Button>
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
                    <div className="flex-1 min-h-0" data-testid="body-editor">
                        <MDEditor
                            value={draftBody}
                            onChange={(val) => setDraftBody(val ?? '')}
                            height="100%"
                            data-color-mode="light"
                        />
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto" data-testid="body-preview">
                        <MarkdownBody source={serverBody} />
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
                            <Button variant="ghost" size="xs" onClick={() => setShowCancelModal(false)}>
                                Keep
                            </Button>
                            <Button
                                variant="error"
                                size="xs"
                                onClick={() => {
                                    setShowCancelModal(false);
                                    onTransition(task.wbs, 'cancelled');
                                }}
                            >
                                Cancel task
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Channel selection modal (R9) */}
            {actionModal && task && (
                // biome-ignore lint/a11y/noStaticElementInteractions: role=presentation with onClick is the standard modal backdrop pattern
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onClick={() => setActionModal(null)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setActionModal(null);
                    }}
                >
                    {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on the dialog body is not an action */}
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Configure ${actionModal} action`}
                        className="bg-spur-surface border border-spur-border rounded-lg shadow-xl p-4 mx-4 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h4 className="text-sm font-semibold text-spur-text mb-3">
                            {ACTION_LABELS[actionModal] ?? actionModal} — Select Channel
                        </h4>
                        <div className="space-y-3">
                            <select
                                className="select select-bordered select-sm w-full bg-spur-bg text-spur-text"
                                value={selectedChannel}
                                onChange={(e) => setSelectedChannel(e.target.value)}
                            >
                                {['claude', 'codex', 'pi', 'opencode', 'antigravity', 'openclaw'].map((ch) => (
                                    <option key={ch} value={ch}>
                                        {ch}
                                    </option>
                                ))}
                            </select>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="checkbox checkbox-xs"
                                    checked={skipDeps}
                                    onChange={(e) => setSkipDeps(e.target.checked)}
                                />
                                <span className="text-xs text-spur-text">Skip dependencies</span>
                            </label>
                        </div>
                        <div className="flex justify-end gap-2 mt-4">
                            <Button variant="ghost" size="xs" onClick={() => setActionModal(null)}>
                                Cancel
                            </Button>
                            <Button variant="primary" size="xs" onClick={dispatchAction}>
                                {actionLoading === actionModal ? 'Dispatching…' : 'Dispatch'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
