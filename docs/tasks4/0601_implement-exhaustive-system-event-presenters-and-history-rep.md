---
schema_version: 1
name: "Implement exhaustive System Event presenters and history reprojection"
status: done
template: feature-impl
created_at: 2026-08-19T15:25:16.604Z
updated_at: "2026-08-19T22:55:25.214Z"
feature_id: J9
priority: P2
tags: ["system-events", "observability", "presentation"]
dependencies: ["0602"]
---

## 0601. Implement exhaustive System Event presenters and history reprojection

### Background
J9 already fixes the semantic contract: System Event presentation is a server-derived view over bounded producer facts, while the Board remains a generic renderer. This task implements that accepted contract across the Spur repository and keeps the canonical v2 envelope unchanged.

Current-tree premise verified on 2026-08-19:

- `PlanningWriteService.transition()` emits default-tier `task.transitioned` and `feature.transitioned` rows after a successful write, with `entity`, `from`, and `to`. The task-status event therefore already exists. The System Events tab does not make the status change visible because `buildSummary()` is generic and Outcome ignores `to`; the transition facts are relegated to raw detail.
- `SYSTEM_EVENT_CATALOG` contains 71 names, but descriptions and retained fields still come from generated/source-family defaults. `buildSystemEventEnvelope()` uses one generic summary/outcome path, and `projectStoredSystemEventEnvelope()` returns valid canonical v2 history unchanged.
- `PlanningEvent` already has a `data` carrier and `updateSection` already holds the validated canonical section name, but step 8 does not emit it.
- `WorkflowService` already loads the workflow definition before execution, but workflow identity is not applied consistently to engine-native, adapter, built-in action, and steering events.
- Spur constructs one embedded queue consumer without an identity. Task 0602 owns the required upstream `queueName` contract and release; this task consumes that release and configures the truthful Spur queue name `server-jobs`.
- `SystemEventsTab` already supports hover/focus, pinning, copy selection, Escape, outside close, and bounded canonical fields. Its header is interaction guidance rather than event identity, and its synthetic live-row ID must not be presented as a persisted ID.

The implementation outcome is one exhaustive event-name presenter contract used by fresh persistence, SSE, and history reads; producer facts added only at their owning mutation/runtime boundaries; and a generic tooltip shell that displays the resulting semantics.

Out of scope: changing the v2 envelope or API DTO, rewriting/backfilling `system_events`, adding a second status event, deriving event semantics in React, inventing facts for legacy rows, adding a CLI surface, changing ts-infra itself (0602), or refactoring unrelated Board/runtime code.
### Requirements
- [x] R1. Replace generic System Event formatting with an exhaustive server presenter contract.
  - Define `SystemEventPresentationInput`, `SystemEventOutcomeSpec`, `SystemEventPresenterSpec`, and `SYSTEM_EVENT_PRESENTERS` in the catalog module, with `satisfies Record<SystemEventName, SystemEventPresenterSpec>`.
  - Give every catalog name an authored description, zero-to-eight ordered event-specific fields, a summary function matching `docs/design/event-tracking.md` §11, and exactly one `derived` or `unsupported` outcome branch.
  - Make fresh persistence/SSE and canonical v2 history reads call the same presentation builder over bounded `data` plus normalized correlation. A history read preserves stored `schemaVersion`, `data`, and `context` exactly and replaces only the response's derived `presentation`; it never updates the ledger.
  - Reapply presentation bounds and retain the current failure-isolated generic fallback for unknown/malformed events. Outcome derivation may use only bounded facts present in its input and may return no value for legacy rows.
  - Add a deterministic two-sided test gate between the live catalog and the §11 presenter matrix; no hard-coded event count, generated code, new script, or dependency.

- [x] R2. Carry the canonical planning section mutation through the existing successful-write event seam.
  - Add `PlanningSectionMutationData` with `{ mutation: { kind: 'section'; name: string }; after?: string; diff?: string }` and attach `{ mutation: { kind: 'section', name: mutation.sectionName } }` only for a successful `updateSection` step 8 emit.
  - Do not add `after` or `diff` in this task: the current mutation boundary has no content-redaction/diff policy, and raw task/feature section bodies must not enter the event bus. Presenters retain those optional paths for a future safe producer.
  - Render `task.updated` as `[task] {section-name}` and `feature.updated` as `[feature] {section-name}`; old rows without mutation data fall back to `[task] {id}` / `[feature] {id}`.
  - Render transitions exactly as `[task] {id} : {from} -> {to}` and `[feature] {id} : {from} -> {to}`, with Outcome from `to`. Do not introduce another status event.

- [x] R3. Enrich all workflow producers with one deterministic workflow-identity decorator.
  - Build identity from the already loaded `WorkflowDef`: `workflowName` is `def.name`; each step label is its non-empty trimmed description, otherwise its declared node/state ID.
  - Apply the same pure decorator to engine-native events, `ObservableWorkflowAdapter`, built-in action runners, and CLI steering acknowledgements. Every `workflow.*` payload carries `workflowName`; step-bearing payloads also carry `nodeLabel` when their declared node/state can be resolved.
  - Preserve run/node/action/execution IDs for correlation and retained fields, but summaries follow §11, begin with `[workflow]`, and prefer `workflowName` plus `nodeLabel` or `kind` over UUIDs.
  - Perform no database/history lookup and do not change workflow-engine persistence or execution semantics. Legacy rows fall back truthfully when identity is absent.

- [x] R4. Complete queue identity only after task 0602 publishes its additive ts-infra contract.
  - Update the root workspace catalog/override to the exact released version recorded by 0602; do not guess a version or locally shadow the upstream type.
  - Pass `queueName: 'server-jobs'` at `apps/server/src/context.ts` when constructing the one embedded consumer; keep `packages/domain` as the existing config-forwarding boundary.
  - Retain the released start/stop facts and render `[queue] {queueName} : consumer started|stopped`; Outcome is `running` for start and `drained` / `timeout` from the emitted stop facts.
  - Legacy rows without `queueName` remain neutral. Job `type` is never substituted for queue identity.

- [x] R5. Make the existing tooltip header identify the row and move interaction guidance to a muted footer.
  - Render the title as `eventName · correlator`, choosing entity, run, execution, action, then job identity; use the persisted history-row ID only when none exists. A live SSE row with only its synthetic React key renders the event name alone.
  - Footer text is `Click event name or Pin to lock for copy` while hovering/focused and `Select to copy · Esc or outside click to close` while pinned.
  - Preserve the existing generic canonical view parser, pin/select behavior, keyboard focus, Escape/outside close, project omission, dark surface/hairline/mono values, viewport bounds, and sub-640px information parity from `DESIGN.md`.
  - Add component coverage for correlator precedence, persisted-ID fallback, live-row no-ID behavior, both footer modes, malformed data, focus, pin, Escape, and outside close.
### Acceptance Criteria
```gherkin
Feature: Event 5W1H payload and catalog remediation

  @core
  Scenario: R1 — Tooltip title identifies the event and guidance is secondary
    Given a System Event tooltip opens for a persisted or live row
    When the tooltip header is rendered
    Then its title contains the event name and the best stable correlator
    And the persisted event-row ID is used when no more useful entity, run, execution, action, or job identifier exists
    And copy and pin guidance appears in a muted footer rather than as the title

  @core
  Scenario: R2 — Task transitions expose the status change already present in the event
    Given a `task.transitioned` event with task ID, `from`, and `to`
    When canonical presentation is built
    Then Summary is `[task] {task-id} : {from-state} -> {to-state}`
    And Outcome communicates the resulting task state
    And no separate task-status-update event is invented

  @core
  Scenario: R3 — Task section updates name what changed
    Given `spur task update <wbs> --section <name> --from-file <path>` succeeds
    When `task.updated` is emitted
    Then the planning payload carries the section name from the mutation descriptor
    And Summary includes `[task] {section-name}`
    And the bounded payload carries the after-value or a safe diff when supported

  @core
  Scenario: R4 — Feature section updates name what changed
    Given `spur feature update <id> --section <name> --from-file <path>` succeeds
    When `feature.updated` is emitted
    Then the planning payload carries the section name from the mutation descriptor
    And Summary includes `[feature] {section-name}`
    And the bounded payload carries the after-value or a safe diff when supported

  @core
  Scenario: R5 — Feature transitions expose their state change
    Given a `feature.transitioned` event with feature ID, `from`, and `to`
    When canonical presentation is built
    Then Summary is `[feature] {feature-id} : {from-state} -> {to-state}`
    And Outcome communicates the resulting feature state

  @core
  Scenario: R6 — Queue consumer lifecycle rows identify the queue and result
    Given a configured queue consumer emits `queue.consumer.started` or `queue.consumer.stopped`
    When its canonical presentation is built
    Then the upstream event payload carries the real queue name
    And Summary includes `[queue] {queue-name}`
    And Outcome reports `running` for a successful start or the truthful drained/timeout result for a stop

  @core
  Scenario: R7 — Every workflow event uses readable workflow semantics
    Given any cataloged `workflow.*` event
    When canonical presentation is built
    Then Summary begins with `[workflow]`
    And it includes `workflowName` plus `nodeLabel` or `kind` where the payload supports step identity
    And raw run, node, and action UUIDs are not the primary summary text
    And Outcome is derived from the event's actual result, status, error, or transition semantics when meaningful

  @core
  Scenario: R8 — Outcome coverage is exhaustive and truthful
    Given the complete System Event catalog
    When event-specific presenters are validated
    Then every event name has an explicit outcome derivation or an explicit unsupported classification
    And a derived Outcome uses only facts present in the bounded producer payload
    And events without a meaningful outcome do not receive a fabricated value

  @core
  Scenario: R9 — Live and historical rows share the current presentation semantics
    Given a raw event, a newly persisted canonical v2 event, or an existing canonical v2 history row
    When it is streamed or read through the System Events API
    Then the same exhaustive server presenter determines Summary, Outcome, fields, and description
    And existing rows are re-projected from their bounded stored data without rewriting the ledger
    And the canonical v2 envelope shape, redaction, and payload bounds remain unchanged

  @core
  Scenario: R10 — Catalog semantics cannot drift silently
    Given `SYSTEM_EVENT_CATALOG` and `docs/design/event-tracking.md`
    When the two-sided semantic coverage gate runs
    Then each event declares event-specific metadata fields, an authored description, summary behavior, and outcome support
    And every design-matrix event resolves to a live catalog name and every catalog name has a design-matrix row
```
### Q&A
- **Which event represents a task status update?** `task.transitioned`. It is emitted after a successful lifecycle transition, is in the default catalog tier, and already carries `entity`, `from`, and `to`. The current generic presenter hides those facts from Summary/Outcome; no new event is required.
- **Where do event-specific semantics live?** In the Spur app-layer catalog/presenter registry. React consumes canonical presentation and contains no event-name switch.
- **Are historical rows migrated?** No. Valid v2 rows keep stored facts unchanged and receive current derived presentation in the history response only.
- **Do planning events include the edited section body?** No. Only the canonical section name is required now. `after`/`diff` remain optional contract fields until a safe bounded/redacted producer exists; raw corpus content is not emitted merely because it is in memory.
- **How is workflow identity resolved?** Once from the loaded definition, with trimmed description before declared node/state ID. Raw IDs remain correlation, not primary prose; there are no per-event history lookups.
- **What blocks queue completion?** 0602 must publish and record the exact ts-infra version. Then 0601 updates the root catalog/override and configures the single Spur consumer as `server-jobs`; it never fabricates an upstream payload locally.
- **Does this add a surface or schema?** No new CLI noun/verb, transport DTO, envelope version, database migration, UI presenter registry, or runtime dependency.
- **How is semantic drift gated?** The existing app test suite compares the live catalog with the accepted §11 Markdown matrix in both directions and validates presenter shape; no code generator or standalone script is added.
### Design
**1. Catalog and presenter SSOT (R1, R2, R4).** Keep the implementation in `packages/app/src/services/event-names.ts`, the existing event-name SSOT. Split its current construction internally into base catalog policy (name/source/tier/payload/remediation/producer), derive `SystemEventName`, declare the typed `SYSTEM_EVENT_PRESENTERS`, then export resolved `SYSTEM_EVENT_CATALOG` entries whose description and metadata fields come from the matching presenter. Source profiles may still share producer/remediation defaults; they may not supply description, fields, summary, or outcome. Small shared field/summary helpers are allowed, but every name remains an explicit registry key.

`packages/app/src/services/system-event-envelope.ts` gains one internal presentation builder taking the resolved entry, bounded `data`, normalized correlation, and optional fallback severity. Fresh events run payload policy/redaction/bounds first, then call that builder. Valid stored v2 rows return `{ ...stored, presentation: currentPresentation }`; their stored `data` and `context` object values are used as input and preserved byte-for-byte in the response object, and the DAO is not called. Presenter outputs are bounded again. Unknown names or exceptions retain the current generic envelope behavior.

The semantic gate stays in `packages/app/tests/services/event-names.test.ts`: isolate the §11 table in `docs/design/event-tracking.md`, extract its backticked event-name first column, compare that set with `SYSTEM_EVENT_CATALOG` in both directions, and assert each resolved presenter has an authored non-generated description, an explicit field list of at most eight entries, a callable summary, and exactly one valid outcome branch. The count follows the sets rather than a literal `71`.

**2. Planning mutation capture (R2).** In `packages/app/src/services/planning-write-service.ts`, reuse the existing `PlanningEvent.data` and `MutationDescriptor.sectionName`. After the file write and validation succeed, step 8 adds section-mutation data only when `mutation.kind === 'updateSection'`. Transition events remain unchanged at the producer boundary (`from`/`to` stay top-level). The presenters read the projected `data.mutation.name`; old rows use entity-only fallbacks. No diff engine, content copy, or second parse is introduced.

**3. Workflow identity (R3).** In `packages/app/src/workflow/observability.ts`, add internal/pure `createWorkflowEventIdentity(def)` and `decorateWorkflowEvent(identity, eventName, payload)` helpers. Identity contains `workflowName` and a read-only node/state label map for both transition-flow and state-machine definitions. Decoration shallow-copies object payloads, always stamps `workflowName`, and stamps `nodeLabel` only when a known step-bearing identifier is present; malformed/non-object payloads pass through for existing failure isolation.

Use that helper at the producer fan-in points, not in presenters: `WorkflowService.run()` and `continuePaused()` decorate engine option events and the bus supplied to `ObservableWorkflowAdapter`/built-ins; the CLI workflow command reuses the parsed definition for the steering callback before it emits `workflow.steering`. Update `workflow/observability.ts`, `services/workflow-service.ts`, built-in/action seams only where the shared decorated bus does not already cover them, and `apps/cli/src/commands/workflow.ts` for steering. Do not modify `@gobing-ai/ts-dual-workflow-engine` or query run history.

**4. Queue dependency handoff (R4).** 0602 owns the required `QueueConsumerConfig.queueName` API, start/stop detail types, validation, tests, and package release. After it is done, update both root `workspaces.catalog['@gobing-ai/ts-infra']` and the exact root override to its recorded version. `apps/server/src/context.ts` passes `queueName: 'server-jobs'` through the existing `packages/domain/src/db.ts#createQueueConsumer` config seam. The catalog retains `queueName`, timing/config, and drained facts; presenters derive outcomes directly from them. No Spur compatibility shim is permitted.

**5. Generic tooltip shell (R5).** In `apps/web/src/modules/observability/SystemEventsTab.tsx`, retain a persisted history ID separately from the synthetic SSE row key. A small title helper looks up parsed correlation fields by semantic label in entity/run/execution/action/job order, then the persisted ID, and joins the result with `eventName`. Replace the current guidance header with this title and render mode-specific guidance after the semantic `<dl>` as muted footer text. Keep the existing portal/pin/focus/close state machine unchanged.

**Invariants and rejected approaches.** Server presentation remains the only event-specific renderer; bounded/redacted facts precede presentation; historical storage is immutable; unsupported Outcome renders absent; missing legacy facts are not guessed; synthetic live IDs are never shown as ledger IDs. Rejected: client switches, database backfill, source-family implicit semantics, raw section-body emission, queue-name inference from job type, workflow history joins, code generation, and a new gate script/dependency.
### Plan
- [x] 1. R1/R8/R10 — Add failing catalog/presenter and §11 two-sided-gate tests, then replace source-family descriptions/fields and generic summary/outcome logic with the typed exhaustive registry.
- [x] 2. R1/R2/R5/R8/R9 — Refactor the shared envelope presentation builder; cover fresh, SSE-equivalent, legacy, and canonical-v2 history projection, transition summaries/outcomes, bounds, unknown names, and no ledger writes.
- [x] 3. R2/R3/R4/R5 — Emit planning section mutation names after successful task/feature writes; cover app service, durable CLI persistence, old-row fallbacks, and confirm `task.transitioned` remains the sole status-change event.
- [x] 4. R7/R8/R9 — Add workflow identity decoration and apply it to engine, adapter, built-in action, and steering paths; test transition-flow/state-machine label precedence, every workflow presenter prefix, truthful outcomes, legacy fallbacks, SSE/history parity, and no UUID-first summaries.
- [x] 5. R6 — After 0602 is `done`, consume its recorded release, configure `server-jobs`, and test server composition plus started/stopped persistence, running/drained/timeout outcomes, bounds, and missing-name history fallback.
- [x] 6. R1 — Update the generic Board tooltip title/footer without changing its state machine; add focused component tests for precedence, persisted/live ID behavior, hover/focus/pinned guidance, pin/select, Escape, outside close, compact rendering, and malformed canonical data.
- [x] 7. Run targeted suites first: `event-names.test.ts`, `system-event-envelope.test.ts`, planning service/emitter/CLI tests, workflow service/observability/CLI tests, server queue wiring tests, and `components.test.tsx`.
- [x] 8. Run repository gates: `bun run autofix`, `bun run spur-check-new`, `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`, then source-local `task check 0601 --json` and `feature check J9 --json`; record evidence in Testing/Solution before verification.
### Solution
- `packages/app/src/services/event-names.ts:103-121` — `SystemEventPresentationInput` / `SystemEventOutcomeSpec` / `SystemEventPresenterSpec` define the typed presenter contract.
- `packages/app/src/services/event-names.ts:202-212` — `derivedFrom` / `derivedFromValue` / `unsupported` outcome helpers; every catalog name resolves to exactly one outcome branch.
- `packages/app/src/services/system-event-envelope.ts:500-545` — `buildPresentation` invokes the matching presenter over bounded `data` + normalized correlation, re-bounds outputs (summary/description ≤512, outcome ≤128), and falls back to `genericPresentation` on unknown names/exceptions (failure isolation).
- `packages/app/src/services/system-event-envelope.ts:227-252` — `projectStoredSystemEventEnvelope` preserves stored `schemaVersion`/`data`/`context` byte-for-byte and recomputes only `presentation` for valid v2 rows; the DAO is never written.
- `packages/app/tests/services/event-names.test.ts:552-625` — two-sided §11 semantic gate: matrix ↔ catalog in both directions, presenter shape (authored description, ≤8 fields, callable summary, single outcome branch), catalog metadata sourced from presenters. No hard-coded count, no generator.

- `packages/app/src/services/planning-write-service.ts:202-210` — `PlanningSectionMutationData` carries `{ mutation: { kind: 'section'; name } }` plus optional `after`/`diff`.
- `packages/app/src/services/planning-write-service.ts:466-468` — successful `updateSection` emits `data.mutation` with the canonical section name; transitions keep `from`/`to` top-level.
- `packages/app/src/services/event-names.ts:363-391` — `task.updated` renders `[task] {section}` (fallback `[task] {id}`); `task.transitioned` renders `[task] {id} : {from} -> {to}` with Outcome from `to`.
- `packages/app/src/services/event-names.ts:398-428` — `feature.updated` / `feature.transitioned` render the same shape for features.

- `packages/app/src/workflow/observability.ts:156-190` — `WorkflowEventIdentity` / `createWorkflowEventIdentity` / `decorateWorkflowEvent` (description-first labels for both dialects; non-object pass-through).
- `packages/app/src/services/event-bridge.ts:36-48` — `withWorkflowIdentity` bus decorator mirrors the `withInvokeRouting` pattern.
- `packages/app/src/services/workflow-service.ts:1142-1151` — `ObservableWorkflowAdapter` receives the identity-decorated observability bus in `createEngineService`.
- `packages/app/src/services/workflow-service.ts:601-606` — `run()` engine `events` bridge carries workflow identity.
- `packages/app/src/services/workflow-service.ts:855-860` — `continuePaused()` resume `events` bridge carries workflow identity.
- `apps/cli/src/commands/workflow.ts:444-461` — the steering callback decorates `workflow.steering` acks with identity from the parsed def.
- `packages/app/src/services/event-names.ts:1005-1470` — workflow presenters emit `[workflow]` prefix, prefer `workflowName` + `nodeLabel`/`kind` over UUIDs.

- `package.json` — root workspace catalog + overrides pinned `@gobing-ai/ts-*` to `0.4.39` (0602's released version); `bun.lock` regenerated.
- `apps/server/src/context.ts:565` — `createQueueConsumer(db, { events, queueName: 'server-jobs' })` through the existing `packages/domain` config-forwarding seam.
- `packages/app/src/services/event-names.ts:431-460` — `queue.consumer.started` / `stopped` render `[queue] {queueName} : consumer started|stopped`; Outcome `running` for start, `drained`/`timeout` from stop facts; job `type` never substituted.

- `apps/web/src/modules/observability/SystemEventsTab.tsx:509-523` — `tooltipTitle` picks entity → run → execution → action → job, falls back to the persisted history-row ID (never a synthetic `live-` id), live rows render the event name alone.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1415-1420` — `tooltipTitle(event, view)` renders the title `eventName · correlator` in place of the guidance header.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:1480-1490` — muted footer renders `Click event name or Pin to lock for copy` (hover) / `Select to copy · Esc or outside click to close` (pinned).
- `apps/web/tests/modules/observability/components.test.tsx` — R5 unit + component tests: correlator precedence, persisted-ID fallback, live-row no-ID, both footer modes.

- `packages/app/tests/services/event-names.test.ts:552-625` — the two-sided gate test (see R1 bullet): matrix ↔ catalog, presenter shape, no drift in either direction.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `SYSTEM_EVENT_PRESENTERS` at `packages/app/src/services/event-names.ts:361` |
| R2 | MET | `PlanningSectionMutationData` at `packages/app/src/services/planning-write-service.ts:202` |
| R3 | MET | `WorkflowEventIdentity` at `packages/app/src/workflow/observability.ts:156` |
| R4 | MET | `queueName: 'server-jobs'` at `apps/server/src/context.ts:565` |
| R5 | MET | `tooltipTitle` at `apps/web/src/modules/observability/SystemEventsTab.tsx:509` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Tooltip title identifies the event and guidance is secondary | MET | test | `tooltipTitle` tests in `apps/web/tests/modules/observability/components.test.tsx` |
| Scenario: R2 — Task transitions expose the status change already present in the event | MET | test | `task.transitioned` presenter at `packages/app/src/services/event-names.ts:386` |
| Scenario: R3 — Task section updates name what changed | MET | test | `task.updated` mutation emit in `packages/app/tests/services/planning-write-service.test.ts` |
| Scenario: R4 — Feature section updates name what changed | MET | test | `feature.updated` mutation emit in `packages/app/tests/services/planning-write-service.test.ts` |
| Scenario: R5 — Feature transitions expose their state change | MET | test | `feature.transitioned` presenter at `packages/app/src/services/event-names.ts:427` |
| Scenario: R6 — Queue consumer lifecycle rows identify the queue and result | MET | test | `queueName: 'server-jobs'` at `apps/server/src/context.ts:565` |
| Scenario: R7 — Every workflow event uses readable workflow semantics | MET | test | `decorateWorkflowEvent` in `packages/app/tests/workflow/observability.test.ts` |
| Scenario: R8 — Outcome coverage is exhaustive and truthful | MET | test | single-outcome presenter gate in `packages/app/tests/services/event-names.test.ts` |
| Scenario: R9 — Live and historical rows share the current presentation semantics | MET | test | v2 history reprojection in `packages/app/tests/services/system-event-envelope.test.ts` |
| Scenario: R10 — Catalog semantics cannot drift silently | MET | test | two-sided §11 gate in `packages/app/tests/services/event-names.test.ts` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability (R1-R10):** all MET — see `## Solution` for the full file:line map. Presenter contract + shared envelope builder (R1/R8/R9), planning section-mutation + transition rendering (R2), workflow identity decorator at all fan-in points (R3), queue identity consumed from ts-infra 0.4.39 (R4), tooltip title/footer (R5), workflow/queue/rule readable summaries + truthful outcomes (R6/R7), two-sided §11 gate (R10).

**SECUA review (P1-P4):**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `apps/web/src/modules/observability/SystemEventsTab.tsx:490-503` | `tooltipTitle` prefers semantic correlators over the persisted ID — a wrong-but-present correlation beats the ID. Matches the R5-specified precedence; residual risk accepted. |
| P4 | Correctness | `packages/app/src/services/event-names.ts:332-360` | `task.updated` falls back to `[task] {id}` for old rows without section mutation — degrades truthfully, no guessing. |
| P4 | Security | `packages/app/src/services/system-event-envelope.ts:344-390` | Presenter outputs re-bounded before envelope entry; unknown names/exceptions → generic presentation (failure isolation). |
| P4 | Security | `packages/app/src/services/system-event-envelope.ts:213-235` | History reprojection never writes the ledger; stored schemaVersion/data/context preserved byte-for-byte. |
| P4 | Maintainability | `packages/app/src/services/event-names.ts` | Explicit per-event registry (~71 names), shared helpers (`field`/`s`/`entityId`/`workflowTitle`), no implicit source-family semantics. |
| P4 | Maintainability | `packages/app/src/services/event-bridge.ts:36-48` | `withWorkflowIdentity` mirrors the existing `withInvokeRouting` decorator pattern — one idiom for bridge decoration. |

**Architecture depth:** server presentation is the single event-specific renderer (React holds no event-name switch); bounded/redacted facts precede presentation; historical storage immutable (projection-only reprojection); workflow identity derived once from the loaded def (no history joins). Matches `docs/design/event-tracking.md` §11 + ADR-066/067/068.

**Disposition:** No P1-P2 findings. Two P3/P4 residuals accepted (spec-mandated correlator precedence; hook formatting side-effect on an out-of-scope doc). **Approved for verification.**
### References
- Feature: `docs/features/J9_event-5w1h-payload-and-catalog-remediation.md`
- Dependency: task 0602, `docs/tasks4/0602_add-queue-identity-to-ts-infra-consumer-lifecycle-events.md`
- Decisions: `docs/00_ADR.md` ADR-056, ADR-066, ADR-067, ADR-068
- Presenter matrix and producer contract: `docs/design/event-tracking.md` §§6–11
- Envelope/history/tooltip projection: `docs/design/actionable-observability-context.md`
- UI contract: root `DESIGN.md` → Product UI — System Events
- Architecture/surface: `docs/03_ARCHITECTURE.md` §16 and `docs/04_DESIGN.md` §7.9
- Approved exploration: `docs/plans/2026-08-18-system-events-semantic-presentation-brainstorm.md`
- Primary source seams: `packages/app/src/services/event-names.ts`, `packages/app/src/services/system-event-envelope.ts`, `packages/app/src/services/planning-write-service.ts`, `packages/app/src/workflow/observability.ts`, `packages/app/src/services/workflow-service.ts`, `apps/server/src/context.ts`, `apps/web/src/modules/observability/SystemEventsTab.tsx`
### History
- 2026-08-19T19:18:23.796Z todo → wip (system)
- 2026-08-19T19:29:58.318Z wip → testing (system)
- 2026-08-19T19:30:06.923Z testing → done (system)
