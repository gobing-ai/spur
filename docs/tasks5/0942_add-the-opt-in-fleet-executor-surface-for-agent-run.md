---
schema_version: 1
name: Add the opt-in fleet executor surface for agent.run
status: done
template: feature-impl
created_at: 2026-09-24T00:13:17.005Z
updated_at: "2026-09-26T02:41:51.234Z"
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

- [x] R1. The surface is selected by `--agent fleet` on model-bearing `/sp:dev-*` commands or by workflow var `executor: fleet`. The selection is valid only when `agent.fleet.enabled` is true and `FleetService.resolve` yields an enabled member whose `role` matches the action's `role`. Tie-breaking uses the configured `strategy` (rest|gtd).
- [x] R2. Dispatch runs through `AgentCoordinationService.sendMessage` to the resolved member, with a body naming run id, state, prompt artifact path and `expectFile`. It then waits identity-pinned (member id plus message id) until `expectFile` exists or the action timeout elapses. There is no terminal scraping and no keystrokes.
- [x] R3. When the fleet is unavailable (disabled, no member for the role, or member unreachable), the action fails with an explicit message and 0937 reason `failed-agent`. When `executorFallback: traditional` is set, it instead records `fallbackReason` in the action result and runs the existing subprocess path.
- [x] R4. The fleet action row records `surface: 'fleet'`, `memberId`, `messageId`, `expectFile`, `durationMs` and the terminal reason. A test asserts the same key set as on the subprocess surface, plus the fleet-only ids.
- [x] R5. Reviewer and verify roles require a fresh member session per dispatch (ADR-121). A reused session is rejected before send. With the fleet not selected, `agent.run` behavior and tests are byte-for-byte unchanged.

### Acceptance Criteria

- [x] AC1 — The agent fleet is an optional executor surface

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `packages/app/src/index.ts:317` |
| `packages/app/src/index.ts:321` |
| `packages/app/src/index.ts:733` |
| `packages/app/src/index.ts:764` |
| `packages/app/src/index.ts:918` |
| `packages/app/src/services/inline-run-setup.ts:311` |
| `packages/app/src/services/inline-run-setup.ts:33` |
| `packages/app/src/services/inline-run-setup.ts:43` |
| `packages/app/src/services/workflow-service.ts:1913` |
| `packages/app/src/services/workflow-service.ts:1949` |
| `packages/app/src/services/workflow-service.ts:2201` |
| `packages/app/src/services/workflow-service.ts:2746` |
| `packages/app/src/services/workflow-service.ts:3` |
| `packages/app/src/services/workflow-service.ts:51` |
| `packages/app/src/services/workflow-service.ts:65` |
| `packages/app/src/services/workflow-service.ts:69` |
| `packages/app/src/services/workflow-service.ts:699` |
| `packages/app/src/services/workflow-service.ts:78` |
| `packages/app/src/services/workflow-service.ts:802` |
| `packages/app/src/services/workflow-service.ts:81` |
| `packages/app/src/services/workflow-service.ts:963` |
| `packages/app/src/services/workflow-service.ts:971` |
| `packages/app/src/workflow/action-trace.ts:178` |
| `packages/app/src/workflow/action-trace.ts:188` |
| `packages/app/src/workflow/action-trace.ts:284` |
| `packages/app/src/workflow/action-trace.ts:294` |
| `packages/app/src/workflow/action-trace.ts:41` |
| `packages/app/src/workflow/actions/agent-run.ts:1292` |
| `packages/app/src/workflow/actions/agent-run.ts:195` |
| `packages/app/src/workflow/actions/agent-run.ts:206` |
| `packages/app/src/workflow/actions/agent-run.ts:241` |
| `packages/app/src/workflow/actions/agent-run.ts:246` |
| `packages/app/src/workflow/actions/agent-run.ts:257` |
| `packages/app/src/workflow/actions/agent-run.ts:30` |
| `packages/app/src/workflow/actions/agent-run.ts:407` |
| `packages/app/src/workflow/actions/agent-run.ts:645` |
| `packages/app/src/workflow/builtins.ts:104` |
| `packages/app/src/workflow/builtins.ts:14` |
| `packages/app/src/workflow/builtins.ts:2` |
| `packages/app/src/workflow/builtins.ts:29` |
| `packages/app/src/workflow/builtins.ts:57` |
| `packages/app/src/workflow/builtins.ts:74` |
| `packages/app/src/workflow/decision-hitl-responder.ts:228` |
| `packages/app/src/workflow/lifecycle-adapter.ts:243` |
| `packages/app/src/workflow/observability.ts:26` |
| `packages/app/src/workflow/observability.ts:472` |
| `packages/app/tests/services/inline-run-setup.test.ts:15` |
| `packages/app/tests/services/inline-run-setup.test.ts:3` |
| `packages/app/tests/services/inline-run-setup.test.ts:649` |
| `packages/app/tests/workflow/builtins.test.ts:34` |
| `packages/config/src/index.ts:771` |
| `packages/config/src/loader.ts:299` |
| `packages/config/tests/loader.test.ts:1112` |
| `packages/config/tests/loader.test.ts:30` |
| `packages/domain/src/dao/run-dao.ts:121` |
| `packages/domain/src/dao/run-dao.ts:127` |
| `packages/domain/src/migrations.ts:1540` |
| `packages/domain/src/migrations.ts:1778` |
| `packages/domain/src/migrations.ts:1844` |
| `packages/domain/src/migrations.ts:310` |
| `packages/domain/tests/dao/migrations.test.ts:12` |
| `packages/domain/tests/dao/migrations.test.ts:129` |
| `packages/domain/tests/dao/migrations.test.ts:225` |
| `packages/domain/tests/dao/migrations.test.ts:331` |
| `packages/domain/tests/dao/migrations.test.ts:385` |
| `packages/domain/tests/dao/migrations.test.ts:598` |
| `packages/domain/tests/dao/migrations.test.ts:657` |
| `packages/domain/tests/dao/migrations.test.ts:660` |
| `plugins/sp/scripts/inline-pipeline-parity-check.ts:53` |
| `plugins/sp/scripts/inline-run-setup.ts:103` |
| `plugins/sp/scripts/inline-run-setup.ts:318` |
| `plugins/sp/scripts/inline-run-setup.ts:34` |
| `plugins/sp/scripts/inline-run-setup.ts:347` |
| `plugins/sp/scripts/inline-run-setup.ts:36` |
| `plugins/sp/scripts/inline-run-setup.ts:430` |
| `plugins/sp/scripts/inline-run-setup.ts:465` |
| `plugins/sp/scripts/inline-run-setup.ts:48` |
| `plugins/sp/scripts/inline-run-setup.ts:557` |
| `plugins/sp/scripts/inline-run-setup.ts:562` |
| `plugins/sp/scripts/inline-run-setup.ts:575` |
| `plugins/sp/scripts/inline-run-setup.ts:580` |
| `plugins/sp/scripts/inline-run-setup.ts:596` |
| `plugins/sp/scripts/inline-run-setup.ts:612` |
| `plugins/sp/scripts/inline-run-setup.ts:629` |
| `plugins/sp/scripts/quality-gate.ts:102` |
| `plugins/sp/scripts/quality-gate.ts:18` |
| `plugins/sp/scripts/quality-gate.ts:180` |
| `plugins/sp/scripts/quality-gate.ts:27` |
| `plugins/sp/scripts/quality-gate.ts:515` |
| `plugins/sp/scripts/quality-gate.ts:578` |
| `plugins/sp/scripts/quality-gate.ts:609` |
| `plugins/sp/scripts/quality-gate.ts:613` |
| `plugins/sp/scripts/quality-gate.ts:621` |
| `plugins/sp/scripts/quality-gate.ts:85` |
| `plugins/sp/tests/inline-run-setup.test.ts:399` |
| `plugins/sp/tests/quality-gate.test.ts:324` |
| `scripts/commands/bundle-plugin-lib.ts:129` |
| `scripts/commands/bundle-plugin-lib.ts:176` |
| `scripts/commands/real-run-cost.test.ts:104` |
| `scripts/commands/real-run-cost.test.ts:19` |
| `scripts/commands/real-run-cost.test.ts:22` |
| `scripts/commands/real-run-cost.test.ts:236` |
| `scripts/commands/real-run-cost.test.ts:25` |
| `scripts/commands/real-run-cost.test.ts:32` |
| `scripts/commands/real-run-cost.test.ts:41` |
| `scripts/commands/real-run-cost.test.ts:44` |
| `scripts/commands/real-run-cost.test.ts:54` |
| `scripts/commands/real-run-cost.test.ts:57` |
| `scripts/commands/real-run-cost.test.ts:6` |
| `scripts/commands/real-run-cost.test.ts:83` |
| `scripts/commands/real-run-cost.ts:118` |
| `scripts/commands/real-run-cost.ts:128` |
| `scripts/commands/real-run-cost.ts:172` |
| `scripts/commands/real-run-cost.ts:178` |
| `scripts/commands/real-run-cost.ts:182` |
| `scripts/commands/real-run-cost.ts:195` |
| `scripts/commands/real-run-cost.ts:213` |
| `scripts/commands/real-run-cost.ts:244` |
| `scripts/commands/real-run-cost.ts:255` |
| `scripts/commands/real-run-cost.ts:273` |
| `scripts/commands/real-run-cost.ts:292` |
| `scripts/commands/real-run-cost.ts:318` |
| `scripts/commands/real-run-cost.ts:329` |
| `scripts/commands/real-run-cost.ts:34` |
| `scripts/commands/real-run-cost.ts:41` |
| `scripts/commands/real-run-cost.ts:5` |
| `scripts/commands/real-run-cost.ts:500` |
| `scripts/commands/real-run-cost.ts:505` |
| `scripts/commands/real-run-cost.ts:515` |
| `scripts/commands/real-run-cost.ts:531` |
| `scripts/commands/real-run-cost.ts:533` |
| `scripts/commands/real-run-cost.ts:56` |
| `scripts/commands/real-run-cost.ts:89` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | agent-run.ts:651 branch on vars.executor==='fleet'; workflow-service.ts:2754-2757 mapFleetExecutorVar applied :802/:805; fleet-dispatch.ts:104-118 enabled gate + role-matched enabled members, :133-139 rest/gtd stable tie-break; tests fleet-dispatch.test.ts:100,145,155,165,239 + agent-run-fleet.test.ts:326; docs flag-glossary.md:73-78, dev-run.md:18,43, dev-runall.md:21,52, execution-batch.md:273 |
| R2 | MET | fleet-dispatch.ts:168-183 body names run id/state/role/prompt artifact/expectFile; :181-187 keyed send requestKey=<runId>/<state>; :200-210 identity-pinned expectFile wait, memberId+messageId recorded; no spawn/terminal/keystroke code (rg clean, subprocess spy agent-run-fleet.test.ts:162); F2 accepted artifact-pinning trust model documented docs/design/fleet-config-declaration.md:87-98 |
| R3 | MET | fleet-dispatch.ts:73-81 fallback only when executorFallback:'traditional' declared, else explicit fail failed-agent; agent-run.ts:390-405 fallbackReason vs explicit failed-agent row; :651-655 capture + :1292-1293 stamp + :242-252 contractViolation spread across all 7 sites (F1 remediation); tests agent-run-fleet.test.ts:177,197,215 + fleet-dispatch.test.ts:297,304 |
| R4 | MET | agent-run.ts:361-366 success row surface:'fleet'/memberId/messageId/expectFile/durationMs/reason done; :376-388 timeout failed-timeout + identity ids; :395-402 unavailable failed-agent; key-set parity test agent-run-fleet.test.ts:108 vs baseline subprocess row :116-131 |
| R5 | MET | fleet-dispatch.ts:46-49 FRESH_SESSION_ROLES=['reviewer'] (verify stages declare role reviewer); :122-131 rejection before send :181; tests fleet-dispatch.test.ts:213 reused-session rejected, :229 one-shot fresh, agent-run-fleet.test.ts:239 default path never consults fleet deps; git diff 34d3dd0de empty on tests/workflow/actions/agent-run.test.ts (161 pre-existing unedited) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — The agent fleet is an optional executor surface | MET | test | Synthesis of R1-R5 all MET (fleet-dispatch.ts new 217 ln; agent-run.ts:258-405,645-655,1292-1293; builtins.ts:57,71-77; workflow-service.ts:1913-1954,:2754-2757); gate PASS attempt-4 9118 pass/0 fail across 522 files (.spur/run/0942-test-gate.status); review PASS full 482b9d9d + delta adc7d39f (.spur/run/0942-review-section.md); verify PASS daff7c38; fingerprint sha256:f1ecc630feed0b7a06f6d9a1157116b885d3abe630b08745015eb5dc139480c8 reproduced |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Verdict: PASS (full review run 482b9d9d, delta re-review run adc7d39f after P3#1 remediation).

Reviewer scope: fleet-dispatch.ts (new), agent-run.ts / builtins.ts / workflow-service.ts (edited), 2 new test files (24+1 tests), 6 doc files. Fresh runs: 185 app tests pass, 123 parity tests pass, default path verified byte-identical (git diff empty on tests/workflow/actions/agent-run.test.ts, 161 pre-existing tests unedited). Gate: PASS attempt-4 (.spur/run/0942-test-gate.status); D2 fingerprint reproduced.

Requirements: R1–R5 MET, AC1 MET (per-requirement evidence in reviewer report; frozen names executor:'fleet', executorFallback:'traditional', surface/memberId/messageId/fallbackReason, dispatchToFleet, FleetDispatchResult all verbatim; ADR-057 durable prompt artifact asserted byte-equal; ADR-121 fresh-session rejection pre-send; no terminal scraping/keystrokes/spawn — asserted by subprocess spy).

Findings:

| ID | Priority | Finding | Disposition |
| --- | --- | --- | --- |
| F1 | P3 | fleet-fallback + contract-violation early returns bypassed the fallbackReason stamp (trace row lost why traditional ran) | FIXED: runner-local fleetFallbackReason (reset at execute() entry, written in fleet block, conditionally spread by contractViolation across all 7 sites); new test asserts all four fields; delta re-review PASS (adc7d39f) |
| F2 | P4 | Identity-pinned wait realized as artifact-pinning (keyed send + delete-before-invoke + recorded ids); file wait cannot cryptographically bind artifact to member — identical trust model to subprocess surface | ACCEPTED (no terminal scraping/spawn anywhere, asserted by test); document in fleet-config-declaration.md §4 if revisited |
| F3 | P4 | mapFleetExecutorVar has no direct unit test (covered indirectly by action-level frozen-name guard + 123 parity tests) | DEFERRED: optional 5-line table test; not blocking |
| F4 | P4 | Post-fleet plain-error returns (timeoutMs gate, requiresCapabilities parse, distinct-executor gate) carry no fallbackReason in error output (pre-existing shape, byte-identical to non-fleet runs) | DEFERRED: only if traceability ever demands it |
| F5 | P4 | Worker deviations adjudicated ACCEPTED: projectPath in FleetDispatchInput (required by FleetService.resolve + artifact paths); fail-loud option list 10>3 (each a subprocess-only guarantee, unset-safe); mapFleetExecutorVar single-point mapping at :802/:805 | ACCEPTED by reviewer with upstream evidence |

Note (delta reviewer): runner suite path is tests/workflow/actions/agent-run.test.ts (brief said tests/workflow/); 172 pass / 0 fail on fleet + runner suites.

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History

- 2026-09-25T15:04:44.519Z todo → wip (system)
- 2026-09-25T16:42:50.966Z wip → testing (system)
- 2026-09-25T17:04:32.660Z testing → done (system)

