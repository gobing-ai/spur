---
schema_version: 1
name: MCP error codes, MCP tool annotations, and A2A public card, card skills and lane branch
status: done
template: feature-impl
created_at: 2026-11-22T02:10:29.285Z
updated_at: "2026-11-23T06:14:39.507Z"
feature_id: A82
priority: P1
tags: ["integrations", "A82"]

estimate_hours: 5
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Every MCP argument-validation failure (unknown argument, enum, type, missing, map-of-strings, and callWorkflowTool `invalid_arguments:` messages) returns errorCode `invalid_arguments`. Unknown-tool and renamed-tool stay `unknown_tool`; service throws stay `tool_error`.
- [x] R2. All 10 built-in MCP tool descriptors, and every workflow-derived tool, declare `annotations: { readOnlyHint, destructiveHint, idempotentHint }` in `tools/list`.
- [x] R3. `GET /a2a/members/:member/.well-known/agent-card.json` answers without a bearer token. Every other `/a2a` route still returns 401 without one and emits `auth.denied`.
- [x] R4. The Agent Card `skills` array has one skill derived from the member's `role` and `purpose`, or one default `general` skill when the member has no role.
- [x] R5. A completed A2A task's `metadata.remoteBranch` is the branch of the tree its drain ran in. For a named member using its registered lane worktree, report that lane's branch. Runs with no member lane report the project tree's branch.

Out of scope: lane routing for A2A requests, per-run cancel (1422), the Board status contract (1423), and any token value in a card or error body.

### Acceptance Criteria

- [x] AC1 — MCP argument-validation failures classify as invalid_arguments
- [x] AC2 — MCP tool descriptors declare read and write annotations
- [x] AC3 — The A2A Agent Card is public while other A2A routes stay bearer-only
- [x] AC4 — The A2A Agent Card lists skills from the member declaration
- [x] AC5 — A2A remoteBranch reports the member's own working-tree branch

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

| File | Change | Why |
| --- | --- | --- |
| `apps/server/src/modules/mcp/index.ts:38-42` | `InvalidArgumentsError` exported | The failure class is the code; a new validator message can never be misfiled |
| `apps/server/src/modules/mcp/index.ts:330` | `dispatchTool` throws `InvalidArgumentsError` for a declared-schema violation | R1 unknown/enum/type families |
| `apps/server/src/modules/mcp/index.ts:262,266` | `callWorkflowTool` argument checks throw it (messages unchanged) | R1 workflow-tool family keeps its `invalid_arguments:` text |
| `apps/server/src/modules/mcp/index.ts:325-327` | `sp_task_update` argument-rule refusals throw it | Same class of failure, same code |
| `apps/server/src/modules/mcp/index.ts:660,699-707,718-728` | `toolErrorCode(error)` reads `instanceof` and the suffix regex is deleted; `requiredString`, map-of-strings and array checks throw it | One classification site instead of four message shapes |
| `apps/server/src/modules/mcp/index.ts:44-49` | `READ_TOOL` / `WRITE_TOOL` frozen annotation pairs | R2's frozen values in one place |
| `apps/server/src/modules/mcp/index.ts:52-200` | every built-in descriptor carries `annotations` | R2: `tools/list` advertises hints, not a client-side name table |
| `apps/server/src/modules/mcp/protocol.ts:30-56` | `McpToolDescriptor.annotations` + `McpToolAnnotations` | The protocol type carries what the wire carries |
| `packages/app/src/services/mcp-workflow-tools.ts:186` | workflow-derived descriptors carry the write hints | R2 covers every advertised tool, not only the built-ins |
| `apps/server/src/modules/a2a/index.ts:44-52` | `FleetSeams.load` (optional) | The lane switch lives in the declaration the agent loop already reads |
| `apps/server/src/modules/a2a/index.ts:112-145` | `drainTree()` + `remoteBranch(ctx, requestKey)` | R5: one `laneForRequestKey(...) ?? projectPath` rule, no A2A lane routing |
| `apps/server/src/modules/a2a/index.ts:157` | `projectTask` passes `message.requestKey` | The key is what the rule needs |
| `apps/server/src/modules/a2a/index.ts:207-215` | comment states the card is the only public route | R3's route discipline is documented where it is enforced |
| `apps/server/src/modules/a2a/index.ts:216-235` | card route drops `authorize` and forwards `role`/`purpose` | R3 public card, R4 skill source |
| `apps/server/src/modules/a2a/projection.ts:53-64,80-105` | `AgentCardInput.role/purpose`, one `skills` entry (`general` when no role) | R4 |
| `packages/app/src/services/fleet-service.ts:465-480` | `memberAddresses` returns `role`/`purpose` | The card can only project what the address carries |
| `packages/app/tests/workflow/idea-pipeline-definition.test.ts:27-35` | test-local `Action.options` gains `expectFiles` | Pre-existing repo-wide typecheck failure (base tree), repaired so the gate can judge this task |
| `apps/server/tests/modules/mcp-module.test.ts` | R1 families + R2 annotations | Failing first; every family asserts the emitted `errorCode` |
| `apps/server/tests/modules/a2a/{routes,projection}.test.ts` | public card, 401 elsewhere, skills, lane-mode branch | R3/R4/R5 |
| `docs/design/embedded-mcp-server.md`, `docs/design/a2a-member-transport.md` | annotations, typed error code, public card, skills, drain tree | T3: the design satellite moves with the surface |

**Forced re-verification update.** The original F5 design preceded lane-backed A2A runs. The existing lane allocator resolves a named member's registered lane and the loop writes its branch beside the run receipt. GetTask reads that recorded branch, with a project-tree fallback for ordinary runs. This implements A82 R5; see `packages/app/tests/services/agent-loop-service.test.ts:1198` and `apps/server/tests/modules/a2a/routes.test.ts:439`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/tests/modules/mcp-module.test.ts:537` — Response and ledger agree on invalid_arguments for each validation family; error controls retain their classifications. |
| R2 | MET | `apps/server/tests/modules/mcp-module.test.ts:666` — Built-ins and exposed workflows carry their three behavior hints. |
| R3 | MET | `apps/server/tests/modules/a2a/routes.test.ts:236` — Bearer refusal emits auth.denied; the same suite proves the card alone is public. |
| R4 | MET | `apps/server/tests/modules/a2a/projection.test.ts:53` — Declared role and purpose form the skill; the default general skill is covered at line 66. |
| R5 | MET | `packages/app/tests/services/agent-loop-service.test.ts:1198` — The named member runs in its registered lane. HTTP returns the recorded branch in apps/server/tests/modules/a2a/routes.test.ts:439; the preceding test covers the project-tree fallback. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — MCP argument-validation failures classify as invalid_arguments | MET | test | `apps/server/tests/modules/mcp-module.test.ts:537` — Response and ledger agree on invalid_arguments for each validation family; error controls retain their classifications. |
| R2 — MCP tool descriptors declare read and write annotations | MET | test | `apps/server/tests/modules/mcp-module.test.ts:666` — Built-ins and exposed workflows carry their three behavior hints. |
| R3 — The A2A Agent Card is public while other A2A routes stay bearer-only | MET | test | `apps/server/tests/modules/a2a/routes.test.ts:236` — Bearer refusal emits auth.denied; the same suite proves the card alone is public. |
| R4 — The A2A Agent Card lists skills from the member declaration | MET | test | `apps/server/tests/modules/a2a/projection.test.ts:53` — Declared role and purpose form the skill; the default general skill is covered at line 66. |
| R5 — A2A remoteBranch reports the member's own working-tree branch | MET | test | `packages/app/tests/services/agent-loop-service.test.ts:1198` — The named member runs in its registered lane. HTTP returns the recorded branch in apps/server/tests/modules/a2a/routes.test.ts:439; the preceding test covers the project-tree fallback. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-22T02:19:02.338Z feature_id S → A82 (system)
- 2026-11-22T05:02:58.053Z todo → wip (system)
- 2026-11-22T05:03:45.342Z wip → testing (system)
- 2026-11-22T05:03:47.496Z testing → done (system)

