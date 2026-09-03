---
schema_version: 1
name: "S0a: Make workflow proof fail-closed — git-tree, task lookup, verifier freshness, artifact binding"
status: done
template: feature-impl
created_at: 2026-09-03T20:27:30.404Z
updated_at: "2026-09-03T23:04:22.104Z"
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

- [ ] R1. Git-tree proof-input capture fails closed: when `read-tree`, `add`, or `write-tree` fails, or the `catch` fires, the caller receives a distinguishable failure rather than an empty string, and no fingerprint is derived from it.
- [ ] R2. The task-pipeline task-spec lookup is not suppressed: an empty resolved task path is an error that fails the step, not a silent fall-through to whole-tree-only proof.
- [ ] R3. An `expectFile` assertion is satisfied only by an artifact produced by the current run — a file left behind by a prior run cannot satisfy it.
- [ ] R4. `run.artifact`'s `proofBinding` is validated at artifact write. An artifact whose declared binding does not hold is rejected; the option stops being decorative.
- [ ] R5. Each of R1-R4 has a regression test that fails against the pre-repair code and passes after, exercising the failure path rather than only the happy path.
- [ ] R6. No change widens what counts as proof. Repairs only remove fail-open paths; no new bypass, env override, or `softFail` escape is introduced.

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

- [ ] Grep every caller of `createGitAlternateTree` and of the `=== ''` sentinel before editing; record the caller set in the Solution.
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
| ------------- | -------- | ---------- |
| R1 | MET | `ProofCaptureError` class `packages/app/src/workflow/proof-input-fingerprint.ts:64`; all four git failure paths throw carrying stderr — read-tree `:116`, add `:121`, write-tree `:125`, catch-convert `:127-129`; no `return ''` sentinel remains (grep). `computeProofInputFingerprint` awaits with no internal catch (`:223`), so no digest is derived from a failed capture; its only production caller fails the action via try/catch `packages/app/src/workflow/actions/proof-fingerprint.ts:68-76`. Exported `packages/app/src/index.ts:621`. Regression: `packages/app/tests/workflow/proof-input-fingerprint.test.ts:210-277` (4 git-failure shapes + compute rejects). Fresh run: 166 pass / 0 fail across the four touched suites. |
| R2 | MET | Fail-closed lookup `config/workflows/task-pipeline.yaml:348`: no `2>/dev/null` on the lookup, no `\|\| true`, no forced `exit 0`; explicit empty-path check exits 1 naming the unresolved wbs. Priority read stays tolerant by design. Baseline re-pin string-identical `config/workflow-composition-baseline.json:253`. Regression: structural no-suppression pins + behavioral non-zero exit `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-242`. |
| R3 | MET | Delete-before-invoke: target resolved and deleted pre-dispatch, deletion failure fails the step before spawn `packages/app/src/workflow/actions/agent-run.ts:333-352`; post-exit assert unchanged `:576-606`. Regression: stale answer cannot satisfy (`ok:false`, "expected file is absent", stale file consumed from disk) and absent-at-dispatch proof `packages/app/tests/workflow/actions/agent-run.test.ts:555-593`. |
| R4 | MET | Binding enforced at write BEFORE ledger: unknown binding rejected `packages/app/src/workflow/actions/run-artifact.ts:92-96`; missing/malformed `sha256:<64hex>` digest in `proofDigestNow`→`proofDigest` rejected `:97-110`; `dao.record` only at `:118` on pass. Sole declaration `config/workflows/task-pipeline.yaml:710` (holds by construction — record re-captures `proofDigestNow` with expect). Regression with zero-ledger-row assertions on every reject branch `packages/app/tests/workflow/actions/run-artifact.test.ts:109-201`. |
| R5 | MET | Each regression names its requirement and exercises the failure path: R1 `packages/app/tests/workflow/proof-input-fingerprint.test.ts:210-277`; R2 `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:179-242` (+ driver case `plugins/sp/tests/inline-pipeline-driver.test.ts:283`); R3 `packages/app/tests/workflow/actions/agent-run.test.ts:555-593`; R4 `packages/app/tests/workflow/actions/run-artifact.test.ts:109-201`. Fresh this run: packages/app 4 suites 166 pass / 0 fail (485 expect, 2.25s); plugins/sp driver 4 pass / 0 fail (1.29s). |
| R6 | MET | Static audit of all added diff lines this run: no `process.env`, no softFail, no `\|\| true`/`exit 0`, no bypass option introduced ("NO bypass-introducing additions found"). Every change removes a fail-open route; `config/rules/structure/protected-files.yaml:28-30` is secrets-scanner scope hygiene (review advisory #3), not a proof-surface widening. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| Proof fingerprinting fails closed on a git failure | MET | test | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:210-277` (add/write-tree/throw awaited rejections; compute derives no digest on read-tree failure); code `packages/app/src/workflow/proof-input-fingerprint.ts:116,121,125,127-129`; downstream step fails via `packages/app/src/workflow/actions/proof-fingerprint.ts:75-76` |
| A missing task spec fails instead of degrading to tree-only proof | MET | test | `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:226-241` (rendered command with unresolvable task throws via execSync); guard at `config/workflows/task-pipeline.yaml:348` exits 1 naming the unresolved task |
| A stale verifier answer cannot satisfy a fresh assertion | MET | test | `packages/app/tests/workflow/actions/agent-run.test.ts:555-593` (stale file → `ok:false` naming absence; target absent at dispatch time); code `packages/app/src/workflow/actions/agent-run.ts:339-352` |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — all six requirements met with file:line evidence; no blocker/major findings. 2 minor, 2 advisory.

#### Findings (ranked)

| # | Severity | Dimension | Finding | Location |
| --- | ---------- | ----------- | --------- | ---------- |
| 1 | P3 (minor) | functional (P3) | The exact fail-open task-path lookup R2 removed (`2>/dev/null … \|\| true; exit 0`) remains in **docs-pipeline**'s proof chain — and its resolved `taskSpecPath` folds into its proof digest via `taskFile:` (docs-pipeline.yaml:155, :191), so the F-7 defect class is still live in the sibling workflow. Out of R2's literal task-pipeline scope (correctly not bundled here); needs a follow-up task to keep D9's fail-closed property uniform across proof-carrying workflows. | `config/workflows/docs-pipeline.yaml:145` |
| 2 | P3 (minor) | correctness (P3) | First R1 regression assertion is a floating promise: `expect(createGitAlternateTree(...)).rejects.toBeInstanceOf(...)` is never awaited — bun:test may settle the test before the matcher runs, so a regression back to the `''` sentinel could pass vacuously. Sibling tests use the awaited `.catch(e => e)` pattern; add `await` (one word). | `packages/app/tests/workflow/proof-input-fingerprint.test.ts:241-244` |
| 3 | P4 (advisory) | security (P4) | `/.spur/` secrets-scanner exclusion's rationale comment (".spur/ is gitignored") is inaccurate — root `.spur/` is partly tracked (`git ls-files`: `.spur/config.yaml`, context/memory markdown). Practical impact ≈ zero: include scope is `apps/`, `packages/`, `scripts/`, so tracked root `.spur/` was never scanned; the exclusion only carves nested gitignored test scaffolding (`/packages/**/.spur/`) out of the `packages/` fragment match. Fix the comment, not the rule. | `config/rules/structure/protected-files.yaml:28-30` |
| 4 | P4 (advisory) | architecture (P4) | R4 binding verifies digest presence/shape in run vars, not a cryptographic artifact-content↔digest binding — exactly the Design's "exactly that check and no broader one" scope. Recorded as the known ceiling; a future slice could bind artifact bytes to the digest if the threat model ever demands it. | `packages/app/src/workflow/actions/run-artifact.ts:97-109` |

#### Functional Traceability

| Req | Status | Evidence |
| ----- | -------- | ---------- |
| R1 | MET | All four capture paths throw `ProofCaptureError` carrying stderr: read-tree `packages/app/src/workflow/proof-input-fingerprint.ts:116`, add `:120`, write-tree `:124`, catch-convert `:127-129`; `computeProofInputFingerprint` propagates (`:221-223`, no internal swallow). Caller audit confirmed: only production caller is `proof-fingerprint.ts:68-76`, whose try/catch fails the action (`ok:false`) — no digest derived from a failed capture. Exported at `packages/app/src/index.ts:621`. |
| R2 | MET | Lookup de-suppressed: no `2>/dev/null` on `task path`, no `\|\| true`, no forced `exit 0`; explicit empty-path check exits 1 naming the unresolved wbs (`config/workflows/task-pipeline.yaml:348`). Priority read stays tolerant as designed. Baseline re-pin verified string-identical to the yaml command; docs-pipeline baseline entry untouched. |
| R3 | MET | Delete-before-invoke: target resolved (same cwd/`isAbsolute`/`join` shape as the post-exit check at `agent-run.ts:577`), deleted pre-dispatch, deletion failure fails the step before spawn (`packages/app/src/workflow/actions/agent-run.ts:339-352`). Uses the file's existing per-call `createNodeFileSystem(cwd)` convention (`:570, :578, :708`). `proofBinding: current` holds by construction: `proof.fingerprint var=proofDigestNow expect=${vars.proofDigest}` (`task-pipeline.yaml:631-635`) runs in the done state before the artifact write (`:710`). |
| R4 | MET | Enforcement at write, before ledger: unknown binding rejected (`run-artifact.ts:92-96`); missing/malformed `sha256:<64hex>` digest in `proofDigestNow`→`proofDigest` rejected (`:97-109`); `dao.record` only reached on pass. Only declaration in the tree is `task-pipeline.yaml:710` — no other workflow regressed. |
| R5 | MET | Every regression exercises the failure path and fails against pre-repair code: R1 four git-failure shapes + compute rejection (`proof-input-fingerprint.test.ts:206-277`); R2 structural no-suppression pins + behavioral execSync throw + priority-var never materialized (`task-pipeline-proof-chain.test.ts:179-233`, `inline-pipeline-driver.test.ts` R2 case); R3 stale-answer cannot satisfy + absent-at-dispatch proof (`agent-run.test.ts:555-594`); R4 zero-ledger-row assertions on all reject branches (`run-artifact.test.ts:109-201`). |
| R6 | MET | Diff adds no env var, option, or softFail escape; every change removes a fail-open route. The `protected-files.yaml` edit is scanner-scope hygiene (finding #3), not a proof-surface widening. |

#### Verification evidence (fresh, this tree)

- `bun test` in `packages/app` on the four touched suites: **166 pass / 0 fail**, 485 expect() calls, 2.05s.
- `bun test tests/inline-pipeline-driver.test.ts` in `plugins/sp`: **4 pass / 0 fail**, 1.3s.
- Pipeline quality gate already green on this exact tree (`bun run spur-check` exit 0; digest `sha256:32e3def16523acf727d28ebfcf2f356ec4740e3e6696733bd89445ca03833459`) — not re-run per handoff.

#### Architecture notes

Repairs deepen the proof contract rather than patch symptoms: capture is now total into the error channel (`ProofCaptureError`); freshness is enforced by construction (delete-before-invoke) instead of racy stat/mtime; binding enforcement moved to the write boundary before the ledger row exists. R2's shell guard fails closed on every degradation path checked (failing `spur` → jq yields empty → `-z` fires; missing `jq` → 127; failed redirect → empty path → `-z` fires). No shallow pass-throughs introduced. Finding #1 is the one architectural debt worth scheduling before 0757 re-measurement if docs-pipeline proofs feed the gate denominator.

**Residual risk:** docs-pipeline fail-open lookup (finding #1) and the unawaited assertion (finding #2). Neither blocks this slice; neither widens proof.

**Disposition:** PASS — proceed. Route finding #1 to a follow-up task; finding #2 is a one-word fix ride-along.

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
