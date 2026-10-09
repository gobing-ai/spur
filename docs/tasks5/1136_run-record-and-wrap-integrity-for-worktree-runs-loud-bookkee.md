---
schema_version: 1
name: "Run-record and wrap integrity for worktree runs: loud bookkeeping, fresh digests, scoped repair"
status: todo
template: feature-impl
created_at: 2026-10-09T05:28:31.980Z
updated_at: "2026-10-09T16:52:17.168Z"
feature_id: H1

ac_altitude: task-local
ac_numbering: task-local
---

## 1136. Run-record and wrap integrity for worktree runs: loud bookkeeping, fresh digests, scoped repair

### Background

**Origin.** Pipeline run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132, 2026-10-08, inline full pipeline, worktree) closed its task correctly but left three integrity defects in the harness that each cost wall-clock and, in one case, nearly certified the wrong tree.

**Defect 1 — the run's action trace silently did not land (93 rows, one refused close).** The run row was created by `inline-run-setup.ts` in the **invoking** tree `/Users/robin/xprojects/spur-new` — correct per the worktree contract (the WT-3 marker and the row live with the invoking tree). Every subsequent `--action` call was made with cwd = the **execution** tree `spur-new-sp-run-1132-85fab6d4`, whose per-tree `.spur/spur.db` contains no such row. The script answered `{"ok":false,"code":"RUN_NOT_FOUND"}` on each call, but the driver's own commands had appended `>/dev/null 2>&1`, so the failures were invisible for the whole run. The result: `runs` row with **zero** `action_runs` rows; `--close --status done` refused with
`{"ok":false,"error":"run 85fab6d4-… closed done with zero action_rows rows; emit --action/--actions-file during the run (no backfill); see inline-pipeline-driver.md#structured-trace-emission-adr-117-task-0868","code":"NO_ACTION_ROWS","actionRows":0}`.
The only non-lying options were to leave the row falsely `running` or to re-emit the trace afterwards; 93 rows were re-emitted post-run (all `--estimated`, since none had been timed) and the correction was written into the run log. **The contract forbids backfill at close — and it was right to; the defect is that the driver let a silent no-op happen at all.**

**Defect 2 — a stale digest nearly reused a gate receipt (12 m 20 s lost).** After deleting a stray untracked artifact the tree's real digest moved from `sha256:e1f2afbf…` to `sha256:21996f6e…`. The driver passed the *file's* value (the older one) to `quality-gate.ts recheck`; the gate's `readReceiptStatus(receiptPath, env.proofDigest)` compared it with `.spur/run/1132-check-receipt.json`'s `inputDigest`, matched, and correctly-skipped by its own rules:
`check.reused — full-tier PASS receipt at input digest sha256:e1f2afbf…; gate skipped`.
A PASS for a tree that no longer existed was one accepted command away. The driver caught it, recomputed the digest, and re-ran the gate for real (12 m 20 s), but the reuse decision trusts a caller-supplied string that the caller is demonstrably capable of getting wrong.

**Defect 3 — the wrapup full route could not complete and "repaired" the wrong file (two failed runs, ~8 min plus a manual revert).** The full route (mode unset → deterministic drift probe → `doc-sync` → `learnings-*` → `doc-tripwire`) failed twice at `doc-tripwire`, which runs the repo-wide tripwires over the still-uncommitted wrap diff:
`repo-wide-tests/adr-supersession.test.ts` → *"(g2) the superseded team-mode design stays as history but is delinked from the design index"*.
Root cause: the wrapup **`doc-sync`** step **re-added** the deliberately delinked row for `design/spur-team-mode-design.md` to `docs/04_DESIGN.md` (with a version/`updated_at` bump), and the ADR-supersession tripwire then failed by design. Its **`repair`** lane followed and modified an **unrelated** file — `apps/app/tests/decision/decision-log-query.test.ts` (+36 lines) — instead of the violation's subject. Both writes had to be reverted by hand (`git checkout -- …`); the wrap only completed on the documented fast route (`mode=fast`: `task-resolve → metrics-record → done`, run `42aaec50-7eac-4a4b-8d0b-a0fe980c8dc5`), i.e. the operator's `--wrap` intent was only partially served.

**Current code facts (verified 2026-10-08).**
- `plugins/sp/scripts/inline-run-setup.ts` modes and contract (usage text, lines 17–24): `--run-id --file`, `--fingerprint --task-file`, `--action --run-id --node --kind --status --ok --duration-ms [--estimated]`, `--actions-file`, `--close --run-id --status [--reason]`, `--persist-out --from`, `--decide`. Terminal-reason enum: `done, paused-operator, failed-check, failed-agent, failed-timeout, failed-guard, cancelled, interrupted, retry-exhausted`. `--estimated` is valid only with `--action`.
- Per-tree DBs are deliberate: the failed-transition message itself says *"Provenance DB checked: <cwd> (per-tree isolation — if the pipeline ran in another tree, e.g. a `--worktree` invoked from elsewhere, re-record `spur task run-link` from this tree)"*. So the fix must respect isolation rather than remove it.
- `quality-gate.ts` modes `run|recheck|deferred|light|status`; reuse surface `readReceiptStatus(receipt, proofDigest)`; the receipt shape `.spur/run/<wbs>-check-receipt.json` (`inputDigest`, `checks[].durationMs`, `status`).
- `config/workflows/wrapup-pipeline.yaml`: `doc-sync` (`:224`), `learnings-validate` (`:259`), `learnings-append` (`:287`), `repair` (`:308`, ADR-118 contract-violation repair), `doc-tripwire` (`:330`, writes `PASS`/`FAIL` to `.spur/run/$__runId-wrapup-doc-tripwire.status`), routing guards (`:600-618`), and the proportional fast path `task-resolve → metrics-record` when `mode == fast` (`:503-506`) with "a caller-set mode is projected verbatim; the probe never runs".
- The tripwire that caught it is `repo-wide-tests/adr-supersession.test.ts` (g2/g3); `docs/04_DESIGN.md` is a derived index whose rows are the delink surface.

**Session evidence (2026-10-09), from the 1130/1131 batch teardown.** (1) `persist-out` skipped one row as an external-key conflict and instructed the driver to reconcile before teardown; the conflicting row was a duplicate `feature:E5` lifecycle run whose authoritative copy already existed in the invoking tree, so nothing unique was lost — but the reconciliation was manual and unassisted. (2) `persist-out-check` then returned BLOCKED against its 256-file listing cap over 367 scratch files, and removal proceeded on hand-verified cited evidence (`1130/1131-verdict.json`, both `-test-gate.status`, both `-review-proof.digest`, four run records) rather than an assertion. (3) While auditing run rows: the invoking tree's database holds 63 runs in `running`, including a `feature:E5` lifecycle row whose `completed_at` is set while its status never closed.

### Requirements

- [ ] R1. **Bookkeeping must reach the tree that owns the run row.** Either the driver contract pins the owning tree as the cwd for `--action` / `--actions-file` / `--close`, or `inline-run-setup.ts` resolves the run row by id across the invoking and execution trees and writes to the owning database. A `RUN_NOT_FOUND` must fail the driver step loudly instead of being a no-op the driver can sleep through.
- [ ] R2. **No silent bookkeeping, and a close that cannot lie.** The driver contract must forbid suppressing stdout/stderr on bookkeeping calls (that suppression is what hid 93 failures), and `--close` must verify the recorded row count for the run before it closes — reporting the delta and exiting non-zero when the row carries none — rather than relying on the caller to have emitted them correctly.
- [ ] R3. **Digest discipline: never reuse a digest the driver merely copied.** Every consumer recomputes the digest immediately before use, and the gate's receipt-reuse path must refuse reuse unless the supplied digest equals a freshly computed one (or the driver passes the freshly computed value by construction). A mismatch must run the gate and record why, never skip it.
- [ ] R4. **`doc-sync` must not resurrect a delinked index row.** An index entry that a prior commit deliberately delinked (superseded-and-delinked is intentional state) must not be re-added by `doc-sync`; the derived index is not a place for doc-sync to invent rows, and the tripwire that enforces the delink must never be "fixed" by changing it.
- [ ] R5. **Repair must be scoped to the violation's subject.** The wrapup `repair` lane may only touch the file(s) the contract violation names. A `doc-tripwire` FAIL must not be repaired by editing an unrelated test (observed: `apps/app/tests/decision/decision-log-query.test.ts`), and every repair attempt must record its scope (files touched) so an out-of-scope edit is visible in the run log.
- [ ] R6. **Contract tests.** Static/fixture pins in the pattern of `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`: the delinked row stays delinked through a doc-sync pass; repair scope is bounded; `--close` fails when the run has no rows; a cross-tree `--action` either lands in the owning database or fails loudly; the gate refuses receipt reuse for a stale supplied digest. Each pin must fail without the fix.
- [ ] R7. **Same-change docs and bundle.** Update the driver reference (bookkeeping sections, structured-trace emission, the digest-recompute rule), the wrapup workflow comments and any run-record/observability doc that lists the wrapup states, and the receipt contract where reuse is decided; rebuild the bundle with `bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts`.

- [ ] R6. **The inline driver executes a state's declared actions through their declared runners,
  never as ad-hoc shell re-implementations.** Recording the H1 batch (2026-10-08) showed the driver
  hand-writing each lane's actions in bash: 43:56 of declared driver overhead plus roughly two
  minutes more inside every run, three driver-script failures (scratch under `/tmp` reaped mid-run, a
  quoting bug that aborted a lane, and one lane invoked before its declared `qualityGateCmd` variable
  was exported — two wasted full-gate runs). The contract must therefore state, per action kind,
  which runner executes it on the inline surface, and require that the declared run variables are
  materialized before any action that consumes them. Driver scratch lives inside the run directory.
- [ ] R7. **A wrap feature-transition must not fail on a nested verification invocation that passes
  standalone.** In the H1 batch the wrapup feature-transition failed with
  `GuardDeniedError: Lifecycle transition denied for feature H1: State "verifying" onEnter shell
  failed (exit 1)` while its own gate printed `H1 (active): PASS`; running
  `feature-verification.yaml` directly then succeeded (`H1 verification PASS`, run
  `abf585eb-3e26-4b66-9835-3d3332e139dc`), so the nested invocation — not the feature — was at
  fault and the transition had to be completed by hand.

- [ ] R8. The pre-removal evidence assertion holds at real evidence volumes. `persist-out-check` refused with `worktree evidence listing failed or exceeded caps (64/prefix, 256 evidence files)` on a worktree holding 367 scratch files, so teardown fell back to manual verification of the cited artifacts. The check is scoped to the evidence a task actually cites, or its caps are derived from that scope, so a large scratch directory cannot turn a safety assertion into a manual step.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Bookkeeping reaches the row whether or not the driver's cwd owns it (req: R1)
  Given a run whose row was created in the invoking tree
  When a driver step emits an action row from the execution tree, or the close runs there
  Then the row lands in the database that owns the run
  And when the owning database cannot be resolved the command fails loudly with a non-zero status
  And no "success" is reported for a row that was not written
```

```gherkin
Scenario: AC2 — A close with no recorded rows cannot report success (req: R2)
  Given a run that recorded zero action rows
  When "inline-run-setup --close --status done" runs
  Then it exits non-zero and names the zero-row condition
  And it does not project a done status into the run-record state file
  And the driver contract forbids suppressing the bookkeeping commands' output
```

```gherkin
Scenario: AC3 — A stale supplied digest cannot reuse a gate receipt (req: R3)
  Given a receipt for digest D1 and a tree whose freshly computed digest is D2
  When the gate is invoked with D1
  Then it recomputes the digest, refuses reuse, and runs the gate
  And the log states that reuse was refused and why
  And a PASS is only ever recorded for the digest the tree actually has
```

```gherkin
Scenario: AC4 — doc-sync leaves a deliberately delinked index row delinked (req: R4)
  Given docs/04_DESIGN.md carries an index row that a prior decision delinked
  When a wrapup doc-sync pass runs over that tree
  Then the row is still delinked afterwards
  And the repo-wide adr-supersession tripwire (g2) stays green
  And doc-sync reports no invented index row
```

```gherkin
Scenario: AC5 — Repair is bounded to the violation's subject (req: R5)
  Given a doc-tripwire FAIL whose violation names one document
  When the repair lane runs
  Then it touches only files named by that violation
  And its run record lists the files it touched
  And an attempt to satisfy the violation by editing an unrelated test is refused
```

```gherkin
Scenario: AC6 — The pins fail without their fixes (req: R6)
  Given each new contract pin
  When the corresponding fix is reverted in an isolated copy
  Then the pin fails
  And with the fix in place the same pins pass inside "bun run spur-check"
```

```gherkin
Scenario: AC7 — Owning docs and bundle reflect the three integrity fixes (req: R7)
  Given the implementation is complete
  When "bun run spur-check" and the bundle rebuild run
  Then both pass
  And the driver reference documents the owning-tree bookkeeping rule, the no-suppression rule and the digest-recompute rule
  And the receipt contract documents when reuse is refused
```

```gherkin
Scenario: AC6 — a driver lane cannot bypass its declared action runner
  Given a pipeline state whose YAML declares actions of a given kind
  When the inline driver executes that state
  Then every action runs through its declared runner with its declared variables materialized
  And no driver scratch is read from outside the run directory

Scenario: AC7 — the wrap feature-transition survives its nested verification
  Given a batch whose tasks are all done and a feature at `active`
  When the wrapup feature-transition runs its nested feature-verification step
  Then the transition completes with the verification receipt recorded, or the failure names the
    nested invocation's own error rather than a generic onEnter exit 1
  And the same verification run standalone and nested agree on the verdict
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Per-tree isolation is correct; the defect is silent failure.** The failed-transition message already states the model: *"Provenance DB checked: <cwd> (per-tree isolation — if the pipeline ran in another tree, e.g. a `--worktree` invoked from elsewhere, re-record …)"*. So R1 must not remove isolation or add a cross-tree lock; it must make the driver's bookkeeping **resolve the owning tree** (preferred: the script resolves the row by id across `<invoking>` and `<execution>` trees, since the driver is prose interpreted by an agent and the mistake is easy to repeat) **and fail loudly** when it cannot. R2 is the complementary half: the suppression that hid 93 failures is a contract violation, and `--close` should verify the row count instead of trusting the caller.

- **Why the gate must not trust a supplied digest (R3).** Receipt reuse exists to avoid paying 6–10 minutes for an unchanged tree — a legitimate optimization keyed on an identity. The identity must be computed by the party that owns the decision, not handed in as a string: `readReceiptStatus(receipt, proofDigest)` currently compares two strings, one of which the caller produced. Recomputing inside the reuse decision (or requiring the driver to pass the freshly computed value by construction, with the recompute recorded in the gate log) turns a silent wrong-PASS into a cheap refusal.

- **doc-sync's job is drift, not invention (R4/R5).** `docs/04_DESIGN.md` is a *derived index*; a superseded satellite that a prior decision delinked is intentional state, and the repo already pins that intent (`repo-wide-tests/adr-supersession.test.ts` (g2)/(g3)). A doc-sync pass that re-adds the row is not "repairing drift" — it is inventing a row and then failing the very tripwire that exists to hold the line. Equally, ADR-118 contract repair is defined for **the stage it belongs to**: a `doc-tripwire` FAIL whose violation names a document may only be repaired in that document. The observed out-of-scope edit (an unrelated decision-log test) shows the scope needs to be enforced, not just intended — hence the recorded file list in R5.

- **Boundaries.** Do not delete per-tree databases, add a global provenance DB, or make `--close` write to a tree it does not own. Do not "fix" the delink tripwire, relax `DEFAULT_EXCLUDE_GLOBS`, or make doc-sync skip index files wholesale (it must still report real drift). Do not make the wrapup skip `doc-sync` by default — the fast path stays an evidence-based route (`mode=fast` only when the resolve probe finds complete, consistent evidence), not an escape hatch for a bug. Do not touch the corpus-owned `## Testing`/`## Review` write path.

- **Failure inventory to write before code:** (a) cross-tree resolution picking the wrong row when a run id exists in both DBs; (b) a loud-failure change breaking the normal same-tree path; (c) `--close` refusing a legitimately row-less dry-run/plan-only run (needs a declared exemption, not a blanket refusal); (d) receipt recompute adding a full digest cost per gate call; (e) doc-sync now never updating a legitimately stale row (over-correction); (f) repair scope blocking a legitimate multi-file violation; (g) the new pins being non-discriminating (the 1132 experience: a pin satisfied by unrelated prose).

### Plan

1. **Failure inventory first** (Design's list), one row per way each of the three fixes can be wrong.
2. **Tests before implementation**: a `--close`/`--action` ownership test (row in the invoking DB, command run from the execution tree, both the resolution and the loud-failure branch); a gate receipt-reuse test with a stale supplied digest; wrapup fixture tests for the delinked-row and repair-scope properties (style of `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`, plus `plugins/sp/tests/wrapup-steps.test.ts` where the existing stubs live).
3. **Implement R1/R2** — owning-tree resolution in `inline-run-setup.ts` (with an explicit exemption for a declared row-less run), the loud-failure path, the no-suppression rule and the close-time row verification in the driver contract.
4. **Implement R3** — recompute inside the reuse decision (or require the driver's freshly computed value) and record a refusal in the gate log; keep the ordinary same-tree fast path unchanged.
5. **Implement R4/R5** — doc-sync treats delinked index entries as intentional and never invents rows; repair scope is limited to the violation's subject and records the files it touched.
6. **Implement R6** — the pins, each demonstrated to fail without its fix (record the demonstration in Testing).
7. **Docs and bundle (R7)** — driver reference (bookkeeping, trace emission, digest rule), wrapup workflow comments, receipt contract; `build:bundle` + `build:scripts`.
8. **Acceptance drill**: reproduce the 1132 shape end-to-end in a small worktree round-trip — a run whose row lives in tree A, bookkeeping driven from tree B (expect rows in A, or a loud failure), a `--close` on a zero-row run (expect non-zero + no done projection), a stale-digest gate call (expect refusal + real run), and a wrapup full route on a tree carrying a delinked index row (expect `doc-tripwire` PASS on the first attempt). Record each command and its output in Testing.
9. `bun run spur-check` once on the final tree; record the evidence.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Incident: run `85fab6d4-baf5-4db8-a0e9-810b12927fb4` (task 1132), 2026-10-08 — 93 action rows silently lost and one refused close (`NO_ACTION_ROWS`); one near-miss receipt reuse on stale digest `sha256:e1f2afbf…` while the tree was at `sha256:21996f6e…`; wrapup runs `4b02efaf-66fb-4656-81d0-a1710740229f` and `a03b4cf8-be23-4e43-a976-48fc9427d6f2` failed at `doc-tripwire`, `42aaec50-7eac-4a4b-8d0b-a0fe980c8dc5` completed on the fast route.
- Code touchpoints: `plugins/sp/scripts/inline-run-setup.ts` (modes/usage `:17-24`, `--action`, `--actions-file`, `--close`, `--estimated`), `plugins/sp/scripts/quality-gate.ts` (`recheck`, `readReceiptStatus`, `check.reused`), `config/workflows/wrapup-pipeline.yaml` (`doc-sync :224`, `repair :308`, `doc-tripwire :330`, guards `:600-618`, fast path `:503-506`), `repo-wide-tests/adr-supersession.test.ts` (g2/g3), `docs/04_DESIGN.md` (derived index rows).
- Contracts to update: `inline-pipeline-driver.md` (structured trace emission ADR-117 section, the run-record two-file convention, the digest-refresh cadence), `docs/design/run-record-contract.md`, `docs/design/disposable-run-storage.md`, and the wrapup workflow's own comments.
- Related: ADR-117 (action trace on every surface), ADR-118 (contract-violation repair), ADR-131 (disposable run scratch), ADR-119 (gate at the invariant's scope), feature E71/E7 (run record), task 0927 (two-file run record), task 0871 (ADR-118 repair pilot 0871), task 1037 (doc-tripwire).

### History

- 2026-10-09T05:30:22.775Z backlog → todo (system)

