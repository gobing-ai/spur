import { taskStatusIcon } from '@gobing-ai/spur-domain/schema';
import { useEffect, useState } from 'react';
import { Badge, Button, Checkbox, Loading, MDEditor, Select } from '@/ui';
import {
    createChildFeature,
    createFeatureTask,
    dispatchFeatureAction,
    linkTaskToFeature,
    loadFeatureShow,
    saveFeatureBody,
    syncFeatureStatus,
    transitionFeature,
} from '../../lib/feature-client';
import type { FeatureShowData, SyncDirection } from '../../lib/feature-types';
import MarkdownBody from '../task-kanban/MarkdownBody';
import NewTaskPanel from '../task-kanban/NewTaskPanel';
import type { TaskSummary } from '../task-kanban/types';
import { useTasks } from '../task-kanban/useTasks';
import { FEATURE_ACTION_LABELS, FEATURE_STATUS_ACTIONS, FSM_ACTIONS, FSM_TRANSITION_TARGET } from './feature-actions';
import NewFeaturePanel from './NewFeaturePanel';

interface FeatureDetailProps {
    featureId: string;
    /** Dismiss the docked panel. */
    onClose?: () => void;
}

type BodyMode = 'preview' | 'edit';

/**
 * Right-panel feature detail — frontmatter, workflow actions, and the markdown body.
 *
 * Converges on TaskDetail architecture (0218): MDEditor for body editing, foldable
 * metadata pane with linked tasks, and dynamic button group driven by the centralized
 * FEATURE_STATUS_ACTIONS mapping.
 */
export default function FeatureDetail({ featureId, onClose }: FeatureDetailProps) {
    const [data, setData] = useState<FeatureShowData | null>(null);
    const [serverBody, setServerBody] = useState('');
    const [draftBody, setDraftBody] = useState('');
    const [mode, setMode] = useState<BodyMode>('preview');
    const [loadingBody, setLoadingBody] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [frontmatter, setFrontmatter] = useState<Record<string, unknown>>({});
    const [showMetadata, setShowMetadata] = useState(false);

    // Action dispatch state
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [showCancelModal, setShowCancelModal] = useState(false);
    const [actionModal, setActionModal] = useState<string | null>(null);
    const [inlineModal, setInlineModal] = useState<string | null>(null);
    const [inlineValue, setInlineValue] = useState('');
    const [selectedChannel, setSelectedChannel] = useState<string>('claude');
    const [syncDirection, setSyncDirection] = useState<SyncDirection>('push');
    const [showNewTaskPanel, setShowNewTaskPanel] = useState(false);
    const [showNewFeaturePanel, setShowNewFeaturePanel] = useState(false);

    // Linked tasks: subscribe to the shared TaskStore
    const { tasks } = useTasks();
    const linkedTasks = (tasks ?? []).filter((t: TaskSummary) => t.featureId === featureId);

    // Load feature data when featureId changes
    useEffect(() => {
        if (!featureId) {
            setData(null);
            setServerBody('');
            setDraftBody('');
            setMode('preview');
            setError(null);
            return;
        }

        let cancelled = false;
        setLoadingBody(true);
        setError(null);
        loadFeatureShow(featureId, new AbortController().signal)
            .then((res) => {
                if (cancelled) return;
                setData(res);
                // Strip frontmatter for editor display
                const bodyOnly = stripFrontmatterContent(res.content);
                setServerBody(bodyOnly);
                setDraftBody(bodyOnly);
                setFrontmatter(res.frontmatter);
            })
            .catch((err: unknown) => {
                if (cancelled) return;
                const msg = err instanceof Error ? err.message : 'Failed to load feature';
                setError(msg);
            })
            .finally(() => {
                if (!cancelled) setLoadingBody(false);
            });

        return () => {
            cancelled = true;
        };
    }, [featureId]);

    const handleTaskCreated = async () => {
        setShowNewTaskPanel(false);
        try {
            const fresh = await loadFeatureShow(featureId, new AbortController().signal);
            setData(fresh);
        } catch {
            // Non-critical — list will refresh on next poll
        }
    };

    const handleFeatureCreated = async () => {
        setShowNewFeaturePanel(false);
        try {
            const fresh = await loadFeatureShow(featureId, new AbortController().signal);
            const bodyOnly = stripFrontmatterContent(fresh.content);
            setData(fresh);
            setServerBody(bodyOnly);
            setDraftBody(bodyOnly);
            setFrontmatter(fresh.frontmatter);
        } catch {
            // Non-critical
        }
    };

    if (error) {
        return (
            <div className="flex items-center justify-center h-full p-4">
                <p className="text-sm text-red-500">{error}</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Select a feature to view details
            </div>
        );
    }

    // ── Body editing handlers ──

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
            await saveFeatureBody({ id: featureId, body: draftBody });
            setServerBody(draftBody);
            setMode('preview');
            // Re-fetch to confirm persisted state
            const res = await loadFeatureShow(featureId, new AbortController().signal);
            const bodyOnly = stripFrontmatterContent(res.content);
            setServerBody(bodyOnly);
            setDraftBody(bodyOnly);
            setFrontmatter(res.frontmatter);
        } catch (err: unknown) {
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

    // ── Action dispatch ──

    const handleAction = (action: string) => {
        if (FSM_ACTIONS[action]) {
            handleFSMTransition(action);
            return;
        }
        // Workflow/agent actions need channel selector
        if (action === 'brainstorm' || action === 'plan') {
            setActionModal(action);
            return;
        }
        // Create/link actions need inline input
        // +Child and +Task open dedicated panels
        if (action === 'add-child') {
            setShowNewFeaturePanel(true);
            return;
        }
        if (action === 'add-task') {
            setShowNewTaskPanel(true);
            return;
        }
        // Link task needs inline WBS input
        if (action === 'link-task') {
            setInlineModal(action);
            setInlineValue('');
            return;
        }
        // Sync needs direction selector
        if (action === 'sync-status') {
            setActionModal('sync-status');
            return;
        }
    };

    const handleFSMTransition = async (action: string) => {
        const targetStatus = FSM_TRANSITION_TARGET[action];
        if (!targetStatus) return;

        if (action === 'cancel') {
            setShowCancelModal(true);
            return;
        }

        setActionLoading(action);
        try {
            await transitionFeature(featureId, targetStatus, new AbortController().signal);
            // Reload
            const res = await loadFeatureShow(featureId, new AbortController().signal);
            const bodyOnly = stripFrontmatterContent(res.content);
            setData(res);
            setServerBody(bodyOnly);
            setDraftBody(bodyOnly);
            setFrontmatter(res.frontmatter);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Transition failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setActionLoading(null);
        }
    };

    const handleCancelConfirm = async () => {
        setShowCancelModal(false);
        await handleFSMTransition('cancel');
    };

    const handleInlineConfirm = async () => {
        const action = inlineModal;
        if (!action || !inlineValue.trim()) return;
        setInlineModal(null);
        setActionLoading(action);

        try {
            if (action === 'add-child') {
                await createChildFeature({ id: featureId, name: inlineValue.trim() });
            } else if (action === 'add-task') {
                await createFeatureTask({ id: featureId, title: inlineValue.trim() });
            } else if (action === 'link-task') {
                await linkTaskToFeature({ id: featureId, wbs: inlineValue.trim() });
            }
            // Reload feature
            const res = await loadFeatureShow(featureId, new AbortController().signal);
            setData(res);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Action failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setActionLoading(null);
        }
    };

    const dispatchAgentAction = async () => {
        if (!actionModal) return;
        const action = actionModal;
        setActionModal(null);
        setActionLoading(action);

        try {
            if (action === 'sync-status') {
                await syncFeatureStatus({ id: featureId, direction: syncDirection });
            } else {
                await dispatchFeatureAction({
                    id: featureId,
                    action: action as 'brainstorm' | 'plan',
                    channel: selectedChannel,
                });
            }
            // Reload feature data after action
            const fresh = await loadFeatureShow(featureId, new AbortController().signal);
            setData(fresh);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Action failed';
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setActionLoading(null);
        }
    };

    // ── Metadata helpers ──

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

    const navigateToTask = (wbs: string) => {
        window.location.assign(`/board/tasks/${wbs}`);
    };

    const statusActions = FEATURE_STATUS_ACTIONS[data.status] ?? [];

    return (
        <div className="flex flex-col h-full">
            {/* Header — title, status pill, and action buttons */}
            <div className="flex items-start justify-between gap-3 p-3 border-b border-spur-border shrink-0">
                <div className="flex flex-col gap-1 overflow-hidden">
                    <h3 className="text-sm font-semibold text-spur-text truncate">
                        {data.id} — {data.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1" data-testid="header-chips">
                        <span
                            className="px-2 py-0.5 rounded-full border border-spur-border text-xs text-spur-text-muted"
                            data-testid="status-pill"
                        >
                            {data.status}
                        </span>
                        {typeof data.frontmatter.priority === 'string' && (
                            <span className="px-2 py-0.5 rounded-full bg-spur-accent/15 text-xs text-spur-accent">
                                {data.frontmatter.priority}
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
                    {statusActions.map((action) => {
                        let variant: 'accent' | 'error' | 'outline' = 'accent';
                        if (action === 'cancel') variant = 'error';
                        else if (action === 'add-child' || action === 'add-task' || action === 'link-task')
                            variant = 'outline';
                        return (
                            <Button
                                key={action}
                                variant={variant}
                                size="xs"
                                onClick={() => handleAction(action)}
                                disabled={actionLoading === action}
                                aria-label={FEATURE_ACTION_LABELS[action]}
                            >
                                {actionLoading === action ? '…' : FEATURE_ACTION_LABELS[action]}
                            </Button>
                        );
                    })}
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="text-spur-text-muted"
                            onClick={onClose}
                            aria-label="Close detail"
                        >
                            &#x2715;
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
                        {/* Status */}
                        <div>
                            <span className="text-xs text-spur-text-muted block mb-1.5">Status</span>
                            <span className="text-sm text-spur-text" data-testid="metadata-status">
                                {data.status}
                            </span>
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
                                        <Badge key={t} variant="outline" size="xs" className="text-spur-text-muted">
                                            {t}
                                        </Badge>
                                    ))}
                                </div>
                            </div>
                        )}
                        {/* File path */}
                        <div className="flex items-center gap-1.5 text-xs">
                            <span className="text-spur-text-muted w-14 shrink-0">File</span>
                            <span className="text-spur-text font-mono truncate">{data.filePath}</span>
                        </div>

                        {/* Linked Tasks */}
                        <div>
                            <span className="text-xs text-spur-text-muted block mb-1.5">
                                Linked Tasks ({linkedTasks.length})
                            </span>
                            {linkedTasks.length === 0 ? (
                                <span className="text-xs text-spur-text-muted italic">No linked tasks</span>
                            ) : (
                                <div className="space-y-1">
                                    {linkedTasks.map((t: TaskSummary) => (
                                        <div key={t.wbs} className="flex items-center gap-2 w-full text-xs">
                                            <span className="shrink-0 text-[13px]" title={t.status}>
                                                {taskStatusIcon(t.status)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => navigateToTask(t.wbs)}
                                                className="flex items-center gap-2 flex-1 min-w-0 text-left hover:underline cursor-pointer"
                                                aria-label={`Go to task ${t.wbs}: ${t.name}`}
                                            >
                                                <span className="font-mono text-spur-accent shrink-0">{t.wbs}</span>
                                                <span className="text-spur-text truncate">{t.name}</span>
                                            </button>
                                            <span className="px-1.5 py-0.5 rounded-full border border-spur-border text-[10px] text-spur-text-muted shrink-0">
                                                {t.status}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Body — MDEditor with edit/preview toggle */}
            <div className="flex-1 flex flex-col overflow-hidden p-3" data-testid="feature-body-section">
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
                        <Loading size="xs" className="text-spur-accent" />
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

            {/* Cancel confirmation modal */}
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
                        aria-label="Confirm cancel feature"
                        className="bg-spur-surface border border-spur-border rounded-lg shadow-xl p-4 mx-4 max-w-xs w-full"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setShowCancelModal(false);
                        }}
                    >
                        <p className="text-sm text-spur-text mb-4">
                            Cancel feature <strong>{featureId}</strong>? This marks it as cancelled and cannot be undone
                            from the board.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="xs" onClick={() => setShowCancelModal(false)}>
                                Keep
                            </Button>
                            <Button variant="error" size="xs" onClick={handleCancelConfirm}>
                                Cancel feature
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Channel / sync direction selector modal */}
            {actionModal && (
                // biome-ignore lint/a11y/noStaticElementInteractions: role=presentation with onClick is standard modal backdrop
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onClick={() => setActionModal(null)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setActionModal(null);
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`Configure ${actionModal} action`}
                        className="bg-spur-surface border border-spur-border rounded-lg shadow-xl p-4 mx-4 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setActionModal(null);
                        }}
                    >
                        {actionModal === 'sync-status' ? (
                            <>
                                <h4 className="text-sm font-semibold text-spur-text mb-3">Sync Status — Direction</h4>
                                <div className="space-y-3">
                                    <Select
                                        variant="bordered"
                                        size="sm"
                                        className="w-full bg-spur-bg text-spur-text"
                                        value={syncDirection}
                                        onChange={(e) => setSyncDirection(e.target.value as SyncDirection)}
                                    >
                                        <option value="push">Push (feature → tasks)</option>
                                        <option value="pull">Pull (tasks → feature)</option>
                                    </Select>
                                </div>
                            </>
                        ) : (
                            <>
                                <h4 className="text-sm font-semibold text-spur-text mb-3">
                                    {FEATURE_ACTION_LABELS[actionModal]} — Select Channel
                                </h4>
                                <div className="space-y-3">
                                    <Select
                                        variant="bordered"
                                        size="sm"
                                        className="w-full bg-spur-bg text-spur-text"
                                        value={selectedChannel}
                                        onChange={(e) => setSelectedChannel(e.target.value)}
                                    >
                                        {['claude', 'codex', 'gemini', 'pi', 'opencode', 'antigravity', 'openclaw'].map(
                                            (ch) => (
                                                <option key={ch} value={ch}>
                                                    {ch}
                                                </option>
                                            ),
                                        )}
                                    </Select>
                                    {/* biome-ignore lint/a11y/noLabelWithoutControl: Checkbox renders an input inside the label */}
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <Checkbox size="xs" checked={false} onChange={() => {}} />
                                        <span className="text-xs text-spur-text">Skip dependencies</span>
                                    </label>
                                </div>
                            </>
                        )}
                        <div className="flex justify-end gap-2 mt-4">
                            <Button variant="ghost" size="xs" onClick={() => setActionModal(null)}>
                                Cancel
                            </Button>
                            <Button variant="primary" size="xs" onClick={dispatchAgentAction}>
                                {actionLoading === actionModal ? 'Dispatching…' : 'Dispatch'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Inline input modal (add-child, add-task, link-task) */}
            {inlineModal && (
                // biome-ignore lint/a11y/noStaticElementInteractions: role=presentation with onClick is standard modal backdrop
                <div
                    role="presentation"
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
                    onClick={() => setInlineModal(null)}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setInlineModal(null);
                    }}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${FEATURE_ACTION_LABELS[inlineModal]} input`}
                        className="bg-spur-surface border border-spur-border rounded-lg shadow-xl p-4 mx-4 max-w-sm w-full"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') setInlineModal(null);
                        }}
                    >
                        <h4 className="text-sm font-semibold text-spur-text mb-3">
                            {FEATURE_ACTION_LABELS[inlineModal]}
                        </h4>
                        {inlineModal === 'link-task' ? (
                            <Select
                                variant="bordered"
                                size="sm"
                                className="w-full bg-spur-bg text-spur-text"
                                value={inlineValue}
                                onChange={(e) => setInlineValue(e.target.value)}
                            >
                                <option value="">— Select a task —</option>
                                {(tasks ?? [])
                                    .filter((t: TaskSummary) => t.featureId !== featureId)
                                    .map((t: TaskSummary) => (
                                        <option key={t.wbs} value={t.wbs}>
                                            {t.wbs} — {t.name}
                                        </option>
                                    ))}
                            </Select>
                        ) : (
                            <input
                                type="text"
                                className="w-full px-3 py-2 rounded border border-spur-border bg-spur-bg text-sm text-spur-text focus:outline-none focus:border-spur-accent"
                                placeholder="Enter child feature name"
                                value={inlineValue}
                                onChange={(e) => setInlineValue(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && inlineValue.trim()) {
                                        handleInlineConfirm();
                                    }
                                }}
                            />
                        )}
                        <div className="flex justify-end gap-2 mt-4">
                            <Button variant="ghost" size="xs" onClick={() => setInlineModal(null)}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                size="xs"
                                onClick={handleInlineConfirm}
                                disabled={!inlineValue.trim() || actionLoading === inlineModal}
                            >
                                {actionLoading === inlineModal ? '…' : 'Create'}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* New Task Panel (slide-out from right) */}
            <NewTaskPanel
                open={showNewTaskPanel}
                onClose={() => setShowNewTaskPanel(false)}
                onCreated={handleTaskCreated}
                folder="docs/tasks2"
                featureId={featureId}
            />

            {/* New Feature Panel (slide-out from right) */}
            <NewFeaturePanel
                open={showNewFeaturePanel}
                parentId={featureId}
                onClose={() => setShowNewFeaturePanel(false)}
                onCreated={handleFeatureCreated}
            />
        </div>
    );
}

/** Strip the YAML frontmatter delimiter block so the editor shows body content only. */
function stripFrontmatterContent(raw: string): string {
    // Match `---\n...\n---\n` frontmatter block at the start
    const match = raw.match(/^---\n[\s\S]*?\n---\n/);
    if (!match) return raw;
    return raw.slice(match[0].length);
}
