import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useEffect, useState } from 'react';
import type { TaskSummary } from './types';

const RELATIVE_REFRESH_MS = 60_000;

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

    return (
        <button
            ref={setNodeRef}
            type="button"
            style={style}
            className={`card card-compact bg-base-200 shadow-sm cursor-pointer hover:shadow-md transition-shadow border border-spur-border w-full text-left ${
                isDragging ? 'opacity-30' : ''
            }`}
            onClick={() => onClick(task.wbs)}
            {...listeners}
            {...attributes}
            aria-roledescription="draggable card"
        >
            <div className="card-body p-3 gap-1">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-spur-text-muted">{task.wbs}</span>
                </div>
                <p className="text-sm font-medium text-spur-text leading-snug">{task.name}</p>
                <div className="flex gap-1 flex-wrap items-center">
                    {task.type && task.type !== 'task' && (
                        <span className="badge badge-outline badge-xs">{task.type}</span>
                    )}
                    {task.priority && <span className="badge badge-outline badge-xs">{task.priority}</span>}
                    {task.featureId && <span className="badge badge-outline badge-xs">{task.featureId}</span>}
                    {task.updatedAt && (
                        <span className="text-[10px] text-spur-text-muted ml-auto" title={task.updatedAt}>
                            {relativeTime(task.updatedAt, now)}
                        </span>
                    )}
                </div>
            </div>
        </button>
    );
}
