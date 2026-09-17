---
schema_version: 1
name: Refuse retiring workflow definitions that still have real non-dry runs
status: done
template: feature-impl
created_at: 2026-09-17T17:41:14.081Z
updated_at: "2026-09-17T19:02:35.705Z"
feature_id: D62

---

## 0882. Refuse retiring workflow definitions that still have real non-dry runs

### Background

Captured from the creation title: "Refuse retiring workflow definitions that still have real non-dry runs".

### Requirements

- A check refuses retiring a workflow definition that still has real (non-dry) terminal runs absent a recorded decision, reading `runs × metadata_json.dryRun` — the column 0866's verdict table used (0866 review finding 6).

### Acceptance Criteria

- Refusal test with mixed dry/non-dry history; clean retirements pass.
- `bun run spur-check` green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `scripts/commands/workflow-promotion.test.ts:388` |
| `scripts/commands/workflow-promotion.test.ts:8` |
| `scripts/commands/workflow-promotion.ts:111` |
| `scripts/commands/workflow-promotion.ts:117` |
| `scripts/commands/workflow-promotion.ts:122` |
| `scripts/commands/workflow-promotion.ts:22` |
| `scripts/commands/workflow-promotion.ts:35` |
| `scripts/commands/workflow-promotion.ts:37` |
| `scripts/commands/workflow-promotion.ts:421` |
| `scripts/commands/workflow-promotion.ts:540` |
| `scripts/commands/workflow-promotion.ts:548` |
| `scripts/commands/workflow-promotion.ts:560` |
| `scripts/commands/workflow-promotion.ts:574` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `scripts/commands/workflow-promotion.ts:470` re-read: checkRetirementGuard flags unrecorded-retirement when a definition absent from config/workflows/ has real non-dry terminal runs (countRealTerminalRuns reads runs × metadata_json.dryRun — the 0866 column) and no retirements[] decision; wired into the catalogue check at :578; historical planning-pipeline/task-pipeline2 decisions recorded in config/workflow-candidates.json retirements[] (re-read). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC: refusal test with mixed dry/non-dry history; clean retirements pass | MET | test | workflow-promotion.test.ts:418 'refuses retiring a definition with real non-dry terminal runs absent a recorded decision' in the 25-test pass re-run 2026-09-17; recorded retirements produce no findings (live `promotion check` PASS with retirements[] present). |
| AC: bun run spur-check green | MET | command | Repo gates this batch: lint+typecheck PASS (after verifyall --fix repairs to 0879/0881 files), test stage 8416 pass / 0 fail, spur-check-feature exit 0 incl. workflow-promotion-check. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Refusal-by-check (not verdict table) matches the design; recorded decisions for historical retirements present. |
| P4 | secua | — | Fail-closed on unrecorded retirement with real traffic; dry runs excluded via metadata_json.dryRun; no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:02.295Z backlog → todo (system)
- 2026-09-17T18:15:49.604Z todo → wip (system)
- 2026-09-17T18:15:50.256Z wip → testing (system)
- 2026-09-17T18:15:50.823Z testing → done (system)

