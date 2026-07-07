import { useState } from 'react';
import { Button, Input } from '@/ui';
import { createChildFeature, createRootFeature } from '../../lib/feature-client';

interface Props {
    open: boolean;
    parentId: string;
    onClose: () => void;
    onCreated: () => void;
}

/**
 * Slide-out panel for creating a new child feature.
 * Mirrors the NewTaskPanel pattern: name input, create on Enter/submit.
 * The parent feature ID is fixed from context.
 */
export default function NewFeaturePanel({ open, parentId, onClose, onCreated }: Props) {
    const [name, setName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [nameTouched, setNameTouched] = useState(false);

    const nameError = nameTouched && name.trim() === '' ? 'Name is required' : '';

    const handleClose = () => {
        setName('');
        setNameTouched(false);
        setError('');
        onClose();
    };

    const handleSubmit = async () => {
        setNameTouched(true);
        const trimmed = name.trim();
        if (trimmed === '') return;

        setSubmitting(true);
        setError('');

        try {
            if (parentId) {
                await createChildFeature({ id: parentId, name: trimmed });
            } else {
                await createRootFeature(trimmed);
            }
            handleClose();
            onCreated();
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Create failed';
            setError(msg);
        } finally {
            setSubmitting(false);
        }
    };

    if (!open) return null;

    return (
        <div className="fixed inset-y-0 right-0 z-40 flex" data-new-feature-panel>
            <div className="w-96 border-l border-spur-border bg-spur-surface shadow-xl flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-spur-border shrink-0">
                    <h3 className="text-sm font-semibold text-spur-text">
                        {parentId ? 'New Child Feature' : 'New Feature'}
                    </h3>
                    <Button variant="ghost" size="xs" onClick={handleClose} aria-label="Close panel">
                        &#x2715;
                    </Button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {/* Parent info */}
                    {parentId && (
                        <div className="text-xs text-spur-text-muted">
                            Parent: <span className="font-mono text-spur-accent">{parentId}</span>
                        </div>
                    )}

                    {/* Name input */}
                    <div>
                        <label htmlFor="new-feature-name" className="block text-xs font-medium text-spur-text mb-1">
                            Feature Name *
                        </label>
                        <Input
                            id="new-feature-name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value);
                                if (!nameTouched) setNameTouched(true);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && name.trim()) {
                                    handleSubmit();
                                }
                            }}
                            placeholder="e.g. Authentication module"
                            disabled={submitting}
                        />
                        {nameError && <p className="text-xs text-red-500 mt-1">{nameError}</p>}
                        {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
                    </div>

                    <div className="text-xs text-spur-text-muted">
                        {parentId
                            ? `The feature ID will be auto-allocated (next free digit under ${parentId}).`
                            : 'The feature ID will be auto-allocated (next free letter A–Z).'}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-spur-border shrink-0">
                    <Button variant="ghost" size="xs" onClick={handleClose} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button
                        variant="primary"
                        size="xs"
                        onClick={handleSubmit}
                        disabled={submitting || name.trim() === ''}
                        loading={submitting}
                    >
                        Create Feature
                    </Button>
                </div>
            </div>
        </div>
    );
}
