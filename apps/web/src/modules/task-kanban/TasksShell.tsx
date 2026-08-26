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
    const [lastSyncAt, setLastSyncAt] = useState<number | undefined>(undefined);
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
            <header className="mx-auto w-full max-w-[1600px] shrink-0 px-4 pt-3">
                {/* ADR-081 (amended 2026-08-26): the header rides History's centered 1600px
                    rail; only the board body below stays full-bleed. */}
                <div className="flex flex-nowrap items-center justify-between gap-4 border-b border-base-content/10 pb-3">
                    <div className="flex shrink-0 items-center gap-3">
                        <span className="text-2xl" aria-hidden="true">
                            📋
                        </span>
                        <div>
                            <h1 className="text-xl font-bold tracking-tight text-spur-text">Tasks</h1>
                            <p className="text-xs text-spur-text-muted">Task corpus, kanban lanes, and phase filters</p>
                            <p
                                className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-spur-border px-2 py-0.5 text-xs text-spur-text-muted font-mono"
                                role="status"
                                data-testid="tasks-live-chip"
                            >
                                <span
                                    className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-spur-success' : 'bg-spur-error'}`}
                                    aria-hidden="true"
                                />
                                last sync {lastSyncAt ? new Date(lastSyncAt).toLocaleString() : '—'}
                            </p>
                        </div>
                    </div>

                    {/* One non-wrapping cluster: filters sit just before the tab strip so the
                        identity block and tabs always share a single header row. */}
                    <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto">
                        <Select
                            variant="ghost"
                            size="xs"
                            className="text-xs shrink-0 w-44"
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
                        <div className="flex shrink-0 items-center gap-1">
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
                        </div>
                        <form onSubmit={submit} className="flex shrink-0 items-center">
                            <Input
                                aria-label="Filter by WBS or feature"
                                type="text"
                                placeholder="WBS or feature"
                                variant="bordered"
                                size="xs"
                                className="w-36"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </form>
                        <Button variant="primary" size="sm" className="shrink-0" onClick={() => setShowNewPanel(true)}>
                            + New Task
                        </Button>
                        <div className="flex shrink-0 items-center gap-1 bg-base-300 p-1 rounded-xl">
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
                </div>
            </header>

            <div data-kanban-board className="flex-1 overflow-hidden">
                <ActiveTab
                    onSelectTask={selectTask}
                    filters={filters}
                    folder={folder}
                    hiddenColumns={hiddenColumns}
                    onConnectionChange={setConnected}
                    onSyncChange={setLastSyncAt}
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
