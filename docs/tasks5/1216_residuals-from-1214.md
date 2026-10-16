---
schema_version: 1
name: Residuals from 1214
status: backlog
template: standard
created_at: 2026-10-16T03:36:32.921Z
updated_at: "2026-10-16T03:36:33.025Z"

---

## 1216. Residuals from 1214

### Background

Source task: 1214 (feature A91) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:b305edce — plugins/sp/lib/destructive-policy.ts:140: The lexical pass recognizes 4 of git's global options, so sibling forms of the *same* defect class still hide a destructive subcommand. Replayed this round against `plugins/sp/lib/destructive-policy.ts:140`: `git --no-pager push --force`, `git -p push -f`, `git --bare push --force`, `git --namespace=x reset --hard` and `git --no-replace-objects push --force` all return null, while git (2.55.0, locally installed) parses those options before the subcommand (they proceed to normal git behavior and fail only on repository lookup — `git --no-pager rev-parse --is-inside-work-tree`). Pre-existing: the pre-diff classifier returned null for every one of these too, and none is in R1's enumerated set — so this is a bounded-scope residual, not a regression introduced here.

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
