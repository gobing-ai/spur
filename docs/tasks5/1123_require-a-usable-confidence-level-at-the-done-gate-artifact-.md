---
schema_version: 1
name: Require a usable confidence level at the done gate (artifact presence + vocabulary)
status: cancelled
template: standard
created_at: 2026-10-07T21:00:41.067Z
updated_at: "2026-10-07T21:43:08.193Z"

---

## 1117. Require a usable confidence level at the done gate (artifact presence + vocabulary)

### Background

Captured from the creation title: "Require a usable confidence level at the done gate (artifact presence + vocabulary)".

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T21:43:07.674Z

- Superseded (2026-10-07, batch af68 merge): main independently landed the same confidence gate as task 1068 R3 (commit e47641d91 — done-transition-guard normalization + PASS-deny, guard/CLI/server tests, verdict-schema doc). This task's parallel implementation (found pre-committed in the runall worktree, completed as 164799b39) is dropped in favor of main's; the branch's additive CLI denial tests ride along in the merge. Renumbered 1117 → 1123 to release the id for main's defect batch.

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

- 2026-10-07T21:43:08.193Z backlog → cancelled (system)

