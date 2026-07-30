import { useEffect, useRef } from 'react';
import { Badge, Button, Loading } from '@/ui';
import type { FeatureActionProgressState } from './sse-helpers';

interface FloatingActionProgressProps {
    progress: FeatureActionProgressState;
    isDismissed: boolean;
    onDismiss: () => void;
    onReopen: () => void;
}

/**
 * Floating action progress layer and re-open chip for feature actions (Task 0388).
 *
 * Renders live job status (queued, running, succeeded, failed) when active.
 * Dismissing hides the layer without cancelling the job (R2); a compact chip remains
 * while non-terminal to re-open the layer. Terminal failures when dismissed fire a
 * global `api-error` event (R4 / R5).
 */
export default function FloatingActionProgress({
    progress,
    isDismissed,
    onDismiss,
    onReopen,
}: FloatingActionProgressProps) {
    const { status, runId, action, error } = progress;
    const firedToastRef = useRef<string | null>(null);

    // R5: If terminal failure occurs while layer is dismissed, fire api-error toast once
    useEffect(() => {
        if (status === 'failed' && isDismissed && runId && firedToastRef.current !== runId) {
            firedToastRef.current = runId;
            if (typeof window !== 'undefined') {
                window.dispatchEvent(
                    new CustomEvent('api-error', {
                        detail: { message: error || `Action ${action || 'job'} failed` },
                    }),
                );
            }
        }
    }, [status, isDismissed, runId, action, error]);

    if (status === 'idle' || !runId) {
        return null;
    }

    const isNonTerminal = status === 'queued' || status === 'running';

    // R2: Compact chip when layer is dismissed but job is still non-terminal
    if (isDismissed) {
        if (!isNonTerminal) return null;
        return (
            <div className="fixed bottom-4 right-4 z-40">
                <button
                    type="button"
                    onClick={onReopen}
                    className="flex items-center gap-2 px-3 py-1.5 bg-spur-bg border border-spur-border hover:border-spur-primary text-spur-text text-xs rounded-full shadow-md font-medium transition-colors"
                >
                    <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span>
                        {action ? `${action.charAt(0).toUpperCase()}${action.slice(1)}` : 'Action'} ({status})
                    </span>
                    <span className="text-spur-text-muted">⤢</span>
                </button>
            </div>
        );
    }

    const badgeVariant =
        status === 'succeeded'
            ? 'success'
            : status === 'failed'
              ? 'error'
              : status === 'running'
                ? 'accent'
                : 'warning';

    return (
        <div className="fixed bottom-4 right-4 z-40 w-80 p-4 bg-spur-bg border border-spur-border rounded-lg shadow-xl backdrop-blur flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-spur-text">
                        {action ? `${action.charAt(0).toUpperCase()}${action.slice(1)}` : 'Action'}
                    </span>
                    <Badge variant={badgeVariant}>{status}</Badge>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="text-spur-text-muted hover:text-spur-text text-base font-bold leading-none p-1"
                    aria-label="Dismiss progress panel"
                >
                    ×
                </button>
            </div>

            <div className="text-xs text-spur-text-muted font-mono truncate">ID: {runId}</div>

            {isNonTerminal && (
                <div className="flex items-center gap-2 text-xs text-spur-text">
                    <Loading className="w-3.5 h-3.5" />
                    <span>{status === 'queued' ? 'Enqueued in job runner...' : 'Running agent slash command...'}</span>
                </div>
            )}

            {status === 'succeeded' && (
                <div className="text-xs text-green-400 font-medium">✓ Action completed successfully.</div>
            )}

            {status === 'failed' && (
                <div className="text-xs text-red-400 font-medium break-words">✕ {error || 'Action job failed.'}</div>
            )}

            {!isNonTerminal && (
                <div className="flex justify-end pt-1">
                    <Button variant="outline" size="sm" onClick={onDismiss}>
                        Close
                    </Button>
                </div>
            )}
        </div>
    );
}
