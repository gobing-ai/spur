---
schema_version: 1
name: "S0a: Make workflow proof fail-closed — git-tree, task lookup, verifier freshness, artifact binding"
status: todo
template: feature-impl
created_at: 2026-09-03T20:27:30.404Z
updated_at: "2026-09-03T21:15:08.007Z"
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
- [ ] R1: convert the capture contract to a failure-carrying result; update all callers; add the git-failure regression test.
- [ ] R4: enforce `proofBinding` in `run-artifact.ts` before `dao.record`; add the unbound-artifact regression test.
- [ ] R3: delete-before-invoke for `expectFile` in `agent-run.ts`; add the stale-answer regression test.
- [ ] R2: de-suppress the task-path lookup in `task-pipeline.yaml`; add the missing-task regression test.
- [ ] R6: audit the changed surface for any newly added bypass; confirm none.
- [ ] Run the workflow-service and workflow-action suites from inside their workspace; then `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Feature: `docs/features/D9_workflow-seam-stabilization-and-proportional-gate-rollout.md`
- Strategy (frozen, approved): `docs/plans/2026-09-02-d8-proportional-workflow-upgrade-strategy.md` §3 (R3 seam S7), §4.2 (immutable safety floor)
- Defect register: `docs/inventory/d8-0729-workflow-contract-inventory.md` §F-5, §F-7, §F-8, §F-9
- ADR-071 (proof-chain symmetry) — `docs/00_ADR.md`; amended by this slice
- Code: `packages/app/src/workflow/proof-input-fingerprint.ts:99-118`, `packages/app/src/workflow/actions/run-artifact.ts:88-101`, `packages/app/src/workflow/actions/agent-run.ts:553`, `config/workflows/task-pipeline.yaml:345`
### History
