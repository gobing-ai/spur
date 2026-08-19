---
title: "System Events semantic summaries, outcomes, and tooltip identity"
date: 2026-08-18
topic: system-events-semantic-presentation
run_id: 5b06ab75-0ae2-4187-bf74-3fb5289e401a
needs_design: true
---

# Brainstorm: System Events semantic presentation

## Overview

The idea is valid, but most of it already belongs to backlog feature **J9 — Event 5W1H payload and
catalog remediation**. Creating a sibling feature would split one contract across two owners. The
right move is to reshape J9 so the canonical server projection produces event-specific `summary`,
`outcome`, description, and fields; the Board remains a renderer of that projection.

The suspected task-status event is `task.transitioned`. It exists in the catalog and emitter, and
the live ledger currently contains 812 rows. Recent rows contain `from` and `to`, but their projected
summary is only `Task transitioned · 0600` and Outcome is absent; the state change appears only in
tooltip fields. The event is present, but the diagnostic fact is visually hidden by the generic
`buildSummary()` and outcome extractor. `task.updated` is a separate event and currently lacks the
section/field payload required for a useful summary.

One requested input is not available today: `queue.consumer.started` / `.stopped` payloads contain
polling and drain data but no queue identity. A truthful `[queue] {queue-name}` summary therefore
requires a producer-contract addition; it must not invent a name in the UI.

## Approaches

### Approach 1: Extend J9 with a typed event-presenter registry ⭐ Recommended

**Description:** Add an exhaustive server-side presenter registry keyed by catalog event name. Each
presenter receives bounded projected data plus correlation and returns the event-specific summary
and meaningful outcome. Keep envelope v2's shape; make presentation explicitly derived and
re-project it on history reads so old transition rows gain readable summaries without a database
rewrite. Extend J9 rather than creating a new feature.

**Required semantics:**

- Tooltip title uses `eventName · best-correlator`, preferring `task:<id>` / `feature:<id>` /
  workflow run / job, then the ledger event id. The exact ledger id remains visible in the context
  rows. Move the interaction hint to a muted footer: hover mode says `Click event name or Pin to
  lock for copy`; pinned mode says `Select to copy · Esc or outside click to close`.
- Planning summaries render exactly from producer data: `[task] 0600 : wip -> testing`,
  `[task] Solution`, `[feature] J9 : backlog -> active`, `[feature] Goal`. Add a scalar mutation
  locus such as `field: 'section:Solution'`; retain `from`/`to` for transitions.
- Queue consumer payloads gain an explicit `queueName` at the `@gobing-ai/ts-infra` producer
  boundary, configured by Spur's consumer composition root; summaries render `[queue]
  server-jobs`. Outcomes use actual data: `running` for start and `drained` / `not drained` for
  stop. This requires a released ts-infra change and Spur dependency update.
- Every `workflow.*` presenter begins with `[workflow]`, uses `workflowName` plus the most useful
  phase/node/action/transition fact, and derives outcomes only from carried values (`status`,
  `finalState`, `ok`, `passed`, `to`, or `reason`). J9 already owns threading `workflowName`,
  `nodeLabel`, and `kind` onto engine-native rows.
- Audit all catalog entries for meaningful outcomes. Terminal/result events map booleans, status,
  final state, exit code, drain result, or error to a concise outcome; observation-only events keep
  `-`. Do not turn every event verb into a tautological outcome.
- Add an exhaustiveness gate: every catalog name must have a presenter or an explicit
  `noMeaningfulOutcome` declaration. Representative tests pin every requested summary and outcome,
  tooltip title/footer placement, SSE/history parity, and historical v2 transition reprojection.

**Trade-offs:**

- **Pros:** Fixes the root at the canonical projection boundary; keeps history, SSE, table,
  tooltip, and future consumers consistent; extends the already-approved J9 ownership; supports
  per-event coverage without a template DSL.
- **Cons:** Touches Spur app projection, planning payloads, workflow enrichment, external ts-infra,
  web presentation, tests, and design authority. Re-projecting stored v2 presentation changes the
  current identity-preservation contract and must be recorded in ADR-056/design docs, although it
  does not rewrite the ledger.

**Implementation Notes:** Keep small shared helpers for repeated shapes (entity transition,
workflow transition, boolean result), but require an explicit registry entry per event. Preserve
stored `data` and `context`; recompute only derived `presentation` on history reads. Old
`task.transitioned` rows can improve because they already retain `from`/`to`; old `task.updated`
rows cannot recover a missing section and remain generic.

**Confidence:** HIGH

**Sources:**

- [Event tracking SSOT](../design/event-tracking.md) | **Verified:** 2026-08-18
- [Existing J9 remediation feature](../features/J9_event-5w1h-payload-and-catalog-remediation.md) | **Verified:** 2026-08-18
- [Canonical envelope projector](../../packages/app/src/services/system-event-envelope.ts) | **Verified:** 2026-08-18
- [Planning write emitter](../../packages/app/src/services/planning-write-service.ts) | **Verified:** 2026-08-18
- [System Events Board renderer](../../apps/web/src/modules/observability/SystemEventsTab.tsx) | **Verified:** 2026-08-18

### Approach 2: Put declarative summary/outcome templates in the catalog

**Description:** Extend every catalog entry with a template/spec describing literal tokens, payload
paths, fallbacks, and outcome selection. One generic interpreter renders the presentation.

**Trade-offs:**

- **Pros:** Catalog is a single serializable description of retention and presentation; coverage is
  mechanically visible.
- **Cons:** Introduces a mini templating DSL for conditionals, boolean outcomes, formatting, and
  fallbacks. Workflow and queue cases quickly exceed simple interpolation, making the catalog hard
  to read and errors runtime-only.

**Implementation Notes:** Viable only if the presenter registry proves repetitive enough to justify
a second-stage refactor. Do not start here.

**Confidence:** MEDIUM

**Sources:**

- [Current source-profile catalog design](../../packages/app/src/services/event-names.ts) | **Verified:** 2026-08-18
- [Event tracking gap G6](../design/event-tracking.md) | **Verified:** 2026-08-18

### Approach 3: Derive summaries and outcomes in the React table

**Description:** Add event-name switches in `SystemEventsTab.tsx`, deriving display text from
`event.payload` while leaving the persisted/server presentation unchanged.

**Trade-offs:**

- **Pros:** Smallest immediate UI diff; can improve existing rows without changing producers.
- **Cons:** Reintroduces client payload guessing that J5 deliberately removed, diverges history
  from SSE/CLI consumers, cannot truthfully add missing section or queue-name data, and duplicates
  server policy.

**Implementation Notes:** Reject except as a temporary compatibility fallback for a versioned
server rollout; no such rollout is required for the recommended approach.

**Confidence:** HIGH that this is the wrong ownership boundary

**Sources:**

- [Actionable observability context](../design/actionable-observability-context.md) | **Verified:** 2026-08-18
- [System Events canonical view parser](../../apps/web/src/modules/observability/SystemEventsTab.tsx) | **Verified:** 2026-08-18

## Recommendation

**Reshape and extend J9 using Approach 1.** J9 already owns the field-level planning diff,
per-event catalog declarations, authored descriptions, workflow naming, and the catalog↔SSOT gate.
Add the typed presenter registry, tooltip identity/footer refinement, explicit outcome audit,
queue-name producer contract, and history read-time presentation reprojection. This is one cohesive
remediation: capture truthful facts at producers, derive semantic presentation once on the server,
and render it consistently in the Board.

The queue request overrides J2's earlier single-queue rationale only by adding a real identity to
the producer contract. Until `queueName` exists, render a neutral queue consumer summary rather
than calling job `type` a queue name.

## Design Summary

Enhance the existing J9 feature around a single invariant: **System Event presentation is a derived,
event-specific server contract over bounded payload data, never a UI guess.** A typed exhaustive
presenter registry produces summary and meaningful outcome for every cataloged name; planning
events add the exact mutation locus; workflow events carry human workflow/step identity; queue
consumer events gain an explicit upstream queue identity. The Board changes only the tooltip shell:
a useful event/correlation title and a muted interaction footer. History reads re-project only the
derived presentation of stored v2 rows, preserving `data`, `context`, indexed correlation, and the
database row; no ledger backfill occurs. Existing transition rows become legible, while facts that
were never captured remain unavailable rather than fabricated.

`needs_design: true` because the change crosses the planning emitter, canonical envelope/catalog,
workflow and queue producer contracts, history projection policy, and web UI; it also changes an
external ts-infra DTO and the cross-cutting convention for all event presentation.

## Next Steps

1. At the idea-evaluation gate, approve **reshape** and reuse feature J9 instead of creating a new
   sibling feature.
2. Route J9 through system design to freeze the presenter interface, v2 history reprojection
   contract, queue-name upstream release sequence, and per-event outcome matrix.
3. Update J9's Goal/Scope/AC through `spur feature update` after approval; then decompose by
   ownership seam: ts-infra queue identity, planning/workflow payload enrichment, canonical
   presenters/history, Board tooltip, and enforcement/tests/docs.

---

**Generated by:** sp:brainstorm
**Research delegation:** inline repository/ledger verification; no external claims
