---
template: feature-impl
schema_version: 1
name: "Emit the routing decision on agent run events via the J5 envelope"
description: ""
status: done
type: task
profile: standard
feature_id: J6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0536"]
ac_numbering: task-local
created_at: "2026-08-14T00:19:14.945Z"
updated_at: "2026-08-14T22:42:39.091Z"
---

## 0545. Emit the routing decision on agent run events via the J5 envelope

### Background
Feature B2's standing telemetry gap: *"Nothing currently records which executor served which
intention. Without it, the operator cannot tell whether the routing is actually saving money — the
stated motivation for tiers."*

Batch 1 makes the routing decision explicit — a role selects a tier, a tier selects an executor, or a
pin overrides both. Nothing writes that decision down. So after batch 1 ships, the operator still
cannot answer "did my `scribe` work actually run on a cheap executor?" except by reading logs.

Feature J5 (verifying) builds the versioned payload envelope with producer attribution, redaction,
and recursive bounds. This task is a **consumer** of that envelope: routing metadata becomes
additional envelope content on events the ledger already writes, which is why no new table or column
is needed.

Scope here is the decision itself. Token consumption per role is task 0547, which joins this
attribution to the history plane over `run_id` — so the rows written here must carry that key. No
dollar figure is ever computed: per-model pricing is too volatile to hold correctly (operator ruling
2026-08-13, feature J6 § *Tokens, not prices*).
### Requirements
- [x] **R1.** Agent-run lifecycle events carry the routing decision in the J5 envelope: the role, the
      resolved tier, the resolved executor, and the **selection source** distinguishing a role
      resolution from an explicit pin from the `agent.default` role. The row must also carry
      `run_id` — already indexed as `idx_system_events_run_id` — so this attribution is joinable to
      the history plane by task 0547. Measurable: a run dispatched each of those three ways produces
      events whose payload names the correct source and whose row carries a non-null `run_id`.
- [x] **R2.** An escalation is recorded with the originating tier, the resulting tier, and the
      objective trigger that caused it (`gate-fail`, `timeout`, `insufficient-evidence`,
      `retry-exhausted`). A run that never escalated is distinguishable from one that escalated once.
      Measurable: an escalating run's events show both tiers and the trigger; a non-escalating run
      shows no escalation record rather than a null-valued one.
- [x] **R3.** No new table, no new column, no historical rewrite. Attribution is envelope metadata on
      rows the ledger already writes, and pre-existing rows project cleanly without one. Measurable:
      the migration set is unchanged and a query over rows written before this task returns them
      without error.
- [x] **R4.** Attribution carries identifiers, tiers, and counts only — no prompt text, no command
      line, no configured secret value — under J5's existing payload bounds and redaction rules.
      Measurable: a redaction test asserts a configured secret appearing in a run's context never
      reaches the persisted attribution payload.
- [x] **R5.** Every selection source has coverage, so an unrecorded path fails the suite rather than
      passing silently. The four are: role-resolved, pinned, defaulted, escalated. Measurable: four
      tests, one per source, each asserting the recorded value.
### Acceptance Criteria
Covers feature J6 scenarios:

- **R1 — An agent run records the routing decision it made**
- **R2 — An escalation is recorded with the trigger that caused it**
- **R3 — The record rides the existing envelope**
- **R5 — Every selection source is covered**
- **R6 — Attribution never carries secrets or prompt bodies**

```gherkin
Scenario: R1 — An agent run records the routing decision it made
  Given a run resolved through a declared role
  When its lifecycle events are read
  Then the payload carries the role, the resolved tier, and the resolved executor
  And it carries the selection source distinguishing a role resolution from a pin or a default

Scenario: R2 — An escalation is recorded with the trigger that caused it
  Given a run whose starting-tier executor failed on an objective signal
  When the run's events are read
  Then the escalation is visible with the originating tier, the resulting tier, and the trigger
  And a run that never escalated is distinguishable from one that escalated once

Scenario: R3 — The record rides the existing envelope
  Given the J5 payload envelope is the carrier
  When attribution is persisted
  Then no new table or column is introduced
  And rows written before this feature project cleanly without a rewrite

Scenario: R5 — Every selection source is covered
  Given the four selection sources role, pin, default, and escalated
  When the test suite runs
  Then each source has coverage asserting its recorded value
  And a source that records nothing fails the suite rather than passing silently

Scenario: R6 — Attribution never carries secrets or prompt bodies
  Given the payload bounds and redaction rules established by J5
  When attribution metadata is written
  Then it contains only identifiers, tiers, and counts
  And it carries no prompt text, command line, or configured secret value
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Where does attribution live physically?** `system_events.payload_json`, as envelope content. No
  new table, no new column — `run_id` is already a column and already indexed
  (`idx_system_events_run_id`).
- **Which call site emits?** `resolveExecutorSelector` (`agent-service.ts:1235`) — the only place that
  knows role, tier, executor, and source simultaneously.
- **What are the escalation triggers?** The existing objective vocabulary: `gate-fail`, `timeout`,
  `insufficient-evidence`, `retry-exhausted` (`stage-registry/schema.ts:375-379`). No new trigger is
  invented here.
- **Is a new event name needed?** Attribution rides existing agent-run lifecycle events; the escalation
  is its own record (R2). Any new name must be registered in the event catalog
  (`event-names.ts:30-36`), not emitted ad hoc.

**Deferred with owner.**

- **If J5's envelope cannot carry this metadata** — owner: feature J5. Route it back rather than
  adding a column; J5 is `verifying` and still open to a contract finding.
- **Dollar cost** — owner: nobody, permanently. Excluded 2026-08-13 (feature J6 § *Tokens, not prices*).
### Design
**Consume the envelope; do not extend the plane.** J5 owns the payload envelope shape, producer
attribution, redaction, and bounds. Routing metadata is envelope *content*. If J5's envelope turns
out not to admit this metadata, that is a finding to route back to J5 — not a reason to add a column
here (R3). Adding a column would also contradict J5's own recorded scope, which rules out new tables
and columns for this plane.

**Emit where the decision is made, not where it is used.** The resolution funnel
(`resolveExecutorSelector`, `packages/app/src/services/agent-service.ts:1235`) is the single place
that knows role, tier, executor, and source together. Emitting from anywhere downstream means
re-deriving what was already decided, which is how the two facts drift apart.

**Escalation is a second event, not a mutated first one** (R2). The starting decision and the
escalation are distinct facts with distinct timestamps; collapsing them loses the "how often does
routing start too cheap" signal, which is the most actionable thing this data can tell the operator.

**Absence must be distinguishable from null** (R2). "This run did not escalate" and "we did not
record whether it escalated" are different, and conflating them silently degrades the dataset the
moment a path is missed — which is precisely what R5's per-source coverage exists to prevent.

**Not in scope:** any change to selection or escalation behavior. This task observes; feature B2
decides, and task 0540 exercises. If writing the tests here reveals a behavioral defect, file it
against B2/I3 rather than fixing it in an observability task.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Ledger table (**no change**) | `system_events (id, event_name, occurred_at, actor, payload_json, run_id, entity_kind, entity_id, sequence)` | `packages/domain/src/migrations.ts:81-91` |
| Metadata carrier | `payload_json` — attribution rides here, **no new column** | same |
| Join key (already indexed) | `run_id` / `idx_system_events_run_id` | `migrations.ts:87`, `:95` |
| Envelope builder | `buildSystemEventEnvelope(...)` | `packages/app/src/services/system-event-tap.ts:83` |
| Envelope type | `SystemEventEnvelopeV2` | exported `packages/app/src/index.ts:275` |
| Version guard | `isSystemEventEnvelopeV2` | `packages/app/src/index.ts:74` |
| Legacy projection (unchanged) | `projectStoredSystemEventEnvelope` | `packages/app/src/index.ts:77` |
| Correlation type | `SystemEventCorrelation` | `system-event-tap.ts:174` |
| Catalog types | `SystemEventCatalogEntry` · `SystemEventMetadataField` | `packages/app/src/services/event-names.ts:30`, `:36` |
| Emission point | `resolveExecutorSelector` — knows role, tier, executor, source together | `packages/app/src/services/agent-service.ts:1235` |
| Selection-source union | `'phase' \| 'default' \| 'explicit'` + `'role'` (added by task 0536) | `agent-service.ts:1238` |
| Escalation source | `getNextFallback` · trigger vocabulary | `packages/domain/src/stage-registry/schema.ts:432-444`, `:375-379` |
| Trigger values | `gate-fail` · `timeout` · `insufficient-evidence` · `retry-exhausted` | `schema.ts:375-379` |

**No new table, column, transport, or CLI noun.** Attribution is envelope content inside `payload_json`.

#### Anti-patterns — what not to implement

- Do **not** add a column to `system_events`. J5's own scope rules out new tables/columns for this
  plane, and R3 requires pre-existing rows to project cleanly.
- Do **not** emit from a call site downstream of resolution. Only `resolveExecutorSelector` knows
  role, tier, executor, and source together; re-deriving downstream is how the two facts drift apart.
- Do **not** collapse the escalation into the initial decision event. They are distinct facts with
  distinct timestamps; merging them destroys the "routing started too cheap" signal.
- Do **not** represent "did not escalate" as a null-valued escalation record — absence and
  not-recorded must be distinguishable (R2).
- Do **not** write prompt text, command lines, or configured secrets into the payload (R4); J5's
  bounds and recursive redaction apply.

#### Cross-task contract

**Assumes from 0536 (batch 1):** `resolveExecutorSelector` resolves roles and its `source` union
carries `'role'`, so a role-resolved dispatch is distinguishable from a pin or a default. Without
that, three of the four selection sources in R5 cannot be recorded.

**Assumes from E6 task 0557:** `agent.invoke.*` events carry a non-null `run_id`. Measured
2026-08-13: 0 of 202 invoke rows have one — the minted runId (`agent-service.ts:959`) is never
threaded into the payload the tap reads (`system-event-tap.ts:200-201`). Task 0557 owns that fix.
If 0545 runs first, wire it here and note the overlap; do not add a second correlation channel.

**Assumes from J5 (verifying):** `buildSystemEventEnvelope` admits additional metadata under its
bounds and redaction rules. If it does not, that is a finding to route back to J5 — **not** a licence
to add a column here.

**Leaves for dependents:**

- Task **0546** aggregates these rows and needs `run_id` present on every attribution row plus a
  stable selection-source value.
- Task **0547** joins on `run_id` to the history plane; this task is why that join has a role to group by.
### Plan
- [x] Emit role, resolved tier, resolved executor, and selection source from the resolution funnel (R1)
- [x] Carry them as J5 envelope metadata on agent-run lifecycle events (R1, R3)
- [x] Emit escalation as its own record with originating tier, resulting tier, and trigger (R2)
- [x] Make "did not escalate" distinguishable from "not recorded" (R2)
- [x] Confirm no migration change and that pre-existing rows project cleanly (R3)
- [x] Add a redaction test asserting no secret or prompt body reaches the attribution payload (R4)
- [x] Add one coverage test per selection source: role, pin, default, escalated (R5)
- [x] Update `docs/04_DESIGN.md §7.9` and `docs/design/actionable-observability-context.md` (T3), then run `bun run autofix && bun run spur-check`
### Solution
Emitted the routing decision on agent-run lifecycle events as J5 envelope metadata, plus a
dedicated escalation record. No migration change — `system_events` is untouched (R3).

Change map:

- **`packages/app/src/observability/agent-execution.ts:30`** — new `AgentRoutingAttribution` type
  (`role?`, `tier`, `executor`, `source`); `AgentExecutionStartedEvent` (:49) and `LifecycleStart`
  (:120) gain optional `routing` so the lifecycle `started` event (observer / `workflow.agent`
  path) carries the decision (R1).
- **`packages/app/src/services/event-bridge.ts:38`** — new `withInvokeRouting(bridge,
  readRouting)` wrapper: merges the run's routing context into `agent.invoke.*` payloads at emit
  time; non-invoke events and absent-context payloads pass through untouched. `readRouting` is
  re-read per emit so escalation hops re-stamp the next dispatch's payload.
- **`packages/app/src/services/agent-service.ts`** —
  - :674 — per-run `AiRunner` forwards invoke events through `withInvokeRouting(invokeBridge,
    () => routing)`; the `routing` holder is stamped from the funnel result at :689 and
    re-stamped per escalation hop at :1025, so the `agent.invoke.start|exit` rows the ledger
    persists carry role/tier/executor/source (R1).
  - :901 — `lifecycle.start` attaches the initial `routing` to the started event.
  - :1002 — escalation branch emits `agent.invoke.escalated` with `runId`, `executionId`,
    `actionId?`, `fromExecutor`, `fromTier`, `toExecutor`, `toTier`, `trigger`, severity
    `warning`: the escalation is its own record; non-escalating runs emit none (R2 absence ≠
    null).
  - :1520 — `resolveExecutorSelector` executor-hit branch now carries
    `tier: getExecutorTier(executor)` so explicit/default selections record the resolved tier.
  - :1466 + :1588 — `resolveExecutorSelector` role branch and `resolveRole` (new `source`
    param): an `agent.default`-routed role stamps `source: 'default'` (not `'role'`) so the four
    selection sources stay distinguishable (R1/R5).
  - :2091 — new `buildRoutingAttribution(result)` helper: projects `AgentResolveResult` →
    attribution; resolutions without a tier/executor (legacy priority, bare-binary pins) carry
    none.
- **`packages/app/src/services/event-names.ts`** — agent source profile metadataFields gain the
  `routing.*` paths (:178-181) and the escalation paths (`fromTier`, `toTier`, `trigger`,
  `fromExecutor`, `toExecutor`); new default-tier catalog entry `agent.invoke.escalated` (:342),
  producer-attributed `spur` / `agent-runner` via the `event()` helper's optional producer
  override (:272) — the event is emitted by the Spur bridge, not ts-ai-runner.
- **`packages/app/src/index.ts:23`** — export `AgentExecutionStartedEvent` /
  `AgentRoutingAttribution`.
- **Unmodified:** `packages/app/src/services/system-event-tap.ts` and
  `packages/domain/src/stage-registry/schema.ts` — the tap already derives subscriptions from the
  catalog and the envelope builder lives in `system-event-envelope.ts` (the task's frozen
  builder anchor shifted from the tap module); the trigger vocabulary is consumed read-only.

Tests (beside the changed sources):

- `packages/app/tests/services/agent-service.test.ts` — `AgentService routing decision
  attribution (0545)`: R5 coverage per selection source — role-resolved (`{role:'scribe',
  tier:'cheap', executor:'cheap-exec', source:'role'}`), pinned (`{tier:'capable-1',
  executor:'capable-exec', source:'explicit'}`), defaulted (`{role:'scribe',…,source:'default'}`),
  escalated (own record with `fromTier:'standard'`, `toTier:'capable-1'`,
  `trigger:'resource-exhaustion'`, non-null `runId`); plus R2 absence (non-escalating run emits
  zero escalation records). Mutation checks: removing the routing attach or the escalation emit
  fails the suite.
- `packages/app/tests/services/event-bridge.test.ts` — `withInvokeRouting` unit tests
  (start/exit enrichment, emit-time re-read for escalation re-stamp, non-invoke passthrough,
  absent-context passthrough, on/off forwarding).
- `packages/app/tests/services/event-names.test.ts` — catalog registration of
  `agent.invoke.escalated` (default tier, spur producer), routing metadata-field admission on
  `agent.invoke.*`, routing + escalation projection tests, R4 redaction (configured secret in
  routing fields never reaches the persisted projection) and R4 shape (no prompt/command/
  invocation keys).
- `packages/app/tests/services/system-event-tap.test.ts` — R1: `agent.invoke.start` with routing
  persists the routing block in the envelope with non-null `run_id`; R2: `agent.invoke.escalated`
  persists tiers/trigger/run_id.
- `packages/app/tests/services/system-event-envelope.test.ts` — R3: rows written before
  attribution project cleanly (legacy raw and canonical v2, no routing fabricated).
### Testing
Independent re-audit 2026-08-14 (`/sp:dev-verify 0545 --auto --next --force --focus all --fix all`). `--fix all` flipped 5 leftover `[ ]` Requirement boxes. Verdict AC ids remapped to feature J6 scenario titles. Artifacts: `.spur/run/0545-verdict.json`, `.spur/run/0545-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/event-bridge.ts:38-57` (`withInvokeRouting` merges routing onto `agent.invoke.start\|exit`); stamp `packages/app/src/services/agent-service.ts:689` + lifecycle start `:901`; persist + `run_id` this run: `packages/app/tests/services/system-event-tap.test.ts:198-222` |
| R2 | MET | Own record `packages/app/src/services/agent-service.ts:996-1012`; catalog `packages/app/src/services/event-names.ts:342-345`. This run: escalated test `packages/app/tests/services/agent-service.test.ts:3108`; absence ≠ null `:3090-3105`; persist `packages/app/tests/services/system-event-tap.test.ts:227-246` |
| R3 | MET | Attribution is `payload_json` content (`buildRoutingAttribution` `packages/app/src/services/agent-service.ts:2091-2101`). This run: `packages/app/tests/services/system-event-envelope.test.ts:150-170` projects pre-0545 rows without fabricating `routing` |
| R4 | MET | This run: `packages/app/tests/services/event-names.test.ts:467-481` secret never persists; `:484-500` prompt/command/invocation dropped, identifiers-only routing survives |
| R5 | MET | This run: role `:3065`, pin `:3078`, default `:3090`, escalated `:3108` in `packages/app/tests/services/agent-service.test.ts`; re-stamp mutation `:3151` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — An agent run records the routing decision it made | MET | test | `packages/app/tests/services/system-event-tap.test.ts:198-222` + `packages/app/tests/services/agent-service.test.ts:3065-3075` this run |
| Scenario: R2 — An escalation is recorded with the trigger that caused it | MET | test | `packages/app/tests/services/agent-service.test.ts:3108` + `:3090-3105` (zero escalation rows when none) this run |
| Scenario: R3 — The record rides the existing envelope | MET | test | `packages/app/tests/services/system-event-envelope.test.ts:150-170` this run |
| Scenario: R5 — Every selection source is covered | MET | test | `packages/app/tests/services/agent-service.test.ts:3065-3108` (role / pin / default / escalated) this run |
| Scenario: R6 — Attribution never carries secrets or prompt bodies | MET | test | `packages/app/tests/services/event-names.test.ts:467-500` this run |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P2 findings; implement-time P3 (escalation re-stamp coverage) already fixed at `packages/app/src/services/agent-service.ts:1023-1025` |

This run: targeted 0545 slice across 5 files → 20 pass / 0 fail. Isolated-suite coverage exit 1 is not a product failure.
### Review
**Verdict: approve** — one P3 coverage note; no functional defects found.

**Functional traceability**
- **R1** — role/tier/executor/source ride `agent.invoke.start|exit` (merged at the per-run invoke bridge, `agent-service.ts:676-679` via `withInvokeRouting`, `event-bridge.ts:27-62`) and the lifecycle started event (`agent-service.ts:898-901`, `agent-execution.ts:180-183`). `run_id` threads through `correlation: lifecycle.identity` → `extractSystemEventCorrelation` (verified end-to-end in the tap test: non-null `run_id` + persisted routing block).
- **R2** — `agent.invoke.escalated` is its own catalog-registered record (`event-names.ts:342`, producer-attributed `spur`/`agent-runner` via the `event()` producer override) carrying `fromTier`, `toTier`, `fromExecutor`, `toExecutor`, `trigger`, `runId`; emitted at `agent-service.ts:1002-1017`. Non-escalating runs emit zero escalation records (`escalations` length 0 asserted in the defaulted test) — absence ≠ null. Trigger vocabulary consumed read-only from the stage registry; no new trigger invented.
- **R3** — `migrations.ts`, `stage-registry/schema.ts`, and `system-event-tap.ts` are unmodified (`git diff` empty). Envelope test projects both legacy raw and canonical v2 rows without fabricating a routing block.
- **R4** — redaction test (`event-names.test.ts`) asserts a configured secret in routing fields never reaches the projection; shape test asserts prompt/command/invocation keys are dropped by the metadata allow-list. Production wiring verified: both tap registrations pass `configuredSecretValues(env)` (`serve.ts:384`, `system-event-ledger.ts:67`), and every string in the routing block goes through `redactAndBound` in `projectSystemEventData`.
- **R5** — four tests, one per source (`agent-service.test.ts:3062-3148`): role-resolved (`{role:'scribe', tier:'cheap', executor:'cheap-exec', source:'role'}`), pinned (`source:'explicit'`), defaulted (`source:'default'` — the `resolveRole` source param correctly distinguishes a default-routed role from a declared/inherited one, both of which stay `'role'`), escalated (own record with both tiers, trigger, non-empty runId). Each asserts the recorded value; an unrecorded path fails the suite.
- **Cross-task contract** — no second correlation channel (run_id rides the existing invoke correlation); no new table/column; escalation reuses the objective failure vocabulary; docs (`04_DESIGN.md §7.9-adjacent`, `actionable-observability-context.md`) match the implementation.

**SECUA**
- **Security** — identifiers/tiers/counts only; recursive redaction applies to every routing string before persistence; escalation payload carries no prompt/command material. No findings.
- **Efficiency** — one object spread per invoke emit; per-run closure; no allocation on non-invoke events. No findings.
- **Correctness** — emitting from the funnel result's consumer (`executeRun`) rather than inside `resolveExecutorSelector` is the correct seam: the attribution is projected from the decision (`buildRoutingAttribution`, `:2091-2112`), never re-derived, and `runId` only exists once the lifecycle is constructed after resolution. The per-run `routing` holder is local to `executeRun` — no cross-run contamination. No findings.
- **Usability** — new event is default-tier, so it persists/streams without the diagnostic toggle; all escalation/routing fields registered in the agent source profile for board rendering. No findings.
- **Architecture** — escalation-as-own-record, absence-vs-null, and catalog registration (incl. producer override) all hold as designed. Consumers of `agent.invoke.*` (`occupant-wait.ts`, `retro-correlation.ts`, CLI followers) match exact `start`/`exit` names and are unaffected by the additive `escalated` event.

**Findings**
- **P3 — Cover the escalation re-stamp (`agent-service.ts:1025`); removing it currently passes the suite.** The re-stamp line is load-bearing: without it, the escalation hop's `agent.invoke.start|exit` rows persist the *starting* executor's attribution (stale `std-exec`/`standard` instead of the actual `capable-exec`/`capable-1` that ran) — exactly the decision/persistence drift the design forbids. No test covers it: the R5 escalated test (`agent-service.test.ts:3107-3148`) injects `deps.runner`, so invoke events never traverse `withInvokeRouting` and the harness listens only for `agent.execution` / `agent.invoke.escalated`; the event-bridge re-read unit test (`event-bridge.test.ts:115-127`) drives the closure by hand and would still pass. Fix: in the escalated test, inject a runner whose `runPromptCommand` emits `agent.invoke.start` on the bus and assert the second dispatch's payload carries `{tier:'capable-1', executor:'capable-exec'}` (resolved `source`), then delete the re-stamp to confirm the test fails.
**P3 follow-up resolution (same run, post-review):** P3 fixed and mutation-verified.

- P3 (escalation re-stamp uncovered) — **fixed** in `agent-service.test.ts`: new test `R1: the escalation hop re-stamps routing on the next dispatch invoke payload (0545 review P3)` drops `deps.runner` so the service constructs the real AiRunner (whose events bus is wrapped by `withInvokeRouting`), stubs `RolePropagatingProcessExecutor.prototype.run` to return a rate-limit failure then success, and asserts the second `agent.invoke.start` payload carries `{ tier: 'capable-1', executor: 'capable-exec', source: 'stage' }` — not the stale starting `standard/std-exec/explicit`. Mutation check confirmed: deleting the re-stamp (`agent-service.ts:1025`) fails this test. 5/5 0545 tests pass.
**P1–P4 priority findings**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P3 | Correctness (coverage) | `agent-service.ts:1025` | Escalation re-stamp was mutation-uncovered — deleting it left the escalated dispatch persisting the starting executor's attribution. **Fixed in-run**: new test drives the service-built AiRunner (real `withInvokeRouting` seam) with a stubbed process executor and asserts the second `agent.invoke.start` payload carries `{tier:'capable-1', executor:'capable-exec', source:'stage'}`; mutation check confirmed deletion now fails the suite. |
| P4 | — | — | No P1–P2 findings; verify verdict PASS after re-gate. |
### References
- **Emission point (R1):** `packages/app/src/services/agent-service.ts:1235`
  (`resolveExecutorSelector` — knows role, tier, executor, and source together), `:990` (explicit
  source), `:1051-1052` (default source), `:996` + `:1142` (starting tier)
- **Escalation source (R2):** `packages/domain/src/stage-registry/schema.ts:432-444`
  (`getNextFallback`), `:375-379` (objective trigger vocabulary)
- **Envelope to consume (R3/R4):** feature J5 payload envelope built in `packages/app`;
  `docs/design/actionable-observability-context.md`, `docs/04_DESIGN.md §7.9`
- **Ledger:** `system_events` (no schema change); `attachSystemEventLedger`
  (`apps/cli/src/system-event-ledger.ts`), `followSystemEventsAfter`
- **Upstream dependency:** feature B2 task 0536 (makes the routing decision explicit)
- **Adjacent, do not duplicate:** feature J3 (ingestion/retention/correlation, verifying), J5
  (envelope, verifying), J4 (Board surfaces, done)
- **Redaction contract:** observability persistence receives configured secrets at composition roots
  and redacts recursively before payload bounds (AGENTS.md § Conventions)
### History
- 2026-08-14T22:14:28.628Z todo → wip (system)
- 2026-08-14T22:31:22.157Z wip → testing (system)
- 2026-08-14T22:31:36.846Z testing → done (system)
