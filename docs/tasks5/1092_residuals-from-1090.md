---
schema_version: 1
name: Residuals from 1090
status: backlog
template: standard
created_at: 2026-10-06T01:24:30.275Z
updated_at: "2026-10-06T01:24:30.680Z"

---

## 1092. Residuals from 1090

### Background

Source task: 1090 (feature H1) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:f0b1ea88 — packages/app/src/services/task-service.ts:1522; task-record.ts:759: A `## Solution` poisoned by the *old* backfill cannot self-heal: the fixed backfill still runs only when `sectionIsBare` is true, which is false for the `(no changes detected)` body the pre-fix code wrote — so task 1089's state is only recoverable by hand-authoring. The sibling precedent does allow replacing record's own output (`sectionIsBare(doc,'Review') \|\| isRecordAuthoredReview(...)`).
- review-finding:8e170b25 — packages/app/src/services/task-record.ts:886; packages/app/src/services/task-service.ts:1523: `resolveDiffBase` builds its own FS and resolves the run dir from `process.cwd()` instead of the injected context root, so under the programmatic `main(argv, { cwd })` seam the base file would be read from — and `git diff` run in — the runner's repo. Latent: the sole production caller never sets `cwd`.
- review-finding:b6583509 — packages/app/src/services/task-record.ts:721: The two hand-maintained copies of the exclusion set (git pathspec array and the renderer predicate/Set) must be edited together; drift makes the git layer and the pure renderer disagree silently.

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
