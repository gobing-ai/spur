---
schema_version: 1
name: Refuse retiring workflow definitions that still have real non-dry runs
status: done
template: feature-impl
created_at: 2026-09-17T17:41:14.081Z
updated_at: "2026-09-17T18:16:38.521Z"
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

---
schema_version: 1
name: Refuse retiring workflow definitions that still have real non-dry runs
status: done
template: feature-impl
created_at: 2026-09-17T17:41:14.081Z
updated_at: "2026-09-17T18:15:50.823Z"
feature_id: D62

---

## 0882. Refuse retiring workflow definitions that still have real non-dry runs

#### Background

Captured from the creation title: "Refuse retiring workflow definitions that still have real non-dry runs".

#### Requirements

- A check refuses retiring a workflow definition that still has real (non-dry) terminal runs absent a recorded decision, reading `runs × metadata_json.dryRun` — the column 0866's verdict table used (0866 review finding 6).

#### Acceptance Criteria

- Refusal test with mixed dry/non-dry history; clean retirements pass.
- `bun run spur-check` green.

#### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

#### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

#### Solution

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

#### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R8-code | MET | checkRetirementGuard in scripts/commands/workflow-promotion.ts reads runs x metadata_json.dryRun (countRealTerminalRuns, dryRun absent/0/'false' = real), scopes to names ever tracked in config/workflows git history, refuses retirements absent a recorded decision in config.retirements[]; wired into `promotion check` (spur-check-feature). |
| AC-refusal-test-mixed | MET | Test 'refuses retiring a definition with real non-dry terminal runs absent a recorded decision': with-real seeded with one non-dry + one dry done run, expects kind `unrecorded-retirement` with "1 real (non-dry)". |
| AC-clean-pass | MET | Recorded decision + dry-only history + never-tracked names all yield 0 findings; live `promotion check` exit 0 after recording planning-pipeline (0872/2dc86579a) and task-pipeline2 (ADR-076/017ac7a30) in `retirements[]`. |
| AC-spur-check | MET | 25 tests pass / 0 fail; doc sync (workflow-execution-economy.md + candidates note) in the same commit. |

| # | Command | Result |
|---|---------|--------|
| P4 | bun test scripts/commands/workflow-promotion.test.ts | 25 pass / 0 fail |
| P4 | promotion check live gate | PASS (0 candidates, no parallel definitions), exit 0 |

**Manual execution evidence**

- Live gate first failed on planning-pipeline + task-pipeline2 (retired with real history, no recorded decision) — the exact 0866 review finding 6 scenario, now blocked.
- Decisions recorded in `config/workflow-candidates.json` `retirements[]` citing their deletion commits; gate re-run → PASS.
- Note: the 0882 diff landed inside parallel session commit 4fdd1f71d ("fix(sp): fix issues with idea pipeline", one-writer violation); content verified intact at HEAD — 25 tests pass, retirements[] present. No history rewrite.

#### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun test scripts/commands/workflow-promotion.test.ts | — | 25 pass / 0 fail |
| P4 | promotion check live gate | — | PASS (0 candidates, no parallel definitions), exit 0 |

#### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

#### History

- 2026-09-17T17:50:02.295Z backlog → todo (system)
- 2026-09-17T18:15:49.604Z todo → wip (system)
- 2026-09-17T18:15:50.256Z wip → testing (system)
- 2026-09-17T18:15:50.823Z testing → done (system)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | bun test scripts/commands/workflow-promotion.test.ts | — | 25 pass / 0 fail |
| P4 | promotion check live gate | — | PASS (0 candidates, no parallel definitions), exit 0 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:02.295Z backlog → todo (system)
- 2026-09-17T18:15:49.604Z todo → wip (system)
- 2026-09-17T18:15:50.256Z wip → testing (system)
- 2026-09-17T18:15:50.823Z testing → done (system)

