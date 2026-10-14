/**
 * Actions offered per task status — the single source of truth for button visibility.
 *
 * The task-side analogue of `FEATURE_STATUS_ACTIONS` (F42): a status lists an action only
 * when the task-lifecycle graph admits the transition it maps to. `task-actions.test.ts` asserts
 * that against the state machine's build-time source (the canonical task-lifecycle workflow
 * definition);
 * a deployed project resolves the same graph at its runtime path
 * (`.spur/workflows/`). `deprecated` offers its two legal exits — un-deprecate to `todo`, or
 * `cancelled` for removal (ADR-137).
 */
export const TASK_STATUS_ACTIONS: Record<string, readonly string[]> = {
    backlog: ['refine', 'start', 'cancel', 'deprecate'],
    todo: ['plan', 'run', 'decompose', 'add-subtask', 'link-feature', 'block', 'cancel', 'deprecate'],
    wip: ['run', 'add-subtask', 'link-feature', 'block', 'cancel', 'deprecate'],
    testing: ['verify', 'complete', 'block', 'cancel', 'deprecate'],
    blocked: ['refine', 'unblock', 'cancel', 'deprecate'],
    done: ['reopen', 'deprecate'],
    deprecated: ['undeprecate', 'cancel'],
    cancelled: [],
};

/** Label for each action button — single source of truth. */
export const TASK_ACTION_LABELS: Record<string, string> = {
    refine: 'Refine',
    plan: 'Plan',
    run: 'Run',
    verify: 'Verify',
    decompose: 'Decompose',
    'add-subtask': '+ Subtask',
    'link-feature': 'Link Feature',
    start: 'Start',
    complete: 'Complete',
    reopen: 'Reopen',
    block: 'Block',
    unblock: 'Unblock',
    cancel: 'Cancel',
    deprecate: 'Deprecate',
    undeprecate: 'Un-deprecate',
};

/**
 * FSM transition actions → target status. Actions absent here are workflow actions
 * dispatched through `api.task.action` instead of a status write.
 */
export const TASK_FSM_TRANSITIONS: Record<string, string> = {
    start: 'todo',
    complete: 'done',
    reopen: 'wip',
    block: 'blocked',
    unblock: 'todo',
    cancel: 'cancelled',
    deprecate: 'deprecated',
    undeprecate: 'todo',
};
