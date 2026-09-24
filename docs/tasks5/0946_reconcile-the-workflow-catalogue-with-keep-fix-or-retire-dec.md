---
schema_version: 1
name: Reconcile the workflow catalogue with keep, fix or retire decisions
status: todo
template: feature-impl
created_at: 2026-09-24T00:13:17.007Z
updated_at: "2026-09-24T00:29:37.630Z"
feature_id: D64
priority: P3
tags:
  - workflow
  - catalogue

dependencies: ["0938", "0943", "0944", "0945"]
estimate_hours: 5
---

## 0946. Reconcile the workflow catalogue with keep, fix or retire decisions

### Background

Implements: R10 — Catalogue workflows are kept, fixed or retired on evidence. docs/design/workflow-catalogue-refactor.md §8. Initial suspects: pr-review, wayfinder, decision-routing-example.

**Refine corrections (2026-09-23)**

1. *Catalogue and wayfinder name.* `config/workflows/` holds ten definitions:
   - decision-routing-example
   - feature-lifecycle
   - feature-verification
   - history-anatomy
   - idea-pipeline
   - pr-review
   - task-lifecycle
   - task-pipeline
   - wayfinder-resolution
   - wrapup-pipeline

   The suspect "wayfinder" is `wayfinder-resolution`.
2. *Retirement machinery exists.* `config/workflow-candidates.json` already carries `retirements[]` records (`{name, recordedBy, date, rationale}`, for example planning-pipeline and task-pipeline2). `bun scripts/spur-dev.ts promotion` fails on `unrecorded-retirement` and `parallel-definition` (`scripts/commands/workflow-promotion.ts:124`). A retirement is a YAML delete **plus** a retirement record, not a free-form edit.
3. *Caller surface per suspect*, non-test references under plugins, apps/cli/src, packages/app/src and scripts:
   - `pr-review`: about 10;
   - `wayfinder-resolution`: about 4;
   - `decision-routing-example`: only `plugins/sp/README.md` among those. It is also referenced from `config/pipeline-budgets.json`, `docs/design/workflow-composition-contract.md` and `docs/design/cli-contracts.md`.
4. *History-anatomy graph decision.* This moved here from 0944, which is measurement-only.
5. *Bookkeeping workflows.* `task-lifecycle` and `feature-lifecycle` (0937 `BOOKKEEPING_WORKFLOWS`) are exempt from cost-based retirement. They are judged on correctness only.

### Requirements

- [ ] R1. A decision table is added as §10 "Catalogue reconciliation" of `docs/design/workflow-catalogue-refactor.md`. It has one row per workflow (all ten), and each row gives:
  - the `keep | fix | retire` decision;
  - evidence: 0938 run count since 2026-06-01, `agent.run` median, wall p50/p90 and terminal-reason mix;
  - live caller count;
  - a one-line reason.

  Bookkeeping workflows are judged on correctness, not cost. `history-anatomy` cites the 0944 measurement.
- [ ] R2. Every `retire` deletes the YAML under `config/workflows/`, reroutes or removes every caller (plugin commands/skills/README, `config/pipeline-budgets.json`, design-doc mentions) and appends a `retirements[]` record. It then regenerates `apps/cli/config/` via `bun run --filter @gobing-ai/spur build:bundle` and updates the composition, guard-parity and catalog-parity baselines. `bun scripts/spur-dev.ts promotion` passes.
- [ ] R3. Every `fix` becomes a follow-up task under feature D64 via `spur task create`, with the evidence row cited in its Background. This task does not implement fixes.
- [ ] R4. The decision rule is applied mechanically. `retire` requires zero real (non-dry, non-bookkeeping) runs in the window **and** either no live caller or an example-only role. A workflow with fewer than 3 runs but live callers is `keep` with a follow-up measurement note, never a retirement.

### Acceptance Criteria

- [ ] AC1 — Catalogue workflows are kept, fixed or retired on evidence

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-24T00:13:59.335Z

- **Scope accepted (idea-eval, 2026-09-23):** the operator accepted the reshaped evaluation: add deterministic evidence states, not more model states, and add a bounded DecisionMaker. They added I9 (`spur-check` primitive) and I10 (optional fleet executor).
- **Design accepted (2026-09-23):** docs/design/workflow-catalogue-refactor.md, with ADR-124/125/126 at Proposed status.
- **Deferred:** a public `spur check` verb. It needs separate operator consent (harness-surface governance).
- **Sequencing:** no implementation starts before D63, E7, H53 and H1 are done. The chain root 0937 carries their open tasks as dependencies.

#### Q&A entry — 2026-09-24T00:29:37.438Z

**Refine decisions — 2026-09-23 (ready depth)**

- **The mechanical retire rule is zero real runs AND (no live caller OR example-only).** This makes decisions reproducible and prevents cost-only retirement of a live surface.
- **Bookkeeping workflows are judged on correctness only.** Their run counts are lifecycle transitions, not work.
- **This task owns the history-anatomy graph decision.** It moved from 0944.
- **`spur-check-feature` runs here once.** This is the last D64 task.
- **Estimate: 5h.**

### Design

**Approach.** Take evidence first, then apply one mechanical rule, then delete (ADR-076 "delete, don't layer"). The rule in R4 makes decisions reproducible from the 0938 report and the caller grep. The table lives in the D64 satellite as the durable record; the task holds only execution evidence.

**Frozen names:**
- section `§10 Catalogue reconciliation`;
- retirement records use the existing `{name, recordedBy: "0946 (D64)", date, rationale}` shape.

**Invariants:**
- No caller points at a deleted definition. A test or grep asserts zero references outside `retirements[]` and history docs.
- Bundle regenerated.
- `promotion` check green.
- Historical run rows are retained, never deleted.

**Rejected alternatives:**
- Deprecation shims kept indefinitely.
- Retiring on cost alone while live callers exist.
- Retiring bookkeeping workflows on cost.

**Anti-patterns:**
- Editing `drizzle/_legacy_reference/`.
- Deleting run history.
- Implementing `fix` items here.

**Expected outcome (hypothesis, not a decision):**
- `decision-routing-example` is likely `retire`: it is example-only, with only README, budget and doc references.
- `pr-review` and `wayfinder-resolution` depend on the measured runs.

### Plan

1. Run `bun scripts/spur-dev.ts real-run-cost --by-state --json --since 2026-06-01` (0938) and a caller grep per workflow. Save both as evidence in the Solution section.
2. Apply the R4 rule and write §10 of the design satellite.
3. For each `retire`: delete the YAML, reroute or remove callers, append a `retirements[]` record, run `build:bundle`, and update the baselines. Run `bun scripts/spur-dev.ts promotion`.
4. For each `fix`, run `spur task create` under D64 with an evidence citation and dependencies.
5. Run `bun run spur-check`, then `bun run spur-check-feature` (the feature-scoped repo-wide pass at feature close, ADR-119).

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
