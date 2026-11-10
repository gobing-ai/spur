---
schema_version: 1
name: Residuals from 1322
status: backlog
template: standard
created_at: 2026-11-10T19:52:54.958Z
updated_at: "2026-11-10T19:52:55.118Z"

---

## 1326. Residuals from 1322

### Background

Source task: 1322 (feature H16) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:2de0e234 — packages/app/src/services/quality-gate.ts:580: `readWorkspaceGraph` expands only `dir/*`-suffixed globs and literal dirs; a `workspaces: ["packages/**"]` declaration (yarn-classic shape) silently yields an empty graph, so `lightScope`'s shared-package refusal never fires for that repo shape — the R3 full-suite fallback is silently unavailable there (a shared-package change would be scoped to its own workspace's tests, missing dependents). The pipeline's once-per-task full gate at the quality boundary still certifies every PASS (recheck green/fallback falls through), and this repo's root declares the supported `apps/*`/`packages/*` shape, so 1322's own runs are unaffected; the supported-shape contract is documented at the reader. Hardening candidate: an unsupported glob shape should refuse the tier (fallback) instead of classifying nothing.

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
