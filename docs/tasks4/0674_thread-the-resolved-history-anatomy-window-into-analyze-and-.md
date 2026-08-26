---
schema_version: 1
name: "Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.860Z
updated_at: "2026-08-26T05:39:55.771Z"
feature_id: I81
priority: P1
tags: ["history-anatomy", "workflow", "performance", "correctness"]
---

## 0674. Thread the resolved history-anatomy window into analyze and give the baseline leg its own bounds

### Background

The daily history-anatomy workflow resolves a DST-aware calendar-day window in `resolve-scope` and writes it to `.spur/run/<runId>-selector.json`, but nothing exports it back into workflow vars. `config/workflows/history-anatomy.yaml:125` therefore runs `spur history analyze --since "$since" --until "$until"` with the vars-block defaults (empty strings), and `:129` references `$baselineSince`, which is never declared in the `vars:` block at all.

Both published reports (`docs/report/2026-08-24-history-anatomy.md`, `2026-08-25-history-anatomy.md`) show the consequence: `selector.since`/`selector.until` null in both artifacts, `artifactDigest == baselineArtifactDigest` (`51e5414f…`), every recurrence key `not-comparable`, and `identity.bounds` published as empty strings. Two independent dogfood runs on different dates reproduce it identically, so it is a plumbing gap and not a data fluke.

The same defect is the dominant performance cost. Measured on the current 1.82 M-message corpus: a bounded single-day analyze produces a 58 KB artifact in 2.0 s; the unbounded analyze produces a 3.9 MB artifact in 18.8 s. Rendered forensics: 9.4 KB bounded vs 131 KB unbounded. Both `agent.run` stages (enrich and validate) consume those artifacts, which is what stretches a run to the 11-18 minutes the dogfood ledgers recorded. Fixing the bounds fixes the correctness defect and roughly an order of magnitude of model-stage payload in one diff.

### Requirements
- [ ] R1. Export the bounds `resolve-scope` resolves (from `.spur/run/<runId>-selector.json`) into the workflow vars the `analyze` stage reads, so the current leg analyzes exactly the requested local calendar day.
- [ ] R2. Give the baseline leg its own ordered inclusive bounds for the immediately preceding local calendar day, and declare every var the stage references in the `vars:` block — `baselineSince` is currently referenced at `:129` and declared nowhere.
- [ ] R3. Keep ad-hoc mode's operator-supplied bounds untouched: no calendar-day normalization is applied to them.
- [ ] R4. Make the resolved window reach the provenance stamp so published `identity.bounds.since` / `identity.bounds.until` carry the audited window instead of empty strings.
- [ ] R5. Add a workflow-level check that no `analyze` stage var is undeclared, so the `baselineSince` class of defect cannot silently recur.
- [ ] R6. Record the before/after payload measurement (artifact bytes and analyze wall-clock, per leg) as evidence that the bounded path is at least an order of magnitude smaller.
### Acceptance Criteria
```gherkin
@core
Scenario: R1 — Daily mode analyzes exactly its resolved local calendar day
  Given the history-anatomy workflow runs in daily mode for the local calendar day 2026-08-24
  And resolve-scope has written DST-aware inclusive bounds to the run-scoped selector sidecar
  When the analyze stage invokes "spur history analyze" for the current leg
  Then the produced current artifact carries a non-null "selector.since" and "selector.until" equal to those resolved bounds
  And no workflow var referenced by the analyze stage is undeclared in the workflow "vars" block

@core
Scenario: R2 — The baseline leg analyzes the immediately preceding local calendar day
  Given a daily run whose current leg is bounded to the local calendar day 2026-08-24
  When the analyze stage invokes "spur history analyze" for the baseline leg
  Then the baseline artifact's bounds are the immediately preceding local calendar day
  And the baseline artifact digest differs from the current artifact digest

@core
Scenario: R4 — The published report makes its audited window auditable
  Given a daily run that completed through the stamp stage
  When the report is published
  Then the frontmatter "identity.bounds.since" and "identity.bounds.until" hold the audited window rather than empty strings
  And "identity.timezone" names the timezone those bounds were resolved in

@core
Scenario: R5 — A bounded daily run costs materially less than an unbounded one
  Given the current corpus of roughly 1.8 million history messages
  When a daily run analyzes one local calendar day instead of the whole corpus
  Then the artifact handed to the enrich and validate stages is at least an order of magnitude smaller than the unbounded artifact
  And the deterministic analyze half completes in under five seconds per leg

@edge
Scenario: R20 — Ad-hoc mode keeps its operator-supplied bounds unchanged
  Given an ad-hoc run supplying its own ordered inclusive bounds and a focus
  When the analyze stage runs
  Then the current artifact's selector equals the operator-supplied bounds
  And no daily calendar-day normalization is applied to them
@core
Scenario: R3 — Recurrence classification produces real verdicts once both windows are bounded
  Given a current artifact and a distinct preceding-day baseline artifact for the same daily run
  When the enrich stage builds the recurrence ledger
  Then no stable key is classified "not-comparable" for the reason that window bounds are unavailable
  And each stable key carries one of "new", "recurring", "regressed", "improved", or "resolved"
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Where the bounds come from.** `resolve-scope` is an `agent.run` stage whose only durable output is the selector sidecar. The engine does not read a stage's file output back into vars, so the seam has to be closed by one of two shapes:

1. **Deterministic shell export** — a `resolve-paths`-style shell stage that reads the selector sidecar with the existing `history-anatomy-cache` helper and writes `HA_SINCE` / `HA_UNTIL` / `HA_BASELINE_SINCE` / `HA_BASELINE_UNTIL` into the run-scoped `.env` file every later stage already sources. `analyze` then sources that file and passes the values, exactly as `cache-probe`, `stamp`, and `publish` already source `$HA_HELPER` / `$HA_TARGET`.
2. Engine-level var export from `agent.run` — a larger change to the workflow engine, and out of proportion to this defect.

Take shape 1: it reuses the `.env` seam that already exists in this workflow, keeps every shell action at glue length per ADR-069 R1, and needs no engine change. The baseline bounds are derived in the helper (the same DST-aware rule `resolve-scope` applies), not recomputed in shell — shell arithmetic over local calendar days with DST is exactly the code ADR-069 R1 says belongs in the helper.

**Why the baseline leg cannot just reuse `$until`.** Line 129 currently pairs an undefined `$baselineSince` with the *current* leg's `$until`, so even with bounds threaded it would produce an overlapping, not a preceding, window. The baseline needs both of its own bounds.

**Why bounding is also the performance fix.** ADR-079 deliberately leaves the deterministic half uncached, so bounding is the only lever on analyze cost, and the artifact size is what the two model stages pay for. This is not a separate optimization — it falls out of the correctness fix.

**Reversibility.** The change is additive to the `.env` seam plus two arg substitutions; reverting restores the current unbounded behavior with no data rewrite.

### Plan

1. Reproduce: run the workflow for a fixed `--date` and capture `selector.json`, both artifact `selector` blocks, and both digests as the failing baseline.
2. Extend the `history-anatomy-cache` helper with a subcommand that reads the selector sidecar and emits the four bound values (current since/until, baseline since/until) into the run-scoped `.env` file, deriving the preceding day with the same DST-aware rule.
3. Declare `baselineSince` and `baselineUntil` in the workflow `vars:` block; wire the `analyze` stage's two shell actions to source the `.env` file and pass the resolved values.
4. Thread the audited window into the provenance payload so `stamp` publishes real `identity.bounds`.
5. Add the undeclared-var check (R5) — a `spur workflow validate` extension or a repo check that cross-references every `$var` referenced by a stage against the `vars:` block.
6. Confirm ad-hoc mode is untouched: an ad-hoc run's artifact selector equals the operator's bounds.
7. Measure: record artifact bytes and analyze wall-clock per leg, bounded vs unbounded, into the task's evidence.
8. Run `bun run lint`, `bun run test`, and `spur workflow validate` on the changed YAML.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
