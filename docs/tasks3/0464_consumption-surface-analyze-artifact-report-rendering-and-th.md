---
template: feature-impl
schema_version: 1
name: "Consumption surface: analyze artifact, report rendering, and the scheduled loop"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0455"]
created_at: "2026-08-06T23:30:12.778Z"
updated_at: "2026-08-06T23:32:29.171Z"
---

## 0464. Consumption surface: analyze artifact, report rendering, and the scheduled loop

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Blocked by 0455.**
Consolidates cancelled tickets 0460 and 0461.

**The question:** What must `spur history analyze` answer, what artifact does it emit for
`spur history report` to render, and what runs the whole thing every morning?

**Why it is open.** `analyze` today loads every ETL record into memory, prices each one, and returns
an `AnalyticsSummary` — `totals`, `bySource`, `byModel`, `daily`
(`packages/domain/src/analytics/types.ts:55`, `packages/app/src/services/history-service.ts:62`).
That is a spend dashboard; it never answers "which tool loop burned this session", which is why this
map exists. It also emits no artifact — output goes to stdout, so `report` has nothing to render and
is an explicit not-implemented stub (`apps/cli/src/commands/history.ts:39`).

**Analyze and the artifact:**

- Which diagnoses earn a place? The lost 0451 report is the reference: time cost by step, token cost
  by step, tool calls by step. Name concrete queries, not categories.
- Artifact shape: what `analyze` writes, where, under what name, and how it is versioned. `report`
  renders it without re-querying the DB, so the artifact is a contract.
- Selectors: session, day, source, run/task. Minimum set serving both the scheduled loop and ad-hoc
  forensics.
- In-memory pass vs SQL. It currently loads everything; at 90k–1.5M lines per source per scan, check
  whether that survives a month of daily imports before committing.
- What survives from the existing surface — `formatSummary` (`analytics/costs.ts:90`) and the
  `run-cost.ts` attribution helpers already exist and may be reusable rather than replaced.

**The scheduled loop:**

- What runs it. Feature A2 (embedded job queue and scheduler) is done and
  `apps/cli/schemas/spur-config.schema.json:90` exposes `runtime.scheduler.enabled`, documented as
  "OFF by default for CLI (run-once)" — establish what it can actually drive before choosing.
  Candidates: Spur's own scheduler plus a `spur workflow`; OS-level `launchd`; agent-side scheduling.
  Weigh harness observability against unattended reliability.
- Multi-source fan-out: `--source` takes one value (default `pi`). Six agents means six invocations
  or a new `--source all`. One source failing must not abort the rest (map AC R6).
- What "yesterday's sessions" means — incremental mode resumes from checkpoints, so a date window may
  be unnecessary. Confirm against 0457's findings.
- Delivery: where the report lands and how the operator learns it exists.
- Failure detection: a scheduled job that silently stops is worse than none. Note `system_events` is
  ~90% prune heartbeat with no workflow or agent rows today, so event-ledger visibility needs
  verifying, not assuming.

**Resolved when** the task body carries the query list, the JSON artifact schema and versioning rule,
the selector set, the in-memory-vs-SQL decision with volume reasoning, the scheduling surface with
its fan-out and failure-isolation model, and how a missed run is detected.

**If the machine-parsable and human-legible needs pull apart, say so** — that is a real finding, not
a failure to decide.
### Requirements
- R1 — Name the concrete queries analyze must answer, including time cost by step, token cost by step, and tool calls by step.
- R2 — Define the JSON artifact contract: schema, location, naming, and versioning, such that report renders it without re-querying the database.
- R3 — Define the selector set (session, day, source, run/task) serving both the scheduled loop and ad-hoc forensics.
- R4 — Decide in-memory aggregation vs SQL, justified against measured volume after a month of daily imports.
- R5 — State what survives from the existing surface — formatSummary and the run-cost.ts attribution helpers — rather than replacing them by default.
- R6 — Choose the scheduling surface, having first established what the A2 embedded scheduler can actually drive, with reasoning across Spur scheduler, launchd, and agent-side scheduling.
- R7 — Define multi-source fan-out across six agents such that one source failing does not abort the others, and define what a nightly window means given checkpoint-based resume.
- R8 — Define report delivery and how a failed or skipped morning run is detected, verifying rather than assuming event-ledger visibility.
### Acceptance Criteria
```gherkin
Feature: 0464 wayfinder investigation

  Scenario: R1 — analyze answers forensic questions, not just spend questions
    Given the forensic record contract from 0455
    When ticket 0464 is resolved
    Then the task body names the concrete queries including per-step attribution
    And a JSON artifact schema with a versioning rule is stated
    And the in-memory versus SQL decision cites volume reasoning
    And reuse of existing analytics helpers is assessed explicitly

  Scenario: R6 — the scheduled loop has an owner and fails visibly
    Given the analyze artifact contract settled in this ticket
    When the scheduling surface is chosen
    Then the surface is named with its reasoning against the alternatives
    And fan-out across six sources isolates per-source failure
    And report delivery and missed-run detection are both specified
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
