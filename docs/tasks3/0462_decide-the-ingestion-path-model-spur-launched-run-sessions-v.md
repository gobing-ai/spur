---
template: feature-impl
schema_version: 1
name: "Decide the ingestion path model: Spur-launched run sessions vs ambient agent history"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-06T23:13:55.985Z"
updated_at: "2026-08-06T23:29:59.844Z"
---

## 0462. Decide the ingestion path model: Spur-launched run sessions vs ambient agent history

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. Unblocked. **Resolve before
0455** — the ETL contract's linkage rules depend on this answer.

**The question:** Should history ingestion read Spur-launched run sessions, ambient agent history
under `$HOME`, or both — and where does the agent roster and its history locations live?

**Why it is open.** There are two paths with very different guarantees:

- **Spur-launched runs.** `packages/app/src/workflow/actions/agent-run.ts:143` routes sessions into
  `.spur/run/<runId>/agent-sessions/<agent>/` and `discoverSessionId()` (`:408`) reads the id back.
  The transcript is already correlated to a `runId` — exact attribution. But only **pi and omp**
  honor `--session-dir` (`shims.ts:167,266`); claude, codex, agy, and grok ignore it.
- **Ambient history.** Everything the operator runs interactively — including the session that
  chartered this map — lands in the agent's own `$HOME` location. This is where the volume is, and
  where yesterday's lost 0451 diagnostic report lives. No run correlation.

**Sub-questions:**

- Does ingestion cover both paths, or is one authoritative? A report that only sees Spur-launched
  runs cannot diagnose an operator's interactive session; one that only sees ambient history throws
  away exact run correlation Spur already has.
- If both: are they one source with two roots, or distinct provenance the record shape must carry?
- Run correlation: for Spur-launched sessions, can `run_id` / task WBS be recorded at import time
  instead of reconstructed? `packages/domain/src/analytics/run-cost.ts:131` currently matches ETL
  payloads to actions heuristically — does the deterministic path make that obsolete for the sources
  that support it, and what happens for the four that do not?
- **Registry ownership.** `ts-ai-runner`'s `shims.ts` already names every agent; the importer keeps a
  second, drifted list (`LlmJsonlSource` lacks omp, grok, hermes). Should the shim own history roots
  too — e.g. a read-side locator alongside `getPromptCommand` — so roster and locations live in one
  place? Upstream edits are authorized (see map Decisions), so this is a live option, not a wish.
- Do `.spur/run/**` session dirs get pruned or archived? If they are cleaned up, ingestion must run
  before cleanup or the data is gone.

**Resolved when** the task body states which paths are ingested, how provenance and run correlation
are represented, and where the agent roster plus history locations will live.
### Requirements
- R1 — Decide whether ingestion covers Spur-launched run sessions, ambient `$HOME` agent history, or both, and whether one is authoritative.
- R2 — Define how provenance is represented if both paths are ingested — one source with two roots, or distinct provenance carried on the record.
- R3 — Determine whether run_id and task WBS can be recorded at import time for Spur-launched sessions, and what the four sources without `--session-dir` support fall back to.
- R4 — Decide where the agent roster and history locations live, given `ts-ai-runner` shims already own the roster and the importer keeps a drifted second list.
- R5 — Determine whether `.spur/run/**` session directories are pruned or archived, and whether ingestion must run before any cleanup.
### Acceptance Criteria
```gherkin
Feature: 0462 wayfinder investigation

  Scenario: R1 — the ingestion path model is settled before the ETL contract
    Given agent-run session routing in `packages/app/src/workflow/actions/agent-run.ts` and the shim roster in ts-ai-runner
    When ticket 0462 is resolved
    Then the ingested paths are named with provenance and run-correlation rules
    And the fallback for sources ignoring --session-dir is stated
    And ownership of the agent roster and history locations is decided
    And session-directory retention is checked against real cleanup behavior
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
- 2026-08-06T23:29:59.844Z todo → cancelled (system)
