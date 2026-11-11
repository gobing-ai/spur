---
schema_version: 1
name: Residuals from 1325
status: backlog
template: standard
created_at: 2026-11-11T00:02:29.712Z
updated_at: "2026-11-11T00:02:29.879Z"

---

## 1329. Residuals from 1325

### Background

Source task: 1325 (feature F22) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:42e0ee35 — apps/cli/src/commands/task/create.ts:97: (Carried from visit 1, unchanged by 2ec3071ff.) The single `task create` CLI surface cannot author an oversize body (no body-input flag; template body is minimal), so its warning projection is near-unreachable for size advisories in practice. Harmless projection code; the service contract still reports.
- review-finding:823be33b — apps/cli/src/commands/task/show.ts:50: (Carried from visit 1, unchanged by 2ec3071ff.) `--sections ","` (only empty CSV entries) silently falls back to the full dump instead of erroring — the caller pays for the whole file. Edge case; full-dump fallback is the safer default.
- review-finding:d6c3c9c2 — plugins/sp/skills/spur-cli/references/tasks.md:63, packages/app/src/services/task-size-precheck.ts:99, plugins/sp/skills/spur-dev/references/execution-workflow.md:331: (Carried from visit 1; section rewritten at `tasks.md:63-72` in 2ec3071ff for rendering accuracy — Finding 1 — but the rewrite still carries the R3 "prefer phase-scoped task docs" preference via the warning text and pre-existing split guidance rather than a dedicated sentence. Corpus-level guidance chain satisfies R3; no behavior gap.)

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
