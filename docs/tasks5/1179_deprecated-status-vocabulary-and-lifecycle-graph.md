---
schema_version: 1
name: Deprecated status vocabulary and lifecycle graph
status: todo
template: feature-impl
created_at: 2026-10-12T05:21:53.033Z
updated_at: "2026-10-12T05:21:53.125Z"
feature_id: F42
priority: P1
tags:
  - feature-lifecycle
  - domain

---

## 1179. Deprecated status vocabulary and lifecycle graph

### Background

Implements: R1 — Deprecated is a canonical feature status across domain and contracts; R2 — The lifecycle graph retains a deprecated feature and allows only un-deprecation or removal exits.

Design: docs/design/feature-deprecated-status.md; ADR-136. Surfaces S1–S4 of the affected-surface review.

### Requirements

- [ ] R1. Append `deprecated` to `FEATURE_STATUSES` in `packages/domain/src/planning/schema.ts` with an icon in `FEATURE_STATUS_ICONS`; no new aliases; unknown statuses still fail listing the allowed set.
- [ ] R2. `config/workflows/feature-lifecycle.yaml` declares state `deprecated` (not terminal) with edges from backlog, active, verifying, blocked and done, and exits only to active and cancelled; regenerate `apps/cli/config/` via build:bundle.
- [ ] R3. A transition into or out of deprecated appends a History entry; an undeclared exit (e.g. deprecated→done) is refused naming the legal edges.
- [ ] R4. Contracts accept deprecated through `z.enum(FEATURE_STATUSES)`; regenerate OpenAPI.

### Acceptance Criteria

- [ ] AC1 — Deprecated is a canonical feature status across domain and contracts
- [ ] AC2 — The lifecycle graph retains a deprecated feature and allows only un-deprecation or removal exits

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Additive enum plus graph edges only; contracts follow the enum. `deprecated` stays out of `terminalStates` so un-deprecate works. Rejected: terminal deprecated (duplicates cancelled). Invariant: ADR-135 graph validation covers the new edges on every transport. Confirm the init seeding source is the bundled `config/workflows` copy; if a separate template copy exists, update it in the same commit.

### Plan

- Domain enum + icon
- Lifecycle YAML states/edges + build:bundle
- OpenAPI regen
- E2E: transition a temp feature backlog→deprecated→active and deprecated→cancelled through the CLI; assert deprecated→done refused

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
