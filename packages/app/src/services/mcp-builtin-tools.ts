/**
 * The embedded MCP server's built-in tool names, in their final `sp` namespace form
 * (task 1379 R1).
 *
 * They live here rather than in `apps/server` because `workflow validate` must refuse an
 * exposed workflow whose tool name collides with one (task 1381 R4), and apps are thin
 * transports. A server-side test asserts this list matches the advertised descriptors.
 */
export const MCP_BUILTIN_TOOL_NAMES: readonly string[] = [
    'sp_task_show',
    'sp_task_list',
    'sp_workflow_status',
    'sp_workflow_run',
    'sp_workflow_continue',
    // Corpus write tools (task 1392). They are reserved for the same reason as the read tools:
    // `workflow validate` must refuse an exposed workflow whose derived name collides.
    'sp_task_create',
    'sp_task_update',
    'sp_task_transition',
    'sp_feature_check',
    'sp_rule_run',
];
