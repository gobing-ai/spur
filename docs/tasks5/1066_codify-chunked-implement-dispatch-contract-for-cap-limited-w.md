---
schema_version: 1
name: codify chunked implement dispatch contract for cap limited worker models
status: todo
template: issue
created_at: 2026-10-03T04:25:11.249Z
updated_at: "2026-10-03T04:38:31.485Z"

feature_id: B1
priority: P3
ac_altitude: task-local
---

## 1066. codify chunked implement dispatch contract for cap limited worker models

### Background

Surfaced 2026-10-02 during task 1059's implement stage (runall-D63-2ebbd97c, worker model glm-5.3-flash).

Four consecutive single-shot implement dispatches died with `stopReason=length`: the model's 16384-token output cap was consumed by one giant thinking block before any file action — three attempts saturated on open-ended reading, one on pure thinking blowout; one worker called `contact_supervisor` mid-death. Splitting the same scope into three small independent chunks (test cases / doc rewrite / task sections) plus an explicit worker contract — "keep every thinking block under ~150 words, act between thoughts, never plan the whole task in one block" — succeeded 3/3.

The countermeasure currently lives only in `.spur/context/learnings.md`, the D63 dogfood report, and pitfalls. The inline pipeline driver (plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md) has no dispatch-shaping contract, so the next cap-limited worker dispatch will rediscover this the expensive way.

### Requirements

- [ ] R1. inline-pipeline-driver.md gains a dispatch-shaping contract for cap-limited worker models: split implement briefs into independent chunks ordered by dependency; instruct workers to keep thinking blocks under ~150 words and act between thoughts; never pack the whole task plan into one dispatch.
- [ ] R2. The contract names the failure signature (`stopReason=length`, zero-output attempts, optional contact_supervisor-before-death) and the fallback ladder: re-chunk smaller → host-session inline execution.
- [ ] R3. The contract is model-agnostic (triggered by observed cap behavior, not a hardcoded model list) and cites the 2026-10-02 D63 1059 evidence.
- [ ] R4. Cross-references: pitfalls entry (done 2026-10-02) and the dogfood report link the contract; the implement stage's dispatch guidance links to it.

### Acceptance Criteria

- [ ] AC1 — The dispatch-shaping contract exists in inline-pipeline-driver.md and is linked from the implement-stage guidance. (req: R1, R4)
- [ ] AC2 — Failure signature and fallback ladder are documented verbatim enough to recognize in a live run. (req: R2)
- [ ] AC3 — No model name is hardcoded as a trigger; the D63 evidence is cited as an example. (req: R3)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Driver doc: plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md (per-call execution-tree pin :145-147 is the nearest existing contract section).
- Evidence: 1059 implement dispatch log (4 failed attempts, 3 chunked successes), runall-D63-2ebbd97c run log (.spur/memory/runs/, main tree).
- Dogfood: docs/dogfood/2026-10-02-D63-runall-batch-wt4-dogfood.md F2 (local).
- Pitfalls: .spur/context/pitfalls.md 2026-10-02 entry.

### History
