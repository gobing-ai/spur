---
schema_version: 1
name: Reuse check receipts across task-pipeline stages as a measured candidate
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.004Z
updated_at: "2026-09-24T00:26:34.023Z"
feature_id: D64
priority: P2
tags:
  - workflow
  - checks
  - promotion

dependencies: ["0938", "0939"]
estimate_hours: 4
---

## 0940. Reuse check receipts across task-pipeline stages as a measured candidate

### Background

Implements: R7 — The comprehensive check runs once at the quality boundary; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §4 and §7 (check dedup candidate).

**Refine corrections (2026-09-23)**

1. *verify and record do not re-run the gate.* The claim was that `test-recheck`, `verify` and `record` re-run the quality gate. In `config/workflows/task-pipeline.yaml`, `verify` (line 470) and `record` (line 540) only read `<wbs>-test-gate.status` and `<wbs>-verdict.json` (lines 538, 661–728). The gate executes only at `test` (line 341) and `test-recheck` (line 416).
2. *precheck is already structural.* `precheck` already runs only size/evidence status plus `spur task check`. The original R2 is already true: it becomes a regression assertion, not a change.
3. *Recheck is already partly de-duplicated.* `test-recheck` already runs probe-then-full (0587 R3). A red `gateProbeCmd` skips the full gate. `/sp:dev-fixall --gate-log` already skips its own confirming gate (`dev-operations.md` around line 540).
4. *Where the duplication actually is:*
   - Model stages re-run tests by checklist instruction: `plugins/sp/skills/spur-dev/references/gate-checklists.md:93` ("Tests pass (`bun run test`)") and `plugins/sp/skills/code-verification/references/secu-review.md:85` ("All tests pass (`bun run test` exits 0)"). The review `agent.run` executes these on an unchanged tree.
   - `test-recheck` runs a full gate even when the fix pass produced no tracked-source change, meaning the recaptured `proofDigest` equals the digest of the last FAIL.

### Requirements

- [ ] R1. `gate-checklists.md` (review gate) and `secu-review.md` replace "run `bun run test`/`bun run lint`" with "confirm `.spur/run/<wbs>-check-receipt.json` via `quality-gate.ts status` reports `reuse: true` for the current digest; run `bun run spur-check` only when it reports stale or missing". A model stage never re-runs the full chain on a reusable receipt.
- [ ] R2. At `test-recheck`, when the recaptured `proofDigest` equals the `inputDigest` of a `status: FAIL` full receipt, the gate is skipped. The stage writes `FAIL` to `-test-gate.status` with a `no-progress` line in the gate log and routes through the existing FAIL transitions. Attempts still count, so the existing cap still bounds the loop.
- [ ] R3. Every reuse or skip emits a `check.reused` or `check.skipped-no-progress` line in the gate log and the action result `data`, identically on inline and subprocess surfaces, because both run the same `quality-gate.ts`.
- [ ] R4. Regression assertion: `precheck` executes no `qualityGateCmd`, and `verify`/`record` execute no gate command. A composition-baseline or YAML test fails if one is added.
- [ ] R5. A `config/workflow-candidates.json` record `check-dedup-task-pipeline` with:
  - `canonical: task-pipeline`;
  - `delta.baselineAgentRunCount` from the 0938 baseline;
  - a deadline 60 days out.

  Its verdict cites 0938 wall-time deltas for `test-recheck` and `review`. If it does not beat the baseline, it is reverted (ADR-076).

### Acceptance Criteria

- [ ] AC1 — The comprehensive check runs once at the quality boundary
- [ ] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:57.032Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:26:33.814Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Dedup targets are model-stage checklists and no-progress rechecks.** verify, record and precheck never ran the gate. That was a premise error in the original task.
- **No new YAML states.** The recheck skip lives in `quality-gate.ts`, which both surfaces already share.
- **Depends on 0938 (baseline) and 0939 (receipt).** 0937 is transitive.
- **Estimate: 4h** (plus shadow-run wall time).

### Design

**Approach.**
- *Recheck skip.* Add a pure check in `quality-gate.ts` recheck mode, before the probe: read the receipt, and if `status == FAIL && inputDigest == env.proofDigest`, do the no-progress FAIL write. It uses 0939's `readReceiptStatus` helper and needs no YAML change: the state already passes `proofDigest`.
- *Model-stage dedup.* Edit only the two reference docs. Review keeps its full-gate-before-review invariant because the `test → review` and `test-recheck → review` guards still read a PASS that only the full gate writes.

**Frozen names:**
- candidate id `check-dedup-task-pipeline`;
- log markers `check.reused`, `check.skipped-no-progress`.

**Invariants:**
- `review` is entered only after a full PASS for the current digest.
- The attempt cap is unchanged.
- The soft-fail exit-0 contract holds.

**Rejected alternatives:**
- Removing `test-recheck`, which loses protection after fix edits.
- Adding new YAML states, which gains nothing because the decision lives in the gate script.
- Having verify/record read receipts, which they don't need because they don't run the gate.

**Anti-patterns:**
- Reusing a `light` receipt for review.
- Comparing against a digest captured before `test-fix`.

**Target.** Measured `test-recheck` wall time on no-progress loops drops to about the probe cost. Review `agent.run` duration is non-increasing versus the 0938 baseline.

### Plan

1. Recheck no-progress branch in `quality-gate.ts`, with a test in `plugins/sp/tests/quality-gate-receipt.test.ts` covering: FAIL receipt with the same digest → skip; different digest → normal; PASS receipt → normal recheck.
2. Edit `gate-checklists.md:93` and `secu-review.md:85` to use the receipt. Run `bun run plugin-smoke`.
3. R4 regression test in `packages/app/tests/workflow/` (a resolved-facts or YAML scan of the `precheck`, `verify` and `record` states for `qualityGateCmd`/`quality-gate.ts`).
4. Candidate record, then run `bun scripts/spur-dev.ts promotion` validation.
5. After shadow runs, evaluate using the 0938 report and record the verdict.
6. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: D64 (docs/features/D64_measured-decision-explicit-check-deduplicated-workflow-catalogue.md), under D6
- Design: docs/design/workflow-catalogue-refactor.md
- ADRs: ADR-124 (check receipts), ADR-125 (decide action), ADR-126 (fleet executor); retains ADR-076/117/119/121/123
- Related: docs/design/workflow-execution-economy.md, docs/design/fleet-config-declaration.md, docs/design/inter-agent-control-plane.md

### History
