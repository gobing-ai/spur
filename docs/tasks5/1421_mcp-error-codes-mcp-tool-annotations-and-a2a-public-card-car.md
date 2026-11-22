---
schema_version: 1
name: MCP error codes, MCP tool annotations, and A2A public card, card skills and lane branch
status: todo
template: feature-impl
created_at: 2026-11-22T02:10:29.285Z
updated_at: "2026-11-22T04:04:11.734Z"
feature_id: A82
priority: P1
tags: ["integrations", "A82"]

estimate_hours: 5
---

## 1421. MCP error codes, MCP tool annotations, and A2A public card, card skills and lane branch

### Background

Implements: R1 — MCP argument-validation failures classify as invalid_arguments; R2 — MCP tool descriptors declare read and write annotations; R3 — The A2A Agent Card is public while other A2A routes stay bearer-only; R4 — The A2A Agent Card lists skills from the member declaration; R5 — A2A remoteBranch reports the member's own working-tree branch.

Design satellite: docs/design/integrations-module.md §1 (F1–F5). ADR-148 amendment 2026-11-21. These fixes come first because the Board reports the numbers they produce.

**Refine corrections (2026-11-21)**
- "laneForRequestKey resolves the A2A member's lane" → its KEY_PATTERN is `^fleet:task:([^:]+):(\d+)$` (`packages/app/src/services/worktree-lane-service.ts:13`). A2A request keys are `a2a:<instanceId>:<messageId>` (`apps/server/src/modules/a2a/index.ts:246`), so the lookup always returns null. The agent loop runs A2A drains in `projectPath` (`agent-loop-service.ts:577`), which is the server's `ctx.cwd`. → R5 has no live bug. It is narrowed to a regression lock: remoteBranch derives the drain tree by the same rule the agent loop uses (one shared call), and a test pins that, under lane mode, an A2A task reports the project tree's branch. No new lane routing for A2A.
- "card skills from role and description" → fleet members have `role` and `purpose`, not `description` (`packages/config/src/index.ts:543,568`). `memberAddresses` returns only `{instanceId, executor, enabled}` (`packages/app/src/services/fleet-service.ts:465`). → it gains `role` and `purpose`, and `AgentCardInput` gains both.
- "remoteBranch callers near :246/:252" → the only caller is `projectTask` at `apps/server/src/modules/a2a/index.ts:142`; :246/:252 are the `requestKey` builders. The card route's `authorize` is at :206, not :205.
- "throw from the validator around :595" → `validateToolArguments` returns a string; the throw is in `dispatchTool` at `apps/server/src/modules/mcp/index.ts:336`. Other throws are `requiredString` (:672 area) and the map-of-strings checks (:699, :703).
- MCP tests live in `apps/server/tests/modules/mcp-module.test.ts` and `apps/server/tests/modules/mcp/protocol.test.ts`, not `mcp*.test.ts` at an unknown path. A2A tests live in `apps/server/tests/modules/a2a/{routes,projection}.test.ts`.

### Requirements

- [ ] R1. Every MCP argument-validation failure (unknown argument, enum, type, missing, map-of-strings, and callWorkflowTool `invalid_arguments:` messages) returns errorCode `invalid_arguments`. Unknown-tool and renamed-tool stay `unknown_tool`; service throws stay `tool_error`.
- [ ] R2. All 10 built-in MCP tool descriptors, and every workflow-derived tool, declare `annotations: { readOnlyHint, destructiveHint, idempotentHint }` in `tools/list`.
- [ ] R3. `GET /a2a/members/:member/.well-known/agent-card.json` answers without a bearer token. Every other `/a2a` route still returns 401 without one and emits `auth.denied`.
- [ ] R4. The Agent Card `skills` array has one skill derived from the member's `role` and `purpose`, or one default `general` skill when the member has no role.
- [ ] R5. A completed A2A task's `metadata.remoteBranch` is the branch of the tree its drain ran in. The drain tree is resolved by the same `laneForRequestKey(…) ?? project` rule the agent loop uses, so A2A tasks report the project tree's branch even with lane mode on.

Out of scope: lane routing for A2A requests, per-run cancel (1422), the Board status contract (1423), and any token value in a card or error body.

### Acceptance Criteria

- [ ] AC1 — MCP argument-validation failures classify as invalid_arguments
- [ ] AC2 — MCP tool descriptors declare read and write annotations
- [ ] AC3 — The A2A Agent Card is public while other A2A routes stay bearer-only
- [ ] AC4 — The A2A Agent Card lists skills from the member declaration
- [ ] AC5 — A2A remoteBranch reports the member's own working-tree branch

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-22T03:57:27.122Z

- **Closed: F5 scope.** A2A drains never get a lane today (key pattern mismatch), so R5 is a shared-rule regression lock and not a behavior change. Lane routing for A2A is not part of A82; file it as its own feature if multi-writer A2A is ever wanted.
- **Closed: idempotentHint.** Reads are idempotent. Writes are marked false, because create, transition and workflow_run are not, and update can append history. A finer per-tool split is not needed for the Board's read/write badge.
- **Closed: skill source.** `purpose` is the member's human description field. There is no `description` field in the schema.

### Design

- **F1, typed error.** Add `export class InvalidArgumentsError extends Error` in `apps/server/src/modules/mcp/index.ts`. Throw it from `dispatchTool` (:336, with the `validateToolArguments` violation), `requiredString`, the map-of-strings checks (:699/:703) and `callWorkflowTool` (:268/:272, keeping the `invalid_arguments:` text). `toolErrorCode(error: unknown)` returns `invalid_arguments` for `instanceof InvalidArgumentsError`; delete the suffix regex (:666). The emit site (:305) passes the error, not its message. Rejected: widening the regex, which breaks on the next new message.
- **F2, annotations.** `McpToolDescriptor` (`apps/server/src/modules/mcp/protocol.ts:23`) gains an optional `annotations?: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean }`. Frozen values:
  - Read tools `sp_task_show`, `sp_task_list`, `sp_feature_check`, `sp_rule_run`, `sp_workflow_status`: `{true, false, true}`.
  - Write tools `sp_task_create`, `sp_task_update`, `sp_task_transition`, `sp_workflow_run`, `sp_workflow_continue`: `{false, false, false}`.
  - Workflow-derived tools: `{false, false, false}`.
  - No tool deletes, so `destructiveHint` is always false.
- **F3, public card.** Remove the `authorize` call from the card route only (:205–207) and rewrite the comment to say that the card is the one public route. `guard.authorize` stays on every other route.
- **F4, skills.** `memberAddresses` returns `role?: string; purpose?: string` as well. `AgentCardInput` gains `role?: string; purpose?: string`. `agentCard` emits `skills: [{ id: role ?? 'general', name: role ?? 'general', description: purpose ?? <the card description>, tags: [role ?? 'general'] }]`.
- **F5, drain tree.** `remoteBranch(ctx, requestKey)` computes `cwd = laneForRequestKey(ctx.cwd, declaration, requestKey) ?? ctx.cwd`. It reuses the agent loop's rule and does not fork it. `projectTask` (:142) passes `message.requestKey`.
- **Invariant:** no token value appears in any card, status or error body.
- **Anti-patterns:** do not add an A2A lane mapping; do not catch-and-rethrow to change messages; do not change the public tool names or the error-code vocabulary (still three codes).
- **Handoff:** 1422 builds on the A2A module as left here. 1423 reads `annotations` and the error codes from `TOOL_DESCRIPTORS` and the `mcp.*` events.

### Plan

- [ ] 1. (R1) Write failing tests in `apps/server/tests/modules/mcp-module.test.ts`, one per message family (unknown argument, enum, string/boolean/array type, missing, map-of-strings, workflow `invalid_arguments:`). Each asserts the `mcp.tool.called` event's `errorCode === 'invalid_arguments'` and the JSON-RPC error. Add one `unknown_tool` regression and one `tool_error` regression.
- [ ] 2. (R1) Add `InvalidArgumentsError`, throw it at the sites in Design F1, change `toolErrorCode` to `instanceof`, and delete the regex.
- [ ] 3. (R2) Write a failing test: `tools/list` has `annotations` on every tool with the frozen values. Then add the field to `McpToolDescriptor` and `TOOL_DESCRIPTORS`, plus the default for workflow tools.
- [ ] 4. (R3, R4) Write failing tests in `apps/server/tests/modules/a2a/routes.test.ts`: an unauthenticated card GET returns 200; message:send and tasks:get return 401 and emit `auth.denied`. In `projection.test.ts`: a role plus purpose yields one skill; no role yields `general`.
- [ ] 5. (R3, R4) Remove `authorize` from the card route and fix the comment. Extend `memberAddresses` and `AgentCardInput`, and map them in `agentCard`.
- [ ] 6. (R5) Write a failing test in `routes.test.ts`: with lane mode on (`agent.fleet.maxWriters` set) and a completed A2A task, `metadata.remoteBranch` equals the project tree's branch. Then change `remoteBranch(ctx, requestKey)` per Design F5.
- [ ] 7. Update `docs/design/embedded-mcp-server.md` (annotations, typed error codes) and `docs/design/a2a-member-transport.md` (public card, skills). Then run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)

