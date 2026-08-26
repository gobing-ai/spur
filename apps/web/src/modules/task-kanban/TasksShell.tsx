import { TASK_STATUSES, taskStatusIcon } from '@gobing-ai/spur-domain/schema';
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Button, Checkbox, Input, Select } from '@/ui';
import { api } from '../../lib/rpc-client';
import { BOOTSTRAP_FOLDER } from './KanbanBoard';
import NewTaskPanel from './NewTaskPanel';
import { TASKS_TABS } from './tabs';
import { useTaskParams } from './useTaskParams';

/**
 * §4 combined-input parse rule (F72): a bare four-digit WBS navigates to that
 * task (opening the existing path-WBS detail popup); a dotted WBS filters to the
 * parent's subtasks; anything else is a feature substring filter.
 */
export function parseCombinedInput(
    value: string,
): { kind: 'navigate'; wbs: string } | { kind: 'filter'; key: 'parent' | 'feature'; value: string } {
    const v = value.trim();
    if (/^\d{4}$/.test(v)) return { kind: 'navigate', wbs: v };
    return v.includes('.') ? { kind: 'filter', key: 'parent', value: v } : { kind: 'filter', key: 'feature', value: v };
}

/**
 * One-row module shell for the Tasks board (History-parity, F72).
 *
 * Header (left→right): identity block + live chip → inline filters (phase
 * Select, status checkboxes, combined WBS/feature input) → tab strip. The board
 * body is full-bleed: no centered max-width wrapper (the ADR-081 divergence from
 * the History/Observability shells) so lanes use every available pixel.
 */
export default function TasksShell() {
    const { selectTask, setFilter, filters } = useTaskParams();
    const [defaultFolder, setDefaultFolder] = useState(BOOTSTRAP_FOLDER);
    const [folders, setFolders] = useState<{ path: string; label?: string }[]>([]);
    const [activeTab, setActiveTab] = useState('kanban');
    const [showNewPanel, setShowNewPanel] = useState(false);
    const [query, setQuery] = useState('');
    const [connected, setConnected] = useState(false);
    const folder = filters.folder ?? defaultFolder;
    const visibleStatuses = new Set(
        filters.status === undefined
            ? TASK_STATUSES.filter((status) => status !== 'blocked' && status !== 'cancelled')
            : filters.status.split(',').filter((status) => TASK_STATUSES.some((candidate) => candidate === status)),
    );
    const hiddenColumns = new Set(TASK_STATUSES.filter((status) => !visibleStatuses.has(status)));

    // Combined input mirrors the active URL filter (feature or parent WBS).
    useEffect(() => {
        setQuery(filters.featureId ?? filters.parentWbs ?? '');
    }, [filters.featureId, filters.parentWbs]);

    useEffect(() => {
        if (typeof api.task.folders !== 'function') return;
        api.task
            .folders({})
            .then((res) => {
                const { data, activeFolder } = res as {
                    data?: { path: string; label?: string }[];
                    activeFolder?: string;
                };
                const active = activeFolder ?? data?.[0]?.path;
                if (data) setFolders(data);
                if (active !== undefined) setDefaultFolder(active);
            })
            .catch(() => {
                // Fall back to the bootstrap folder list.
            });
    }, []);

    const toggleColumn = (status: string) => {
        const next = new Set(visibleStatuses);
        if (next.has(status)) next.delete(status);
        else next.add(status);
        setFilter('status', TASK_STATUSES.filter((candidate) => next.has(candidate)).join(','));
    };

    // §4 parse rule: bare 4-digit WBS → navigate (+ path-WBS popup); dotted → parent
    // filter; anything else → feature substring filter. Filter state stays URL-driven.
    const submit = (e: FormEvent) => {
        e.preventDefault();
        const parsed = parseCombinedInput(query);
        if (parsed.kind === 'navigate') {
            selectTask(parsed.wbs);
            setQuery('');
            return;
        }
        setFilter(parsed.key, parsed.value || null);
    };

    const ActiveTab = (TASKS_TABS.find((t) => t.id === activeTab) ?? TASKS_TABS[0]).component;

    return (
        <div className="task-kanban flex flex-col h-full">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-spur-border px-4 pb-3 pt-3 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                    <span className="text-2xl" aria-hidden="true">
                        📋
                    </span>
                    <h1 className="text-xl font-bold tracking-tight text-spur-text">Tasks</h1>
                    <span
                        className="inline-flex items-center gap-1.5 rounded-full border border-spur-border px-2 py-0.5 text-xs text-spur-text-muted font-mono"
                        role="status"
                        data-testid="tasks-live-chip"
                    >
                        <span
                            className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-spur-success' : 'bg-spur-error'}`}
                            aria-hidden="true"
                        />
                        {connected ? 'Live' : 'Polling'}
                    </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    <Select
                        variant="ghost"
                        size="xs"
                        className="text-xs"
                        value={folder}
                        onChange={(e) => setFilter('folder', e.target.value)}
                        aria-label="Task phase folder"
                    >
                        {folders.map((f) => (
                            <option key={f.path} value={f.path}>
                                {f.label ? `${f.label} (${f.path})` : f.path}
                            </option>
                        ))}
                    </Select>
                    {TASK_STATUSES.map((status) => (
                        <label
                            key={status}
                            htmlFor={`tasks-status-${status}`}
                            className="flex items-center gap-1 cursor-pointer"
                        >
                            <Checkbox
                                id={`tasks-status-${status}`}
                                size="xs"
                                checked={!hiddenColumns.has(status)}
                                onChange={() => toggleColumn(status)}
                            />
                            <span className="text-[10px] text-spur-text-muted">
                                {taskStatusIcon(status)} {status}
                            </span>
                        </label>
                    ))}
                    <form onSubmit={submit} className="flex items-center">
                        <Input
                            aria-label="Filter by WBS or feature"
                            type="text"
                            placeholder="WBS or feature"
                            variant="bordered"
                            size="xs"
                            className="w-40"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                    </form>
                    <Button variant="primary" size="sm" onClick={() => setShowNewPanel(true)}>
                        + New Task
                    </Button>
                </div>

                <div className="flex items-center gap-1 bg-base-300 p-1 rounded-xl">
                    {TASKS_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                activeTab === tab.id
                                    ? 'bg-primary text-primary-content font-bold shadow-sm'
                                    : 'text-base-content/70 hover:bg-base-content/10'
                            }`}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            <div data-kanban-board className="flex-1 overflow-hidden">
                <ActiveTab
                    onSelectTask={selectTask}
                    filters={filters}
                    folder={folder}
                    hiddenColumns={hiddenColumns}
                    onConnectionChange={setConnected}
                />
            </div>

            <NewTaskPanel
                open={showNewPanel}
                onClose={() => setShowNewPanel(false)}
                onCreated={() => {
                    // The board's SSE/poll store catches the new card on the next interval.
                }}
                folder={folder}
            />
        </div>
    );
}
