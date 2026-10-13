---
schema_version: 1
name: Add the opt-in decision maker liveness probe
status: done
template: feature-impl
created_at: 2026-10-11T23:23:17.424Z
updated_at: "2026-10-13T02:58:38.775Z"
feature_id: P11

done_forced: "false"
done_reason: unforced close; PASS artifact at tracked Testing section (scratch verdict not retained)
---

## 1171. Add the opt-in decision maker liveness probe

### Background

Slice of feature P11. Recorded evidence can only say "this maker worked at some point, if the ledger
has rows at all". A registered maker whose backend died since then still reads as configured. The
`--probe` marker closes that gap with one real decision per maker, on demand.

The probe is the only part of `status` that calls a maker, so it is opt-in, it never changes the exit
code, and it leaves no trace in the ledger.

### Requirements

- [x] R1. Add `probeDecisionMakers(service, status, spec?)` to
  `packages/app/src/decision/decision-status-readiness.ts`, with `LIVENESS_DECISION_ID` exported as the
  catalog id the probe serves (`maker-liveness`, task 1169).
- [x] R2. For each distinct maker, serve `LIVENESS_DECISION_ID` once with
  `service.probeMaker(id, name, { instructions: LIVENESS_PROBE_QUESTION }, backstopMs)` — a probe-only hub over the same catalog loader as `spur decision run`, so catalog resolution, input validation, the maker call and the fallback
  route are all exercised.
- [x] R3. Map each outcome to `DecisionProbeOutcome { maker, ok, value, reason, durationMs }` where
  `ok` is `source === 'model'`, `reason` is the served reason, and `value` is null only when the
  deadline expired. The hub maps every backend outcome — low confidence, no backend, timeout,
  error — to the declared fallback instead of throwing, so a failing maker is data; a caller
  mistake at the hub (unknown id, unregistered maker, invalid input) propagates and is reported
  as an environment fault (R5).
- [x] R4. Pass no `bus` and no `decisionLog`: the probe emits no decision event and writes no
  `decision_logs` row, so the recorded evidence the same report shows cannot be contaminated by the
  probe that verified it.
- [x] R5. Fail before any maker call when the liveness id is not served: `service.describe(id)` throws
  `UnknownDecisionError` and the caller surfaces it as a caller/environment mistake (task 1172 R2
  maps it to the non-zero exit).
- [x] R6. Enumerate failure modes before the assertions and cover them with deterministic tests: answered
  and accepted (`ok: true`); low confidence; no backend; timeout; maker error; unexpected throw from
  the seam; absent liveness id (validated before the loop); unregistered maker (never listed by the
  caller).

### Acceptance Criteria

- [x] AC1 — An opt-in probe proves a maker answers right now
- [x] AC2 — A probe that cannot reach its maker is reported, not raised

### Q&A

Closed decisions from the original 2026-10-11 refinement and implementation session (deduplicated during this audit):

- Operator request (this session): prove "actually working" by having the maker answer a real, simple
  decision one by one rather than inferring health from configuration. Accepted the recommended shape:
  one liveness decision per distinct registered effective maker, opt-in via `--probe`.

- Closed: the probe writes no `decision_logs` row and emits no decision event, so the recorded
  evidence column cannot be satisfied by the probe that checks it. Tradeoff (no probe audit trail) is
  recorded in the design satellite §6.

- Closed: a failing probe never changes the exit code. `--probe` answers "is it working now", and a
  readiness report is data, not a failing command; a non-zero exit stays reserved for caller mistakes
  and catalog or maker-config errors.

### Design

**Chosen: loop in the app service, one bounded probe call per maker, injectable seam for the failure table.**

- `probeDecisionMakers` accepts the `DecisionMakerProbe` seam implemented by `DecisionService`.
  It validates the liveness entry before iterating, including an empty maker set. `probeMaker` rejects
  duplicate ids before constructing a maker, then uses a probe-only hub with bounded drivers.
  Service tests substitute hub outcomes to cover acceptance, each fallback reason, deadline expiry
  and rejection; CLI tests exercise the real offline typesafe backend.
- Sequential, not parallel: a probe is a diagnostic an operator watches; concurrent local-model calls
  would queue against one server and turn a latency signal into noise.
- No ledger writes: keeping probe rows out of `system_events` and `decision_logs` means the "working"
  column can never be satisfied by the probe that checks it. The corresponding tradeoff — a probe run
  leaves no audit trail — is recorded in the design satellite §6.

**Rejected:**
- Calling the registry directly: it would skip catalog resolution, input validation and the fallback
  route, so a green probe would not prove what the column claims.
- A `--probe` that also serves each decision id: cost grows with the catalog, and a real decision with
  synthetic input is exactly the noise feature P1's evidence bar exists to exclude.

### Plan

- [x] Validate the liveness entry before iterating and reject duplicate catalog ids.
- [x] Probe each registered effective maker once through the isolated bounded hub without event/log sinks.
- [x] Test accepted/fallback results, deadline expiry, propagation, filtering and deduplication.

### Solution

- **R1–R4 — the seam** (`packages/app/src/decision/decision-service.ts`): `probeMaker(decisionId, maker,
  input, backstopMs)` serves the liveness decision through a probe-only hub, and returns
  `DecisionProbeOutcome { maker, ok, value, reason, durationMs }` where `ok = source === 'model'`.
- **Bounded, not raced first** (`probeHub()`, `PROBE_DRIVER_BUDGET_MS = 120_000`): the probe registry
  carries the budget per driver — `timeoutMs` for the hosted backend, `startupTimeoutMs` +
  `requestTimeoutMs` for `laya-local`, `requestTimeoutMs` for `fm-local` — because a cold local model
  legitimately needs its load budget. `raceTimeout` is the backstop for a driver with no budget of its own
  (the in-process `mlx-native` core); a race expiry reports `reason: 'timeout'`, `value: null`.
- **No side effects**: the probe passes no event bus and no decision log, so it emits no `decision.*` event
  and writes no `decision_logs` row. Asserted end to end: after `--probe`, `RECORDED` is still 0.
- **R5 — the loop** (`decision-status-readiness.ts`): `probeDecisionMakers(probe, status, spec?)` asks each
  distinct registered effective maker once, sequentially, with an optional `onResult` stream. A seam throw
  (unknown liveness id, unregistered maker, invalid input) propagates as an environment fault.
- **R6 — failure modes first**: the table in the test file was written before the implementation; the seven
  modes and their covering tests are listed in Testing.
- **Extraction** (`loadCatalogs(hub)`): the catalog-loading loop moved out of the constructor so the probe
  hub and the serving hub load identically; `catalogErrors` is filled from the same call, so the second hub
  cannot introduce a divergent error set.
- **Root cause found while implementing**: a `laya-local` decision call blocked for ~1 h in this environment
  instead of failing fast, which is why the probe bounds every driver rather than trusting one shared
  timeout. Recorded in the design satellite §6 as a known limit.

- **Citations**: `packages/app/src/decision/decision-service.ts:260` (probeMaker), `packages/app/src/decision/decision-service.ts:293` (probeHub), `packages/app/src/decision/decision-service.ts:153` (raceTimeout), `packages/app/src/decision/decision-status-readiness.ts:165` (probe loop).


- Re-audit corrections: preflight the liveness entry even with an empty maker set, and reject duplicate catalog ids before entering the probe hub. Service regression tests now execute result mapping, every fallback reason, the wall-clock deadline and caller-error propagation.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Probe loop and exported liveness id at `packages/app/src/decision/decision-status-readiness.ts:165`; exported at `packages/app/src/index.ts:98-100`. |
| R2 | MET | One call per distinct registered effective maker: `packages/app/tests/decision/decision-status-readiness.test.ts:258`; duplicate rejection before hub: `packages/app/tests/decision/decision-service.test.ts:47`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| R3 | MET | probeMaker maps ok from source model and null value on deadline at `packages/app/src/decision/decision-service.ts:319-349`; backstop race at `packages/app/src/decision/decision-service.ts:186`; tested at `packages/app/tests/decision/decision-service.test.ts:64`. |
| R4 | MET | Probe-only hub built with registry only, no bus/log, at `packages/app/src/decision/decision-service.ts:352-375`; ledger unchanged after probe at `apps/cli/tests/commands/decision.test.ts:482`. |
| R5 | MET | Missing entry fails before any call: `packages/app/tests/decision/decision-status-readiness.test.ts:308`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| R6 | MET | Failure-mode table written ahead of assertions at `packages/app/tests/decision/decision-status-readiness.test.ts:14-30`; executable cases at `packages/app/tests/decision/decision-service.test.ts:64`. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — An opt-in probe proves a maker answers right now | MET | test | `apps/cli/tests/commands/decision.test.ts:482`; `packages/app/tests/decision/decision-status-readiness.test.ts:258`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
| Scenario: R6 — A probe that cannot reach its maker is reported, not raised | MET | test | Every fallback reason and deadline mapped to data: `packages/app/tests/decision/decision-service.test.ts:64`. Fresh this run: bun test tests/decision (cwd packages/app) exited 0, 88 pass/0 fail; bun test tests/commands/decision.test.ts (cwd apps/cli) exited 0, 32 pass/0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Current audit corrected stale Requirements/Design that named decision-readiness.ts and service.decide. The implementation intentionally uses a probe-only hub to bound drivers without shortening real decisions or attaching sinks. Missing-entry preflight now runs even with no effective makers, and probeMaker rejects duplicate ids before reaching the hub. Service tests now execute accepted results, every fallback reason, timeout expiry and rejection instead of relying only on preconstructed outcome stubs.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | correctness | packages/app/src/decision/decision-status-readiness.ts | Empty maker set bypassed missing-entry validation. | FIXED — describe runs before iteration; zero-call regression passes. |
| P2 | correctness | packages/app/src/decision/decision-service.ts | Probe hub bypassed the duplicate-id guard used by real decisions. | FIXED — duplicate catalog rejection precedes hub decide; regression asserts zero calls. |
| P3 | test coverage | packages/app/tests/decision/decision-service.test.ts | Prior tests supplied already-mapped probe outcomes and did not exercise timeout mapping. | FIXED — real service mapping and deadline are exercised with substituted hub results. |

Known external limit: the wall-clock backstop returns timeout data but cannot cancel an in-process driver that exposes no cancellation. Such a driver may retain process resources after the report prints. This feature promises a bounded result, not driver cancellation; upstream cancellation support is the concrete upgrade trigger. Hardware behavior remains unverified here. The prior major label incorrectly treated that explicit scope limit as a completed local fix. No timeout configuration or persisted probe history is required by P11.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-11T23:25:04.245Z backlog → todo (system)
- 2026-10-12T01:39:52.300Z todo → wip (system)
- 2026-10-12T01:39:53.012Z wip → testing (system)
- 2026-10-12T01:44:13.836Z testing → done (system)
- 2026-10-12T01:57:02.740Z done → wip (system)
- 2026-10-12T01:57:03.366Z wip → testing (system)
- 2026-10-12T01:57:04.009Z testing → done (system)

