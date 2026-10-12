---
schema_version: 1
name: Residuals from 1183
status: backlog
template: standard
created_at: 2026-10-12T21:34:05.573Z
updated_at: "2026-10-12T21:34:06.018Z"

---

## 1186. Residuals from 1183

### Background

Source task: 1183 (feature G631) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:a9e056ea — packages/app/src/database/database-browser-service.ts:52, :159-167: `page` and `offset` are bounded only from below, so an integer-valued but unrepresentable value reaches SQL as an OFFSET the driver rejects. Reproduced on the mounted module: `?page=1e21` → 500 `{"error":"datatype mismatch"}` and `?offset=1e21` → 500 (same for `1e300`), where `?page=9999999999999999` answers 200 with an empty page and `?pageSize=1e21` is clamped to 200 correctly. `Number.isInteger(1e21)` is true, so `normalizePage` (`packages/app/src/database/database-browser-service.ts:52-56`) passes it and the offset validator (`:159-167`) does the same; the product is bound as OFFSET at `packages/domain/src/dao/database-inspector.ts:167`. No requirement or AC commits the routes to a behaviour for an unbounded page (R4 bounds `pageSize` only), it is unreachable from the documented client (the design's pager drives `?page=` from integer URL state, `docs/design/projects-database-tab.md:90-91`), and there is no data loss or exposure — a hardening gap, not a requirement breach.

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
