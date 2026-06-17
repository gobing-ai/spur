import type { TaskSummary } from './types';

const STATUS_COLORS: Record<string, string> = {
    backlog: 'badge-neutral',
    todo: 'badge-info',
    wip: 'badge-warning',
    testing: 'badge-accent',
    blocked: 'badge-error',
    done: 'badge-success',
    cancelled: 'badge-ghost',
};

interface Props {
    task: TaskSummary;
    onClick: (wbs: string) => void;
}

export default function TaskCard({ task, onClick }: Props) {
    const badgeClass = STATUS_COLORS[task.status] ?? 'badge-ghost';

    return (
        <button
            type="button"
            draggable
            className="card card-compact bg-base-200 shadow-sm cursor-pointer hover:shadow-md transition-shadow border border-spur-border w-full text-left"
            onClick={() => onClick(task.wbs)}
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', task.wbs);
                e.dataTransfer.effectAllowed = 'move';
            }}
        >
            <div className="card-body p-3 gap-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-spur-text-muted">{task.wbs}</span>
                    <span className={`badge badge-xs ${badgeClass}`}>{task.status}</span>
                </div>
                <p className="text-sm font-medium text-spur-text leading-snug">{task.name}</p>
                <div className="flex gap-1 flex-wrap">
                    {task.priority && <span className="badge badge-outline badge-xs">{task.priority}</span>}
                    {task.featureId && <span className="badge badge-outline badge-xs">{task.featureId}</span>}
                </div>
            </div>
        </button>
    );
}
