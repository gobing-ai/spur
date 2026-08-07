---
template: feature-impl
schema_version: 1
name: "Add spur history --source all fan-out with per-source failure isolation and a spur history daily command"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0465", "0474"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.341Z"
updated_at: "2026-08-07T06:45:18.079Z"
---

## 0470. Add spur history --source all fan-out with per-source failure isolation and a spur history daily command

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on tasks 0465 and 0468.**

Task 0464 ruled that **fan-out belongs in `spur history`, not in whatever schedules it** — placing
isolation in the CLI means it holds no matter what invokes the command: launchd, a workflow, or a
human. `--source` currently takes exactly one value defaulting to `pi`
(`apps/cli/src/commands/history.ts:12`), so six agents means six invocations with no shared failure
policy.

**Two behaviors measured during the investigation that this ticket must fix:**

- **An absent source is silently successful.** `spur history import --source opencode --json` returns
  `files=0 lines=0 imported=0` and **exit 0** — bit-identical to a healthy no-op. Under a nightly
  loop, an agent whose history path changed would report success forever while importing nothing.
  `empty` must therefore be its own coverage state, distinct from `ok`.
- **Exit codes cannot express partial success.** Import returns 1 for *any* parse or validation error
  (`apps/cli/src/commands/history.ts:27`). Under fan-out that makes one noisy source indistinguishable
  from six dead ones, so the loop's health signal is useless.

**"Yesterday's sessions" is not a date window.** Task 0457 verified that incremental mode resumes
correctly from checkpoints, so the nightly import takes **no date argument** — it imports whatever
arrived since the last checkpoint. That is both the correct semantics and self-healing: a missed
night is picked up the next night with no gap and no double-count. Only the analyze step takes a
window, and only to scope the report.

**Ordering constraint (task 0464 § R7):** the realpath-normalization fix in task 0465 must land first.
Its path-identity defect produces duplicate checkpoint rows per physical file, and under `--source
all` that hits every source on every run, since each agent directory under `$HOME` is a symlink.

Full spec: task 0464 `### Design` § R7.
### Requirements
- R1 — Accept `--source all` on `spur history import`, iterating the known sources, so six agents no longer require six invocations.
- R2 — Isolate per-source failure: a throwing source is caught, recorded with its error, and the loop continues; one source can never abort another. Each source commits its own transaction so a mid-import failure leaves that source's checkpoint intact for the next run without rolling back its siblings.
- R3 — Replace the binary exit contract with 0 for all sources ok, 2 for partial success where at least one source succeeded and at least one failed, and 1 only when every source failed.
- R4 — Report a source that discovered zero files as an `empty` coverage state distinct from `ok`, and treat a source that was non-empty on the previous run and is empty now as a warning rather than a success.
- R5 — Bound each source with its own timeout so one pathological corpus cannot hang the whole run past its window.
- R6 — Add a `spur history daily` command performing import-all, analyze, artifact write, and report-retention prune in one run-once invocation suitable for an external scheduler.
- R7 — Take no date argument on the nightly import path, relying on checkpoint resume, so a missed run self-heals on the next run without gaps or double-counting.
- R8 — Emit a per-source coverage summary into the analyze artifact so the report can show which sources contributed and which failed or were empty.
### Acceptance Criteria
```gherkin
Feature: 0470 multi-source fan-out isolates failure

  Scenario: R2 — one failing source does not abort the others
    Given six configured sources where one raises during import
    When import runs with --source all
    Then the remaining five sources complete and persist their records
    And the failing source is recorded with its error in the coverage summary

  Scenario: R3 — partial success is distinguishable from total failure
    Given a run where at least one source succeeded and at least one failed
    When the command exits
    Then the exit code is 2
    And a run where every source failed exits 1
    And a run where every source succeeded exits 0

  Scenario: R4 — an empty source is not silently successful
    Given a source whose history directory contains no files
    When import runs with --source all
    Then that source is reported with an empty status rather than ok
    And a source that was non-empty on the previous run and is now empty is reported as a warning

  Scenario: R7 — a missed night self-heals
    Given the nightly run did not execute for two days
    When the next nightly run executes
    Then every record appended during the gap is imported exactly once
    And no duplicate ledger rows are produced

Scenario: R1 — one invocation covers every source
    Given six configured sources
    When import runs with --source all
    Then every configured source is attempted in a single invocation

  Scenario: R5 — a pathological source cannot hang the run
    Given one source whose import exceeds its configured timeout
    When import runs with --source all
    Then that source is abandoned at its deadline and recorded as failed
    And the remaining sources still complete

  Scenario: R6 — the daily command is one run-once invocation
    Given an external scheduler invoking the daily command
    When it runs
    Then import-all, analyze, artifact write, and retention prune all occur in that single process
    And the process exits rather than staying resident

  Scenario: R8 — coverage travels into the artifact
    Given a fan-out run where sources succeeded, failed, and were empty
    When the analyze artifact is written
    Then it carries a per-source coverage entry for each of those outcomes
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

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
