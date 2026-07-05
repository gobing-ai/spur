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
    // Inbox IPC (task 0193/0204): message lifecycle events emitted inside
    // TeamService. Metadata only — id/from/to/thread id/createdAt; the body
    // stays in the store. `message.read` is deferred until a mark-read API
    // exists (InboxMessageDao currently only exposes markDelivered/markFailed).
    'message.sent',
    'message.replied',
];
