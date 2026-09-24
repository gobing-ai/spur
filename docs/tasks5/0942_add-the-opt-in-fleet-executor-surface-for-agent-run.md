---
schema_version: 1
name: Add the opt-in fleet executor surface for agent.run
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.005Z
updated_at: "2026-09-24T00:25:35.137Z"
feature_id: D64
priority: P2
tags:
  - workflow
  - fleet
  - executor

dependencies: ["0937"]
estimate_hours: 8
---

## 0942. Add the opt-in fleet executor surface for agent.run

### Background

Implements: R8 — The agent fleet is an optional executor surface. ADR-126; docs/design/workflow-catalogue-refactor.md §5; builds on fleet-config-declaration.md and inter-agent-control-plane.md.

**Refine corrections (2026-09-23)**

1. *Seams exist; this is wiring, not new infrastructure.* The pieces are:
   - `agent.fleet {enabled (default false), strategy: rest|gtd, members[]}` in `packages/config/src/index.ts`;
   - `FleetService.resolve(projectPath): ResolvedFleet` with `ResolvedFleetMember.role` (`packages/app/src/services/fleet-service.ts:68`, `:97`). Role-only members resolve through the shared `cheapestEligibleExecutors` funnel (`agent-service.ts`);
   - `AgentCoordinationService.sendMessage` and `assignTask` (`agent-coordination-service.ts:256`, `:491`);
   - `spur agent wait --role --until`, an identity-pinned wait;
   - the run-scoped executor pin `__executor.<role>` in `packages/app/src/workflow/actions/agent-run.ts:246` onward (B7/0894).
2. *Parity check scope.* The claim was that `inline-pipeline-parity-check` "gains a fleet column". That check is a three-way diff of action/guard *kinds* (`plugins/sp/scripts/inline-pipeline-parity-check.ts`). It has no surface columns. Surface parity is proven instead by a trace-field test: fleet, inline and subprocess action rows carry the same `expectFile`, duration and terminal reason.
3. *Control-plane verbs.* `spur message` has `send`, `inbox`, `reply` and `watch`. `send --wait` blocks until the recipient reaches a state. No new noun or verb is needed.

### Requirements

- [ ] R1. The surface is selected by `--agent fleet` on model-bearing `/sp:dev-*` commands or by workflow var `executor: fleet`. The selection is valid only when `agent.fleet.enabled` is true and `FleetService.resolve` yields an enabled member whose `role` matches the action's `role`. Tie-breaking uses the configured `strategy` (rest|gtd).
- [ ] R2. Dispatch runs through `AgentCoordinationService.sendMessage` to the resolved member, with a body naming run id, state, prompt artifact path and `expectFile`. It then waits identity-pinned (member id plus message id) until `expectFile` exists or the action timeout elapses. There is no terminal scraping and no keystrokes.
- [ ] R3. When the fleet is unavailable (disabled, no member for the role, or member unreachable), the action fails with an explicit message and 0937 reason `failed-agent`. When `executorFallback: traditional` is set, it instead records `fallbackReason` in the action result and runs the existing subprocess path.
- [ ] R4. The fleet action row records `surface: 'fleet'`, `memberId`, `messageId`, `expectFile`, `durationMs` and the terminal reason. A test asserts the same key set as on the subprocess surface, plus the fleet-only ids.
- [ ] R5. Reviewer and verify roles require a fresh member session per dispatch (ADR-121). A reused session is rejected before send. With the fleet not selected, `agent.run` behavior and tests are byte-for-byte unchanged.

### Acceptance Criteria

- [ ] AC1 — The agent fleet is an optional executor surface

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:57.802Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:25:34.941Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Surface parity is proven by a trace key-set test, not by `inline-pipeline-parity-check`.** That check compares action and guard kinds only.
- **`agent.run` never launches fleet members.** It only dispatches to running members. Launch stays with the operator or fleet tooling (ADR-116).
- **Fallback happens only when declared (`executorFallback: traditional`).** Otherwise the action fails explicitly with `failed-agent`.
- **Estimate: 8h.**

### Design

**Approach.**
- A third branch in `AgentRunActionRunner` executor resolution (`agent-run.ts`), taken only when `context.vars.executor === 'fleet'`.
- It delegates to a new `packages/app/src/workflow/fleet-dispatch.ts`:
  - `dispatchToFleet({role, prompt, expectFile, timeoutMs, runId, state}, deps): Promise<FleetDispatchResult>`;
  - `deps = {fleet: FleetService, coordination: AgentCoordinationService, waitForFile, now}`.
- The `--agent fleet` flag maps to var `executor=fleet` wherever `/sp:dev-*` already threads `--agent` into workflow vars.
- The flag glossary entry lives in `plugins/sp/skills/spur-dev/references/flag-glossary.md`.

**Frozen names:**
- the var value `executor: fleet`;
- var `executorFallback: traditional`;
- result fields `surface`, `memberId`, `messageId`, `fallbackReason`;
- `dispatchToFleet`, `FleetDispatchResult`.

**Invariants:**
- ADR-057 durable artifacts and identity-pinned waits.
- ADR-121 fresh session for reviewer and verify.
- No silent downgrade: fallback happens only when declared.
- Default path untouched when not selected.

**Rejected alternatives:**
- Fleet-only workflow copies (ADR-076 "delete, don't layer").
- Fleet as default.
- A new `spur fleet` verb, which needs consent.

**Anti-patterns:**
- Polling a terminal.
- Reading member stdout.
- Spawning a member from the action. Members are launched by the operator or a fleet launcher, never by `agent.run`.

**Targets:**
- `fleet-dispatch.ts` covers every branch: resolved, no member, disabled, timeout, fallback, reused-session rejection.
- Existing `agent-run` tests green with no edits.

**Handoff:** 0943 may route high-risk lanes to a fleet reviewer role. That is optional and not required.

### Plan

1. `packages/app/src/workflow/fleet-dispatch.ts`, with `packages/app/tests/workflow/fleet-dispatch.test.ts`. Use a fake FleetService, a fake coordination service and a temp-dir `expectFile`, covering every branch listed in the Design targets.
2. The `agent-run.ts` fleet branch and result fields. Write the trace key-set parity test in `packages/app/tests/workflow/agent-run-fleet.test.ts`, and confirm the existing agent-run tests are unchanged.
3. `--agent fleet` → `executor=fleet` var plumbing in the dev-command var threading, with a flag-glossary entry. Keep `plugins/sp/tests/flag-contract-parity.test.ts` and `command-flag-parity.test.ts` green.
4. Add a docs note to `docs/design/fleet-config-declaration.md` (the surface section).
5. Run `bun run spur-check`, then `bun run plugin-smoke`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
