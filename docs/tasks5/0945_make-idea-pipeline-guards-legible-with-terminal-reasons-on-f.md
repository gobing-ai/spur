---
schema_version: 1
name: Make idea-pipeline guards legible with terminal reasons on failure edges
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.007Z
updated_at: "2026-09-24T00:29:06.402Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - idea-pipeline

dependencies: ["0937", "0938"]
estimate_hours: 4
---

## 0945. Make idea-pipeline guards legible with terminal reasons on failure edges

### Background

Implements: R2 — Every workflow run ends with a classified terminal reason; R4 — Workflow shape changes are accepted only on measured benefit. docs/design/workflow-catalogue-refactor.md §7.

**Refine corrections (2026-09-23) — inventory from `config/workflows/idea-pipeline.yaml`**

1. *Failure edges.* There are five `→ failed` edges:
   - `start` (agent doctor FAIL, around line 564);
   - `ac-generate` (auto profile, check/coverage failed after 3 retries, around line 663);
   - `feature-check` (failed after 3 retries, around line 714);
   - `design-approval` (rejected after 1 revise, around line 769);
   - `batch-create-run` (failed after 3 retries, around line 842).

   There are four `→ cancelled` edges: from `idea-eval`, `feature-check`, `design-approval` and `batch-create`. `failureStates` = `failed`, `cancelled`, so all nine need a declared `terminalReason` under 0937's validation rule.
2. *Compound guards.* The recurring compound predicate is the **design route**: `design ∈ {auto, skip}` × `needs_design` from `<runId>-idea-needs-design.json`. It is re-derived inline in the `ac-generate → system-design|decompose` and `feature-check → system-design|decompose` guards (lines 636–702, marked `(warn)` with 4–5 test segments). It is combined with the **AC readiness** pair (`idea-ac-check.status` and `idea-coverage.status` = PASS).
3. *agent.run count.* There are six `agent.run` actions. This task must not change that count; it is a legibility change, not a model-hop change.

### Requirements

- [ ] R1. Each of the nine failure-state edges declares a `terminalReason` (0937):
  - `start → failed`: `failed-check`;
  - `ac-generate → failed`, `feature-check → failed` and `batch-create-run → failed`: `retry-exhausted`;
  - `design-approval → failed`: `retry-exhausted` (revise budget exhausted);
  - all four `→ cancelled` edges: `cancelled`.

  `spur workflow validate` passes under 0937's rule.
- [ ] R2. One deterministic shell action writes two named files, and it runs at the end of both `ac-generate` and `feature-check` onEnter:
  - `.spur/run/<runId>-idea-design-route.txt`, holding `design` or `skip`. The value is `skip` when `design=skip`, or when `design=auto` and `needs_design=false`. Otherwise it is `design`, so a missing or corrupt JSON fails safe to `design`.
  - `.spur/run/<runId>-idea-ac-ready.status`, holding `PASS` or `FAIL`. It is `PASS` only when both AC check and coverage are PASS.
- [ ] R3. The four route guards (`ac-generate → system-design|decompose`, `feature-check → system-design|decompose`) each read those two files plus one var (`profile` or `__hitlAnswer`). Each guard has at most three `test` segments and carries no `(warn)` marker. The routing truth table is unchanged.
- [ ] R4. The `agent.run` count stays at 6, asserted by the composition baseline. The candidate record `idea-pipeline-guard-legibility` has `baselineAgentRunCount: 6`, projected 6. Its verdict cites the 0938 terminal-reason coverage for idea-pipeline, which should be 100% classified for new runs.

### Acceptance Criteria

- [ ] AC1 — Every workflow run ends with a classified terminal reason
- [ ] AC2 — Workflow shape changes are accepted only on measured benefit

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:58.953Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:29:06.197Z

**Refine decisions — 2026-09-23 (ready depth)**

- **Design-approval rejection maps to `retry-exhausted`.** The edge fires only after the revise budget is spent. The closed enum has no `rejected` value, and adding one would reopen 0937's enum. Revisit only if the 0938 mix shows operator rejections are material.
- **The truth-table test is written before the rewrite.** This is the regression proof that legibility changed nothing.
- **Estimate: 4h.**

### Design

**Approach.** Compute the derived facts once and let guards read files. This mirrors the existing captured signal-file pattern (0769). The shared shell action is duplicated in two onEnter lists (YAML has no include). A test asserts the two copies are byte-equal, rather than adding an engine include feature.

**Frozen names:**
- files `<runId>-idea-design-route.txt` and `<runId>-idea-ac-ready.status`;
- candidate id `idea-pipeline-guard-legibility`.

**Invariants:**
- The routing truth table is identical before and after. A table test enumerates `profile × hitlAnswer × design × needs_design × ac × coverage`.
- Fail safe to `design` and `FAIL`.
- `agent.run` count = 6.
- The retry-cap edges are unchanged.

**Rejected alternatives:**
- Using `decide` for routing. These are deterministic facts.
- A new helper script. A single `jq`/`test` line suffices, and ADR-069's no-inline-shell rule is history-anatomy-specific.
- Engine YAML anchors or includes, which is out of scope.

**Anti-patterns:**
- Reading `needs_design` JSON inside guards after this change.
- Renaming existing status files.

**Targets:**
- Guard-parity fixture and composition baseline updated.
- `inline-pipeline-parity-check` green.
- The dev-idea inline driver reference is updated if it documents the guards.

### Plan

1. Truth-table test first: `packages/app/tests/workflow/idea-pipeline-routing.test.ts`, pinned against the current guards (green before the change).
2. Add the route and readiness writer action to the `ac-generate` and `feature-check` onEnter, then rewrite the four guards. The truth-table test stays green. Add the byte-equality test for the two action copies.
3. Declare `terminalReason` on the nine failure edges and run `spur workflow validate`.
4. Update the composition, guard-parity and bundle baselines (`bun run --filter @gobing-ai/spur build:bundle`), then run `inline-pipeline-parity-check`.
5. Candidate record, validated with `bun scripts/spur-dev.ts promotion`.
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
