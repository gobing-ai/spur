---
schema_version: 1
name: Harden the ADR-076 promotion gate and resolve the pilot candidate through it
status: testing
template: feature-impl
created_at: 2026-09-17T17:38:39.161Z
updated_at: "2026-09-17T17:51:17.151Z"
feature_id: D62

---

## 0878. Harden the ADR-076 promotion gate and resolve the pilot candidate through it

### Background

Captured from the creation title: "Harden the ADR-076 promotion gate and resolve the pilot candidate through it".

### Requirements

- Gate `evaluateCandidate`'s `promote` decision on measured real runs: a candidate with zero recorded runs cannot promote (`scripts/commands/workflow-promotion.ts:284`).
- `resolve` refuses a decision that contradicts the candidate's evaluated `verdict` (`:514-538` never reads it).
- The `resolve --decision promote` refusal branch gets a test.
- The duration statistic's `.runs` count matches its duration fold (`:263` folds `rows.length` over a null-filtered durations array).
- Wire or drop `--now` in the resolve branch (`:427` parses it, never uses it).
- Final acceptance: resolve candidate `wrapup-contract-violation-pilot-routing` (`config/workflow-candidates.json:6`; verdict `delete`, deadline 2026-10-17, measured absence recorded by task 0876) **through the hardened gate**, decision `delete`.

### Acceptance Criteria

- Tests cover: zero-run promote refusal; contradicting-decision refusal; `--decision promote` refusal branch; duration fold count consistency.
- The pilot candidate is resolved via the hardened resolve path with the recorded `delete` decision and reason.
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
| `scripts/commands/workflow-promotion.test.ts:16` |
| `scripts/commands/workflow-promotion.test.ts:161` |
| `scripts/commands/workflow-promotion.test.ts:20` |
| `scripts/commands/workflow-promotion.test.ts:217` |
| `scripts/commands/workflow-promotion.test.ts:219` |
| `scripts/commands/workflow-promotion.test.ts:225` |
| `scripts/commands/workflow-promotion.test.ts:6` |
| `scripts/commands/workflow-promotion.ts:263` |
| `scripts/commands/workflow-promotion.ts:284` |
| `scripts/commands/workflow-promotion.ts:292` |
| `scripts/commands/workflow-promotion.ts:410` |
| `scripts/commands/workflow-promotion.ts:417` |
| `scripts/commands/workflow-promotion.ts:433` |
| `scripts/commands/workflow-promotion.ts:528` |

### Testing

- `bun test scripts/commands/workflow-promotion.test.ts` — 23 pass, 0 fail (49 expects), including the three new resolve-CLI tests and the flipped unmeasured-gate expectation.
- Live gate exercise: `promotion resolve wrapup-contract-violation-pilot-routing --decision promote` → refused (verdict contradiction, candidate retained); `--decision delete` → `resolved … as delete`, candidates left 0, `promotion check` PASS.
- Duration fold pinned: wrapup-pipeline seeded case asserts `agentRunDurationMs.runs === 0` while `agentRunCount.runs === 1`.
- `--now` dropped from resolve (parsed-never-used); check/evaluate keep theirs.

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: UNKNOWN)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No P1–P3 findings; verify verdict UNKNOWN |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.047Z backlog → todo (system)
- 2026-09-17T17:50:02.609Z todo → wip (system)
- 2026-09-17T17:51:17.151Z wip → testing (system)

