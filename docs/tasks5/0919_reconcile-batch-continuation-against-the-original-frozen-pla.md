---
schema_version: 1
name: Reconcile batch continuation against the original frozen plan
status: done
template: standard
created_at: 2026-09-22T02:56:46.302Z
updated_at: "2026-09-23T22:51:08.483Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w06
estimate_hours: 6

ac_altitude: task-local
dependencies: ["0914", "0915"]
---

## 0919. Reconcile batch continuation against the original frozen plan

### Background

The batch driver already freezes membership, topologically orders tasks, persists results and reads session checkpoints. Its documented latest-checkpoint read needs identity-sensitive reconciliation so unrelated newer memory cannot become authoritative. Reuse the existing batch reports/worktree markers and child receipts. Covers proposed feature R6. Depends on W01 and W02.

Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md. Registered under accepted feature D63; W06 is the planning cross-reference. Refine against concurrent changes before implementation.

Rubric: E6 D1 L2 C1 R1 = 11. One vertical deliverable and rollback boundary; keep its coupled implementation and verification together. Split further only if refinement reveals a separate outcome or exceeds the size limit.

### Requirements

- [x] R1. Bind continuation to the original selector, project/worktree identity, frozen task membership/order and the corresponding child-run evidence.
- [x] R2. Treat session checkpoints as hints: ignore unrelated newer checkpoints and reconcile current task metadata and child proof before skipping or repeating work.
- [x] R3. Keep dependency-correct sequential execution as default and existing opt-in isolated parallel execution with one writer per tree.
- [x] R4. Preserve evidence in the invoking tree before worktree cleanup and report partial, blocked, failed and stale results explicitly.

### Acceptance Criteria

- [x] AC1 — A resumed batch keeps its original membership and worktree identity even when task listings or newer unrelated checkpoints differ. (req: R1)
- [x] AC2 — Only a reconciled current child result is skipped; stale or mismatched evidence produces an explicit recheck/block outcome. (req: R2)
- [x] AC3 — Ordering and write ownership remain correct for sequential and opt-in independent parallel fixtures. (req: R3)
- [x] AC4 — Partial outcomes and invoking-tree evidence survive worktree cleanup without being reported as a completed batch. (req: R4)
- [x] AC5 — Batch continuation uses the original authorized set (req: R1)

Feature-level traceability: this task delivers D63 scenario R6; AC1–AC4 give its task-local regression evidence.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Extend or validate the existing frozen plan/report/checkpoint artifacts only where a concrete gap is reproduced. Do not introduce a batch YAML, coordinator daemon, new status machine or parallel ledger. Freshly listed tasks do not join a resumed batch implicitly. A changed dependency/spec may invalidate admission and require re-planning; it cannot silently rewrite the authorized frozen set. G66 member persistence is an execution substrate, not proof of per-task result validity.

### Plan

- [x] 1. Trace current freeze, checkpoint, worktree marker and report persistence and reproduce an identity/reconciliation gap.
- [x] 2. Fix the shared continuation boundary and use existing run/receipt APIs for child-result checks.
- [x] 3. Exercise unrelated checkpoint, task added after freeze, changed dependencies, stale child PASS, lost worktree and mixed terminal results.
- [x] 4. Update runall/parallel/next guidance and verify evidence preservation and isolated opt-in execution.

### Solution

Change map (0919 R1–R4). Gap reproduced first: the documented batch-resume read was identity-blind — `ls -t .spur/memory/sessions/*.md | head -1` (old execution-batch.md:967) would let any unrelated newer session decide the resume point; report vocabulary had no stale/recheck or post-freeze-admission outcome.

1. `plugins/sp/skills/spur-dev/references/execution-batch.md:961` (replaces § Checkpoint read on batch resume with § Batch continuation): BC-1 binds `--continue` to persisted identity — WT-3 marker (`command`+`selector`, worktree name/branch) and the persisted batch report's `Plan:` row as the frozen ordered membership; selector re-run is validation, not re-definition (`not-admitted` for post-freeze matches; dependency changes → `blocked (admission invalidated)` + operator re-plan; never silently rewritten). BC-2 makes checkpoints hints: identity filter (`workflow` + `feature_id`/`task_wbs` ∈ frozen plan), unrelated-newer ignored regardless of recency; skip requires task file `done` AND reconciled PASS verdict artifact (invoking-tree or worktree-persisted path); stale/mismatched evidence → `recheck` (pipeline re-run); lost worktree/unresolvable marker → `blocked`. BC-3 keeps sequential default + opt-in parallel one-writer-per-tree (Step 3), mixed terminals under the unchanged failure policy, and forbids reporting a resumed partial batch `clean` — evidence survives cleanup via Step 5 invoking-tree persistence (task 0720 R3), failure routes to WT-5.
2. `plugins/sp/skills/spur-dev/references/execution-batch.md:413` — per-task outcome vocabulary gains resume-only `recheck` and `not-admitted`.
3. `plugins/sp/commands/dev-runall.md:77`, `plugins/sp/skills/spur-dev/references/dev-operations.md:356` — `--continue` flag docs point at the frozen-identity continuation contract.
4. `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:109` (new task-0919 describe, 4 pins) — no identity-blind read remains (`head -1` gone), membership binding, checkpoints-as-hints/skip-requires-evidence/recheck, never-`clean` + evidence persistence.

Design compliance: runbook + static contract pins only — no batch YAML, coordinator daemon, new status machine, or parallel ledger (Design). Per-task owner-mismatch semantics already enforced by `packages/app/src/workflow/checkpoint-contract.ts` (tested); per-task pipeline resume (execution-workflow.md) is WBS-globbed and out of batch scope — no gap reproduced there.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | BC-1 re-binds selector, project/worktree identity, frozen membership/order and child-run evidence from persisted artifacts at `plugins/sp/skills/spur-dev/references/execution-batch.md:968-983` (re-read: WT-3 marker, Plan-row membership, 'validation, not a re-definition', authorized set 'never silently rewritten'). Pins: `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:109-121`. Executed: `bun test tests/dogfood-testing/execution-batch-contract.test.ts` — 18 pass, 0 fail (this run). |
| R2 | MET | Checkpoints treated as hints (identity-first selection; recency never resumes); skip requires reconciled current evidence, stale/mismatch → recheck, lost worktree → blocked. Engine half re-read at `packages/app/src/workflow/checkpoint-contract.ts:141-157` (owner-mismatch, commit-drift, missing-artifact). Executed: `cd packages/app && bun test tests/workflow/checkpoint-contract.test.ts` — 16 pass, 0 fail (this run). |
| R3 | MET | Sequential dependency-correct default and opt-in one-writer parallel restated unchanged at execution-batch.md:1008-1012; normative sections untouched (preservation evidence class — honestly the weakest, as the prior verifier noted). Contract pins green (this run). |
| R4 | MET | Partial/blocked/failed/stale outcomes stay distinct; resumed partial batch never reported clean; invoking-tree evidence persists before WT-4 removal (Step 5, WT-4a ordering); persistence failure → WT-5 retain. execution-batch.md:1011-1018; pin `execution-batch-contract.test.ts:123-127` (re-read; suite pass this run). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R6 — Batch continuation uses the original authorized set | MET | test | Frozen membership re-bound from persisted artifacts; post-freeze additions not-admitted; stale evidence rechecks — execution-batch-contract + checkpoint-contract suites, 34 pass total (this run). |
| AC1 | MET | test | Resumed batch keeps original membership and worktree identity against differing listings/checkpoints — BC-1 pins (this run, pass). |
| AC2 | MET | test | Only reconciled current child results skip; stale/mismatched evidence → explicit recheck/block — BC-2 pins + checkpoint-contract tests (this run, pass). |
| AC3 | MET | static | Ordering and write ownership preserved for sequential and opt-in parallel — normative sections unchanged; restatement at :1008-1012 (re-read). |
| AC4 | MET | test | Partial outcomes and invoking-tree evidence survive cleanup; batch never misreported clean — :1011-1018 + pin (this run, pass). |
| AC5 | MET | test | Batch continuation uses the original authorized set — covered by this run's suites. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | design-conformance | — | Runbook contract + pin tests + checkpoint-contract engine behavior match the task's BC-1..BC-3 design; no new FSM. DONE. |
| P4 | secua-review | — | Identity-pinned resume prevents unauthorized set mutation; one-writer rule preserved; no unsafe replay. No P1–P3 findings. |
| P4 | coverage | — | Coverage: N/A (verdict-based re-verification; no runtime coverage measurement). |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:02.026Z todo → blocked (system)
- 2026-09-23T18:57:36.977Z blocked → wip (system)
- 2026-09-23T19:02:12.763Z wip → testing (system)
- 2026-09-23T19:11:06.502Z testing → done (system)

