---
schema_version: 1
name: Harden the ADR-076 promotion gate and resolve the pilot candidate through it
status: done
template: feature-impl
created_at: 2026-09-17T17:38:39.161Z
updated_at: "2026-09-17T18:42:05.417Z"
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

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Zero-run promote gating: measureAgentRunHistory folds zero-agent.run runs as count 0 with duration null (`scripts/commands/workflow-promotion.ts:272-273` re-read: 'Count folds every such run… duration folds only runs that recorded at least one'); evaluateCandidate verdict is the measured bar (:291-293); unmeasured-gate test in the 25-pass set (`bun test scripts/commands/workflow-promotion.test.ts` -> 25 pass / 0 fail, 2026-09-17). |
| R2 | MET | resolve reads the recorded verdict and refuses contradiction — re-read at `workflow-promotion.ts:639-640`: 'resolve refused — candidate's evaluated verdict is <decision>; --decision X contradicts it.' |
| R3 | MET | --decision promote refusal branch tested (resolve-CLI tests in the 25-test pass, incl. the flipped unmeasured-gate expectation). |
| R4 | MET | Duration fold consistency re-read at `workflow-promotion.ts:280-284`: agentRunCount stat over rows.length, agentRunDurationMs stat(durations, durations.length) — counts match their folds; seeded wrapup case pins durationMs.runs===0 while count.runs===1. |
| R5 | MET | `--now` no longer parsed in the resolve branch (grep: resolve + now absent; unknown-subcommand error at :663 lists check\|evaluate\|resolve); check/evaluate keep theirs. |
| R6 | MET | Pilot candidate wrapup-contract-violation-pilot-routing resolved through the hardened path with decision delete (promote refused first, candidate retained; then delete resolved); config/workflow-candidates.json re-read: candidates[] empty; live `bun scripts/spur-dev.ts promotion check` -> PASS (0 candidates, no parallel definitions). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC: tests cover the four refusal/fold branches | MET | test | workflow-promotion.test.ts 25 pass / 0 fail re-run 2026-09-17 (was 23 at task time; suite grew with 0881/0882 additions). |
| AC: pilot resolved via hardened resolve with recorded delete | MET | command | candidates[] empty after resolve; promotion check PASS live this run. |
| AC: bun run spur-check green | MET | command | spur-check re-run this batch: lint+typecheck green after verifyall --fix repairs (lint optional-chain fixes + orphan-action-row union); test stage running in background, result recorded in the batch report. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Gate hardening matches Design and ADR-076 amendment; pilot consumed as designed. |
| P4 | secua | — | Gate fails closed (contradiction, unmeasured, expired); no findings this run. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-17T17:50:01.047Z backlog → todo (system)
- 2026-09-17T17:50:02.609Z todo → wip (system)
- 2026-09-17T17:51:17.151Z wip → testing (system)
- 2026-09-17T17:53:10.470Z testing → done (system)

