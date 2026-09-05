---
schema_version: 1
name: "S0a: Make workflow proof fail-closed — git-tree, task lookup, verifier freshness, artifact binding"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:30.404Z
updated_at: "2026-09-05T00:57:39.706Z"
feature_id: D9
priority: P1
ac_altitude: task-local
---

## 0751. S0a: Make workflow proof fail-closed — git-tree, task lookup, verifier freshness, artifact binding

### Background

Four defects in the D8 register (F-5, F-7, F-8, F-9 — `docs/inventory/d8-0729-workflow-contract-inventory.md` §F) let a workflow report a verified PASS on evidence that was never actually captured. They share one property: each fails *open*. A git failure yields an empty fingerprint that still hashes; a missing task spec is swallowed by `|| true; exit 0`; a verifier answer file left by a previous run satisfies a fresh assertion; and `run.artifact`'s `proofBinding` is echoed into result data without ever being checked.

Together these make every downstream number untrustworthy — including the cost-per-verified-PASS denominator D9's later slices depend on. The frozen D8 strategy (`docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3, R3 seam S7) puts them before any routing work for exactly that reason: a proportional gate built on a fail-open proof measures nothing.

Anchors verified 2026-09-03: `packages/app/src/workflow/proof-input-fingerprint.ts:99-118` returns `''` on all four git failure paths and on the `catch`; `config/workflows/task-pipeline.yaml:345` suppresses the task-path lookup and forces `exit 0`; `packages/app/src/workflow/actions/agent-run.ts:553` asserts `expectFile` presence with no freshness constraint; `packages/app/src/workflow/actions/run-artifact.ts:88-101` spreads `proofBinding` into the result and never validates it.

### Requirements

- [x] R1. Git-tree proof-input capture fails closed: when `read-tree`, `add`, or `write-tree` fails, or the `catch` fires, the caller receives a distinguishable failure rather than an empty string, and no fingerprint is derived from it.
- [x] R2. The task-pipeline task-spec lookup is not suppressed: an empty resolved task path is an error that fails the step, not a silent fall-through to whole-tree-only proof.
- [x] R3. An `expectFile` assertion is satisfied only by an artifact produced by the current run — a file left behind by a prior run cannot satisfy it.
- [x] R4. `run.artifact`'s `proofBinding` is validated at artifact write. An artifact whose declared binding does not hold is rejected; the option stops being decorative.
- [x] R5. Each of R1-R4 has a regression test that fails against the pre-repair code and passes after, exercising the failure path rather than only the happy path.
- [x] R6. No change widens what counts as proof. Repairs only remove fail-open paths; no new bypass, env override, or `softFail` escape is introduced.

### Acceptance Criteria

```gherkin
Feature: Fail-closed workflow proof

  @core
  Scenario: R1 — Proof fingerprinting fails closed on a git failure
    Given a proof-input fingerprint computation whose git invocation fails
    When the fingerprint is requested
    Then the computation reports a distinguishable failure to its caller
    And no empty-tree digest is produced
    And no downstream step records a verified PASS derived from it.

  @core
  Scenario: R2 — A missing task spec fails instead of degrading to tree-only proof
    Given a task-pipeline run whose task-path lookup resolves to nothing
    When the proof step executes
    Then the step fails with an error naming the unresolved task
    And the run does not proceed to record proof built from the working tree alone.

  @core
  Scenario: R3 — A stale verifier answer cannot satisfy a fresh assertion
    Given a verifier answer file written by a previous run and still present on disk
    And a new agent.run step declaring that path as its expectFile
    When the new step exits successfully without writing the file
    Then the expectFile assertion fails
    And the failure names the staleness rather than reporting the file as produced.

  @core
  Scenario: R4 — A declared proof binding is enforced at artifact write
    Given a run.artifact step declaring a proofBinding that does not hold for the artifact
    When the artifact is written
    Then the step fails
    And no artifact record is persisted for the unbound artifact.

  @edge
  Scenario: R6 — The repairs add no new bypass
    Given the repaired proof paths
    When the workflow action surface is inspected for escapes
    Then no environment variable, option, or softFail path restores the previous fail-open behavior.
```


<!-- DD-09 coverage: this task's scenarios sit at task-local altitude and are R-titled, so their
     normalized titles do not match the feature's ship-contract wording. The `covers:` aliases
     below name the D9 scenarios R4 and R6 actually satisfy (0700 R3). -->

- [x] AC-D9a. (covers: The done-state verdict artifact declares the enforced proof binding) R4 — the done-state `run.artifact` declares `proofBinding: current` and an unbound artifact is rejected at write.
- [x] AC-D9b. (covers: No new bypass is introduced in the pipeline composition) R6 — the repaired proof paths add no `2>/dev/null`, `|| true`, forced `exit 0`, env override, or `softFail` escape.
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Invariant introduced:** proof capture is a total function into `Result<digest, reason>`, never into `string`. Today the empty string doubles as both "no tree" and "capture failed", which is precisely what makes it fail open.

**R1** — change `createGitAlternateTree`'s contract from `Promise<string>` to a discriminated result (or `null` plus a thrown, named error at the single call site — whichever the existing caller shape in `proof-input-fingerprint.ts` makes smaller). The `catch` must not swallow: it converts to the failure variant carrying the git stderr. Every caller that currently branches on `=== ''` must be updated; grep the callers before editing rather than patching the one the ticket names.

**R2** — the fix is in `config/workflows/task-pipeline.yaml:345`, not in a new action. Drop `2>/dev/null`, drop `|| true`, drop the forced `exit 0`, and add an explicit empty-path check that exits non-zero with a message. The priority read that follows stays tolerant (a missing priority is genuinely optional); the *task path* is not.

**R3** — the smallest correct fix is delete-before-invoke: remove the `expectFile` target before the agent runs, so presence after exit is proof of production. Prefer that over stat/mtime comparison, which is racy on coarse filesystem timestamps. If a caller legitimately needs an existing file preserved, that is a different action, not an `expectFile`.

**R4** — validate `proofBinding` where the artifact is written in `run-artifact.ts`, before `dao.record`, so a failed binding never reaches the ledger. The binding's meaning is defined in ADR-071's proof-chain symmetry; implement exactly that check and no broader one.

**Tradeoff accepted:** R1 and R2 will surface latent failures that were previously invisible — some existing runs that "passed" will now fail. That is the point, and it is why this task precedes the re-measure gate (0757): the measurement must run against honest proof.

**Not in this task:** F-10 whole-tree attribution (out of scope per D9), and the resolve/resume seam (0752) and action-option/confinement repairs (0753), which are sibling S0 tasks.

### Plan
- [x] Grep every caller of `createGitAlternateTree` and of the `=== ''` sentinel before editing; record the caller set in the Solution.
- [x] R1: convert the capture contract to a failure-carrying result; update all callers; add the git-failure regression test.
- [x] R4: enforce `proofBinding` in `run-artifact.ts` before `dao.record`; add the unbound-artifact regression test.
- [x] R3: delete-before-invoke for `expectFile` in `agent-run.ts`; add the stale-answer regression test.
- [x] R2: de-suppress the task-path lookup in `task-pipeline.yaml`; add the missing-task regression test.
- [x] R6: audit the changed surface for any newly added bypass; confirm none.
- [x] Run the workflow-service and workflow-action suites from inside their workspace; then `bun run spur-check`.
### Solution

Implemented fail-closed proof capture (R1-R4, R6); all four fail-open paths now reject or exit non-zero, none widened what counts as proof.

**R1 — git-tree capture fails closed** (`packages/app/src/workflow/proof-input-fingerprint.ts:64-71`): new exported `ProofCaptureError` carrying the git stderr. All four failure paths in `createGitAlternateTree` now throw instead of returning the `''` sentinel: read-tree `packages/app/src/workflow/proof-input-fingerprint.ts:116`, add `:121`, write-tree `:125`, and the catch (converts foreign throws, re-throws `ProofCaptureError` as-is) `:129`. `computeProofInputFingerprint` propagates the throw, so no digest is ever derived from a failed capture; its only production caller, the `proof.fingerprint` action, already fails the action through its existing try/catch (`packages/app/src/workflow/actions/proof-fingerprint.ts:74-76`). Caller audit per Plan: the only non-test caller set is {`computeProofInputFingerprint`, package index export}; no `=== ''` branch existed outside the function itself. `ProofCaptureError` added to the public surface at `packages/app/src/index.ts:618`.

**R2 — task-spec lookup de-suppressed** (`config/workflows/task-pipeline.yaml:344-350`): dropped `2>/dev/null` on the lookup, dropped `|| true`, dropped the forced `exit 0`; added `mkdir -p .spur/run` guard and an explicit empty-path check that exits 1 naming the unresolved task. The priority read stays tolerant (a missing priority line is genuinely optional).

**R3 — expectFile delete-before-invoke** (`packages/app/src/workflow/actions/agent-run.ts:333-352`): the expectFile target is resolved and deleted before dispatch, so presence after exit-0 is proof THIS run produced it (stat/mtime comparison rejected as racy per Design). Deletion failure fails the step before spawn. No preserve option added — a caller needing an existing file preserved needs a different action, per Design.

**R4 — proofBinding enforced at artifact write** (`packages/app/src/workflow/actions/run-artifact.ts:86-111`, regex `:9`): before `dao.record`, a declared binding must be exactly `'current'` (unknown values rejected) and the run must carry a well-formed `sha256:<64hex>` digest in `vars.proofDigestNow` (preferred) else `vars.proofDigest`; otherwise the artifact is rejected and no ledger row is persisted. Declared `proofBinding: current` on the done-state verify-verdict artifact (`config/workflows/task-pipeline.yaml:703-711`) — it holds there by construction (record re-captures `proofDigestNow` with `expect`), making the option non-decorative in the canonical pipeline.

**Baseline re-pin**: `config/workflow-composition-baseline.json` `task-pipeline.test:onEnter:0` invocation updated to the new R2 command (1-line diff, hand-preserved `proofInputs`/`disposition`/`callers` metadata that `regen-composition-baseline.ts` would have dropped).

**Tests (R5)** — each regression names its requirement and exercises the failure path: R1 `packages/app/tests/workflow/proof-input-fingerprint.test.ts:206-277` (all four git failure shapes reject; `compute` derives no digest); R2 `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-237` (structural no-suppression pins + behavioral non-zero exit on unresolved path) and `:198-203` (R4 yaml declaration pin); R3 `packages/app/tests/workflow/actions/agent-run.test.ts:555-594` (stale answer cannot satisfy; target absent at dispatch time) plus existing expectFile tests reworked to produce the file during dispatch (`:541-553`, `:598-616`, `:675-690`, `:744-750`); R4 `packages/app/tests/workflow/actions/run-artifact.test.ts:109-198` (missing/malformed digest and unknown binding reject with zero ledger rows; `proofDigestNow` preferred; no-binding behavior unchanged).

**R6 audit**: no env var, option, or softFail path added; every change only removes a fail-open route (R2's tolerant priority read is unchanged from pre-0751 behavior).

**Not done (out of scope per Design)**: F-10 whole-tree attribution; resolve/resume seam (0752); action-option/confinement (0753). R1/R2 will surface latent failures in previously-"passing" runs — accepted tradeoff per Design, re-measured at 0757.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/proof-input-fingerprint.ts:63` declares `ProofCaptureError`; `:114-126` throw it on non-zero `read-tree` / `add` / `write-tree`; `:127-130` re-throw from the `catch` — no empty-string sentinel remains. `bun test tests/workflow/proof-input-fingerprint.test.ts --test-name-pattern "git-tree capture fails closed"` → 5 pass / 0 fail. |
| R2 | MET | `config/workflows/task-pipeline.yaml:368` fails the step when the resolved task path is empty ("fail-closed proof chain (0751 R2): task path for $wbs did not resolve"); the comment at `:365` states the path is NOT optional. `bun test tests/workflow/task-pipeline-proof-chain.test.ts --test-name-pattern "task-path lookup fails closed"` → 4 pass / 0 fail. |
| R3 | MET | `packages/app/src/workflow/actions/agent-run.ts:339-352` deletes `expectFile` before dispatch and fails if it cannot; `:576-606` fails after a zero exit when the file is absent. `bun test tests/workflow/actions/agent-run.test.ts --test-name-pattern "0751 R3"` → 2 pass / 0 fail. |
| R4 | MET | `packages/app/src/workflow/actions/run-artifact.ts:28` narrows `proofBinding`; `:86-103` rejects an unsupported value and rejects `current` when the run carries no current proof input, before any artifact record is persisted. `bun test tests/workflow/actions/run-artifact.test.ts --test-name-pattern "proofBinding enforcement"` → 5 pass / 0 fail. |
| R5 | MET | All four failure-path suites run green together: `cd packages/app && bun test tests/workflow/proof-input-fingerprint.test.ts tests/workflow/task-pipeline-proof-chain.test.ts tests/workflow/actions/run-artifact.test.ts tests/workflow/actions/agent-run.test.ts` → 166 pass / 0 fail / 485 expect() calls. Each suite asserts the thrown error or failed result, not only the happy path. |
| R6 | MET | `git show c838f89f4 -U0 -- packages/app/src config/workflows \| grep '^+' \| grep -icE 'softfail\|continueonerror\|bypass\|allowmissing\|SPUR_.*=\|process\.env\.[A-Z]'` → `0`. The only `process.env` reads in the touched files (`proof-input-fingerprint.ts:109`, `agent-run.ts:1094`) are pre-existing child-process env inheritance, not proof overrides. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Proof fingerprinting fails closed on a git failure | MET | test | `bun test tests/workflow/proof-input-fingerprint.test.ts --test-name-pattern "git-tree capture fails closed"` → 5 pass / 0 fail / 9 expect(). The suite drives each git step to a non-zero exit and asserts `ProofCaptureError`, so no digest is derived. |
| R2 — A missing task spec fails instead of degrading to tree-only proof | MET | test | `bun test tests/workflow/task-pipeline-proof-chain.test.ts --test-name-pattern "task-path lookup fails closed"` → 4 pass / 0 fail / 11 expect(), asserting the `config/workflows/task-pipeline.yaml:368` guard errors on an unresolved path. |
| R3 — A stale verifier answer cannot satisfy a fresh assertion | MET | test | `bun test tests/workflow/actions/agent-run.test.ts --test-name-pattern "0751 R3"` → 2 pass / 0 fail / 6 expect(): a pre-seeded `expectFile` is deleted before dispatch and the assertion fails when the run does not rewrite it. |
| R4 — A declared proof binding is enforced at artifact write | MET | test | `bun test tests/workflow/actions/run-artifact.test.ts --test-name-pattern "proofBinding enforcement"` → 5 pass / 0 fail / 12 expect(): unsupported and unheld bindings both fail before persistence. |
| R6 — The repairs add no new bypass | MET | command | `git show c838f89f4 -U0 -- packages/app/src config/workflows \| grep '^+' \| grep -icE 'softfail\|continueonerror\|bypass\|allowmissing\|SPUR_.*=\|process\.env\.[A-Z]'` → `0` added bypass-shaped lines. |
| The done-state verdict artifact declares the enforced proof binding | MET | test | (D9 ship-contract alias of this task's R4; see task AC checklist `AC-D9a`.) `config/workflows/task-pipeline.yaml:743` declares `proofBinding: current` on the done-state `run.artifact`; `cd packages/app && bun test tests/workflow/actions/run-artifact.test.ts --test-name-pattern "proofBinding enforcement"` -> 5 pass / 0 fail / 12 expect(): unsupported and unheld bindings both fail before persistence, so a missing or stale binding cannot reach `dao.record`. |
| No new bypass is introduced in the pipeline composition | MET | command | (D9 ship-contract alias of this task's R6; see task AC checklist `AC-D9b`.) `git show c838f89f4 -U0 -- packages/app/src config/workflows \| grep '^+' \| grep -icE 'softfail\|continueonerror\|bypass\|allowmissing\|SPUR_.*=\|process\.env\.[A-Z]'` -> `0` added bypass-shaped lines across the task-pipeline and docs-pipeline surfaces. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | closure | `config/workflows/docs-pipeline.yaml:143` | The prior sibling fail-open lookup was resolved by 0760 and is regression-pinned by `docs-pipeline-proof-chain.test.ts`. |
| P4 | test fidelity | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241` | The prior floating rejection matcher was consolidated into 0760 R4 and now awaits the rejection before asserting `ProofCaptureError`. |
| P4 | documentation | `config/rules/structure/protected-files.yaml:28` | The inaccurate `.spur/` comment is corrected without changing scanner scope. |

**Per-requirement verdict** — R1 MET · R2 MET · R3 MET · R4 MET · R5 MET · R6 MET.

Fresh verification includes 52 passing app workflow tests covering both resolved findings; the full project gate is recorded by 0764. The digest-presence binding is intentionally narrower than cryptographic artifact-content binding and remains an accepted threat-model ceiling, not unfinished D9 work.

**Residual risk** — none requiring D9 work.

**Final disposition:** done.
### References

- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3 (R3 seam S7), §4.2 (immutable safety floor)
- Defect register: `docs/inventory/d8-0729-workflow-contract-inventory.md` §F-5, §F-7, §F-8, §F-9
- ADR-071 (proof-chain symmetry) — `docs/00_ADR.md`; amended by this slice
- Code: `packages/app/src/workflow/proof-input-fingerprint.ts:99-118`, `packages/app/src/workflow/actions/run-artifact.ts:88-101`, `packages/app/src/workflow/actions/agent-run.ts:553`, `config/workflows/task-pipeline.yaml:345`

### History

- 2026-09-03T22:01:08.055Z todo → wip (system)
- 2026-09-03T23:02:52.259Z wip → testing (system)
- 2026-09-03T23:04:22.104Z testing → done (system)
