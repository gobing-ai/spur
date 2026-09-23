---
schema_version: 1
name: Reconcile batch continuation against the original frozen plan
status: testing
template: standard
created_at: 2026-09-22T02:56:46.302Z
updated_at: "2026-09-23T19:10:49.501Z"
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

- [ ] 1. Trace current freeze, checkpoint, worktree marker and report persistence and reproduce an identity/reconciliation gap.
- [ ] 2. Fix the shared continuation boundary and use existing run/receipt APIs for child-result checks.
- [ ] 3. Exercise unrelated checkpoint, task added after freeze, changed dependencies, stale child PASS, lost worktree and mixed terminal results.
- [ ] 4. Update runall/parallel/next guidance and verify evidence preservation and isolated opt-in execution.

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
| R1 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:968-983` (BC-1): selector+project/worktree identity re-derived from the persisted WT-3 marker `command`+`selector` and worktree name/branch (:969-972); frozen membership/order = the persisted batch report's `Plan:` row, "the resumed loop iterates exactly those WBS rows" (:973-976); selector re-run is "validation, not a re-definition" (:978-980); authorized set "never silently rewritten" (:982-983). Corresponding child-run evidence: skip gate requires the persisted PASS verdict artifact, invoking-tree or worktree-persisted path (:999-1001). Pins: `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:109-121` (identity-blind read removed; membership binding; post-freeze never joins). |
| R2 | MET | `execution-batch.md:985-1006` (BC-2): candidate checkpoints selected by identity first — frontmatter `workflow` is `task-pipeline` and `feature_id`/`task_wbs` ∈ frozen plan; "Checkpoints matching neither rule are ignored regardless of recency" (:990-997) — hints only, `phase`/`next_action` surfaced, never the resume point by mtime (:987-989). Reconcile before skip/repeat: skip requires task file `done` AND PASS verdict artifact "consistent with the task's current metadata. Anything less is not a valid skip." (:999-1001); stale/mismatched (`source_commit`/`digest` drift, missing artifact, backwards task file) → `recheck` (:1002-1004); lost worktree/unresolvable marker → `blocked` (:1004-1005); "Never treat an unverified claim as done." (:1005-1006). Compositional engine half: `packages/app/src/workflow/checkpoint-contract.ts:141-143` owner-mismatch on `task_wbs`, :147-153 commit-drift on `source_commit`, :155-157 missing-artifact probe — tested by `packages/app/tests/workflow/checkpoint-contract.test.ts` (16 pass), incl. the owner-mismatch and commit-drift cases. Honest boundary: the `digest` comparison axis is runbook-side; `checkpointStaleness` parses but does not compare `digest`. |
| R3 | MET | Preservation evidence (honest: no new fixture): `execution-batch.md:1008-1010` (BC-3) restates sequential dependency-correct default + opt-in `--mode parallel` with proven-independence and one writer per tree, deferring to Step 3 — unchanged by the diff (`:200-236` driver loop; `:937-951` § Parallel Execution; parallel-vs-sequential default at :947-949). Failure policy for mixed terminals deferred unchanged to Step 4 (:368-386; BC-3 :1011-1012). Flag surface consistent: `dev-operations.md:356` and `dev-runall.md:75-82` keep `--mode sequential\|parallel` default sequential. No new pin asserts ordering/one-writer — R3 is satisfied by restatement + untouched normative sections, the weakest evidence class in this task. |
| R4 | MET | `execution-batch.md:1011-1018` (BC-3): per-task outcomes stay distinct incl. resume-only `recheck`/`not-admitted` (:1013-1014, matching Step 5 vocabulary :412-414); "a resumed, partially-complete batch is never reported `clean`" (:1014-1015); evidence survives cleanup "via the invoking-tree persistence in Step 5 (task 0720 R3)" (:1016) — the Step 5 section (:426-441) writes `.spur/run/worktree-<marker-id>-batch-report.md` + `worktree-<marker-id>-verdicts/<wbs>-verdict.json` before WT-4 removal (WT-4a ordering :710-713); persistence failure routes to WT-5 retain (:436-439, :1016-1017; WT-5 :796-828). Explicit stale reporting = `recheck` outcome. Pin: `execution-batch-contract.test.ts:123-127`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-22T02:58:02.026Z todo → blocked (system)
- 2026-09-23T18:57:36.977Z blocked → wip (system)
- 2026-09-23T19:02:12.763Z wip → testing (system)

