import type { DecisionLogDetail, DecisionLogRow } from '@gobing-ai/spur-contracts';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button } from '@/ui';
import { fetchWithTimeout, resolveApiUrl } from '../../lib/rpc-client';
import { CopyValueButton, formatDuration } from './SystemEventsTab';
import type { ObservabilityNavIntent } from './tabs';

export interface DecisionDetailDrawerProps {
    /** List row that opened the drawer; null closes it. */
    row: DecisionLogRow | null;
    onClose: () => void;
    /** Shell navigation sink; when present a run-linked row offers "View run events" (task 1100 R7). */
    onNavigate?: (intent: ObservabilityNavIntent) => void;
}

function outcomeBadgeVariant(outcome: string): 'success' | 'warning' | 'error' {
    switch (outcome) {
        case 'accepted':
            return 'success';
        case 'fallback':
            return 'warning';
        default:
            return 'error';
    }
}

function formatValue(value: string | null): string {
    if (value === null || value === '') return '—';
    try {
        return JSON.stringify(JSON.parse(value));
    } catch {
        return value;
    }
}

/** DESIGN.md § Product UI — Decisions: the drawer Input section is pretty-printed JSON. */
function formatPretty(value: string | null): string {
    if (value === null || value === '') return '';
    try {
        return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
        return value;
    }
}

/**
 * Detail drawer for one decision invocation (task 1100 §3.6): fetches the full
 * row (redacted input, question, phase timings) by id on open and degrades
 * gracefully to the list row when the fetch fails.
 */
export default function DecisionDetailDrawer({ row, onClose, onNavigate }: DecisionDetailDrawerProps) {
    const [detail, setDetail] = useState<DecisionLogDetail | null>(null);
    const [error, setError] = useState<string | null>(null);
    const fetchIdRef = useRef(0);

    useEffect(() => {
        if (!row) {
            setDetail(null);
            setError(null);
            return;
        }
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);

        const controller = new AbortController();
        const fetchId = ++fetchIdRef.current;
        setError(null);
        (async () => {
            try {
                const res = await fetchWithTimeout(
                    new Request(`${resolveApiUrl()}/observability/decisions/${encodeURIComponent(row.id)}`, {
                        signal: controller.signal,
                    }),
                );
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = (await res.json()) as DecisionLogDetail;
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setDetail(data);
            } catch (err) {
                if (controller.signal.aborted || fetchId !== fetchIdRef.current) return;
                setError(err instanceof Error ? err.message : String(err));
            }
        })();

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            controller.abort();
        };
    }, [row, onClose]);

    if (!row) return null;

    // The list row is the rendering floor; the detail payload upgrades it in place.
    const view: DecisionLogDetail = detail ?? { ...row, question: null, inputJson: null, phases: [] };
    // Local consts keep null-narrowing alive inside the JSX closures below.
    const runId = view.runId;
    const prettyInput = formatPretty(view.inputJson);

    const fields: { label: string; value: string }[] = [
        { label: 'Decision', value: view.decisionId },
        { label: 'Outcome', value: view.outcome },
        { label: 'Maker', value: view.makerName ? `${view.makerName} (${view.makerSource ?? '?'})` : '—' },
        { label: 'Caller', value: view.caller },
        { label: 'Value', value: formatValue(view.value) },
        { label: 'Fallback', value: formatValue(view.fallbackValue) },
        { label: 'Source', value: view.source ?? '—' },
        { label: 'Reason', value: view.reason ?? '—' },
        {
            label: 'Confidence',
            value:
                view.confidence === null
                    ? '—'
                    : `${view.confidence}${view.minConfidence !== null ? ` (min ${view.minConfidence})` : ''}`,
        },
        { label: 'Catalog layer', value: view.catalogLayer ?? '—' },
        { label: 'Catalog source', value: view.catalogSource ?? '—' },
        { label: 'Started At', value: new Date(view.startedAt).toLocaleString() },
        { label: 'Duration', value: formatDuration(view.durationMs) ?? '—' },
        { label: 'Input keys', value: view.inputKeys.length > 0 ? view.inputKeys.join(', ') : '—' },
    ];
    if (view.workflowName !== null) fields.push({ label: 'Workflow', value: view.workflowName });
    if (view.nodeId !== null) fields.push({ label: 'Node', value: view.nodeId });
    if (view.wbs !== null) fields.push({ label: 'WBS', value: view.wbs });
    if (view.runId !== null) fields.push({ label: 'Run', value: view.runId });
    if (view.decisionType !== null) fields.push({ label: 'Type', value: view.decisionType });

    return (
        <div
            className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
            onClick={onClose}
            onKeyDown={(e) => {
                if (e.key === 'Escape') onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Decision details for ${view.id}`}
            data-testid="decision-detail-drawer"
        >
            <div
                className="w-full max-w-xl h-full bg-base-100 border-l border-base-content/10 shadow-2xl flex flex-col overflow-hidden"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                role="document"
            >
                {/* Header */}
                <div className="px-5 py-4 border-b border-base-content/10 flex items-center justify-between bg-base-200/50">
                    <div className="flex items-center gap-2">
                        <Badge variant={outcomeBadgeVariant(view.outcome)} size="sm">
                            {view.outcome}
                        </Badge>
                        <span className="font-mono text-sm font-semibold text-base-content truncate max-w-xs">
                            {view.decisionId}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {onNavigate && runId !== null && (
                            <Button
                                variant="outline"
                                size="xs"
                                data-testid="navigate-decision-run-events-btn"
                                onClick={() => onNavigate({ tab: 'system-events', runId })}
                            >
                                View run events
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={onClose}
                            aria-label="Close drawer"
                            data-testid="close-decision-drawer"
                        >
                            ✕
                        </Button>
                    </div>
                </div>

                {/* Content Body */}
                <div className="p-5 flex-1 overflow-y-auto space-y-5">
                    {error && (
                        <div
                            className="p-3 rounded-lg bg-warning/10 border border-warning/20 text-xs text-warning"
                            role="alert"
                        >
                            Detail fetch failed ({error}); showing list data.
                        </div>
                    )}

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 gap-3 bg-base-200/40 p-3 rounded-lg border border-base-content/10 text-xs font-mono">
                        {fields.map((f) => (
                            <div key={f.label}>
                                <span className="text-base-content/50 block text-[10px] uppercase">{f.label}</span>
                                <span className="font-semibold text-base-content break-words">{f.value}</span>
                            </div>
                        ))}
                    </div>

                    {view.error && (
                        <div className="p-3 rounded-lg bg-error/10 border border-error/20 text-xs font-mono text-error break-words">
                            {view.error}
                        </div>
                    )}

                    {view.question && (
                        <div>
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                                Question
                            </h4>
                            <p className="text-sm text-base-content bg-base-200/40 border border-base-content/10 rounded-lg p-3">
                                {view.question}
                            </p>
                        </div>
                    )}

                    {/* Redacted + bounded input (never the raw evidence text) */}
                    <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                            <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60">
                                Input {view.inputJson === null ? '(metadata mode)' : '(redacted)'}
                            </h4>
                            {view.inputJson !== null && <CopyValueButton value={prettyInput} label="input JSON" />}
                        </div>
                        {view.inputJson === null ? (
                            <p className="text-xs text-base-content/50">Not recorded — decision log metadata mode.</p>
                        ) : (
                            <pre
                                className="text-xs font-mono bg-base-200/40 border border-base-content/10 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words"
                                data-testid="decision-detail-input"
                            >
                                {prettyInput}
                            </pre>
                        )}
                    </div>

                    {/* Caller-observed phase timings */}
                    <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-base-content/60 mb-2">
                            Phases
                        </h4>
                        {view.phases.length === 0 ? (
                            <p className="text-xs text-base-content/50">No phase timings recorded.</p>
                        ) : (
                            <ul className="space-y-1" data-testid="decision-detail-phases">
                                {view.phases.map((p) => (
                                    <li
                                        key={`${p.phase}-${p.startedAt}-${p.durationMs}`}
                                        className="flex items-center justify-between text-xs font-mono bg-base-200/40 border border-base-content/10 rounded-lg px-3 py-1.5"
                                    >
                                        <span className="font-semibold">{p.phase}</span>
                                        <span className="text-base-content/60">
                                            {formatDuration(p.durationMs) ?? `${p.durationMs}ms`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
