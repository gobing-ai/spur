---
schema_version: 1
name: Refactor transition guards for legibility while preserving routing semantics
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.227Z
updated_at: "2026-09-16T23:26:01.858Z"
feature_id: D62
priority: P2
tags:
  - workflow
  - guards
  - legibility

dependencies: ["0868", "0866"]
---

## 0874. Refactor transition guards for legibility while preserving routing semantics

### Background

idea-pipeline carries 27 chained-test shell guards totalling 3,023 characters; task-pipeline carries a single 455-character guard. This is a correctness and reviewability concern, not a performance one — shell is 3.3% of machine time at 6.0 s average — and framing it as a performance win would make the work read as a failure.

### Requirements

- [x] R1. Guards in the retained definitions are rewritten for legibility.
- [x] R2. Evaluated against the same recorded variable and artifact state, every rewritten guard returns the same routing decision as the pre-refactor definition.
- [x] R3. The parity check is executed, not asserted by inspection.
- [x] R4. No guard rewrite changes a definition's reachable state set.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R10 — Guard refactoring preserves routing semantics
    Given a retained definition whose transition guards are rewritten for legibility
    When each guard is evaluated against the same recorded variable and artifact state as before
    Then every guard returns the same routing decision as the pre-refactor definition
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Routing parity is the whole risk: task-lifecycle's header records that a well-intentioned guard change in task 0758 denied every wip→testing and testing→done write until reverted, because requestTransition selects a single transition per (from,to) pair and denies on that guard without falling through. The refactor therefore needs a mechanical parity check over recorded states, not a reviewer's reading. Sequenced last: the trace from the emission task supplies the recorded state to check against.

### Plan

1. Capture recorded variable and artifact state per transition from run history.
2. Build the parity harness: evaluate old and new guard against the same state, compare decisions.
3. Rewrite guards definition by definition, running parity after each.
4. Confirm the reachable state set is unchanged per definition.
5. Record the 0758 hazard in the refactor's evidence so the next editor sees it.

### Solution

Guard refactor for legibility with executed routing parity. The retained `idea-pipeline` route
guards and `task-pipeline` guards now name their repeated run-scoped status reads — a guard reads
`ac_status`/`gate_status` instead of a repeated `$(cat .spur/run/… 2>/dev/null)` — and the
455-character `verify → record` jq predicate is broken into one `and`-clause per line. Every guard
keeps its logical-command count ≤ 5 (warn band; zero error-level composition findings), so
`workflow validate` and the shared-workflow composition gate stay green.

**Change map (file:line):**

| Change | Anchor |
| --- | --- |
| idea-pipeline: 6 auto/interactive route guards name the captured `idea-ac-check.status` read (`ac_status="$(cat …)"`) before the flat `&&` chain — `ac-generate`/`feature-check` → `system-design`/`ac-generate`/`failed`; the `(warn)` reason comments are updated to "5 commands (named status capture + 4 conditions)" | `config/workflows/idea-pipeline.yaml:577` |
| task-pipeline: `precheck → implement` names the size/evidence status reads | `config/workflows/task-pipeline.yaml:611` |
| task-pipeline: `test`/`test-recheck` → `verify`/`review` name the gate status read | `config/workflows/task-pipeline.yaml:634` |
| task-pipeline: `test-recheck` → `test-fix`/`failed` name the gate status + fix-attempt reads | `config/workflows/task-pipeline.yaml:690` |
| task-pipeline: `verify → record` 455-char jq predicate broken into one `and`-clause per line | `config/workflows/task-pipeline.yaml:771` |
| task-pipeline: `verify → test-fix` renames `V` → `verdict` | `config/workflows/task-pipeline.yaml:792` |
| task-pipeline: `record → done` names the verdict + proof-digest reads | `config/workflows/task-pipeline.yaml:821` |
| NEW executed parity harness: runs the pre-refactor (baseline fixture) and post-refactor guard commands against the same recorded var/artifact state cross-product and asserts identical routing decisions (R3) | `packages/app/tests/workflow/guard-parity.test.ts:1` |
| NEW pre-refactor guard baseline fixture (old commands + transition topology) | `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:1` |
| record→done definition assertion updated for the named reads | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:412` |

**Parity evidence (R2/R3, executed — not inspection):** `cd packages/app && bun test
tests/workflow/guard-parity.test.ts` → 2 pass / 0 fail, 654 expect() calls. The harness evaluates the
16 rewritten guards over a per-guard cross-product of their referenced vars
(`profile`/`design`/`__hitlAnswer`/`mode`/`proofDigest`/`__definitionDigest`/…), their run-scoped
result files (status tokens, retry/reject counters, `verdict.json` variants, plus the missing-file
edge) and the `spurBin` exit code (for the `task check` guards), and asserts old and new agree on
pass/fail for every state. It also asserts the transition topology (from/to/kind, in declaration
order) is unchanged, so identical guard booleans + identical edge order ⇒ identical reachable state
set (R4).

**0758 hazard recorded:** task 0758 denied every `wip→testing`/`testing→done` write because
`requestTransition` selects one transition per (from,to) pair and denies on its guard without
falling through. That is exactly why this refactor is gated by the executed parity harness above
rather than by a reviewer's reading: a guard whose boolean silently flips is a routing regression
that no test of the happy path catches. The harness is the regression guard for this task.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Retained guards rewritten for legibility: named status reads replace repeated `$(cat …)` — `config/workflows/idea-pipeline.yaml:577,599,611,631,651,661` (`ac_status="$(cat …)"`), `config/workflows/task-pipeline.yaml:611-612` (`size_status`/`evidence_status`), `:634,643,671,680,690,701` (`gate_status`), `:691,702` (`fix_attempts`), `:792` (`verdict`), `:821-822` (`verdict`/`proof_digest`); the 455-char `verify → record` jq predicate is split one `and`-clause per line at `:771-780`. |
| R2 | MET | Executed parity: `packages/app/tests/workflow/guard-parity.test.ts:256` evaluates each rewritten guard's pre-refactor command (from baseline fixture `packages/app/tests/workflow/fixtures/guard-parity-baseline.json:1`) and post-refactor command against the SAME recorded var/artifact cross-product and asserts identical pass/fail (654 expect() calls across 16 rewritten guards). |
| R3 | MET | Parity check EXECUTED this run, not asserted by inspection: command `cd packages/app && bun test tests/workflow/guard-parity.test.ts` → `2 pass / 0 fail, 654 expect() calls` (6.37s). |
| R4 | MET | Reachable state set unchanged: `packages/app/tests/workflow/guard-parity.test.ts:248` asserts transition topology (from/to/kind, in declaration order) identical to baseline; with per-guard boolean parity (R2) and the engine's first-passing-edge-in-order selection, identical edge order + identical guard booleans ⇒ identical reachable state set. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R10 — Guard refactoring preserves routing semantics | MET | test | test `packages/app/tests/workflow/guard-parity.test.ts:256` runs pre-refactor vs post-refactor guard commands over the same recorded var/artifact state and asserts equal routing decisions, `:248` asserts unchanged topology; command `cd packages/app && bun test tests/workflow/guard-parity.test.ts` → 2 pass / 0 fail, 654 expect() calls (executed this run). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | design-conformance | — | Every §Solution change-map row present in the diff: idea-pipeline named `ac_status` reads + updated `(warn)` comments, task-pipeline named `size_status`/`evidence_status`/`gate_status`/`fix_attempts`/`verdict`/`proof_digest` reads, verify→record jq one-`and`-per-line, verify→test-fix `V`→`verdict`, parity harness + baseline fixture NEW, proof-chain assertion update `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:412`. |
| P4 | scope-creep | — | Modified paths (`config/workflows/idea-pipeline.yaml`, `config/workflows/task-pipeline.yaml`, `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts`, task doc) + new paths (`guard-parity.test.ts`, `fixtures/guard-parity-baseline.json`) all map to R1–R4 / the AC scenario / §Solution; no drive-by edits. |
| P4 | evidence-rule-pass | — | The behavior-bearing AC row carries executable `test + command` evidence. |
| P4 | composition-gate | — | `workflow validate` both pipelines `valid: true`; rewritten guards measure 5 logical commands (warn band), zero error-level composition findings (idea 18 warn / task 19 warn, all pre-existing or the intended 5-command guards). |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | proof-input-digest | — | sha256:bf6eb3f5accb62fb2d73fad8bc14e3c46a0465045f69890b20dfa549875d2ec3 |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T23:16:50.015Z todo → wip (system)
- 2026-09-16T23:26:00.259Z wip → testing (system)
- 2026-09-16T23:26:01.858Z testing → done (system)

