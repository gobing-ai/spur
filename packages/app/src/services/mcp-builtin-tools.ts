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
    // Task tools wave A of 1445: check, sections, deps, preflight and the inline batch plan.
    'sp_task_check',
    'sp_task_sections',
    'sp_task_deps',
    'sp_task_preflight',
    'sp_task_batch_plan',
    'sp_feature_check',
    // Feature, workflow and rule tools, wave B of 1445.
    'sp_feature_show',
    'sp_feature_list',
    'sp_feature_create',
    'sp_feature_update',
    'sp_feature_transition',
    'sp_feature_sync',
    'sp_feature_refresh',
    'sp_workflow_list',
    'sp_workflow_show',
    'sp_workflow_validate',
    'sp_workflow_cancel',
    'sp_rule_list',
    'sp_rule_validate',
    'sp_rule_run',
    // Decision, coordination, builder and self tools, wave C of 1445.
    'sp_decision_list',
    'sp_decision_show',
    'sp_decision_status',
    'sp_decision_run',
    'sp_agent_status',
    'sp_message_send',
    'sp_message_inbox',
    'sp_message_reply',
    'sp_builder_check_deps',
    'sp_builder_show_branches',
    'sp_self_status',
    'sp_self_search',
    'sp_self_actions',
];
