import { TASK_STATUSES } from '@gobing-ai/spur-domain/schema';
import type { TaskSummary } from './types';

interface Props {
    /** Selected task, resolved by the container from the polled list (null when nothing is selected). */
    task: TaskSummary | null;
    onTransition: (wbs: string, toStatus: string) => void;
}

/** Right-panel task detail (R4) — frontmatter + status transition buttons. READ-ONLY (inline editing deferred). */
export default function TaskDetail({ task, onTransition }: Props) {
    if (!task) {
        return (
            <div className="flex items-center justify-center h-full text-spur-text-muted text-sm">
                Select a task to view details
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div className="p-3 border-b border-spur-border shrink-0">
                <h3 className="text-sm font-semibold text-spur-text mb-1">{task.wbs}</h3>
                <p className="text-sm text-spur-text">{task.name}</p>
            </div>

            <div className="p-3 border-b border-spur-border shrink-0">
                <span className="text-xs font-semibold text-spur-text-muted uppercase tracking-wide mb-2 block">
                    Status
                </span>
                <div className="flex flex-wrap gap-1">
                    {(TASK_STATUSES as readonly string[]).map((s: string) => (
                        <button
                            key={s}
                            type="button"
                            onClick={() => onTransition(task.wbs, s)}
                            className={`btn btn-xs ${task.status === s ? 'btn-primary' : 'btn-ghost'}`}
                        >
                            {s}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-2">
                    {task.priority && (
                        <div>
                            <span className="text-xs text-spur-text-muted">Priority</span>
                            <span className="badge badge-outline badge-xs ml-2">{task.priority}</span>
                        </div>
                    )}
                    {task.featureId && (
                        <div>
                            <span className="text-xs text-spur-text-muted">Feature</span>
                            <span className="text-sm text-spur-text ml-2">{task.featureId}</span>
                        </div>
                    )}
                    <div>
                        <span className="text-xs text-spur-text-muted">File</span>
                        <span className="text-xs text-spur-text ml-2 font-mono">{task.filePath}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
