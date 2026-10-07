---
schema_version: 1
name: Emit decision lifecycle events and persist them to the system event ledger
status: done
template: feature-impl
created_at: 2026-10-07T01:02:20.687Z
updated_at: "2026-10-07T03:52:39.008Z"
feature_id: P1
priority: P2
tags:
  - decision
estimate_hours: 6

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1095-verdict.json
---

## 1095. Emit decision lifecycle events and persist them to the system event ledger

### Background

Slices S1+S2 of docs/design/decision-observability-and-adoption.md §5. DecisionService.decide (packages/app/src/decision/decision-service.ts:182) serves catalog decisions but emits nothing, so maker reliability cannot be measured and feature P1 adoption has no evidence. Covers R4–R8.

### Requirements

- [x] R1. Register `decision.start`, `decision.success`, `decision.failure`, `decision.end` and `decision.rejected` in BASE_CATALOG (`packages/app/src/services/event-names.ts`) through `baseEvent(name, 'decision', …)` with payload policy `metadata-only` and tier `default`. Add `decision` to the `SystemEventSource` union (`event-names.ts:14`) and a `SOURCE_PROFILES` row (`:76`): `{ producerPackage: 'spur', subsystem: 'decision', remediationKind: 'prefix-filter' }`. Each event gets a `SYSTEM_EVENT_PRESENTERS` entry, modelled on `agent.invoke.start`/`exit` (`:713`/`:732`). Its `fields` plus `retain` must cover every payload field listed in R3, because metadata-only persistence keeps only `CORE_METADATA_PATHS` and the declared presenter paths.
- [x] R2. One exported emitter module, `packages/app/src/decision/decision-events.ts`, owns event construction:
  - `beginDecisionInvocation(bus, ctx, start)` returns `{ succeed, fail, end }`.
  - `emitDecisionRejected(bus, ctx, error)` emits `decision.rejected`.
  - Every event from one call shares an `invocationId` (`crypto.randomUUID()`, minted at start).
  - The order is fixed: `start → (success | failure) → end`, or `rejected` alone.
  - `end` fires from a `finally` block, so a maker throw still ends the invocation.
- [x] R3. Payloads contain metadata only, per design §3.2:
  - Common to every event: `invocationId`, `decisionId`, `caller` (`cli` | `workflow` | `gate`), `correlation{runId?, workflowName?, nodeId?, wbs?}`, and `severity` stamped by the producer.
  - `start`: `type`, `maker`, `makerSource`, `catalogLayer`, `inputKeys[]`, `evidenceDigest?`, `minConfidence`.
  - `success`: `value`, `confidence`, `maker`.
  - `failure`: `reason`, `fallbackValue`, `confidence`, `maker`, `error?`.
  - `end`: `durationMs`, `value`, `source`, `reason`, `maker`, `confidence` (so the reliability report reads one row per invocation).
  - `rejected`: `errorKind`, `message`, `maker?`.
  - Input values and evidence text never appear. `error` and `message` pass through `redactAndBound(text, [], 512)`.
  - `makerSource` uses the real `DecisionMakerSource` vocabulary: `flag | config-decision | config-default | catalog-decision | catalog-default`. The workflow inline-question path uses `inline`.
- [x] R4. Severity is set by the producer in the payload, never by growing `inferSeverity`: `info` for start/success/end, `warning` for failure, `error` for failure with reason `error`, and `error` for rejected.
- [x] R5. Emission is best-effort. Each `bus.emit` is wrapped so that a listener throw or tap failure never changes the returned decision or the thrown caller error. With no bus, emission is a no-op.
- [x] R6. DecisionService seam: `DecideOptions` gains `readonly bus?: SystemEventBus` and `readonly context?: DecisionCallContext{caller, correlation?}`. They are passed per call, not to the constructor, because `getDecisionService` caches one service per `cwd` per process.
  - `decide` emits `rejected` (then rethrows) for `DecisionCatalogError`, `UnknownDecisionError` and `UnknownDecisionMakerError`.
  - Otherwise it emits start → success|failure → end around `hub.decide`.
  - `success` means `source === 'model'` and `reason === 'accepted'`. Every other served result is `failure`.
- [x] R7. CLI `spur decision run` (`apps/cli/src/commands/decision.ts:133`):
  - Build `const bus = new EventBus() as SystemEventBus; const ledger = await attachSystemEventLedger(bus, context);`, following `agent.ts:1396`.
  - Pass `{ maker, bus, context: { caller: 'cli' } }` to `decide`.
  - In the catch block, call `emitDecisionRejected(bus, {decisionId: id, caller: 'cli'}, error)` for every pre-decide caller mistake: describe, evidence read, and param parse. A rejection thrown from inside `decide` is already emitted there and must not be emitted twice.
  - Call `await ledger.flush()` and `ledger.unsubscribe()` in `finally`.
  - Add no new flags.
- [x] R8. The workflow `decide` action (inline-question path, `packages/app/src/workflow/actions/decide.ts:64`):
  - `DecideActionDeps` gains `observabilityBus?`, wired in `packages/app/src/workflow/builtins.ts:108` from `options.observabilityBus`.
  - The runner calls `beginDecisionInvocation` with caller `workflow`, decisionId `options.id`, makerSource `inline`, maker = `result.backend ?? 'none'`, and correlation `{runId: context.runId, nodeId: context.stateOrNodeId}`.
  - It maps the `DecideResult` to success/failure/end.
  - Reason `disabled` emits nothing, because no maker was involved and it must not count as a fallback in the reliability report.
- [x] R9. The inline driver path (`packages/app/src/services/inline-run-setup.ts:854`, `:1525`):
  - `runDecideForInlineRun` accepts `runId`, `node` and an optional bus, and passes the real runId and node instead of `'inline-decide'`/`'decide'`.
  - `runInlineRunDecide` builds a local `EventBus`, registers `registerSystemEventTap(bus, new SystemEventDao(projectDb.adapter), …)` over `openInlineRunProjectDb`, as `:1273` does for the trace writer, and closes it in `finally`.
- [x] R10. Update `docs/design/event-tracking.md`: the §4 5W1H matrix (counts and five rows), the §8 emitter checklist entry, and the §11 presenter table. Fix `makerSource` in `docs/design/decision-observability-and-adoption.md` §3.2 to the R3 vocabulary.

### Acceptance Criteria

- [x] AC1 — An accepted decision emits start, success and end events in order
- [x] AC2 — A fallback decision emits start, failure and end events in order
- [x] AC3 — A caller mistake emits decision.rejected before any maker call
- [x] AC4 — Decision event payloads stay metadata-only and carry run correlation
- [x] AC5 — Decision events persist to the system event ledger

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/decision.ts:12` |
| `apps/cli/src/commands/decision.ts:138` |
| `apps/cli/src/commands/decision.ts:145` |
| `apps/cli/src/commands/decision.ts:15` |
| `apps/cli/src/commands/decision.ts:157` |
| `apps/cli/src/commands/decision.ts:177` |
| `apps/cli/src/commands/decision.ts:198` |
| `apps/cli/src/commands/decision.ts:201` |
| `apps/cli/src/commands/decision.ts:6` |
| `apps/cli/src/commands/decision.ts:9` |
| `docs/design/event-tracking.md:132` |
| `docs/design/event-tracking.md:138` |
| `docs/design/event-tracking.md:140` |
| `docs/design/event-tracking.md:21` |
| `docs/design/event-tracking.md:219` |
| `docs/design/event-tracking.md:355` |
| `docs/design/event-tracking.md:49` |
| `packages/app/src/decision/decision-service.ts:1` |
| `packages/app/src/decision/decision-service.ts:13` |
| `packages/app/src/decision/decision-service.ts:195` |
| `packages/app/src/decision/decision-service.ts:199` |
| `packages/app/src/decision/decision-service.ts:20` |
| `packages/app/src/decision/decision-service.ts:204` |
| `packages/app/src/decision/decision-service.ts:213` |
| `packages/app/src/decision/decision-service.ts:222` |
| `packages/app/src/decision/decision-service.ts:226` |
| `packages/app/src/decision/decision-service.ts:272` |
| `packages/app/src/decision/decision-service.ts:96` |
| `packages/app/src/index.ts:12` |
| `packages/app/src/services/event-names.ts:1593` |
| `packages/app/src/services/event-names.ts:25` |
| `packages/app/src/services/event-names.ts:371` |
| `packages/app/src/services/event-names.ts:97` |
| `packages/app/src/services/inline-run-setup.ts:1543` |
| `packages/app/src/services/inline-run-setup.ts:1549` |
| `packages/app/src/services/inline-run-setup.ts:1562` |
| `packages/app/src/services/inline-run-setup.ts:1597` |
| `packages/app/src/services/inline-run-setup.ts:56` |
| `packages/app/src/services/inline-run-setup.ts:64` |
| `packages/app/src/services/inline-run-setup.ts:70` |
| `packages/app/src/services/inline-run-setup.ts:82` |
| `packages/app/src/services/inline-run-setup.ts:833` |
| `packages/app/src/services/inline-run-setup.ts:879` |
| `packages/app/src/services/inline-run-setup.ts:884` |
| `packages/app/src/workflow/actions/decide.ts:104` |
| `packages/app/src/workflow/actions/decide.ts:6` |
| `packages/app/src/workflow/actions/decide.ts:60` |
| `packages/app/src/workflow/actions/decide.ts:64` |
| `packages/app/src/workflow/builtins.ts:111` |
| `plugins/sp/lib/inline-run.generated.mjs:1679` |
| `plugins/sp/lib/inline-run.generated.mjs:1685` |
| `plugins/sp/lib/inline-run.generated.mjs:1690` |
| `plugins/sp/lib/inline-run.generated.mjs:1706` |
| `plugins/sp/lib/inline-run.generated.mjs:546` |
| `packages/app/src/decision/decision-events.ts:1` |
| `packages/app/tests/decision/decision-events.test.ts:1` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/event-names.ts:26` (source union), `:97` (SOURCE_PROFILES spur/decision/prefix-filter), `:373-377` (five baseEvent entries; 3-arg defaults metadata-only + default at `:225-227`), `:1597-1730` (five presenters); test `packages/app/tests/decision/decision-events.test.ts:299-310` |
| R2 | MET | `packages/app/src/decision/decision-events.ts:134-141` (beginDecisionInvocation, one invocationId `:139`), `:107-126` (emitDecisionRejected), fixed order start→terminal→end; end-from-finally at the service seam `packages/app/src/decision/decision-service.ts:256-270`; tests `packages/app/tests/decision/decision-events.test.ts:83-113` |
| R3 | MET | Payload builders `packages/app/src/decision/decision-events.ts:116-125,146-155,157-173`; makerSource vocabulary `DecisionMakerSource |
| R4 | MET | Producer-stamped severity in payload: info start `:148` / success `:158` / end `:171`, warning failure `:164-165`, error for reason `error` and rejected `:121,165`; inferSeverity untouched (no diff hunk); test `packages/app/tests/decision/decision-events.test.ts:115-136` |
| R5 | MET | Best-effort emit `packages/app/src/decision/decision-events.ts:175-184`: undefined-bus no-op, sync try/catch + async `.catch` swallow; tests `packages/app/tests/decision/decision-events.test.ts:162-216` (undefined bus, hostile listener, rejecting bus) |
| R6 | MET | `packages/app/src/decision/decision-service.ts:97-99` (DecideOptions bus/context, per call), rejected+rethrow `:204` (DecisionCatalogError dup id), `:211` (describe/UnknownDecisionError), `:226` (UnknownDecisionMakerError, maker name in payload); lifecycle around hub.decide `:229-256`; success = model+accepted `:247-249`; tests `packages/app/tests/decision/decision-events.test.ts:206-297` |
| R7 | MET | `apps/cli/src/commands/decision.ts:141-142` (bus + attachSystemEventLedger), `:186-189` (decide with maker/bus/caller cli), rejected at pre-decide sites `:149,173,181`, no double emission (outer catch `:199-201`), flush+unsubscribe in finally `:202-203`, no new flags (`:132-136` unchanged) |
| R8 | MET | `packages/app/src/workflow/actions/decide.ts:61-65` (deps.observabilityBus), wired `packages/app/src/workflow/builtins.ts:111` from options.observabilityBus (fed by `packages/app/src/services/workflow-service.ts:2047`, tapped at `apps/cli/src/commands/workflow.ts:533`); runner `packages/app/src/workflow/actions/decide.ts:111-150`: caller workflow, decisionId options.id, makerSource inline, maker backend??"none", correlation runId/nodeId, disabled emits nothing (`:111`); tests `packages/app/tests/decision/decision-events.test.ts:371-419` |
| R9 | MET | `packages/app/src/services/inline-run-setup.ts:834-838` (runId/node/observabilityBus inputs), `:881-885` (real runId/node, 0941 defaults), `:1548-1570` (local EventBus + registerSystemEventTap(SystemEventDao(openInlineRunProjectDb))), unsubscribe+close in finally `:1594-1596`; driver path executed by `packages/app/tests/services/inline-run-driver.test.ts:410-430` (exit 0 disabled / exit 1 bad options) |
| R10 | MET | `docs/design/event-tracking.md:129` (§4 counts), `:132-136` (five rows 76-80 with fresh anchors), `:139-140` (tally + narrative), `:223` (§8 decision.* severity worked example), `:355-359` (§11 presenter rows); makerSource clause: `docs/design/decision-observability-and-adoption.md:81` already carries the exact T3 vocabulary at the base commit |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/decision/decision-events.test.ts:83-113` (order + one shared invocationId) |
| AC2 | MET | test | `packages/app/tests/decision/decision-events.test.ts:115-136` and service fallback lifecycle `:214-259` |
| AC3 | MET | test | `packages/app/tests/decision/decision-events.test.ts:143-160` (single event, redacted message) and `:262-297` (rejected before lifecycle; service rethrows) |
| AC4 | MET | test | catalog contract `packages/app/tests/decision/decision-events.test.ts:299-310` (metadata-only policy) + projection `:325-357` (declared fields kept; correlation in ledger column run_id, envelope context, nested wbs) |
| AC5 | MET | test | `packages/app/tests/decision/decision-events.test.ts:325-344` (three rows start/failure/end persisted through the real tap+envelope path); CLI/inline attach wiring at `apps/cli/src/commands/decision.ts:141-142`, `packages/app/src/services/inline-run-setup.ts:1553` |
| An accepted decision emits start, success and end events in order | MET | test | see AC1: packages/app/tests/decision/decision-events.test.ts:83-113 (order + one shared invocationId) |
| A fallback decision emits start, failure and end events in order | MET | test | see AC2: packages/app/tests/decision/decision-events.test.ts:115-136 (warning severity failure) |
| A caller mistake emits decision.rejected before any maker call | MET | test | see AC3: :143-160 redaction, :262-297 rejected before lifecycle |
| Decision event payloads stay metadata-only and carry run correlation | MET | test | see AC4: catalog contract :299-310, projection :325-357 (run_id correlation) |
| Decision events persist to the system event ledger | MET | test | see AC5: :325-344 real tap+envelope rows; wiring apps/cli/src/commands/decision.ts:141-142, packages/app/src/services/inline-run-setup.ts:1548-1570 |
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

- 2026-10-07T02:52:53.892Z todo → wip (system)
- 2026-10-07T03:48:16.496Z wip → testing (system)
- 2026-10-07T03:52:39.002Z testing → done (system)

