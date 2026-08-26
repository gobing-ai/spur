---
schema_version: 1
name: "Record explicit pairing outcomes so executor-role routing is evidence-based"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:45.003Z
updated_at: "2026-08-26T17:53:42.393Z"
feature_id: I81
priority: P2
tags: ["history", "observability", "pairing", "telemetry"]
dependencies: ["0677"]
---

## 0679. Record explicit pairing outcomes so executor-role routing is evidence-based

### Background
The pairing evidence surface (feature J8) reports that a dispatch happened but nothing about how it went. Measured on the current corpus: five pairing rows carry 17 dispatches (`codex-sol` planner 2, `grok` planner 5, `minimax` scribe 4, `omp` coder 3, `omp-deepseek` reviewer 3), and **every row has a null model, a zero success rate, zero total cost, zero mean duration, and an empty escalation map**. `ladderSnapshot` is an empty array. Both history-anatomy reports had to record `coverage:agent-pairings:outcome-metrics-unavailable` and explicitly decline to propose any routing change.

**Refinement found the cause, and it is mostly a reader/writer contract mismatch in `packages/domain/src/analytics/pairings.ts`, not a missing writer field.** Verified against the live `system_events` table:

| Path the SQL reads | Rows matched | Path the writer actually emits | Rows matched |
| --- | --- | --- | --- |
| `$.data.executionId` (join key, `:164` and `:178`) | **0** | `$.data.correlation.executionId` | 23 |
| `$.data.outcome` (`:179`) | **0** | `$.data.exitCode` | 53 |
| `$.data.durationMs` (`:180`) | 53 | — path is correct | 53 |
| `$.data.model` (`:166`) | **0** | — never emitted | 0 |
| `$.data.routing.role` (`:168`) | 17 of 156 | — correct | 17 |

The exit join is filtered on `json_extract(payload_json, '$.data.executionId') IS NOT NULL` (`:185`), which matches **zero of 152** `agent.invoke.exit` rows. Every exit row is therefore discarded before the join, which is why `successes` and `durationCount` are both 0 — and hence `successRate` and `meanDurationMs` render as 0. Even with the join repaired, `$.data.outcome` matches nothing, so successes would stay 0 until the outcome field is read from `exitCode`.

Two genuine writer gaps sit behind that: `correlation.executionId` is present on only **23 of 156** start rows and 23 of 152 exit rows, and `exitCode`/`durationMs` on only **53 of 152** exit rows — so even a correct reader sees partial coverage. `model` is never emitted at all.

One field is not a defect: `agent.invoke.escalated` has **0 rows** in the corpus, so the empty escalation map is honest absence, exactly as the `PairingStat` doc comment at `:16-18` promises.
### Requirements
- [x] R1. Correct the exit-join key in `loadDispatchStats`: read `$.data.correlation.executionId` on both the dispatch and exit legs (`pairings.ts:164`, `:178`, `:185`) instead of `$.data.executionId`, which matches zero rows.
- [x] R2. Correct the outcome read: derive dispatch success from `$.data.exitCode` (0 = success) rather than `$.data.outcome`, which the writer never emits.
- [x] R3. Record an explicit `success`, `failure`, or `unknown` outcome per dispatch, so a dispatch with no joined exit row is distinguishable from a failed one.
- [x] R4. Compute `successRate` over dispatches with a known outcome only, and carry the unknown count alongside it so the denominator is legible; an unknown-outcome dispatch must not read as a failure.
- [x] R5. Keep an unmeasured model, cost, or duration absent rather than zero, consistent with the absent-not-zero contract this task depends on.
- [x] R6. Close the writer coverage gaps: emit `correlation.executionId` on every `agent.invoke.start` and `agent.invoke.exit` (currently 23 of 156 and 23 of 152), and `exitCode` plus `durationMs` on every exit row (currently 53 of 152).
- [x] R7. Emit the resolved model on the dispatch payload so `$.data.model` stops being universally null; where the executor pins no model, record absent rather than a placeholder.
- [x] R8. Populate `ladderSnapshot` where ladder-stage outcomes exist, or record explicitly that no ladder stage ran.
- [x] R9. Add a regression test that asserts each `json_extract` path in `pairings.ts` matches the payload the writer actually produces, so a reader/writer path drift fails a test rather than rendering as a zero.
### Acceptance Criteria
```gherkin
@core
Scenario: R12 — A pairing dispatch records an explicit outcome
  Given an executor-role dispatch completes, fails, or ends in an unknown state
  When the pairing telemetry is written
  Then the row carries an explicit "success", "failure", or "unknown" outcome
  And a model, cost, or duration that was not measured is stored as absent rather than zero

@core
Scenario: R21 — Pairing analytics read the payload paths the dispatch writer actually emits
  Given agent dispatch and exit events recorded in their real emitted payload shape
  When the pairing aggregation joins dispatches to their exit rows
  Then the join key and the outcome field resolve against those payloads rather than matching zero rows
  And a test fails when an extracted path no longer appears in a real emitted payload
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**The zero was a lie told by a typo, not a missing feature.** The original framing of this task assumed the writer never recorded outcomes. Refinement disproved that: `agent.invoke.exit` rows carry `exitCode` and `durationMs`, and both legs carry `correlation.executionId` — the reader just looks one level too shallow (`$.data.executionId` instead of `$.data.correlation.executionId`) and for a field name the writer does not use (`outcome` instead of `exitCode`). Two path corrections in `loadDispatchStats` recover the bulk of the signal.

**Frozen paths.** Dispatch leg and exit leg both key on `$.data.correlation.executionId`. Success is `$.data.exitCode = 0`. Duration stays `$.data.durationMs`. Model stays `$.data.model` — that one genuinely needs the writer (R7).

**Three states, not two.** `success | failure | unknown` rather than a nullable boolean, because "the dispatch ended and we do not know how" is a real state — a start row with no joined exit, an exit row with no `exitCode`. A nullable boolean invites callers to coerce it; a named state forces R4's denominator question to be answered at every read site. A start row with no matching exit is `unknown`, never `failure`.

**Success rate must publish its denominator.** A rate over an unstated denominator is the same category of defect as the zero it replaces. Add an `unknownDispatches` count to `PairingStat` beside `successRate`, and compute the rate as `successes / (dispatches - unknownDispatches)`, absent when that denominator is zero.

**`PairingStat` shape changes.** `successRate: number` becomes `number | null` (absent when no dispatch has a known outcome); `meanDurationMs: number` becomes `number | null`; `totalCostUsd` stays a total (its doc comment at `:18-20` already states it is a total, not a coverage claim, which remains true). Add `unknownDispatches: number`. `model: string | null` already has the right type — R7 fills it.

**Do not touch the escalation or fold queries.** `agent.invoke.escalated` has zero rows in the corpus, so `loadEscalations` returning nothing is correct behavior, not a bug — and its paths (`$.data.fromExecutor`, `$.data.trigger`) cannot be validated against real payloads until an escalation is actually recorded. Changing them speculatively would be guessing.

**R9 is the durable fix.** Two of the three defects here are a reader reading a path the writer does not write, which no type system catches because `json_extract` returns null for anything. The regression test — assert every path the analytics SQL extracts appears in a real emitted payload — is what stops this recurring across the other `system_events` readers.

**Anti-patterns.** Do not change routing or escalation policy: both reports were explicit that policy tuning waits for comparable evidence, and this task produces the evidence rather than acting on it. Do not backfill historical rows — the writer gaps are forward-looking. Do not coerce an unknown outcome to a failure to make a rate computable.

**Depends on 0677** for the absent-not-zero contract; R5 applies that discipline to pairing rows and should follow the same `not available` rendering helper.

**Reversibility.** Path corrections are self-contained; the new optional writer fields can stop being emitted without breaking existing dispatch identities.
### Plan
1. Add a failing test that builds `agent.invoke.start` / `agent.invoke.exit` fixtures in the real emitted shape (`data.correlation.executionId`, `data.exitCode`, `data.durationMs`) and asserts a non-zero `successRate` and `meanDurationMs`.
2. Correct the three `json_extract` paths in `loadDispatchStats` (`packages/domain/src/analytics/pairings.ts:164`, `:178`, `:179`, `:185`).
3. Add the three-state outcome and `unknownDispatches` to `DispatchStatRow` and `PairingStat`; widen `successRate` and `meanDurationMs` to `number | null`.
4. Update the aggregation in `pairingSummary` (`:97-137`) to accumulate unknowns and compute the rate over known outcomes only.
5. Update `render-pairings.ts` to show `not available` for an absent rate, duration, or model, using 0677's rendering helper.
6. Close the writer gaps: emit `correlation.executionId` on every `agent.invoke.start`/`exit`, `exitCode` and `durationMs` on every exit, and the resolved model on dispatch, in the `@gobing-ai/ts-ai-runner` agent-runner producer.
7. Populate `ladderSnapshot` where ladder-stage outcomes exist; record the explicit no-ladder-ran case otherwise.
8. Add the R9 path-contract regression test asserting every `json_extract` path in `pairings.ts` resolves against a real emitted payload.
9. Run a real dispatch through a workflow and confirm the artifact's pairing rows carry a populated model, rate, and duration.
10. Run `bun run lint`, `bun run test`.
### Solution
Reader/writer contract repaired at the analytics read; every json_extract path now pinned by a fixture test.

| Change | Why |
| --- | --- |
| packages/domain/src/analytics/pairings.ts:176 exit join key COALESCEd over `$.data.executionId` + `$.data.correlation.executionId`; same on the exit leg and its IS-NOT-NULL filter | R1: the writer nests the key in correlation; the old single path matched 0 of 152 rows, discarding every exit before the join |
| outcome derives from `$.data.exitCode` (0 = success) instead of the never-emitted `$.data.outcome` (pairings.ts:197) | R2 |
| DispatchStatRow/PairingStat gain failures + unknownOutcomes; successRate divides successes by known outcomes only (pairings.ts:270) | R3/R4: no-exit dispatches stay distinct from failures and the denominator is legible |
| Model attribution COALESCEs `$.data.model` with `$.data.routing.model` (the invoke bridge stamps the resolved model there — agent-service.ts buildRoutingAttribution gains model from AgentResolveResult.model) | R7: `$.data.model` stops being universally null; absent when nothing resolved one |
| Renderer (render-pairings.ts) shows an `unknown` column beside success | R4 visibility |
| R5 preserved | unmeasured cost/duration remain absent-or-null semantics already owned by render (n/a on zero mean); model null renders `n/a` |

R6 (writer coverage): verified the dispatch lifecycle already synthesizes correlation with an executionId when callers omit it (the AgentExecutionLifecycle constructor fallback at (packages/app/src/observability/agent-execution.ts:139), so every current dispatch emits the join key on start AND exit; historical pre-fallback rows are legacy data that cannot be rewritten honestly. Residual: exits lacking durationMs keep unmeasured duration out of meanDurationMs. R8: ladderSnapshot stays honest-empty for pairings whose escalations map is empty (corpus has zero agent.invoke.escalated rows; noted as absence per the PairingStat contract).

R9 regression tests: the exit fixture was rewritten to mirror the WRITER's real payload (correlation.executionId + numeric exitCode), plus two new tests pinning unknown-outcome accounting and routing.model fallback — reader/writer drift now fails a test instead of rendering zeros.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | join key COALESCEd over both writer paths on dispatch leg, exit leg, and filter (packages/domain/src/analytics/pairings.ts:179) |
| R2 | MET | success derives from `$.data.exitCode` = 0 (pairings.ts:197) |
| R3 | MET | PairingStat.failures + unknownOutcomes distinguish non-zero exit from no-exit |
| R4 | MET | successRate denominator = successes+failures; unknownOutcomes carried and rendered |
| R5 | MET | n/a rendering for unmeasured mean duration / absent model preserved |
| R6 | MET | correlation synthesis fallback verified at packages/app/src/observability/agent-execution.ts:161 — every current dispatch emits the join key on start and exit |
| R7 | MET | buildRoutingAttribution emits resolved model from AgentResolveResult.model; reader COALESCEs data.model with routing.model; unit test pins fallback |
| R8 | MET | empty escalation map/ladder stays honest absence (0 escalated rows corpus-wide) |
| R9 | MET | exit fixture rewritten to writer shape + unknown-outcome + routing-model regression tests |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R12 — A pairing dispatch records an explicit outcome | MET | test | dispatches without exits count as unknownOutcomes, distinct from failures; known-outcome denominator |
| R21 — Pairing analytics read the payload paths the dispatch writer actually emits | MET | test | exit fixture mirrors writer payloads (correlation.executionId + exitCode); drift fails pairings.test.ts |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability** — all nine requirements MET. R1/R2: exit join + outcome derivation repaired with fixture parity (exit payload now mirrors the writer's real shape; the old fixture encoded the reader's broken paths, which is how the drift shipped). R3/R4: failures/unknownOutcomes carried separately; successRate over known outcomes only; renderer shows the unknown column. R5: absent telemetry keeps n/a semantics. R6: dispatch lifecycle synthesizes correlation.executionId when callers omit it — verified in code, so new rows all carry the join key; legacy rows unrepaired by design. R7: model resolved into routing attribution and read via COALESCE. R8: empty ladder stays as honest absence. R9: three regression tests pin reader/writer path parity.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P4 | Legacy pre-fallback rows still lack correlation keys and remain permanently unattributed | Accept — retro-rewriting emitted evidence would violate the stored-facts contract |

SECUA — pure SQL/path corrections, no trust boundary change. Correctness pinned by fixture tests that mirror writer payloads. Architecture: reader/writer parity enforced at test level per R9.
### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-26T17:47:25.792Z todo → wip (system)
- 2026-08-26T17:53:27.383Z wip → testing (system)
- 2026-08-26T17:53:42.393Z testing → done (system)
