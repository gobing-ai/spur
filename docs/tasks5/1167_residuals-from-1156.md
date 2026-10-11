---
schema_version: 1
name: Residuals from 1156
status: cancelled
template: standard
created_at: 2026-10-10T23:25:59.184Z
updated_at: "2026-10-11T03:04:23.355Z"

---

## 1167. Residuals from 1156

### Background

Source task: 1156 (feature K3) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:399e6c8b — packages/app/src/services/project-registry.ts:586: refreshProjects holds the advisory registry lock across up to 4×1s HTTP probe timeouts plus 2×2s kill waits per stale entry; list()/board /api/projects route through it. Bounded and fail-closed; probe window is new, lock-held kill wait pre-existed

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

Resolved inline (operator directive: no deferral to new task files), then cancelled.

- review-finding:399e6c8b (lock held across probes/kills): packages/app/src/services/project-registry.ts:626 `refreshProjects` restructured — the registry lock now covers only the purge decision and the write; ownership-verified HTTP probes (4×requestTimeoutMs) and kill waits (2×killTimeoutMs) per stale entry run unlocked, so list()/board callers no longer block behind stale-entry teardown. `stopRegisteredProject` is fail-closed (returns refusals, never throws), so an unlocked stop cannot strand the purge. Regression test "persists the purge before probing or stopping the stale listener" at packages/app/tests/services/project-registry.test.ts:723 (fails pre-fix: the probe fired before the write).

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-11T03:04:23.355Z backlog → cancelled (system)

