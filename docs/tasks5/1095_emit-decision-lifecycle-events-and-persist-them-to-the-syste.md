---
schema_version: 1
name: Emit decision lifecycle events and persist them to the system event ledger
status: todo
template: feature-impl
created_at: 2026-10-07T01:02:20.687Z
updated_at: "2026-10-07T01:19:49.334Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 6

---

## 1095. Emit decision lifecycle events and persist them to the system event ledger

### Background

Slices S1+S2 of docs/design/decision-observability-and-adoption.md §5. DecisionService.decide (packages/app/src/decision/decision-service.ts:182) serves catalog decisions but emits nothing, so maker reliability cannot be measured and feature P1 adoption has no evidence. Covers R4–R8.

### Requirements

- [ ] R1. Register `decision.start`, `decision.success`, `decision.failure`, `decision.end` and `decision.rejected` in BASE_CATALOG (`packages/app/src/services/event-names.ts`) through `baseEvent(name, 'decision', …)` with payload policy `metadata-only` and tier `default`. Add `decision` to the `SystemEventSource` union (`event-names.ts:14`) and a `SOURCE_PROFILES` row (`:76`): `{ producerPackage: 'spur', subsystem: 'decision', remediationKind: 'prefix-filter' }`. Each event gets a `SYSTEM_EVENT_PRESENTERS` entry, modelled on `agent.invoke.start`/`exit` (`:713`/`:732`). Its `fields` plus `retain` must cover every payload field listed in R3, because metadata-only persistence keeps only `CORE_METADATA_PATHS` and the declared presenter paths.
- [ ] R2. One exported emitter module, `packages/app/src/decision/decision-events.ts`, owns event construction:
  - `beginDecisionInvocation(bus, ctx, start)` returns `{ succeed, fail, end }`.
  - `emitDecisionRejected(bus, ctx, error)` emits `decision.rejected`.
  - Every event from one call shares an `invocationId` (`crypto.randomUUID()`, minted at start).
  - The order is fixed: `start → (success | failure) → end`, or `rejected` alone.
  - `end` fires from a `finally` block, so a maker throw still ends the invocation.
- [ ] R3. Payloads contain metadata only, per design §3.2:
  - Common to every event: `invocationId`, `decisionId`, `caller` (`cli` | `workflow` | `gate`), `correlation{runId?, workflowName?, nodeId?, wbs?}`, and `severity` stamped by the producer.
  - `start`: `type`, `maker`, `makerSource`, `catalogLayer`, `inputKeys[]`, `evidenceDigest?`, `minConfidence`.
  - `success`: `value`, `confidence`, `maker`.
  - `failure`: `reason`, `fallbackValue`, `confidence`, `maker`, `error?`.
  - `end`: `durationMs`, `value`, `source`, `reason`, `maker`, `confidence` (so the reliability report reads one row per invocation).
  - `rejected`: `errorKind`, `message`, `maker?`.
  - Input values and evidence text never appear. `error` and `message` pass through `redactAndBound(text, [], 512)`.
  - `makerSource` uses the real `DecisionMakerSource` vocabulary: `flag | config-decision | config-default | catalog-decision | catalog-default`. The workflow inline-question path uses `inline`.
- [ ] R4. Severity is set by the producer in the payload, never by growing `inferSeverity`: `info` for start/success/end, `warning` for failure, `error` for failure with reason `error`, and `error` for rejected.
- [ ] R5. Emission is best-effort. Each `bus.emit` is wrapped so that a listener throw or tap failure never changes the returned decision or the thrown caller error. With no bus, emission is a no-op.
- [ ] R6. DecisionService seam: `DecideOptions` gains `readonly bus?: SystemEventBus` and `readonly context?: DecisionCallContext{caller, correlation?}`. They are passed per call, not to the constructor, because `getDecisionService` caches one service per `cwd` per process.
  - `decide` emits `rejected` (then rethrows) for `DecisionCatalogError`, `UnknownDecisionError` and `UnknownDecisionMakerError`.
  - Otherwise it emits start → success|failure → end around `hub.decide`.
  - `success` means `source === 'model'` and `reason === 'accepted'`. Every other served result is `failure`.
- [ ] R7. CLI `spur decision run` (`apps/cli/src/commands/decision.ts:133`):
  - Build `const bus = new EventBus() as SystemEventBus; const ledger = await attachSystemEventLedger(bus, context);`, following `agent.ts:1396`.
  - Pass `{ maker, bus, context: { caller: 'cli' } }` to `decide`.
  - In the catch block, call `emitDecisionRejected(bus, {decisionId: id, caller: 'cli'}, error)` for every pre-decide caller mistake: describe, evidence read, and param parse. A rejection thrown from inside `decide` is already emitted there and must not be emitted twice.
  - Call `await ledger.flush()` and `ledger.unsubscribe()` in `finally`.
  - Add no new flags.
- [ ] R8. The workflow `decide` action (inline-question path, `packages/app/src/workflow/actions/decide.ts:64`):
  - `DecideActionDeps` gains `observabilityBus?`, wired in `packages/app/src/workflow/builtins.ts:108` from `options.observabilityBus`.
  - The runner calls `beginDecisionInvocation` with caller `workflow`, decisionId `options.id`, makerSource `inline`, maker = `result.backend ?? 'none'`, and correlation `{runId: context.runId, nodeId: context.stateOrNodeId}`.
  - It maps the `DecideResult` to success/failure/end.
  - Reason `disabled` emits nothing, because no maker was involved and it must not count as a fallback in the reliability report.
- [ ] R9. The inline driver path (`packages/app/src/services/inline-run-setup.ts:854`, `:1525`):
  - `runDecideForInlineRun` accepts `runId`, `node` and an optional bus, and passes the real runId and node instead of `'inline-decide'`/`'decide'`.
  - `runInlineRunDecide` builds a local `EventBus`, registers `registerSystemEventTap(bus, new SystemEventDao(projectDb.adapter), …)` over `openInlineRunProjectDb`, as `:1273` does for the trace writer, and closes it in `finally`.
- [ ] R10. Update `docs/design/event-tracking.md`: the §4 5W1H matrix (counts and five rows), the §8 emitter checklist entry, and the §11 presenter table. Fix `makerSource` in `docs/design/decision-observability-and-adoption.md` §3.2 to the R3 vocabulary.

### Acceptance Criteria

- [ ] AC1 — An accepted decision emits start, success and end events in order
- [ ] AC2 — A fallback decision emits start, failure and end events in order
- [ ] AC3 — A caller mistake emits decision.rejected before any maker call
- [ ] AC4 — Decision event payloads stay metadata-only and carry run correlation
- [ ] AC5 — Decision events persist to the system event ledger

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T01:02:46.355Z

- Scope and approach closed at idea-pipeline run 4111db4a-101f-420c-8b6f-9530bf678534: chosen approach and rejected alternatives recorded in Design; contract in docs/design/decision-observability-and-adoption.md.
- Adoption slices start only after the reliability report shows recorded evidence for their decision id and maker (feature P1 entry condition).

#### Q&A entry — 2026-10-07T01:19:09.518Z

- Bus and context are per call on DecideOptions, not on the constructor, because `getDecisionService` caches one instance per process (decision-service.ts:297).
- The workflow inline-question decide emits too (caller `workflow`, makerSource `inline`), so the task-pipeline decision points gather evidence before 1094. Reason `disabled` emits nothing.
- CLI `decision run` adds no flag for run correlation. Shell-invoked decisions from workflows (1097/1098) carry caller `cli` and empty correlation. Reliability grouping is by `decisionId × maker`, so the evidence still counts. A `--run-id` flag would be a public-surface change and is deferred until a report needs per-run joins.
- Severity is stamped in the payload (event-tracking §8), not inferred.

### Design

**Chosen: one emitter module and three call sites.**

- `decision-events.ts` is the only place that builds decision event payloads.
- `DecisionService.decide` covers `spur decision run` and, after task 1094, catalog-backed workflow decides.
- `DecideActionRunner` covers today's inline-question workflow decides, both through the engine and the inline driver.
- When 1094 routes catalog-backed decides through the service, the runner keeps emitting only for the deprecated inline-question form, so nothing is emitted twice.

**Rejected:**
- Upstream hooks in `ts-ai-decision`: they need a library release, and the wrapper already holds every field.
- Bus on the constructor: `getDecisionService` caches the instance per process (`decision-service.ts:297`), so a constructor bus would leak between callers.
- Growing `inferSeverity`: event-tracking §8 says producers stamp severity.

**Seams (file:line):**

| Concern | Location |
| --- | --- |
| Catalog | `packages/app/src/services/event-names.ts:14` (source union), `:76` (SOURCE_PROFILES), `:281` (baseEvent examples), `:713`/`:732` (presenter examples), `:898` (`retain` example) |
| Service | `packages/app/src/decision/decision-service.ts:85` (DecideOptions), `:182` (decide) |
| CLI | `apps/cli/src/commands/decision.ts:133-170` (run action), `apps/cli/src/system-event-ledger.ts` (attachSystemEventLedger), `apps/cli/src/commands/agent.ts:1396` (bus pattern) |
| Workflow | `packages/app/src/workflow/actions/decide.ts:58` (deps), `:64` (runner), `packages/app/src/workflow/builtins.ts:108` (registration); `workflow-service.ts:2047` passes `observabilityBus`, which the CLI workflow command taps (`apps/cli/src/commands/workflow.ts:916`) |
| Inline driver | `packages/app/src/services/inline-run-setup.ts:854`, `:869-875` (hard-coded runId), `:1525`; tap helper `packages/app/src/services/system-event-tap.ts:51` |

**Invariants:**
- `decision.failure` means a fallback value was served. It does not mean a crash: the caller still gets a value.
- `value` and `fallbackValue` are always members of the catalog's closed vocabulary, so they may appear in payloads.
- Input values and evidence text never leave the decide call.
- Emission can never change a decision result or a caller error.
- CLI exit codes are unchanged: 0 for every backend outcome, 1 for caller mistakes.

**Execution budget:**
- About 10 source files and 2 docs.
- `requireDiff: true`.
- No new public CLI noun, verb or flag.
- No new dependency.

### Plan

1. Write the failure list first, as E2E scenarios plus emitter checks:
   - `end` is missing when the maker throws.
   - `rejected` fires after `start`, or twice for one CLI call.
   - An input value or evidence text leaks into `payload_json`.
   - A listener throw changes the decide result.
   - The CLI writes `system_events` rows without `runId`/`nodeId` correlation for a workflow decide.
   - Reason `disabled` is counted as a failure.
   - A presenter is missing a field, so the field is dropped under metadata-only.
2. In `event-names.ts`, add the `decision` source, the SOURCE_PROFILES row, the five `baseEvent` entries and their presenters (fields plus retain). Run the existing event-catalog contract test (`bun test` in `packages/app`) to confirm every name has a presenter and a profile.
3. Add `packages/app/src/decision/decision-events.ts` with `beginDecisionInvocation` and `emitDecisionRejected`, and export both from the app index.
4. In `DecisionService.decide`, add `bus` and `context` to `DecideOptions`, emit rejected or the lifecycle around `hub.decide`, and compute `inputKeys` and `evidenceDigest` (sha256 of `input.instructions` when present).
5. CLI `decision run`: attach the ledger, pass bus and context, emit `rejected` from the catch for pre-decide errors, and flush in `finally`.
6. Workflow runner: add the `observabilityBus` dep, wire it in `builtins.ts:108`, and map `DecideResult` to events (skip `disabled`).
7. Inline driver: thread runId, node and a tapped bus through `runDecideForInlineRun` and `runInlineRunDecide`.
8. Docs: event-tracking.md §4, §8 and §11; fix §3.2 makerSource in the satellite.
9. E2E, in a temporary project with no maker backend:
   - `spur decision run task-triage --param wbs=1 --json` exits 0.
   - `system_events` holds exactly start, failure (reason `no-backend`, severity `warning`) and end rows under source `decision`, sharing one `invocationId`.
   - `spur decision run nope --json` exits 1 and writes one `decision.rejected` row.
   - Save the queried rows as the repeatable artifact `.spur/run/1095-decision-events.json`.
10. Gate: `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
