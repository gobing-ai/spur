---
schema_version: 1
name: Fix gate-recheck receipt persistence and unreachable FSM decisions (0962 run findings)
status: backlog
template: standard
created_at: 2026-09-26T16:33:31.303Z
updated_at: "2026-09-26T16:48:42.117Z"
feature_id: I31

---

## 0976. Fix gate-recheck receipt persistence and unreachable FSM decisions (0962 run findings)

### Background

Surfaced by the session that drove task 0962 end-to-end (`dev-run 0962 --auto --next --agent inline --worktree`, run `wf-0962-0021`) and then landed its branch. All three findings are harness-level, reproduced with in-session evidence, and unowned: `rg` over the open task corpus finds no task for check-receipt persistence on the recheck path, for the FSM decision fallback, or for the guard-test timing.

Owned by elsewhere — recorded here as pointers, not requirements:

- Standard-script twin verification: **0970** / feature **A32** (resolves the `stale_twin` gate failure this session reported; fixed live by commits `58bd10d78` + `3166da837`).
- Inline `--worktree` run provenance destroyed by teardown and action-row emission: **0975**. This session independently reproduced the provenance loss (the worktree's `spur.db` died with `git worktree remove`, so both run rows are no longer queryable and the run records survive only because they were copied out by hand); that belongs to 0975.
- Proof-capture ordering vs completion-box ticking (ticking boxes before the `record` hop moved the fresh digest off the declared one): **0958** Defect B. Its checkbox-canonical digest makes the ordering irrelevant, so 0975 no longer carries it.
- 0945 routing truth-table evaluation cost: **0974**.

**F-A — `quality-gate.ts recheck` never persists the check receipt, so the declared no-progress skip is unreachable.** The script's own contract says a full-tier FAIL receipt at the current digest is a no-progress skip straight to the FAIL write (0940 R2), implemented as `receiptFailsAtDigest(receipt, currentDigest)` comparing `receipt.inputDigest === currentDigest`. Only `run` writes receipts, so after any `run` at a different digest the comparison can never hold. Observed: `run` wrote `.spur/run/0962-check-receipt.json` with `inputDigest sha256:f1772d62…`; a later `recheck` at `sha256:ea9a99e8…` re-ran the entire suite (349 s) and left the receipt byte-identical (`inputDigest` still `f1772d62…`, `completedAt` unchanged at `2026-09-26T06:35:12.638Z`). One task consumed three full gate invocations: 67 s (FAIL on `require-corresponding-test`), 541 s (FAIL, load-sensitive test), 349 s (PASS). Anchor: `docs/reports/i31/0912-workflow-baseline.md` F4 gate repetition, owner handoff D62. That baseline marks F3/F4 INSUFFICIENT_EVIDENCE pending a 3-run sample with retained failing-gate output, so no performance target is claimed here — the measurement above is this run's own gate invocations.

**F-B — FSM `decide` actions degrade to the YAML default, making `retryable` unreachable.** `inline-run-setup.ts --decide` returned `{"ok":true,"value":"fix","degraded":true,"reason":"disabled","backend":null,"confidence":null}` for `test-fail-triage` and `{"value":"standard","degraded":true}` for `triage`. The `test-fail-triage` guard `jq -e '.value == "retryable"'` therefore can never pass on this host, so the declared recheck-without-repair lane is dead in an inline run, and the recorded classification is a YAML default rather than a decision. The failure is silent in the common case because the default (`fix`) is also the right answer for a genuinely repairable failure; it only becomes visible when the gate failure is environmental or pre-existing, where a `retryable` classification is the honest one. The run log cannot distinguish a real decision from a fallback.

**F-C — `EnvShellGuardRunner > passed reflects exit code, preserving guard semantics` intermittently exceeds bun's 5 s default in the full suite.** Observed at 09:10: `(fail) … [5000.50ms] ^ this test timed out after 5000ms` inside `bun run gate`. The same file re-run in isolation: 8 pass / 0 fail in 116 ms. It did not recur in the final gate run (9222 pass / 0 fail). Root cause unconfirmed; the test spawns `/bin/sh`, and the suite runs at concurrency 20, so spawn latency is the leading hypothesis — confirmation needs a recurrence captured with load and timing.

### Requirements

- [ ] R1. On the recheck path the gate persists the receipt it actually evaluated, so the declared no-progress skip is reachable: after a `run` and a subsequent `recheck` at an unchanged proof digest, the receipt's `inputDigest` names the digest that `recheck` evaluated, and a second `recheck` at that same digest takes the `check.skipped-no-progress` path instead of re-running the gate command.
- [ ] R2. The classification source of every FSM `decide` is recorded and distinguishable: a run log or trace row states whether an action's value came from a decision backend or from the declared default, and the `failure-class` lane's `retryable` outcomes are reachable when a backend is configured.
- [ ] R3. Spawn-bearing guard tests declare an explicit time budget, so full-suite wall-clock load cannot turn a passing assertion into a failure: the guard suite passes repeated consecutive full-suite runs, or the affected tests carry an explicit `timeout` with a comment naming the spawn cost as the reason.

### Acceptance Criteria

- [ ] AC1 — R1 — A recheck at an unchanged digest does not re-run the gate command (req: R1)
- [ ] AC2 — R2 — Decision provenance is recorded and `retryable` is reachable (req: R2)
- [ ] AC3 — R3 — Guard-test timing is declared, not left to the suite default (req: R3)

**Verify lens**

- **AC1** — after one `quality-gate.ts run` and two `quality-gate.ts recheck` invocations at the same proof digest, `.spur/run/<wbs>-check-receipt.json` carries `inputDigest` equal to that digest and the second recheck's log/stdout contains `check.skipped-no-progress`; the gate log for the second recheck shows no `bun run spur-check` execution.
- **AC2** — with the decision backend enabled, `--decide --node test-fail-triage` can return `value: "retryable"` and the run log names the source as a model decision; with it disabled the same call records `source: default` (or equivalent) so a reader can tell a fallback from a decision.
- **AC3** — `(cd packages/app && bun test tests/workflow/guards)` passes on N consecutive full-suite runs declared by the owner, and the `EnvShellGuardRunner` case that timed out either declares an explicit timeout with the spawn-cost comment or no longer depends on wall clock.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Fix direction per finding; the owner picks the final shape.

**F-A (R1).** Two candidate shapes, both keeping `run` authoritative: (a) `recheck` refreshes the receipt it already has, rewriting `inputDigest`, `checks` and `completedAt` for the digest it evaluated, so the next recheck at that digest skips; or (b) the receipt becomes a per-digest record keyed by digest, and the no-progress test looks up the digest rather than the single latest receipt. Shape (a) is the smaller diff and matches the current single-file path in `.spur/run/<wbs>-check-receipt.json`; shape (b) also fixes the case where a recheck at digest X is followed by a recheck at a digest Y that was evaluated earlier. Preserve the existing anti-laundering property: a FAIL receipt must never be rewritten to PASS by a skip, and a skip must still write the FAIL verdict for a FAIL digest.

**F-B (R2).** Decide the policy before coding: either (a) give FSM-internal decides a resolvable backend under `profile=auto`, so the model actually classifies, or (b) declare the YAML `default` as the intended deterministic classification for FSM-internal decides, drop the pretense of a model decision on that path, and record `source: default` so provenance is honest. Option (b) is cheaper and arguably correct — an inline driver must not depend on a backend being configured — but it makes the `retryable` lane a static fallback that no failure class can reach, so the YAML's three-way choice would collapse and the guard set should be simplified to match. Option (a) restores the intent but adds a backend dependency to a path that currently never fails. Do not leave the current intermediate state, where the guard set implies three outcomes and only one is reachable.

**F-C (R3).** Cheapest fix is an explicit per-test `timeout` on the spawn-bearing guard cases, with a comment naming `/bin/sh` spawn cost under suite concurrency as the reason. A stronger fix removes the wall-clock dependency by injecting the spawn result and asserting on it, keeping one end-to-end case that really spawns. Prefer the stronger fix for the semantics case if the injection stays readable.

### Plan

- [ ] Reproduce F-A: one `run` + two `recheck` at a fixed digest; capture the receipt before/after and confirm the second recheck re-executes the gate command.
- [ ] Implement the chosen R1 shape in `plugins/sp/scripts/quality-gate.ts`; extend `plugins/sp/tests/quality-gate.test.ts` (or the existing receipt tests) to assert the skip path fires and that a FAIL digest is never laundered to PASS.
- [ ] Decide the F-B policy with the owner, then implement the chosen shape and record decision provenance; assert `retryable` reachability (or the collapsed guard set) in the workflow tests.
- [ ] Apply the F-C timing fix and run the guard suite inside a full `bun run gate` at least twice to confirm stability.
- [ ] Gates: `bun run gate`; `spur rule run --json`; any pipeline-relevant YAML guard changes re-validated with `spur workflow validate`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
