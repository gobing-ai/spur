import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';
import { Badge, Card, CardBody } from '@/ui';
import type { TaskSummary } from './types';
import { useTasks } from './useTasks';

const RELATIVE_REFRESH_MS = 60_000;

/** Staleness threshold: timestamps older than 7 days get the faint tint (F72 R4). */
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/** Priority accent — colored left border resolved through `.task-kanban` tokens (F72 R3). */
const PRIORITY_ACCENT: Record<string, string> = {
    P1: 'border-l-2 border-l-spur-error',
    P2: 'border-l-2 border-l-spur-warning',
    P3: 'border-l-2 border-l-spur-text-muted',
};

function relativeTime(iso: string, now: number): string {
    const then = new Date(iso).getTime();
    const diff = now - then;
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
}

interface Props {
    task: TaskSummary;
    onClick: (wbs: string) => void;
}
export default function TaskCard({ task, onClick }: Props) {
    const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
        id: task.wbs,
        data: { task },
    });

    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), RELATIVE_REFRESH_MS);
        return () => clearInterval(id);
    }, []);

    const style = transform
        ? { transform: CSS.Transform.toString(transform), zIndex: isDragging ? 50 : undefined }
        : undefined;

    // F72 R2: read the active board store's derived map through the existing hook.
    const { subtaskProgress } = useTasks();
    const progress = subtaskProgress.get(task.wbs);
    const accent = task.priority ? PRIORITY_ACCENT[task.priority] : undefined;
    const stale = task.updatedAt ? now - new Date(task.updatedAt).getTime() > STALE_THRESHOLD_MS : false;

    return (
        <Card
            variant="compact"
            asChild
            className={`bg-spur-surface-2 hover:bg-spur-surface-3 rounded-xl border border-spur-border cursor-pointer transition-colors w-full text-left ${accent ?? ''} ${
                isDragging ? 'opacity-30' : ''
            }`}
        >
            <button
                ref={setNodeRef}
                type="button"
                style={style}
                onClick={() => onClick(task.wbs)}
                {...listeners}
                {...attributes}
                aria-roledescription="draggable card"
            >
                <CardBody className="p-3 gap-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-mono text-spur-text-muted">{task.wbs}</span>
                        {task.priority && (
                            <Badge variant="outline" size="xs">
                                {task.priority}
                            </Badge>
                        )}
                    </div>
                    <p className="text-sm font-medium text-spur-text leading-snug">{task.name}</p>
                    <div className="flex gap-1 flex-wrap items-center">
                        {progress && progress.total > 0 && (
                            <Badge
                                variant="outline"
                                size="xs"
                                data-testid="subtask-progress"
                                title="subtasks done/total"
                            >
                                {progress.done}/{progress.total}
                            </Badge>
                        )}
                        {task.type && task.type !== 'task' && (
                            <Badge variant="outline" size="xs">
                                {task.type}
                            </Badge>
                        )}
                        {task.featureId && (
                            <Badge variant="outline" size="xs">
                                {task.featureId}
                            </Badge>
                        )}
                        {task.updatedAt && (
                            <span
                                className={`text-xs font-mono ml-auto ${stale ? 'text-spur-text-faint' : 'text-spur-text-muted'}`}
                                title={task.updatedAt}
                            >
                                {relativeTime(task.updatedAt, now)}
                            </span>
                        )}
                    </div>
                </CardBody>
            </button>
        </Card>
    );
}
