---
schema_version: 1
name: Residuals from 1192
status: cancelled
template: standard
created_at: 2026-10-14T05:04:49.259Z
updated_at: "2026-10-14T05:05:26.983Z"

---

## 1206. Residuals from 1192

### Background

Source task: 1192 (feature F43) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:7af4f337 — docs/design/planning-workflow-contracts.md:30: A doc that restates the task-status vocabulary is still stale and is not named in satellite §3.1 S13. `docs/design/planning-workflow-contracts.md:30` prints the `task-lifecycle.yaml` states as `backlog · todo · wip · testing · blocked · done · cancelled` while declaring that YAML as its source, and its sibling row for `feature-lifecycle.yaml` (same table) already carries ADR-136's `deprecated`. Pre-existing — absent from this diff and from R1's two named docs — but it is a doc whose list now drifts from `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`).
- review-finding:8c4d1879 — packages/domain/src/planning/task-skeleton.ts:39: A second task-status key list survives in the domain layer: `matrixStatusSchema` at `packages/domain/src/planning/task-skeleton.ts:39` holds 7 statuses without `deprecated` and its own docstring still says "all 7"; it is mirrored at `apps/cli/schemas/section-matrix.schema.json:56` and bundled at `plugins/sp/lib/quality-gate.generated.mjs:29808`. Not introduced by this diff and latent (no shipped `config/tasks/section-matrix.yaml` variant declares `deprecated`), but S14's "audit only" row examined only *terminal sets*, so this sibling vocabulary went unnamed.
- review-finding:beac79e4 — docs/design/task-deprecated-status.md:74: The S4 audit row's newly added anchor `apps/cli/src/config/scaffold-manifest.ts:33` lands on a blank line; `SCAFFOLD_MANIFEST` is declared at `apps/cli/src/config/scaffold-manifest.ts:39`. The row still names the symbol and its second read (`apps/cli/src/commands/init.ts:152`) is exact, so the no-edit claim stays proved — only the line number is off.

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-14T05:05:26.983Z backlog → cancelled (system)

