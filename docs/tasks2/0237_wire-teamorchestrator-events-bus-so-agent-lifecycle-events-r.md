---
template: feature-impl
schema_version: 1
name: "Wire TeamOrchestrator events bus so agent lifecycle events reach system event tap"
description: ""
status: done
type: task
profile: standard
feature_id: J2
parent_wbs: null
priority: P1
tags: ["observability", "agent", "team", "wiring", "server"]
dependencies: []
created_at: "2026-07-10T00:02:02.995Z"
updated_at: "2026-07-28T00:32:05.628Z"
---

## 0237. Wire TeamOrchestrator events bus so agent lifecycle events reach system event tap

### Background
Feature L. Source-verified: `TeamOrchestrator` in `@gobing-ai/ts-ai-runner` emits `agent.started` (team-orchestrator.ts:73), `agent.stopped` (line 86), and `agent.message.sent` (line 98) when team orchestration runs. However, `TeamService.orchestrator()` at team-service.ts:372 creates `new TeamOrchestrator(this.configDir, dao)` with NO options, so the `events` parameter falls back to a throwaway `new EventBus<AgentEvents>()` (team-orchestrator.ts:35). `TeamServiceContext` (team-service.ts:27) doesn't even have an events field for the canonical server bus.

These three catalog events (event-names.ts:106-108) currently fire into a void — the tap subscribes to them but they never reach the server's canonical bus.

Separately: `message.sent`/`message.replied` are correctly wired via `TeamServiceContext.eventBus` (team-service.ts:41, 163, 357) — these are TeamService-emitted, not TeamOrchestrator-emitted. The `agent.message.sent` (orchestrator path) and `message.sent` (TeamService path) are different events with different scopes — both need to work.
### Requirements
R1. Add `events?: EventBus<AgentEvents>` field to `TeamServiceContext` in packages/app/src/services/team-service.ts.

R2. In `TeamService.orchestrator()` (line 372), pass `{ events: this.ctx.events }` to the `TeamOrchestrator` constructor when `ctx.events` is defined. Keep the fallback to throwaway bus when no events provided (CLI path).

R3. In apps/server/src/context.ts, wire the canonical eventsBus into the `TeamServiceContext.events` field.

R4. Verify that after wiring, team agent start/stop/send-message operations produce system_events rows for agent.started, agent.stopped, agent.message.sent.

R5. Verify existing message.sent/message.replied wiring is unchanged (TeamServiceContext.eventBus path, not the TeamOrchestrator path).

R6. Search for and update any test files that mock TeamServiceContext without the new events field.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
Wire `TeamOrchestrator` lifecycle events onto the server EventBus so `agent.started` / `agent.stopped` / `agent.message.sent` reach the system_events tap.

1. **`packages/app/src/services/team-service.ts:49-55`** — `TeamServiceContext.events?: EventBus<AgentEvents>` for agent lifecycle (separate from `eventBus` used for `message.sent|replied`).
2. **`packages/app/src/services/team-service.ts:386-390`** — `orchestrator()` constructs `new TeamOrchestrator(this.configDir, dao, { events: this.ctx.events })`; when `events` is undefined (CLI), orchestrator falls back to its throwaway bus.
3. **`apps/server/src/context.ts:359-362`** — `teamService()` injects `events: eventsBus as unknown as never` (same cast pattern as `eventBus` and workflow buses).

`message.sent` / `message.replied` remain on `TeamServiceContext.eventBus` (`team-service.ts:371-379`) — unchanged path (R5).
### Testing
**Verify run:** 2026-07-11 — `/sp:dev-verify 0237 --auto --focus all --fix all --force` (standalone re-audit of `done` task).

**Coverage:** N/A as monorepo aggregate. Focused suites below cover the new wiring paths.

**Command evidence (this run):**
```
bun test packages/app/tests/services/team-service.test.ts -t "agent lifecycle"
3 pass (R4 orchestrator emit, R5 message.sent coexistence, R6 optional events)

bun test apps/server/tests/upstream-system-events-wiring.test.ts -t "0237"
1 pass — agent.started / agent.stopped / agent.message.sent rows in system_events

bunx tsc --noEmit -p packages/app   # exit 0
bunx tsc --noEmit -p apps/server    # exit 0
```

**`--fix all` applied this run:**
1. Added app tests for R4/R5/R6 (`team-service.test.ts` — agent lifecycle bus describe).
2. Added server integration `[0237 R4]` proving orchestrator emits on server `eventsBus` reach the tap.
3. Solution rewritten with `file:line` citations; Testing expanded with command evidence.

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `team-service.ts:55` `events?: EventBus<AgentEvents>` |
| R2 | MET | `team-service.ts:388` `{ events: this.ctx.events }` to TeamOrchestrator |
| R3 | MET | `context.ts:362` `events: eventsBus as unknown as never` in `teamService()` |
| R4 | MET | App: orchestrator start/send/stop emits three events; Server: same bus → system_events rows (`[0237 R4]`) |
| R5 | MET | `R5: message.sent still fires when both eventBus and events are wired` — message path unchanged |
| R6 | MET | Optional field; existing mocks valid; R6 test constructs without events |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| (section empty / placeholder only) | N/A | n/a | No checklist/Gherkin AC; verified via R1–R6 |

**Design conformance:** task `### Design` empty; implementation matches Background (add events field, pass to orchestrator, wire server bus; leave message eventBus alone). DONE.

**SECUA Review (answer-file; Review section owned by `/sp:dev-review`)**

| Sev | Dim | Finding |
|-----|-----|---------|
| — | S | Metadata-only agent lifecycle payloads; no message body on agent.message.sent. |
| — | E | Optional bus; no extra work when CLI omits events. |
| — | C | Separate fields prevent conflating message.* with agent.*; cast matches server pattern. |
| — | U | Comments document which bus field owns which events. |
| minor | A | Board team start/stop uses SupervisorService (`process.*`), not TeamOrchestrator (`agent.*`) — wiring enables orchestrator path when used; not a regression of this task's scope. |

No blocker/major findings.

**Verdict:** PASS — R1–R6 MET with executable R4/R5 evidence after this verify.
### Review
PASS. The wiring is correct: `TeamOrchestrator` now receives the canonical server bus via `ctx.events`, so `agent.started`, `agent.stopped`, and `agent.message.sent` will reach the system event tap.

Optional field safety: `events?: EventBus<AgentEvents>` is optional in `TeamServiceContext`, so the CLI path (which doesn't provide it) still works — the orchestrator creates its internal throwaway bus.

Cast safety: `as unknown as never` matches the established pattern. Runtime soundness verified — same singleton `eventsBus` instance.

Existing `message.sent`/`message.replied` wiring (R5) is untouched — those events fire through `TeamServiceContext.eventBus`, a different field and code path.
### References

L

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-10T00:52:06.313Z todo → done (system)
