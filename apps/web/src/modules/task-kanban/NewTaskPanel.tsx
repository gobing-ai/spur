import { TASK_VARIANTS, type TaskVariant } from '@gobing-ai/spur-domain/schema';
import { useEffect, useState } from 'react';
import { Button, Input, MDEditor, Select } from '@/ui';
import ResizeHandle from '../../components/ResizeHandle';
import { api } from '../../lib/rpc-client';

const PANEL_WIDTH_KEY = 'spur:new-task-panel-width';
const DEFAULT_PANEL_WIDTH = 384;
const MIN_PANEL_WIDTH = 384;

interface Props {
    open: boolean;
    onClose: () => void;
    onCreated: () => void;
    folder: string;
    /** Pre-link the new task to this feature (sets feature_id in frontmatter). */
    featureId?: string;
}

type EditorMode = 'edit' | 'preview';

interface MarkdownFieldProps {
    id: string;
    label: string;
    placeholder: string;
    value: string;
    mode: EditorMode;
    onChange: (value: string) => void;
    onModeChange: (mode: EditorMode) => void;
    disabled: boolean;
}

function MarkdownField({ id, label, placeholder, value, mode, onChange, onModeChange, disabled }: MarkdownFieldProps) {
    return (
        <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <label htmlFor={id} className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide">
                    {label} <span className="text-spur-text-muted font-normal">(optional, markdown)</span>
                </label>
                <fieldset className="flex items-center gap-1">
                    <legend className="sr-only">{label} mode</legend>
                    <Button
                        type="button"
                        variant={mode === 'edit' ? 'primary' : 'ghost'}
                        size="xs"
                        onClick={() => onModeChange('edit')}
                        disabled={disabled}
                        aria-pressed={mode === 'edit'}
                    >
                        Edit
                    </Button>
                    <Button
                        type="button"
                        variant={mode === 'preview' ? 'primary' : 'ghost'}
                        size="xs"
                        onClick={() => onModeChange('preview')}
                        disabled={disabled}
                        aria-pressed={mode === 'preview'}
                    >
                        Preview
                    </Button>
                </fieldset>
            </div>
            {mode === 'edit' ? (
                <div className="min-h-40" data-testid={`${id}-editor`}>
                    <MDEditor
                        value={value}
                        onChange={(next) => onChange(next ?? '')}
                        height={160}
                        textareaProps={{ id, placeholder, disabled, 'aria-label': label }}
                        data-color-mode="dark"
                    />
                </div>
            ) : (
                <div
                    className="min-h-40 rounded border border-spur-border bg-spur-bg p-3 text-sm text-spur-text overflow-y-auto"
                    data-testid={`${id}-preview`}
                >
                    {value.trim() ? (
                        <MDEditor.Markdown source={value} data-color-mode="dark" />
                    ) : (
                        <p className="text-xs text-spur-text-muted">{placeholder}</p>
                    )}
                </div>
            )}
        </div>
    );
}

/**
 * Slide-out panel for creating a new task. Feeds the existing `task.create` oRPC
 * endpoint. If Background/Requirements are entered, follows the create with a
 * `bodyUpdate` to seed the body. On success, closes the panel and triggers a
 * board refresh via `onCreated`.
 */
export default function NewTaskPanel({ open, onClose, onCreated, folder, featureId }: Props) {
    const [name, setName] = useState('');
    const [background, setBackground] = useState('');
    const [requirements, setRequirements] = useState('');
    const [backgroundMode, setBackgroundMode] = useState<EditorMode>('edit');
    const [requirementsMode, setRequirementsMode] = useState<EditorMode>('edit');
    const [template, setTemplate] = useState<TaskVariant>('standard');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [nameTouched, setNameTouched] = useState(false);
    const [panelWidth, setPanelWidth] = useState(() => {
        if (typeof window === 'undefined') return DEFAULT_PANEL_WIDTH;
        try {
            const stored = Number.parseFloat(window.localStorage.getItem(PANEL_WIDTH_KEY) ?? '');
            if (Number.isFinite(stored) && stored > 0) {
                return Math.max(MIN_PANEL_WIDTH, Math.min(stored, window.innerWidth * 0.9));
            }
        } catch {
            // localStorage unavailable — use the default panel width.
        }
        return DEFAULT_PANEL_WIDTH;
    });

    const nameError = nameTouched && name.trim() === '' ? 'Name is required' : '';

    useEffect(() => {
        document.documentElement.style.setProperty('--new-task-panel-w', `${panelWidth}px`);
    }, [panelWidth]);

    const handleClose = () => {
        if (submitting) return;
        setName('');
        setBackground('');
        setRequirements('');
        setBackgroundMode('edit');
        setRequirementsMode('edit');
        setTemplate('standard');
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
            const res = await api.task.create({ title: trimmed, folder, template, featureId });
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
                className="fixed inset-y-0 right-0 max-w-[90vw] bg-spur-surface border-l border-spur-border z-50 flex shadow-2xl"
                style={{ width: panelWidth, minWidth: MIN_PANEL_WIDTH }}
                role="dialog"
                aria-label="New Task"
            >
                <ResizeHandle
                    targetVar="--new-task-panel-w"
                    onResizeEnd={(px) => {
                        const max = typeof window !== 'undefined' ? window.innerWidth * 0.9 : px;
                        const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(px, max));
                        setPanelWidth(clamped);
                        try {
                            window.localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
                        } catch {
                            // localStorage unavailable — width still applies for this session.
                        }
                    }}
                    direction="horizontal"
                    invert
                />
                <div className="flex min-w-0 flex-1 flex-col">
                    {/* Header */}
                    <div className="flex items-center justify-between p-4 border-b border-spur-border shrink-0">
                        <h2 className="text-sm font-semibold text-spur-text">New Task</h2>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-spur-text-muted"
                            onClick={handleClose}
                            aria-label="Close"
                            disabled={submitting}
                        >
                            ✕
                        </Button>
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
                            <Input
                                id="new-task-name"
                                type="text"
                                variant="bordered"
                                size="sm"
                                error={!!nameError}
                                className="w-full bg-spur-bg text-spur-text"
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

                        {/* Template */}
                        <div>
                            <label
                                htmlFor="new-task-template"
                                className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide block mb-1.5"
                            >
                                Template
                            </label>
                            <Select
                                id="new-task-template"
                                variant="bordered"
                                size="sm"
                                className="w-full bg-spur-bg text-spur-text"
                                value={template}
                                onChange={(e) => setTemplate(e.target.value as TaskVariant)}
                                disabled={submitting}
                            >
                                {(TASK_VARIANTS as readonly string[]).map((v) => (
                                    <option key={v} value={v}>
                                        {v}
                                    </option>
                                ))}
                            </Select>
                        </div>

                        <MarkdownField
                            id="new-task-background"
                            label="Background"
                            placeholder="Why this task exists…"
                            value={background}
                            mode={backgroundMode}
                            onChange={setBackground}
                            onModeChange={setBackgroundMode}
                            disabled={submitting}
                        />

                        <MarkdownField
                            id="new-task-requirements"
                            label="Requirements"
                            placeholder="What must be done…"
                            value={requirements}
                            mode={requirementsMode}
                            onChange={setRequirements}
                            onModeChange={setRequirementsMode}
                            disabled={submitting}
                        />

                        {/* Error */}
                        {error && (
                            <div className="text-xs text-spur-error bg-spur-error/10 border border-spur-error/20 rounded p-2">
                                {error}
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-end gap-2 p-4 border-t border-spur-border shrink-0">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-spur-text-muted"
                            onClick={handleClose}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
                            {submitting ? 'Creating…' : 'Create Task'}
                        </Button>
                    </div>
                </div>
            </div>
        </>
    );
}
