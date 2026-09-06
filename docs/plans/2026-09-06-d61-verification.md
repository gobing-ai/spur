# D61 forced verification — 2026-09-06

> **Closure correction:** the initial FAIL below is historical. After the operator's ADR-108
> direction, all 13 tasks were repaired/re-verified PASS and D61 advanced through verifying to done.
> See [the final closure report](2026-09-06-d61-closure.md) for current results and limitations.

Batch verdict: FAIL. Shippable: FAIL.

Invocation: `$sp-dev-verifyall --feature D61 --auto --next --force --focus all --fix all --agent inline`.
Source HEAD: `bcc88972043f8c94319cc3464c34e64916ac33d7`; source-local CLI:
`bun run apps/cli/src/index.ts`. Verification stayed inline.

## Task outcomes

7 PASS, 2 PARTIAL, 3 FAIL; 1 NOT-STARTED excluded from verdict rollup.
Each implemented task's linked Testing section contains the full requirement/AC evidence table,
transcribed by `task record` from its freshly derived verdict.

| Task | Verdict | Evidence / residual |
| --- | --- | --- |
| [0765](../tasks4/0765_make-essential-completion-checks-explicit-without-blanket-st.md) | PASS | Required references and completion proof now fail normal checks; focused regressions added. |
| [0766](../tasks4/0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md) | FAIL | Explicit unsuppressed corpus audit removed despite the accepted contract. |
| [0767](../tasks4/0767_replace-composition-mirrors-with-live-workflow-facts-and-beh.md) | PASS | Live composition, budgets, evaluation, costs, advisories and digest behavior verified. |
| [0768](../tasks4/0768_unify-workflow-plan-identity-and-readable-execution-progress.md) | PASS | Plan/version identity, truthful progress and digest mismatch behavior verified. |
| [0769](../tasks4/0769_upgrade-planning-and-evidence-workflows-without-structural-c.md) | PASS | Planning/docs/wayfinder proof and atomic handoff verified. |
| [0770](../tasks4/0770_upgrade-lifecycle-and-wrapup-workflows-with-truthful-outcome.md) | PASS | Lifecycle/wrapup outcomes, captured failure and terminal behavior verified. |
| [0771](../tasks4/0771_upgrade-example-history-and-pr-review-workflow-behavior.md) | PASS | Example/history/PR-review behavior and cache identity verified. |
| [0772](../tasks4/0772_complete-the-final-task-pipeline-and-packaged-workflow-rollo.md) | PARTIAL | Pipeline proof passes; authority drift and missing matched savings evidence remain. |
| [0773](../tasks4/0773_audit-and-migrate-config-corpus-baseline-json.md) | FAIL | Required per-key classification artifact missing; historical summary is not recoverable proof. |
| [0774](../tasks4/0774_migrate-cli-fallback-accepted-callers-and-dependent-fixtures.md) | PASS | Caller migration verified, including historical intermediate loader retention; stale Solution corrected. |
| [0775](../tasks4/0775_delete-corpus-composition-baselines-and-snapshot-tests.md) | PARTIAL | Artifact retirement passes; T10 authority conflict and wrong default feature gate remain. |
| [0776](../tasks4/0776_fix-d61-pipeline-execution-blockers-stale-executor-doc-and-0.md) | FAIL | Executor example/evidence recovery pass; required strict feature PASS fails. |
| [0777](../tasks4/0777_d61-batch-execution-findings-register-consolidated-fixes-for.md) | NOT-STARTED | Todo findings register; NOT-STARTED under the batch status grammar, excluded from rollup. |

`--next: no-op - task already terminal (done)` applies to 0765–0776.
No task status transitions were made. 0777 remains todo; verification did not implement its
remaining findings or create additional tasks.

## Repairs and verification

- Fixed the shared planning checker: unsuppressible required findings were still advisory at normal
  completion. Required declared references now error; completion proof/scenario/rollup findings error
  at effective done. Advisory precompletion checks remain advisory.
  Owner: `packages/app/src/services/planning-check-base.ts`.
- Added regressions in the planning/feature/task checker suites and corrected conflicting old
  expectations. The new regression failed before the production fix.
- Made the existing R41 workflow assertions insensitive to YAML indentation without weakening their
  transition/approval assertions. No workflow YAML was edited by this verification.
- Synchronized the changed completion behavior in `docs/04_DESIGN.md`; refreshed task evidence via CLI.
  Corrected 0765/0774 Solution descriptions through CLI. No manual task-corpus writes.
- `bun run spur-check`: exit 0; 7452 tests pass, 0 fail, 416 files; lint, all seven workspace
  typechecks, 44 precheck and two postcheck rules pass.
- `bun run test-cf`: exit 0, one test passes.
- `bun run build`: exit 0; web chunk-size advisory only.
- Dedicated CLI `build:bundle`: exit 0; needed because the root build did not refresh bundled YAML.
  All 11 source definitions validate, use quoted version "1", and byte-match their bundled copies.
- Source-local task-pipeline `workflow show --format todo --json`: exit 0, 12 steps, version "1".
- All 12 implemented tasks pass `task check --strict-core --json`. These are structural checks,
  not substitutes for the verification verdict. 0773 has four advisory stale historical anchors.
- A scripts-only diagnostic run from the scripts directory failed its root-config lookup; the
  subsequent root comprehensive gate passed that test. Initial indentation-sensitive plugin tests
  failed and were repaired. Neither failure is omitted from the verification history.

Full logs: `.spur/run/d61-verifyall-{gate,cf,build,bundle}.log`.
Targeted checker, workflow, CLI, identity and plugin test evidence is recorded in the task tables.

## Final feature gate

After all task records, `feature check D61 --json` exits 0 with `pass=true` because D61 is active,
but reports five advisory linked-unverified scenarios: R2, R3, R10, R11, R12.
The strict check exits 1 with those same five findings promoted to errors.
There are no remaining evidence-not-recoverable findings.

The verifyall shippable contract rejects linked-unverified scenarios even when advisory and also
rejects incomplete linked tasks. Thus Shippable is FAIL for those five scenarios and todo task 0777.
The feature checker credits only a PASS covering task with MET rows, so a task-level non-PASS
also withholds credit from its otherwise MET rows.

Deterministic `task verifyall-aggregate --from-file .spur/run/d61-verifyall-batch-input.json --json`
exits 1 with FAIL. Machine summary including `shippable:false`:
`.spur/run/d61-verifyall-result.json`.

## Residuals and recovery

1. **0766 / 0775 — contract conflict.** [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
   retains explicit whole-corpus audits. The implementation removed the explicit corpus command/flags,
   and derived design/process guidance now describes retirement. The accepted D61 requirement is not
   met by per-task checks or a test suite. Operator decision required: restore the specified audit,
   or explicitly authorize an ADR/scope amendment retaining its removal. Restoring a retired public
   surface needs consent under project governance; no such change was made.
2. **0773 — missing classification.** Required `.spur/run/d61-0773-classification.json` is absent;
   no tracked historical copy or original batch worktree was found. The historical baseline has 299
   keys, but totals alone do not prove per-key classifications and rationale. Recover the original
   report or authorize a new, explicitly labeled reconstruction; do not fabricate historical proof.
3. **0772 — missing matched measurements.** [Rollout evidence](2026-09-04-d61-rollout-evidence.md)
   cites captures in a removed worktree and acknowledges unavailable pre-change measurements.
   Fresh tests and static command counts cannot establish comparable real-run savings. Supply
   original matched captures or explicitly revise the measurement acceptance criterion.
4. **0775 — wrapup default mismatch.** `config/workflows/wrapup-pipeline.yaml:92` defaults to full
   `bun run spur-check`, not the required affected-feature check. Override behavior passes.
   Correcting workflow YAML requires explicit authorization; it was left unchanged.
5. **0776 — strict feature check.** AC2 remains UNMET as a consequence of the above task verdicts;
   executor and evidence recovery are fixed, but a previous green label is not reproducible.
6. **0777 — unfinished findings.** Remains todo. Complete through its implementation lifecycle before
   attempting feature ship.

Doc-evolve sync check: the completion-policy repair and its surface documentation move together.
The pre-existing ADR-108 versus derived audit-retirement conflict is unresolved, not silently
ratified. No feature state/scope, ADR, public command, workflow policy, or external system was changed.

## Working-tree and artifact handoff

All verification changes remain uncommitted and reviewable; no clean-start task commit was claimed.
Pre-existing changes in `.spur/context/pitfalls.md` and indentation-only
`config/workflows/task-pipeline.yaml` were preserved.
The frozen task set is `.spur/run/d61-verifyall-frozen.json`.
Answer files `.spur/run/0765-verify-answer.txt` through `0776-verify-answer.txt` are the source
of truth for the corresponding generated verdicts; the task records disclose these gitignored writes.
No new dependency, agent, remote write, deployment or publication was introduced.
