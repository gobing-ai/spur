import { useDroppable } from '@dnd-kit/core';
import { taskStatusIcon } from '@gobing-ai/spur-domain/schema';
import { Badge, Button } from '@/ui';
import TaskCard from './TaskCard';
import type { TaskSummary } from './types';

interface Props {
    status: string;
    label: string;
    tasks: TaskSummary[];
    onCardClick: (wbs: string) => void;
    sortDir?: 'asc' | 'desc';
    onSortToggle?: () => void;
}
export default function KanbanColumn({ status, label, tasks, onCardClick, sortDir, onSortToggle }: Props) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
        data: { status },
    });

    return (
        <section
            ref={setNodeRef}
            aria-label={`${label} column`}
            className={`flex flex-col flex-1 min-w-[16rem] rounded-xl border transition-colors duration-200 overflow-hidden ${
                isOver
                    ? 'bg-spur-surface/40 border-spur-accent shadow-lg ring-1 ring-spur-accent/30'
                    : 'bg-transparent border-spur-border'
            }`}
        >
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-spur-border shrink-0 bg-spur-surface">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">
                    {taskStatusIcon(status)} {label}
                </span>
                <div className="flex items-center gap-1.5">
                    <Badge
                        variant="ghost"
                        size="sm"
                        className="font-mono text-spur-text-muted bg-spur-surface-2 border border-spur-border/80 px-2 py-0.5"
                    >
                        {tasks.length}
                    </Badge>
                    {onSortToggle && (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="h-6 w-6 p-0 flex items-center justify-center text-spur-text-muted hover:text-spur-text hover:bg-spur-surface-2 rounded-md transition-colors"
                            onClick={onSortToggle}
                            aria-label={`Sort ${label} by WBS`}
                            title={`Sort ${label}: ${sortDir === 'asc' ? 'WBS ↓' : sortDir === 'desc' ? 'WBS ↑' : 'none'}`}
                        >
                            {sortDir === 'asc' ? '↓' : sortDir === 'desc' ? '↑' : '⇅'}
                        </Button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[4rem]">
                {tasks.map((t) => (
                    <TaskCard key={t.wbs} task={t} onClick={onCardClick} />
                ))}
                {tasks.length === 0 && (
                    <div className="flex items-center justify-center h-20 text-xs text-spur-text-muted italic border border-dashed border-spur-border/60 rounded-lg my-1 bg-spur-surface/30">
                        No tasks
                    </div>
                )}
            </div>
        </section>
    );
}
