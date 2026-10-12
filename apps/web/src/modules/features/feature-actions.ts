/** Actions offered per feature status — the single source of truth for button visibility. */
export const FEATURE_STATUS_ACTIONS: Record<string, readonly string[]> = {
    backlog: ['brainstorm', 'plan', 'add-child', 'add-task', 'start', 'cancel', 'deprecate'],
    active: ['add-child', 'add-task', 'link-task', 'sync-status', 'verify', 'block', 'cancel', 'deprecate'],
    verifying: ['sync-status', 'complete', 'rework', 'cancel', 'deprecate'],
    blocked: ['add-child', 'add-task', 'unblock', 'cancel', 'deprecate'],
    done: ['deprecate'],
    deprecated: ['undeprecate', 'cancel'],
    cancelled: [],
};

/** Label for each action button — single source of truth. */
export const FEATURE_ACTION_LABELS: Record<string, string> = {
    brainstorm: 'Brainstorm',
    plan: 'Plan',
    'add-child': '+ Child',
    'add-task': '+ Task',
    'link-task': 'Link Task',
    'sync-status': 'Sync',
    start: 'Start',
    verify: 'Verify',
    complete: 'Complete',
    rework: 'Rework',
    block: 'Block',
    unblock: 'Unblock',
    cancel: 'Cancel',
    deprecate: 'Deprecate',
    undeprecate: 'Un-deprecate',
};
/** Visual tier of a detail action button: primary transition, secondary creation/link, or hazard. */
export type FeatureActionTier = 'primary' | 'secondary' | 'hazard';

/** Visual tier per action — presentation only; membership stays in FEATURE_STATUS_ACTIONS. */
export const FEATURE_ACTION_TIER: Record<string, FeatureActionTier> = {
    start: 'primary',
    verify: 'primary',
    complete: 'primary',
    unblock: 'primary',
    brainstorm: 'secondary',
    plan: 'secondary',
    'add-child': 'secondary',
    'add-task': 'secondary',
    'link-task': 'secondary',
    'sync-status': 'secondary',
    block: 'hazard',
    rework: 'hazard',
    cancel: 'hazard',
    deprecate: 'hazard',
    undeprecate: 'primary',
};

/** Actions that are FSM transitions (use existing transitionFeature API). */
export const FSM_ACTIONS: Record<string, true> = {
    start: true,
    verify: true,
    complete: true,
    rework: true,
    block: true,
    unblock: true,
    cancel: true,
    deprecate: true,
    undeprecate: true,
};

/** FSM action → target status mapping. */
export const FSM_TRANSITION_TARGET: Record<string, string> = {
    start: 'active',
    verify: 'verifying',
    complete: 'done',
    rework: 'active',
    block: 'blocked',
    unblock: 'active',
    cancel: 'cancelled',
    deprecate: 'deprecated',
    undeprecate: 'active',
};

/** Actions that dispatch via spur agent run (need channel selector). */
export const AGENT_ACTIONS: Record<string, true> = {
    brainstorm: true,
    plan: true,
};

/** Actions that create resources (need inline input dialog). */
export const CREATE_ACTIONS: Record<string, true> = {
    'add-child': true,
    'add-task': true,
};

/** Actions that modify existing resources (need inline input dialog). */
export const LINK_ACTIONS: Record<string, true> = {
    'link-task': true,
};
