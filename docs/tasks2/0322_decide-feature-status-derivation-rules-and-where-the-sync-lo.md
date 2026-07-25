---
template: meta
schema_version: 1
name: "Decide feature-status derivation rules and where the sync logic lives"
description: ""
status: done
type: meta
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-07-24T23:40:23.228Z"
updated_at: "2026-07-24T23:59:40.874Z"
---

## 0322. Decide feature-status derivation rules and where the sync logic lives

### Background
**Ticket type:** `wayfinder:grilling` — resolve via `/sp:dev-refine`; record the decision in this body.

**Question:** What is the exact mapping from a feature's linked-task-set state to legal feature-lifecycle transitions, and where does that derivation logic live?

**Sub-questions:**

- Task-set → transition mapping: e.g. any task `wip`/`testing` ⇒ feature `active`? all tasks terminal (`done`/`cancelled`) ⇒ eligible for `verifying` → `done`? empty task set ⇒ no-op?
- `verifying` gate interaction: derivation may only advance into `verifying` when L4 AC traceability holds — auto-advance must respect the gate (use `spur feature advance` hops, never raw status sets).
- Regression semantics: new task added to a `done` feature ⇒ reopen to `active`? Any task `blocked` ⇒ feature `blocked`?
- `pull` vs `push` semantics for the existing `/features/{id}/sync` contract (pull = tasks→feature, push = feature→tasks?) — define or retire.
- Home of the logic. **Recommendation:** `packages/app` feature-service (derive + apply through existing lifecycle guards), exposed as a `spur feature sync <id> [--json]` CLI verb and by un-stubbing the HTTP handler; the sp plugin only orchestrates and asks. Alternatives: domain package, or plugin-only logic (rejected — Board/server and other platforms need it too).
### Requirements

<!-- R-numbered expectations for the process/docs/chore outcome. Keep empty if not applicable. -->

### Acceptance Criteria

<!-- Lightweight checklist or Given/When/Then if there is an observable completion condition. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
**Decision (2026-07-24, operator-confirmed via grilling):**

1. **Logic home:** `packages/app` feature-service owns derive + apply through the existing lifecycle guards (`packages/app/src/services/feature-service.ts:237` already hosts the index-refresh logic to extend). New CLI verb `spur feature sync <id> [--all] [--dry-run] [--json]`; the stubbed `POST /features/{id}/sync` handler (`apps/server/src/modules/feature/handlers.ts:121`, currently returns `affectedTasks: 0`) is un-stubbed and delegates to the same service. The sp plugin only orchestrates and asks (ADR-021 — apps are thin transports).
2. **Mapping — conservative forward-only** over the canonical enum (`packages/domain/src/planning/schema.ts:23`):
   - All linked tasks terminal (`done`/`cancelled`, ≥1 `done`) ⇒ propose advance toward `done` via legal hops; the `verifying` hop requires the L4 AC-traceability gate to hold, otherwise stop before it and report.
   - Any task `wip`/`testing` ⇒ propose `backlog → active`.
   - All non-terminal tasks `blocked` ⇒ propose `blocked`.
   - Empty task set ⇒ no-op.
   - Proposals are applied via `spur feature advance` — never raw status sets.
3. **Regression:** a new non-terminal task linked to a `done` feature ⇒ emit a reopen proposal (`done → active`) with reason; operator-confirmed only, never auto-applied in unattended runs.
4. **Contract:** `pull` = tasks→feature derivation — implement now against the existing direction enum (`packages/contracts/src/feature.ts:147`). `push` = feature→tasks cascade (e.g. feature `cancelled` ⇒ open tasks `cancelled`) — semantics documented in `docs/04_DESIGN.md`, implementation deferred until a real consumer lands; `push` returns an explicit not-implemented error, never a silent no-op.
### Testing
N/A — decision ticket, no code.

**Confidence ratings (decision claims):**

- HIGH — sync handler is a stub returning `affectedTasks: 0` (verified `apps/server/src/modules/feature/handlers.ts:121` today).
- HIGH — feature status enum and `verifying` L4 gate semantics (verified `packages/domain/src/planning/schema.ts:23` and the spur-cli features reference today).
- HIGH — direction enum `pull|push` already in the contract (verified `packages/contracts/src/feature.ts:147` today).
- MEDIUM — the derivation mapping itself: sound design, unproven until implemented and dogfooded against the drifted corpus.
- LOW — "one active goal" corpus invariant interaction with bulk `active` proposals; to resolve at implementation (may need to scope the invariant or the proposals).
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `docs/tasks2/0322_decide-feature-status-derivation-rules-and-where-the-sync-lo.md` | Decision reviewed with operator via structured Q&A; all four recommendations accepted (app-service logic home, conservative forward-only mapping, confirm-gated reopen, pull now / push deferred) | None — proceed to dependent tickets |
| P4 | `apps/server/src/modules/feature/handlers.ts:121` | Existing sync stub confirmed as the implementation seam — contract and direction enum already exist | Un-stub via the graduated implementation ticket |

Residual risk: derivation mapping unproven until implemented and dogfooded against the drifted corpus (MEDIUM); "one active goal" corpus-invariant interaction flagged LOW for implementation.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-07-24T23:48:57.436Z todo → wip (system)
- 2026-07-24T23:57:02.959Z wip → testing (system)
- 2026-07-24T23:59:40.874Z testing → done (system)
