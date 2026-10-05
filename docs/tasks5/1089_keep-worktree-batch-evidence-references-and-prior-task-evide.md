---
schema_version: 1
name: Keep worktree-batch evidence references and prior-task evidence resolvable after teardown
status: backlog
template: feature-impl
created_at: 2026-10-05T13:36:08.395Z
updated_at: "2026-10-05T13:38:09.718Z"
feature_id: E71

---

## 1089. Keep worktree-batch evidence references and prior-task evidence resolvable after teardown

### Background

A `--worktree` batch runs in a fresh tree whose `.spur/run/` is empty, while the invoking tree holds every earlier task's per-tree evidence. Nothing carries prior evidence into the worktree, and the references a batch writes point back into the tree WT-4 deletes. Three symptoms were observed in one batch (`dev-runall --feature G72 --worktree`, worktree `spur-new-runall-g72-f14c`, landed on the base ref as `600dda990`):

1. **The wrap's feature preflight refuses on evidence it cannot see.** Wrap run `a24ac55c-cbe0-4d54-b521-ef86401a348f` failed at `task-resolve` with `failed:preflight:done-gate L4.dogfood-missing,L4.evidence-not-recoverable,L4.scenario-unverified` (`plugins/sp/scripts/wrapup-steps.ts`, `preflightFeature`; reason at `.spur/run/<runId>-route-reason.txt`) even though the frozen plan's earlier task 1078 was `done` with its verdict artifact present the whole time at `.spur/run/1078-verdict.json` in the invoking tree. After the batch landed on the base ref, `spur feature check G72 --json` in the invoking tree reported **no** findings of that kind, so the finding was tree-local, not corpus-real.

2. **Telemetry degrades resolvable evidence to `UNKNOWN`.** The same batch's wrap metrics recorded `{"wbs":"1078","status":"done","verdict":"UNKNOWN"}` after logging `task 1078 has no certifying verdict — .spur/run/1078-verdict.json: missing or carries none, tracked Testing: no Verdict: line — recording UNKNOWN telemetry`.

3. **`done_reason` names a path teardown deletes.** `spur task show 1079 --json` returned `done_reason: "unforced close; PASS artifact at /Users/robin/xprojects/spur-new-runall-g72-f14c/.spur/memory/evidence/1079-verdict.json"` — a worktree path removed by WT-4. The durable copies were written by WT-4a (`inline-run-setup --persist-out`) to `.spur/run/1079-verdict.json` and `.spur/memory/evidence/1079-verdict.json` in the invoking tree, so the artifact survived but the recorded reference did not.

Existing behavior the change must respect: WT-4a already persists run rows and cited/owned artifacts worktree → invoking tree (`.spur/run/` direct children named `<wbs>-*` / `<runId>-*`), per-tree lifecycle DB rows intentionally do not travel, and `reconcileDoneCloseAudit` composes `done_reason` from the `passArtifactPath` its caller supplies (`packages/app/src/services/task-transition.ts:185-189`).

### Requirements

- [ ] R1. Prior completed tasks' per-tree evidence resolves inside a worktree batch — either staged into the worktree from the invoking tree at WT-2, or read from the invoking tree by `preflightFeature`/`runMetrics` — so a tree-local absence never produces a false missing-evidence finding.
- [ ] R2. A task closed inside a batch worktree records a `done_reason` artifact path that still resolves after WT-4 removes the worktree: rewrite it at `--persist-out` to the durable invoking-tree artifact, and report an unresolvable path instead of fabricating one.
- [ ] R3. Wrap metrics record the real verdict for a frozen-plan task whose evidence resolves in the invoking tree; `UNKNOWN` stays reserved for genuinely absent evidence.
- [ ] R4. Tests pin R1–R3, and `plugins/sp/skills/spur-dev/references/execution-batch.md` states the staging and reference-rewrite rule in the same change (T3).

### Acceptance Criteria

- [ ] AC1 — Task and feature evidence remains valid without completed scratch
- [ ] AC2 — Retained run inspection and artifact references survive scratch removal
- [ ] AC3 — Existing lasting data is preserved before its scratch dependency is retired

The three titles are E71's scenarios verbatim (DD-09 subset rule); this task delivers their worktree-batch half, and Requirements R1–R4 carry the specifics.

Verification: re-run a worktree batch over a feature whose earlier task is already `done` and confirm (a) the wrap preflight logs no tree-local missing-evidence finding, (b) the metrics row carries the task's real verdict, and (c) the wrapped task's `done_reason` resolves after WT-4 removes the worktree.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Failure list first: a worktree batch wrap preflight must not report `L4.evidence-not-recoverable` for a task whose artifact resolves in the invoking tree; wrap metrics must not write `UNKNOWN` for the same task; a batch-local `done_reason` must resolve after teardown; and a plain (non-worktree) run must be byte-identical in behavior.

**Prior-evidence visibility (R1, R3).** `plugins/sp/scripts/wrapup-steps.ts` resolves evidence relative to the process cwd (`preflightFeature`, `runMetrics`), and a batch's wrap runs with cwd inside the worktree. Two mechanisms are defensible and the implementer picks one, documenting why:

- **Stage at WT-2** — when the frozen plan contains members already `done`/`cancelled`, copy their per-tree artifacts from the invoking tree into the worktree's `.spur/run/` before the first task pipeline runs (bounded to frozen-plan owners, same `<wbs>-*` / `<runId>-*` ownership naming WT-4a already uses). WT-4a's persist-out then no-ops on byte-identical copies instead of refusing.
- **Evaluate after merge** — keep the worktree clean and make the feature preflight/metrics consult the invoking tree for frozen-plan members it cannot resolve locally, naming the tree it read.

Staging is the smaller change and keeps one evidence plane; evaluating after merge avoids a second artifact copy. Either way the rule belongs in `plugins/sp/skills/spur-dev/references/execution-batch.md` (§ WT-2 / § WT-4a), not only in the script.

**Reference rewriting (R2).** `reconcileDoneCloseAudit` (`packages/app/src/services/task-transition.ts:185-189`) writes `done_reason` from the caller's `passArtifactPath` (supplied from `apps/cli/src/commands/task.ts`). The path is correct when written and dead after teardown. Rewrite it at the durable boundary instead of at close: WT-4a's `plugins/sp/scripts/inline-run-setup.ts --persist-out` already knows the worktree and invoking roots and already redirects stored path references, so a recorded reason naming the worktree must be rewritten to the persisted invoking-tree path (the same rewrite the delegate already performs for artifact rows). A reason that does not resolve in either tree is left untouched and reported, never fabricated.

**Verification surface.** `plugins/sp/tests/wrapup-steps.test.ts` owns the preflight/metrics level; `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts` owns the batch contract level; `plugins/sp/scripts/persist-out-check.ts` already scans cited evidence and is the place to assert the rewritten reason resolves.

**Constraints.** No new public CLI noun/verb/flag. Per-tree lifecycle DB rows still do not travel. Plain runs (no `--worktree`) must be unchanged, including the `UNKNOWN` telemetry path for genuinely absent evidence.

### Plan

1. Write the failure list as tests first, in the files that already own these contracts (`plugins/sp/tests/wrapup-steps.test.ts`, `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`): a worktree batch preflight must not surface `L4.evidence-not-recoverable` for a frozen-plan task whose artifact exists in the invoking tree; its metrics row must not be `UNKNOWN`; a batch-local `done_reason` must resolve after teardown; a plain run keeps today's `UNKNOWN`-for-absent-evidence behavior.
2. Implement the chosen prior-evidence mechanism (stage at WT-2, or read the invoking tree in `preflightFeature`/`runMetrics`) and name the tree in the finding/log text it produces.
3. Rewrite a recorded batch-local `done_reason` path to the persisted invoking-tree artifact at WT-4a persist-out, and report an unresolvable one instead of inventing a path.
4. Sync `plugins/sp/skills/spur-dev/references/execution-batch.md` (§ WT-2 / § WT-4a) with the staging and rewrite rules in the same change (T3).
5. Gates: `bun run spur-check`; `bun run test-repo-wide`; `bun run plugin-smoke` when the plugin lib is regenerated (`bun run build:plugin-lib`).
6. Prove it end-to-end on a real batch: run a worktree batch over a feature whose earlier task is already `done`, then confirm the wrap preflight reports no tree-local missing evidence, the metrics row carries the real verdict, and the wrapped task's `done_reason` resolves after WT-4 removes the worktree. Record the worktree marker, merge commit and the three artifacts as the acceptance evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
