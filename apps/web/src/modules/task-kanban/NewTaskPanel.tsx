import { useState } from 'react';
import { api } from '../../lib/rpc-client';

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    folder: string;
}

/**
 * Slide-out panel for creating a new task. Feeds the existing `task.create` oRPC
 * endpoint. If Background/Requirements are entered, follows the create with a
 * `bodyUpdate` to seed the body. On success, closes the panel and triggers a
 * board refresh via `onCreated`.
 */
export default function NewTaskPanel({ open, onClose, onCreated, folder }: Props) {
    const [name, setName] = useState('');
    const [background, setBackground] = useState('');
    const [requirements, setRequirements] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [nameTouched, setNameTouched] = useState(false);

    const nameError = nameTouched && name.trim() === '' ? 'Name is required' : '';

    const handleClose = () => {
        if (submitting) return;
        setName('');
        setBackground('');
        setRequirements('');
        setError('');
        setNameTouched(false);
        onClose();
    };

    const handleSubmit = async () => {
        setNameTouched(true);
        const trimmed = name.trim();
        if (trimmed === '') return;

        setSubmitting(true);
        setError('');

        try {
            const res = await api.task.create({ title: trimmed, folder });
            const wbs = res.data.wbs;

            // If Background or Requirements were entered, seed the body via bodyUpdate
            const bodyParts: string[] = [];
            if (background.trim()) {
                bodyParts.push(`### Background\n${background.trim()}`);
            }
            if (requirements.trim()) {
                bodyParts.push(`### Requirements\n${requirements.trim()}`);
            }
            if (bodyParts.length > 0) {
                try {
                    await api.task.body({ wbs, body: bodyParts.join('\n\n') });
                } catch (bodyErr: unknown) {
                    // Body seeding failure is non-fatal — the task was created.
                    // Surface it but don't block the close/refresh.
                    const msg = bodyErr instanceof Error ? bodyErr.message : 'Body seeding failed';
                    if (typeof window !== 'undefined') {
                        window.dispatchEvent(
                            new CustomEvent('api-error', {
                                detail: { message: `Task created but body seeding failed: ${msg}` },
                            }),
                        );
                    }
                }
            }

            handleClose();
            onCreated();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Create failed';
            setError(msg);
            if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('api-error', { detail: { message: msg } }));
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/40 z-40" onClick={handleClose} aria-hidden="true" />

            {/* Slide-out panel */}
            <div
                className="fixed inset-y-0 right-0 w-96 max-w-[90vw] bg-spur-surface border-l border-spur-border z-50 flex flex-col shadow-2xl"
                role="dialog"
                aria-label="New Task"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-spur-border shrink-0">
                    <h2 className="text-sm font-semibold text-spur-text">New Task</h2>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="btn btn-ghost btn-sm text-spur-text-muted"
                        aria-label="Close"
                        disabled={submitting}
                    >
                        ✕
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Name */}
                    <div>
                        <label
                            htmlFor="new-task-name"
                            className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide block mb-1.5"
                        >
                            Name <span className="text-spur-error">*</span>
                        </label>
                        <input
                            id="new-task-name"
                            type="text"
                            className={`input input-bordered input-sm w-full bg-spur-bg text-spur-text ${
                                nameError ? 'input-error' : ''
                            }`}
                            placeholder="Task name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (!nameTouched) setNameTouched(true);
                            }}
                            onBlur={() => setNameTouched(true)}
                            disabled={submitting}
                        />
                        {nameError && <p className="text-xs text-spur-error mt-1">{nameError}</p>}
                    </div>

                    {/* Background */}
                    <div>
                        <label
                            htmlFor="new-task-background"
                            className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide block mb-1.5"
                        >
                            Background <span className="text-spur-text-muted font-normal">(optional, markdown)</span>
                        </label>
                        <textarea
                            id="new-task-background"
                            className="textarea textarea-bordered textarea-sm w-full bg-spur-bg text-spur-text font-mono text-xs"
                            placeholder="Why this task exists…"
                            rows={4}
                            value={background}
                            onChange={(e) => setBackground(e.target.value)}
                            disabled={submitting}
                        />
                    </div>

                    {/* Requirements */}
                    <div>
                        <label
                            htmlFor="new-task-requirements"
                            className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide block mb-1.5"
                        >
                            Requirements <span className="text-spur-text-muted font-normal">(optional, markdown)</span>
                        </label>
                        <textarea
                            id="new-task-requirements"
                            className="textarea textarea-bordered textarea-sm w-full bg-spur-bg text-spur-text font-mono text-xs"
                            placeholder="What must be done…"
                            rows={4}
                            value={requirements}
                            onChange={(e) => setRequirements(e.target.value)}
                            disabled={submitting}
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="text-xs text-spur-error bg-spur-error/10 border border-spur-error/20 rounded p-2">
                            {error}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 p-4 border-t border-spur-border shrink-0">
                    <button
                        type="button"
                        className="btn btn-sm btn-ghost text-spur-text-muted"
                        onClick={handleClose}
                        disabled={submitting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={handleSubmit}
                        disabled={submitting}
                    >
                        {submitting ? 'Creating…' : 'Create Task'}
                    </button>
                </div>
            </div>
        </>
    );
}
