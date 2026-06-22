import { useDroppable } from '@dnd-kit/core';
import TaskCard from './TaskCard';
import type { TaskSummary } from './types';

interface Props {
    status: string;
    label: string;
    tasks: TaskSummary[];
    onCardClick: (wbs: string) => void;
}

export default function KanbanColumn({ status, label, tasks, onCardClick }: Props) {
    const { setNodeRef, isOver } = useDroppable({
        id: status,
        data: { status },
    });

    return (
        <section
            ref={setNodeRef}
            aria-label={`${label} column`}
            className={`flex flex-col flex-shrink-0 w-64 rounded-lg border transition-colors duration-200 ${
                isOver ? 'bg-spur-accent/10 border-spur-accent/40 shadow-lg' : 'bg-spur-surface border-spur-border'
            }`}
        >
            <div className="flex items-center justify-between px-3 py-2 border-b border-spur-border shrink-0">
                <span className="text-xs font-semibold text-spur-text uppercase tracking-wide">{label}</span>
                <span className="badge badge-sm badge-ghost">{tasks.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[4rem]">
                {tasks.map((t) => (
                    <TaskCard key={t.wbs} task={t} onClick={onCardClick} />
                ))}
                {tasks.length === 0 && (
                    <div className="flex items-center justify-center h-16 text-xs text-spur-text-muted italic">
                        No tasks
                    </div>
                )}
            </div>
        </section>
    );
}
