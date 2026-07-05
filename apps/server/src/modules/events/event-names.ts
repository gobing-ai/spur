/**
 * Planning event names persisted by the system_events tap and streamed over the
 * `/api/events/planning` SSE endpoint. The single source for both consumers —
 * adding a new event here flows into persistence (R2 tap) and the live stream.
 */
export const PLANNING_EVENT_NAMES: string[] = [
    'task.created',
    'task.updated',
    'task.transitioned',
    'feature.created',
    'feature.updated',
    'feature.transitioned',
    'queue.consumer.started',
    'queue.consumer.stopped',
    'queue.job.enqueued',
    'queue.job.completed',
    'queue.job.failed',
    'queue.job.retrying',
    'queue.stats',
    'scheduler.job.executed',
];
