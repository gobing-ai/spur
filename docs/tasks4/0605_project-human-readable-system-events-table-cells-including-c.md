---
schema_version: 1
name: "Project human-readable System Events table cells including coding-agent identity"
status: done
template: feature-impl
created_at: 2026-08-19T21:01:14.733Z
updated_at: "2026-08-24T20:43:31.025Z"
feature_id: J91
priority: P2
tags: ["system-events", "observability", "presentation"]
---

## 0605. Project human-readable System Events table cells including coding-agent identity

### Background
J91 deepens the J9 presenter and envelope path so Observability > System Events table cells are human-readable: workflow definition and step in Summary, human correlators in Correlation and Action, and a dedicated Agent column when coding-agent identity already exists on the payload. J9 stays done. Envelope v2 is unchanged; presentation is re-projected on read. Tooltip and expanded payload remain the home for raw ids.

Current-tree premises verified 2026-08-19:

- `workflowTitle` (`packages/app/src/services/event-names.ts:159`) returns `data.workflowName`, else `correlation.runId`. Missing names become the run UUID in Summary.
- `stepName` (`event-names.ts:164`) returns `nodeLabel`, else `kind`, else `node`. Action `kind` (`agent.run`) and UUID-shaped `node` can become the Summary step.
- `decorateWorkflowEvent` (`packages/app/src/workflow/observability.ts:180`) already stamps `workflowName` and description-first `nodeLabel`. `run()` / `continuePaused()` wrap engine-native emits. `createEngineService` still wraps the adapter bus only when `opts.extensions` is set (`workflow-service.ts:1148`).
- `projectActionMetadata` already copies `options.agent` / `options.role` onto `metadata.*`. `withInvokeRouting` already merges `routing.executor` onto `agent.invoke.*`. Presenter `fields` is both tooltip (max 8) and metadata allow-list (`resolveCatalogEntry` uses `presenter.fields` only), so those agent paths can be dropped before projection.
- `PRESENTATION_KEYS` is `{severity, summary, description, fields, outcome, action}` (`system-event-envelope.ts:131`). Table Correlation concatenates `context.correlation` UUIDs (`SystemEventsTab.tsx:424`). Action cells render `presentation.action.value` (`SystemEventsTab.tsx:1619`), which for `workflow-trace` is `spur workflow trace <runId>`.
- Row `actor` exists on history/SSE but is not a table column. `buildSystemEventEnvelope` does not take `actor`.

Implements feature J91 scenarios R1–R8 (titles below). Authority: `docs/design/system-events-human-table.md` (ADR-073/074). Brainstorm Approach 1 (server-owned table projection). Board-only UUID stripping and a new envelope `context` slot stay rejected.

Sizing: E3 D1 L2 C0 R1 = 7. Helpers, table projector, Agent retain, and producer audit all edit `event-names.ts`, `system-event-envelope.ts`, and `SystemEventsTab.tsx` and are unreadable apart — kept as one task. A ts-libs producer upgrade is a Plan fallback inside this task, not a sibling.

Out of scope: reopening J9; a new envelope schema or transport; new CLI nouns; client-only UUID stripping; ledger rewrite or invented historical facts; unrelated Board tabs.
### Requirements
- [x] R1. Replace `workflowTitle` / `stepName` UUID and `kind` fallbacks with `humanWorkflowTitle`, `humanStepLabel`, and `looksLikeOpaqueId` so every cataloged `workflow.*` Summary follows `[workflow] {workflowName} · {human step} {result}` when those facts exist, omits a missing name or step (including the ` · ` separator), and never substitutes `runId`, `eventId`, `actionId`, a UUID-shaped `node`, or action `kind` as the step.
- [x] R2. After the event-name presenter, `projectTablePresentation` writes `presentation.correlators`, `presentation.actionLabel`, and `presentation.agent` from bounded `data` (plus optional persistence-row `actor`) with no opaque ids in those strings. Action is the action name (`kind`), entity, or a short human verb, never a remediation command that embeds a UUID. Tooltip `fields` and `presentation.action` remain the home for raw ids and those commands.
- [x] R3. Project Agent in order from `data.routing.executor`, then `data.agent`, then `data.metadata.agent`, then executor-shaped row `actor`; never `context.producer.package`. Omit the key (blank cell, not `-`) when the event has no executor, including pure engine rows such as `workflow.node.enter` and `workflow.transition`.
- [x] R4. Add optional `retain` on `SystemEventPresenterSpec` so catalog `metadataFields` = `fields` ∪ `retain`. Agent-executed workflow presenters retain `metadata.agent`, `metadata.role`, and `routing.executor`. Stamp identity at existing Spur fan-ins (`withWorkflowIdentity` on every engine-native and adapter emit that has a loaded `WorkflowDef`, `projectActionMetadata`, invoke routing). Keep `SystemEventEnvelopeV2.context` as `{project, producer, correlation}`. Upgrade a ts-libs producer contract only if that Spur path cannot emit any of the four Agent sources for an agent-executed event Spur already fans in.
- [x] R5. Use the same presenter and `projectTablePresentation` for fresh SSE/persistence and canonical v2 history reads: re-project `presentation` only, do not rewrite stored `data` / `context` or the ledger, and omit missing historical workflow name, step label, or agent identity rather than inventing them.
- [x] R6. Map server-projected Summary, `correlators`, `actionLabel`, and `agent` into Board columns `Time | Severity | Event | Summary | Producer | Correlation | Agent | Outcome | Action` (compact ≤639px stacks Summary, Correlation, Action, and Agent under the event name) without recovering names or agent identity from raw payload keys and without client-only UUID stripping.
### Acceptance Criteria
```gherkin
Feature: System Events human-readable table: workflow identity, id-free columns, and coding-agent

  @core
  Scenario: R1 — Workflow summaries name the definition and human step without opaque ids
    Given any cataloged `workflow.*` event
    When canonical presentation is built
    Then Summary follows `[workflow] {workflowName} · {human step or state description and result}` when those facts exist
    And `workflowName` is the definition file or name (for example `idea-pipeline`), never a run id
    And a missing name or step is omitted, including its separator, rather than replaced with `runId`, `eventId`, `actionId`, or a UUID-shaped `node`
    And action `kind` is not used as a substitute for the step description in Summary

  @core
  Scenario: R2 — Correlation and Action columns show human correlators, not opaque ids
    Given live or historical System Events table rows
    When the table cells are rendered
    Then no column displays `eventId`, ledger row id, `runId`, `executionId`, `actionId`, a UUID-shaped `node`, or a `live-` prefixed token
    And CORRELATION shows human correlators already in bounded data: workflow or run name, step label, action name (`kind`), and entity
    And a numeric sequence correlator may remain
    And entity values such as a task WBS or feature id remain visible
    And ACTION shows the action name, entity, or a short human verb
    And a remediation command that embeds a UUID, such as `spur workflow trace <runId>`, is not the Action column value

  @core
  Scenario: R3 — Tooltip and expanded payload remain the home for raw ids
    Given a System Event whose bounded payload includes machine correlators
    When the operator opens the tooltip or expanded detail
    Then raw ids (`eventId`, ledger row id, `runId`, `actionId`, UUID-shaped `node`) remain available there
    And remediation commands that embed those ids remain available there
    And the table cells stay human-readable

  @core
  Scenario: R4 — Agent column shows coding-agent identity from existing payload facts
    Given a System Event whose bounded payload already carries or can carry a coding-agent or executor identity
    When the System Events table is rendered
    Then a dedicated Agent column shows one bounded string projected by the server
    And the identity is taken in order from `data.routing.executor`, then `data.agent`, then `data.metadata.agent`, then row `actor` when that actor is an executor or agent id
    And `context.producer.package` is never used as the Agent value
    And the cell is empty when the event has no executor, including pure engine rows such as `workflow.node.enter` and `workflow.transition`

  @core
  Scenario: R5 — Agent identity is stamped and retained on the Spur-only path
    Given an agent-executed event that already carries or can carry coding-agent identity at an existing Spur fan-in
    When the envelope is persisted or streamed
    Then the relevant presenters retain `metadata.agent`, `metadata.role`, and `routing.executor` so the metadata allow-list does not drop them
    And identity is stamped at that Spur fan-in rather than inferred later by the Board
    And `SystemEventEnvelopeV2.context` still contains only project, producer, and correlation
    And a ts-libs producer-contract upgrade is used only when that Spur path cannot emit the identity

  @core
  Scenario: R6 — Live and historical rows share the current human projection without a ledger rewrite
    Given a newly persisted canonical v2 event or an existing canonical v2 history row
    When it is streamed or read through the System Events API
    Then the same server presenter determines Summary, Correlation, Action, Agent, and Outcome
    And presentation is re-projected from bounded stored data without rewriting the ledger
    And the canonical v2 envelope shape, redaction, and payload bounds remain unchanged
    And missing historical workflow name, step label, or agent identity is omitted, never invented

  @core
  Scenario: R7 — The Board renders server-projected cells and does not interpret raw payloads
    Given the Observability > System Events table
    When events are displayed from SSE or history
    Then the Board maps server-projected presentation into the table columns
    And it does not recover workflow names, step labels, or agent identity by interpreting raw payload keys
    And it does not hide ids by client-only UUID stripping that leaves presenter semantics unchanged

  @edge
  Scenario: R8 — Compact System Events layout stays human-readable
    Given the operator opens the System Events tab on a viewport at or below 639px
    When events are rendered
    Then stacked Summary, Correlation, Action, and Agent values omit opaque event ids
    And raw ids remain in the tooltip and expanded detail
```
### Q&A
- **Table projection lives on the server, not the Board.** Chose brainstorm Approach 1 / ADR-073: an envelope-level `projectTablePresentation` after the event-name presenter. Rejected Board-only UUID stripping (ADR-066: Board is a generic renderer; SSE/history/table would diverge; cannot recover `idea-pipeline` the presenter never emitted).
- **No new context slot.** Chose optional `presentation.correlators` / `actionLabel` / `agent` (schemaVersion stays 2). Rejected `context.human` / `context.executor` — `context` is closed `{project, producer, correlation}`; historical v2 rows cannot gain those keys without a rewrite.
- **Agent is presentation, not producer.** ADR-074: `presentation.agent` from `routing.executor` → `data.agent` → `metadata.agent` → executor-shaped row `actor`. Producer names the emitting package. Blank when the event has no executor (`workflow.node.enter`, `workflow.transition`).
- **Action column is the human verb, not the remediation command.** `presentation.action` stays tooltip remediation (`spur workflow trace <runId>`). The column reads `actionLabel`. This redefines the J5 table reading of Action; tooltip still has the command.
- **J91 under J9, not a J10 sibling.** DD-14: J already has nine children. Parent is encoded in the id (drop last character → J9). J9 work is not reopened except the named `workflowTitle` / `stepName` fallbacks.
- **ts-libs is a fallback, not the start.** Operator asked for a coding-agent column and allowed an upstream bump only if needed. Frozen: Spur fan-in + `retain` first; bump the owning `@gobing-ai/ts-*` payload only if an agent-executed event Spur already emits still has none of the four sources.
- **One task, not four seams.** Same files (`event-names.ts`, `system-event-envelope.ts`, `SystemEventsTab.tsx`); projector returns correlators/actionLabel/agent together; Board lands one column set. A producer-audit miss is a Plan step, not a sibling WBS.
- **Open questions: none.** Implement must not invent a second projector, a client stripper, or an envelope v3.
### Design
**WHAT.** Server-owned table projection on envelope v2: human workflow Summary, id-free Correlation/Action strings, optional Agent string. The Board maps those presentation keys. No new envelope `context` keys, no new CLI noun, no ledger rewrite.

**WHY.** J9 already prefixes `[workflow]` and prefers `workflowName` + `nodeLabel`, but `workflowTitle` still falls back to `correlation.runId` and `stepName` still falls back to `kind` / UUID `node`. The table then concatenates correlation UUIDs and renders `spur workflow trace <runId>` in Action. Operators cannot answer “which workflow, which step, which coding agent” from the grid. ADR-073/074 record the table-cell and Agent-projection decisions.

**WHERE (primary files).**

- `packages/app/src/services/event-names.ts` — opaque-id helpers, workflow Summary, `retain` on presenters, catalog `metadataFields` union.
- `packages/app/src/services/system-event-envelope.ts` — optional presentation keys, `projectTablePresentation`, `actor` into `buildPresentation` / builders.
- `packages/app/src/services/event-bridge.ts` + `packages/app/src/services/workflow-service.ts` — always wrap adapter+engine buses when a `WorkflowDef` is loaded.
- `packages/app/src/workflow/observability.ts` — already stamps `workflowName` / `nodeLabel` and `metadata.agent`; no new helper unless the audit proves a missing stamp.
- `apps/web/src/modules/observability/SystemEventsTab.tsx` — column mapping only.
- Tests: `packages/app/tests/services/event-names.test.ts`, `packages/app/tests/services/system-event-envelope.test.ts`, `packages/app/tests/workflow/observability.test.ts`, `packages/app/tests/services/workflow-service*.test.ts` (adapter wrap), `apps/web/tests/modules/observability/components.test.tsx`.

**Frozen names (implement these; do not invent siblings).**

- `looksLikeOpaqueId(value: string): boolean` — true for UUID `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}` (any case), prefix `live-`, or a cell that is only `eventId` / ledger row id / `runId` / `executionId` / `actionId`. Not opaque: workflow definition name (`idea-pipeline`), YAML description / declared state id, action `kind` (`agent.run`), entity WBS / feature id (`0605`, `J91`), numeric `sequence`.
- `humanWorkflowTitle(input)` — `data.workflowName` when present and not opaque; else `''`. Never `correlation.runId`. Replaces `workflowTitle` at every `workflow.*` Summary.
- `humanStepLabel(data)` — `data.nodeLabel` when present and not opaque; else `undefined`. Does not read `kind` or UUID-shaped `node`. Replaces `stepName` in Summary only (tooltip `fields` may still show `node` / `kind`).
- Summary grammar: `[workflow] {workflowName} · {humanStep} {result}`. Omit a missing slot and its ` · `. Result suffixes stay as today (`started`, `done`, `failed`, `{from} -> {to}`, …). Pin: `workflow.action.start` / `started` with `workflowName=idea-pipeline` and a long `nodeLabel` contains neither `runId` nor `eventId`.
- `SystemEventPresenterSpec.retain?: readonly SystemEventMetadataField[]` — extra metadata allow-list, not tooltip. Tooltip `fields` stay ≤8. `resolveCatalogEntry` sets `metadataFields` = `fields` ∪ `retain`. Do not add agent paths to `CORE_METADATA_PATHS`.
- Agent-executed workflow presenters (`workflow.action.start` / `started` / `done` / `finished` / `failed_continue` and any other `workflow.action.*` that can carry `agent.run` metadata) **retain** `metadata.agent`, `metadata.role`, `routing.executor`.
- `PRESENTATION_KEYS` and `SystemEventEnvelopeV2.presentation` gain optional `correlators?: string`, `actionLabel?: string`, `agent?: string`. `context` stays `{project, producer, correlation}`. `hasOnlyKeys` accepts the three new presentation keys.
- `projectTablePresentation({ data, correlation, presentation, actor? })` runs **after** the event-name presenter inside `buildPresentation`. Presenters do not each encode the opaque-id table policy.
  - `correlators`: join human facts already in bounded `data` — workflow name, step label, action `kind`, entity `kind:id`. Numeric `sequence` may remain. Forbidden: `runId`, `executionId`, `actionId`, `eventId`, UUID `node`, `live-` tokens, `context.correlation` UUIDs. Empty → omit (Board `displayValue` renders `-`).
  - `actionLabel`: action `kind`, entity, or a short human verb. Forbidden: `presentation.action.value` when it embeds a UUID. Empty → omit (`-` in the cell).
  - `agent`: first non-empty non-opaque of `data.routing.executor` → `data.agent` → `data.metadata.agent` → persistence-row `actor` when it matches `^[A-Za-z][A-Za-z0-9._-]*$` and is not a `SystemEventProducerPackage` string. Else omit. Pure engine rows (`workflow.node.enter`, `workflow.transition`) omit even when producer is `@gobing-ai/ts-dual-workflow-engine`.
- `buildSystemEventEnvelope` / `projectStoredSystemEventEnvelope` / `buildPresentation` take optional `actor?: string | null` from the tap or history row. It never enters `context`. History v2 still returns `{ ...stored, presentation }` with stored `data`/`context` byte-for-byte.
- `presentation.action` (remediation object, e.g. `spur workflow trace ${runId}`) is unchanged and tooltip/detail only.
- Board: `parseSystemEventView` is the single network-boundary narrow.
  - `view.correlation` ← `presentation.correlators` (stop concatenating `context.correlation` UUIDs). Keep `correlationFields` for tooltip title precedence (J9) — tooltip may still show run/action ids.
  - Action **column** ← `presentation.actionLabel` (not `presentation.action.value`).
  - `view.agent` ← `presentation.agent` (string or null). Agent **cell** renders `view.agent ?? ''` (blank), never `displayValue` (that would show `-`).
  - Desktop columns: `Time | Severity | Event | Summary | Producer | Correlation | Agent | Outcome | Action`. `colSpan` for expanded detail becomes 9 (was 8). Compact ≤639px keeps `Time | Event` and stacks Summary, Correlation, Action, Agent under the name.
- Producer stamp: in `createEngineService`, wrap `bus` with `withWorkflowIdentity(bus, def)` whenever a loaded `WorkflowDef` is available — not only `opts.extensions !== undefined`. `run()` / `continuePaused()` already pass `extensions: { workflow, file }` and already wrap engine-native `events`. Do not skip the adapter wrap. Do not modify `@gobing-ai/ts-dual-workflow-engine` unless the post-wrap audit shows an agent-executed event Spur fans in still has none of the four Agent sources.

**No new API.** No new CLI noun/verb/flag. No `context.human` / `context.executor`. No envelope v3. No new DTO table. Visual tokens stay in root `DESIGN.md` (reuse existing table typography; do not add a color token for Agent).

**Anti-patterns (do not implement).**

- Client regex that strips UUIDs from Summary / Correlation / Action / Agent.
- Board reading `event.actor` or `data.*` as an Agent fallback.
- Using `context.producer.package` / `subsystem` as Agent.
- Substituting action `kind` for the Summary step.
- Falling back Summary to `correlation.runId` / `event.id`.
- Rendering `presentation.action.value` in the Action column.
- Adding agent keys to `CORE_METADATA_PATHS` (would retain them on every event).
- Per-presenter copies of `correlators` / `actionLabel` / `agent` (one envelope projector).
- Rewriting stored v2 `data`/`context` or backfilling `system_events`.
- Inventing `workflowName` / `nodeLabel` / agent for historical rows that lack them.
- Starting with a ts-libs bump; that is a Plan fallback after the Spur fan-in audit fails.

**Handoff / deps.** No `dependencies[]`. Assumes J9 (0601/0602) presenter registry, envelope reprojection, and `decorateWorkflowEvent` stay as landed. Does not reopen J9 summaries except the `workflowTitle` / `stepName` fallbacks named above. Docs already pointed from `docs/04_DESIGN.md` §0 / §7.9 and `docs/03_ARCHITECTURE.md` §16.2; implement does not author a second satellite.

**ts-libs fallback (only if R4 audit fails).** If an agent-executed `workflow.action.*` or `agent.invoke.*` event that Spur already fans in still cannot emit `routing.executor` / `data.agent` / `metadata.agent` / executor-shaped `actor` after retain + wrap, add the missing scalar on the **domain payload** in the owning `@gobing-ai/ts-*` package and consume it in `data` — not a new envelope version. Record the package + field in Solution. If the Spur path works, write “no ts-libs upgrade” in Solution and stop.
### Plan
- [x] 1. R1 — Add `looksLikeOpaqueId`, `humanWorkflowTitle`, `humanStepLabel` in `event-names.ts`. Switch every `workflow.*` Summary off `workflowTitle` / `stepName`. Failing tests first: idea-pipeline `workflow.action.started` with long `nodeLabel` matches the grammar and contains neither run UUID nor event id; missing `workflowName` omits the name rather than substituting `runId`; `kind` is not the Summary step.
- [x] 2. R2 / R5 — Extend `SystemEventEnvelopeV2.presentation` + `PRESENTATION_KEYS` with optional `correlators`, `actionLabel`, `agent`. Add `projectTablePresentation` after the event-name presenter. Thread optional `actor` through `buildSystemEventEnvelope` / `projectStoredSystemEventEnvelope` / `buildPresentation` without putting it on `context`. Assert history v2 keeps stored `data`/`context` bytes and only replaces `presentation`. Empty correlators/actionLabel omit (Board `-`); opaque ids never appear in those strings; `presentation.action` still carries `spur workflow trace <runId>` for tooltip.
- [x] 3. R3 / R4 — Add `retain?` to `SystemEventPresenterSpec`; catalog `metadataFields` = `fields` ∪ `retain`. Retain `metadata.agent`, `metadata.role`, `routing.executor` on agent-executed `workflow.action.*` presenters. Project `presentation.agent` in the frozen order. Engine rows `workflow.node.enter` / `workflow.transition` omit Agent. Do not use `CORE_METADATA_PATHS`.
- [x] 4. R4 — Always wrap the adapter observability bus with `withWorkflowIdentity` when `createEngineService` has a loaded `WorkflowDef` (`workflow-service.ts:1148` ternary). Keep existing `run()` / `continuePaused()` engine-event wraps. Audit one agent-executed action payload: if none of the four Agent sources exist after wrap+retain, only then take the ts-libs fallback in Design; otherwise record “no ts-libs upgrade”.
- [x] 5. R6 / R7 / R8 — `parseSystemEventView` maps `correlators` / `actionLabel` / `agent`. Desktop adds Agent between Correlation and Outcome (9 columns; expanded `colSpan` 9). Action column uses `actionLabel`. Agent cell is blank when omitted. Compact stacks Summary, Correlation, Action, Agent. No client UUID stripper; no raw `data.*` recovery. Tooltip title/footer (J9) may still show run/action ids.
- [x] 6. Tests — targeted first: `event-names.test.ts` (Summary grammar + retain/catalog union), `system-event-envelope.test.ts` (projector, actor, history reprojection, `hasOnlyKeys`), workflow wrap (`observability.test.ts` / workflow-service tests), `components.test.tsx` (columns, Agent blank vs `-`, compact, Action not `spur workflow trace <uuid>`). Then one confirming `bun run lint` / targeted bun test; full `spur-check` is the pipeline gate, not this refine.
### Solution
- `packages/app/src/services/event-names.ts:164-190` — Added `looksLikeOpaqueId`, `humanWorkflowTitle`, `humanStepLabel`. Replaced `workflowTitle` and `stepName` across all `workflow.*` presenters so Summary follows `[workflow] {workflowName} · {humanStep} {result}` without opaque machine IDs.
- `packages/app/src/services/event-names.ts:118` — Extended `SystemEventPresenterSpec` with optional `retain?: readonly SystemEventMetadataField[]`. Updated `resolveCatalogEntry` (line 1597) to set `metadataFields` to the union `presenter.fields ∪ presenter.retain`. Retained `metadata.agent`, `metadata.role`, `routing.executor` on agent-executed action presenters.
- `packages/app/src/services/system-event-envelope.ts:72-85,129-139` — Added optional `correlators?: string`, `actionLabel?: string`, `agent?: string` to `SystemEventEnvelopeV2.presentation`, updated `PRESENTATION_KEYS`, and added validation in `isValidPresentation`.
- `packages/app/src/services/system-event-envelope.ts:384-460` — Implemented `projectTablePresentation` projecting `correlators` from human facts in bounded data, `actionLabel` from action kind/verb (excluding remediation commands with UUIDs), and `agent` from `routing.executor` → `data.agent` → `data.metadata.agent` → actor (omitted on pure engine rows). Integrated into `buildPresentation`.
- `packages/app/src/services/system-event-envelope.ts:198-252` — Threaded optional `actor?: string | null` through `buildSystemEventEnvelope` and `projectStoredSystemEventEnvelope` without opening `context`. Stored history v2 preserves `data` and `context` bytes byte-for-byte; only `presentation` is re-projected on read.
- `apps/server/src/modules/events/index.ts:212-216,328-335` — Threaded actor into buildSystemEventEnvelope and projectStoredSystemEventEnvelope.
- `packages/app/src/services/system-event-tap.ts:81-88` — Threaded actor into buildSystemEventEnvelope.
- `apps/web/src/modules/observability/SystemEventsTab.tsx:20-33,434-460,1162-1207,1584-1650` — Updated `SystemEventView` and `parseSystemEventView` to map `correlation`, `actionLabel`, and `agent`. Updated table layout to 9 columns (`Time | Severity | Event | Summary | Producer | Correlation | Agent | Outcome | Action`), rendered Agent cell blank when omitted (`view.agent ?? ''`), rendered Action cell with `actionLabel`, updated expanded detail `colSpan` to 9, and stacked `agent` when present in compact layout.
- Producer audit: all Spur fan-in points (`withWorkflowIdentity` on engine/adapter buses, `projectActionMetadata`, `withInvokeRouting`) provide agent and workflow identity. No ts-libs contract upgrade required.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/event-names.ts:164-199` looksLikeOpaqueId humanWorkflowTitle humanStepLabel omit opaque runId kind UUID node |
| R2 | MET | `packages/app/src/services/system-event-envelope.ts:380-503` projectTablePresentation correlators actionLabel agent without opaque ids |
| R3 | MET | `packages/app/src/services/system-event-envelope.ts:392-433` Agent projection routing.executor data.agent metadata.agent actor omit pure engine rows |
| R4 | MET | `packages/app/src/services/event-names.ts:114-121` SystemEventPresenterSpec retain metadata.agent metadata.role routing.executor |
| R5 | MET | `packages/app/src/services/system-event-envelope.ts:227-252` projectStoredSystemEventEnvelope re-project presentation without rewriting stored data context ledger |
| R6 | MET | `ALL_COLUMNS` at `apps/web/src/modules/observability/ColumnCustomizer.tsx:25-106` defines the Time, Severity, Event, Summary, Correlation, Outcome, Agent, Producer, Action, and Actor columns consumed by System Events |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Workflow summaries name the definition and human step without opaque ids | MET | test | `packages/app/tests/services/event-names.test.ts:632-667` looksLikeOpaqueId humanWorkflowTitle humanStepLabel opaque ids |
| R2 — Correlation and Action columns show human correlators, not opaque ids | MET | test | `packages/app/tests/services/system-event-envelope.test.ts:260-289` projectTablePresentation correlators actionLabel without opaque IDs |
| R3 — Tooltip and expanded payload remain the home for raw ids | MET | test | `apps/web/tests/modules/observability/components.test.tsx:729-786` expanded detail keeps run-42 tooltip payload ids |
| R4 — Agent column shows coding-agent identity from existing payload facts | MET | test | `packages/app/tests/services/system-event-envelope.test.ts:260-289` agent routing.executor |
| R5 — Agent identity is stamped and retained on the Spur-only path | MET | test | `packages/app/tests/services/event-names.test.ts:618-630` retain catalog metadataFields |
| R6 — Live and historical rows share the current human projection without a ledger rewrite | MET | test | `packages/app/tests/services/system-event-envelope.test.ts:140` re-projects only presentation on history row |
| R7 — The Board renders server-projected cells and does not interpret raw payloads | MET | test | `apps/web/tests/modules/observability/system-events-tab.test.ts:87-110` parseSystemEventView maps correlators actionLabel agent |
| R8 — Compact System Events layout stays human-readable | MET | test | `apps/web/tests/modules/observability/components.test.tsx:635` compact two columns human-readable stack |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**Functional traceability (R1-R6 / scenarios R1-R8):** all MET — server-owned table presentation projection implemented via `projectTablePresentation`, opaque ID filtering via `looksLikeOpaqueId`, clean workflow summary grammar without UUID fallbacks, 9-column desktop table layout with Agent column and human Action labels, compact layout stacking, and complete backward-compatible history reprojection without modifying stored bytes.

**SECUA review (P1-P4):**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | Correctness | `packages/app/src/services/system-event-envelope.ts:384-460` | `projectTablePresentation` filters out opaque machine IDs and handles missing fields gracefully with undefined/empty fallbacks. |
| P4 | Security | `packages/app/src/services/system-event-envelope.ts:198-252` | Bounded strings enforced on all table presentation properties (correlators <= 512, actionLabel <= 128, agent <= 128); secrets redacted before projection. |
| P4 | Maintainability | `packages/app/src/services/event-names.ts:118` | `retain` mechanism allows preserving agent metadata paths without exceeding the 8-field tooltip cap. |
| P4 | Architecture | `apps/web/src/modules/observability/SystemEventsTab.tsx` | Board acts as a pure presentation consumer without raw payload key scraping or client-side UUID regex munging. |

**Architecture depth:** Adheres strictly to ADR-073 and ADR-074. Envelope `context` remains `{project, producer, correlation}`, stored v2 event data remains immutable, presentation is dynamically projected on read.

**Disposition:** No P1-P2 findings. **Approved for verification.**
### References
- Feature J91: `docs/features/J91_system-events-human-readable-table-workflow-identity-id-free-columns-and-coding-agent.md`
- Satellite: `docs/design/system-events-human-table.md` (ADR-073/074)
- Envelope / reprojection: `docs/design/actionable-observability-context.md`; `docs/04_DESIGN.md` §7.9; ADR-056/066/067/068
- Presenter matrix: `docs/design/event-tracking.md` §11 (J9); §12 pointer if present
- Parent feature J9 (done): 0601 presenters + 0602 queue identity
- Code SSOT: `packages/app/src/services/event-names.ts`, `packages/app/src/services/system-event-envelope.ts`, `packages/app/src/workflow/observability.ts`, `packages/app/src/services/event-bridge.ts`, `packages/app/src/services/workflow-service.ts`, `apps/web/src/modules/observability/SystemEventsTab.tsx`
- UI tokens: repository-root `DESIGN.md` (no new Agent color token)
### History
- 2026-08-19T22:44:31.446Z todo → wip (system)
- 2026-08-19T22:54:12.470Z wip → testing (system)
- 2026-08-19T22:54:14.961Z testing → done (system)
