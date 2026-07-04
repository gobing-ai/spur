import type { PlanningEventName } from '@gobing-ai/spur-app';

/**
 * Planning event names persisted by the system_events tap and streamed over the
 * `/api/events/planning` SSE endpoint. The single source for both consumers —
 * adding a new event here flows into persistence (R2 tap) and the live stream.
 */
export const PLANNING_EVENT_NAMES: PlanningEventName[] = [
    'task.created',
    'task.updated',
    'task.transitioned',
    'feature.created',
    'feature.updated',
    'feature.transitioned',
];
