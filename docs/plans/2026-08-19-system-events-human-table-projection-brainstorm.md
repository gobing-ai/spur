---
title: "System Events table: workflow identity, id-free columns, executor column"
date: 2026-08-19
topic: system-events-human-table-projection
run_id: f00aed70-8b22-4747-bf4e-281a3e983eb3
needs_design: true
---

# Brainstorm: System Events human table projection (post-J9)

**Date:** 2026-08-19

## Overview

J9 (done, tasks 0601/0602) already made presentation a server-owned, event-name-keyed contract
over the canonical v2 envelope. That landed `[workflow]` prefixes, `workflowName`/`nodeLabel`
decoration, and tooltip title identity. Three operator-visible defects remain on Observability >
System Events, and they are presentation/projection defects — not a new event schema.

1. **Workflow summaries still substitute machine ids for workflow identity.**
   `workflowTitle()` falls back to `correlation.runId` when `workflowName` is missing
   (`packages/app/src/services/event-names.ts`). `stepName()` falls back to `kind` then `node`.
   Adapter events always mint a fresh `eventId` UUID (`ObservableWorkflowAdapter.envelope`).
   The operator sample is the contract: after `[workflow]`, show the workflow file/name
   (`idea-pipeline`), a middle-dot, then the human step/state description and result.
2. **CORRELATION and ACTION columns render opaque ids.** The table concatenates
   `run`/`execution`/`action` UUIDs from `context.correlation`. ACTION for workflow events is the
   remediation command `spur workflow trace <runId>`. Raw ids already live in the tooltip; table
   cells must stay human (run/step/action name/entity).
3. **The coding agent that executed the request is a first-class diagnostic fact and has no
   column.** `context.producer` is the emitting package (`@gobing-ai/ts-dual-workflow-engine`),
   not the coding agent. Identity already exists on some payloads (`data.agent`,
   `data.routing.executor`, `data.metadata.agent` on `workflow.action.started`, row `actor`) but
   is not projected as a table column, and `metadata.agent` is stripped by the metadata allow-list
   because the action presenters do not declare that path.

Do **not** reopen J9. Create a new child of feature J (recommended id **J10**). Preserve envelope
v2. No new CLI nouns.

## Approaches

### Approach 1: Server-owned human projection on a new J10 child ⭐ Recommended

**Description:** Keep ADR-066 ownership: the Board renders a canonical projection; it does not
interpret payloads. Tighten workflow presenters so SUMMARY never substitutes `runId`, `eventId`,
`actionId`, or a UUID-shaped `node`. Reproject CORRELATION and ACTION from human facts already
in bounded `data` (workflow name, node label, action `kind`, entity). Add an Agent/Executor
table column from a server-projected identity. Close producer/retention gaps in Spur first;
upgrade ts-libs only if agent identity cannot be stamped at an existing Spur fan-in.

**Required semantics:**

- Workflow SUMMARY matches the operator sample:
  `[workflow] {workflowName} · {nodeLabel} {result}`
  (`started` / `done` / `failed` / transition `from -> to` as today). Omit a missing name or
  step rather than substituting a UUID. `workflowName` is the definition name (e.g.
  `idea-pipeline`), never a run id.
- `stepName` prefers `nodeLabel` (definition `description`, else declared state id). Do not
  promote `node` when it is a UUID. `kind` may still appear as the action name in ACTION, not
  as a substitute for the step description in SUMMARY.
- CORRELATION cells show human correlators only: workflow name, step label, action `kind`,
  entity `kind:id` (WBS / feature id are already human). Sequence may stay. Raw
  `runId`/`executionId`/`actionId`/`eventId` stay in tooltip fields and expanded payload.
- ACTION cells show the action name (`kind`, entity, or a short human verb). Remediation
  commands that embed a UUID (`spur workflow trace <runId>`) move to the tooltip footer or
  expanded detail — they are not a table column value.
- Agent column: one bounded string projected by the presenter/envelope from, in order,
  `data.routing.executor`, `data.agent`, `data.metadata.agent`, then row `actor` when that
  actor is an executor/agent id. Empty when the event has no executor (pure engine
  `workflow.node.enter` / `workflow.transition`). Never use `context.producer.package`.
- Retention: add `metadata.agent` / `metadata.role` / `routing.executor` to the relevant
  presenters so `projectAllowedMetadata` keeps them. Today `workflow.action.started` retains
  `runId`/`workflowName`/`nodeLabel`/`node`/`actionId`/`kind` and drops `metadata.agent`.
- Producer: keep `withWorkflowIdentity` + `decorateWorkflowEvent`. Audit emit paths that skip
  the wrapper (`workflow-service.ts` only wraps when `opts.extensions` is set). Do not invent
  names for historical rows that never stored them (ADR-067/068).
- Feature: new J child (J10). J9 stays done. Same-commit surface notes in
  `docs/04_DESIGN.md` §7.9 and `docs/design/actionable-observability-context.md` Board
  projection (column set).

**Trade-offs:**

- **Pros:**
  - Fixes the three operator complaints at the same authority J9 already established.
  - History, SSE, and the table stay consistent via read-time presentation reprojection.
  - Cheapest agent path first: catalog retention + presenter projection; ts-libs only if that
    cannot emit the identity.
  - Does not reopen a done feature or invent an envelope v3.
- **Cons:**
  - Touches presenters, catalog field lists, Board columns, and possibly the workflow identity
    decorator — several files, one contract.
  - Old rows without `workflowName`/`nodeLabel`/`agent` stay incomplete (truthful omission).
  - Moving remediation UUIDs out of ACTION changes the J5 “action column = remediation”
    reading; that column is redefined as the human action name.

**Implementation Notes:**

- Do not add keys to `SystemEventEnvelopeV2.context` (`hasOnlyKeys` will reject them). Put
  human correlation and agent identity in `presentation` (summary, fields, a dedicated
  `presentation` slot such as `outcome` is already taken — prefer extra `fields` plus a
  first-class `presentation` value the Board already knows, or a single new optional
  presentation key only if fields cannot carry Agent without a column contract). Prefer
  `presentation.fields` + Board column mapping over an envelope shape change.
- Shared helpers: `humanWorkflowTitle`, `humanStepLabel`, `looksLikeOpaqueId` (UUID / `live-`
  prefixes). Presenters call them; the client does not re-derive.
- Tests: pin the operator sample for `workflow.action.start`/`started` with
  `workflowName=idea-pipeline` and a long `nodeLabel`; assert SUMMARY contains neither
  `runId` nor `eventId`. Assert CORRELATION/ACTION strings have no UUID. Assert Agent column
  from `routing.executor` / `agent` / `metadata.agent` and empty when absent.
- Browser-check the Observability > System Events table (desktop + compact) after the column
  change.

**Confidence:** HIGH
**Sources:**

- [J9 shipped feature](../features/J9_event-5w1h-payload-and-catalog-remediation.md) | **Verified:** 2026-08-19
- [Event tracking §7 / §11](../design/event-tracking.md) | **Verified:** 2026-08-19
- [Envelope + Board projection](../design/actionable-observability-context.md) | **Verified:** 2026-08-19
- [Presenters `workflowTitle`/`stepName`](../../packages/app/src/services/event-names.ts) | **Verified:** 2026-08-19
- [Envelope correlation + remediation ACTION](../../packages/app/src/services/system-event-envelope.ts) | **Verified:** 2026-08-19
- [Table CORRELATION/ACTION rendering](../../apps/web/src/modules/observability/SystemEventsTab.tsx) | **Verified:** 2026-08-19
- [Workflow identity decorator](../../packages/app/src/workflow/observability.ts) | **Verified:** 2026-08-19
- [ADR-066/067/068](../00_ADR.md) | **Verified:** 2026-08-19

### Approach 2: Board-only cosmetic filtering

**Description:** Leave server presenters and producers unchanged. In `SystemEventsTab`, drop
UUID-shaped tokens from the CORRELATION string, hide ACTION when it looks like a trace
command, rewrite SUMMARY in the client when it looks like `[workflow] <uuid>`, and add an
Agent column from `event.actor`.

**Trade-offs:**

- **Pros:**
  - Smallest web diff; no catalog or ts-libs work.
  - Can hide ids on already-persisted rows without waiting for producer fixes.
- **Cons:**
  - Violates ADR-066 (clients must not interpret event payloads).
  - SSE, history, future CLI consumers, and the table diverge.
  - Client cannot recover `idea-pipeline` or a step description that the presenter never
    put in `presentation.summary`.
  - `event.actor` is usually empty on `workflow.*` (extractor looks at `actor`/`agentId`/
    `memberId`, not `metadata.agent` or `routing.executor`).
  - Heuristic UUID stripping is brittle (`0601` is a WBS, not an id to hide).

**Implementation Notes:** Reject as the primary path. A client may still *render* server-
projected fields; it must not guess workflow names or agent identity from raw payload.

**Confidence:** HIGH that this is the wrong ownership boundary
**Sources:**

- [ADR-066 exhaustive server presenters](../00_ADR.md) | **Verified:** 2026-08-19
- [Actor extractor](../../packages/app/src/services/system-event-tap.ts) | **Verified:** 2026-08-19

### Approach 3: Extend envelope v2 context with human and agent slots

**Description:** Add `context.human` (`workflowName`, `stepLabel`, `actionName`) and
`context.executor` to `SystemEventEnvelopeV2`, persist them, and teach the Board to read
those slots. If ts-ai-runner / the workflow engine do not emit executor identity on every
row, change those upstream contracts so the new slots are always populated.

**Trade-offs:**

- **Pros:**
  - Makes human identity a first-class envelope fact, not a presenter convention.
  - A dedicated `context.executor` would make the Agent column trivial.
- **Cons:**
  - Invents envelope shape (`hasOnlyKeys` on `context` is currently
    `{project, producer, correlation}`). That is a schema change the operator asked to
    avoid unless agent identity cannot be projected from existing payloads.
  - Historical v2 rows cannot gain the new context keys without a ledger rewrite (forbidden)
    or a read-time adapter that is equivalent to Approach 1's presenter work.
  - Upstream ts-libs work is speculative: Spur already has `data.agent`,
    `routing.executor`, and `metadata.agent` at the producer fan-in.

**Implementation Notes:** Hold unless implement proves the cheaper Spur projection cannot
surface executor identity on agent-bearing events. If an upstream stamp is required, add
fields to the *domain payload* (data), not a new envelope version.

**Confidence:** MEDIUM (useful if Approach 1 hits a hard producer hole; not the start)
**Sources:**

- [Envelope v2 shape](../../packages/app/src/services/system-event-envelope.ts) | **Verified:** 2026-08-19
- [Operator constraint: preserve v2 unless agent cannot be projected] | **Verified:** 2026-08-19

## Recommendations

**Take Approach 1. Create J10 under J. Do not reopen J9.**

J9 owns the presenter registry, history reprojection, and the first `[workflow]` convention.
The remaining work is a table-legibility contract on top of that registry: never put opaque
ids in SUMMARY/CORRELATION/ACTION, and project the coding agent when the payload already
has it. That is a new child, not a done-feature rewrite.

Key decision factors: ADR-066 (server owns presentation), ADR-067 (reproject presentation
only), ADR-068 (do not invent missing facts), ADR-051 (no new CLI nouns), and the operator
sample for `workflow.*` SUMMARY.

Consider Approach 2 only as a forbidden shortcut. Consider Approach 3 only if implement
proves agent identity is absent from every Spur-reachable payload for agent-executed
events — then stamp it at the producer (Spur decorator first, ts-libs if the engine emits
those rows without passing Spur).

## Design Summary

Continue System Events presentation under Observability board feature J as a **new child
(J10)**. Do not reopen J9. Do not add a CLI noun. Do not introduce envelope v3.

**Invariant:** table cells are human-readable; the tooltip and expanded payload remain the
home for raw ids (`eventId`, ledger row id, `runId`, `actionId`, UUID `node`).

**SUMMARY (`workflow.*`).** Every cataloged workflow presenter emits:

`[workflow] {workflowName} · {human step or state} {result}`

`workflowName` is the definition name (file/name such as `idea-pipeline`). The step is
`nodeLabel` from the loaded definition (`description` when non-empty, else the declared
state id). Result is the existing truthful suffix (`started`, `done`, `failed`,
`from -> to`, …). If a fact is absent, omit it. Never fall back to `runId`, `eventId`,
`actionId`, or a UUID-shaped `node`. History reads re-project `presentation` from stored
bounded `data` (ADR-067).

**CORRELATION and ACTION.** Stop rendering `context.correlation` UUIDs and remediation
commands that embed those UUIDs. CORRELATION shows human correlators already in bounded
data: workflow name, step label, action `kind`, entity. ACTION shows the action name or
entity, not `spur workflow trace <uuid>`. Remediation stays available in the tooltip /
expanded detail.

**Agent column.** Add a dedicated System Events column when the projection can name the
coding agent / executor. Project in this order: `data.routing.executor`, `data.agent`,
`data.metadata.agent`, then row `actor` when it is an agent/executor id. Leave the cell
empty when the event has no executor. Do **not** use `context.producer` (package /
subsystem). Prefer a Spur-only path: retain the existing payload paths on the relevant
presenters (they are currently dropped for `metadata.agent`) and stamp identity at existing
Spur fan-ins (`withInvokeRouting`, `projectActionMetadata`, `withWorkflowIdentity`). A
ts-libs upgrade is in scope only if those paths cannot carry the identity.

**Out of scope:** new event names, ledger rewrites, backfilling names that were never
stored, Board modules other than System Events, and any new public CLI noun.

`needs_design: true` because the change crosses presenters + catalog retention
(`packages/app`), Board column contract (`apps/web` + `04_DESIGN.md` §7.9 / actionable
observability satellite), and possibly workflow producer decoration; it also sets a
cross-cutting “no opaque ids in table cells” convention. Ties lean design.

## Next Steps

1. Idea-eval taste gate: approve this evaluation to create J10 (do not reshape J9).
2. System design (`sp:sys-architecture`): freeze the SUMMARY grammar, the human
   CORRELATION/ACTION mapping, the Agent projection order, and whether Agent rides
   `presentation.fields` or a new optional presentation key (envelope `context` stays
   closed).
3. Decompose by seam, not by complaint: (a) workflow SUMMARY + no-id presenter helpers,
   (b) human CORRELATION/ACTION projection, (c) Agent retention + column, (d) producer
   decoration-gap audit / optional ts-libs only if (c) cannot find a fact.

---

**Generated by:** sp:brainstorm
**Research delegation:** inline `sp:source-driven-development` against this repo’s presenters,
envelope, Board table, workflow decorator, J9, and ADR-066/067/068. No `spur agent run`
escalation (no subprocess trigger).
