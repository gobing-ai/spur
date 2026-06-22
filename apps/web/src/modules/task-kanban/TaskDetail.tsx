import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import MDEditor from '@uiw/react-md-editor';
import { useEffect, useState } from 'react';
import { api } from '../../lib/rpc-client';
import type { TaskSummary } from './types';

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
export default function TaskDetail({ task, onTransition }: Props) {
    const [serverBody, setServerBody] = useState('');
    const [draftBody, setDraftBody] = useState('');
    const [mode, setMode] = useState<BodyMode>('preview');
    const [loadingBody, setLoadingBody] = useState(false);
    const [saving, setSaving] = useState(false);

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
                const content = res.data.content;
                setServerBody(content);
                setDraftBody(content);
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

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-spur-border shrink-0">
                <h3 className="text-sm font-semibold text-spur-text mb-1">{task.wbs}</h3>
                <p className="text-sm text-spur-text">{task.name}</p>
            </div>

            <div className="p-3 border-b border-spur-border shrink-0">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide mb-2 block">
                    Status
                </span>
                <div className="flex flex-wrap gap-1">
                    {(TASK_STATUSES as readonly string[]).map((s: string) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => onTransition(task.wbs, s)}
                            className={`btn btn-xs ${task.status === s ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            <div className="p-3 border-b border-spur-border shrink-0">
                <div className="space-y-2">
                    {task.priority && (
                        <div>
                            <span className="text-xs text-spur-text-muted">Priority</span>
                            <span className="badge badge-outline badge-xs ml-2">{task.priority}</span>
                        </div>
                    )}
                    {task.featureId && (
                        <div>
                            <span className="text-xs text-spur-text-muted">Feature</span>
                            <span className="text-sm text-spur-text ml-2">{task.featureId}</span>
                        </div>
                    )}
                    <div>
                        <span className="text-xs text-spur-text-muted">File</span>
                        <span className="text-xs text-spur-text ml-2 font-mono">{task.filePath}</span>
                    </div>
                </div>
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
        </div>
    );
}
