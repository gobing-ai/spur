import type { TaskReadinessResponse } from '@gobing-ai/spur-contracts';
import { useEffect, useState } from 'react';
import { subscribePlanningConnection, subscribePlanningEvents } from '../../lib/planning-events';
import { api, resolveApiUrl } from '../../lib/rpc-client';

/** Commands are advice only. Native disclosure and links preserve ordinary keyboard navigation. */
export default function PlanningReadinessPanel({ folder, taskWbs }: { folder?: string; taskWbs?: readonly string[] }) {
    const [data, setData] = useState<TaskReadinessResponse['data'] | null>(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false;
        let running = false;
        let dirty = false;
        let controller: AbortController | undefined;
        async function reload() {
            dirty = true;
            setData(null);
            setError('');
            if (running) return;
            running = true;
            try {
                while (dirty && !disposed) {
                    dirty = false;
                    controller = new AbortController();
                    try {
                        const response = await api.task.readiness({ folder }, { signal: controller.signal });
                        if (!disposed && !dirty) setData(response.data);
                    } catch {
                        if (!disposed && !dirty)
                            setError('Unable to load readiness. Refresh or check the project server.');
                    }
                }
            } finally {
                running = false;
            }
        }
        void reload();
        const offEvents = subscribePlanningEvents(() => {
            void reload();
        });
        const offConnection = subscribePlanningConnection((connected) => {
            if (connected) void reload();
        });
        return () => {
            disposed = true;
            controller?.abort();
            offEvents();
            offConnection();
        };
    }, [folder]);
    const tasks = data?.tasks.filter((task) => taskWbs === undefined || taskWbs.includes(task.wbs)) ?? [];
    const pausedRuns = data?.pausedRuns.filter((run) => taskWbs === undefined || taskWbs.includes(run.wbs)) ?? [];
    return (
        <details className="shrink-0 rounded-lg border border-spur-border bg-spur-surface-1 mx-4 my-2 text-xs text-spur-text">
            <summary className="cursor-pointer px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-spur-accent">
                Daily readiness
                {data && (
                    <span className="ml-2 text-spur-text-muted">
                        {tasks.filter((task) => task.state === 'ready').length} ready ·{' '}
                        {tasks.filter((task) => task.state === 'blocked').length} blocked · {pausedRuns.length} paused
                    </span>
                )}
            </summary>
            <div className="max-h-64 overflow-y-auto px-3 pb-3 space-y-2">
                {error ? (
                    <p role="alert">{error}</p>
                ) : !data ? (
                    <p role="status">Checking readiness…</p>
                ) : (
                    <>
                        {!tasks.length && <p>No tasks in this view.</p>}
                        <ul className="space-y-2">
                            {tasks.map((task) => (
                                <li key={task.wbs}>
                                    <span className="font-mono">{task.wbs}</span> · {task.state}
                                    {task.nextAction && (
                                        <code className="ml-2 select-all">{task.nextAction.command}</code>
                                    )}
                                    <ul className="ml-4 text-spur-text-muted">
                                        {task.reasons.map((reason) => (
                                            <li key={`${reason.code}:${reason.message}`}>{reason.message}</li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ul>
                        <ul>
                            {pausedRuns.map((run) => (
                                <li key={`${run.wbs}-${run.runId}`}>
                                    <a
                                        className="text-spur-accent underline"
                                        href={`${resolveApiUrl()}/runs/${encodeURIComponent(run.runId)}/progress`}
                                    >
                                        Inspect paused run {run.runId} (task {run.wbs})
                                    </a>
                                </li>
                            ))}
                        </ul>
                        {data.diagnostics.map((diagnostic) => (
                            <p key={`${diagnostic.path}-${diagnostic.message}`} role="alert">
                                {diagnostic.path}: {diagnostic.message}
                            </p>
                        ))}
                    </>
                )}
            </div>
        </details>
    );
}
