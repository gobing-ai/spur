---
schema_version: 1
name: Fix gate-recheck receipt persistence and unreachable FSM decisions (0962 run findings)
status: done
template: standard
created_at: 2026-09-26T16:33:31.303Z
updated_at: "2026-09-27T01:37:08.000Z"
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

- [x] R1. On the recheck path the gate persists the receipt it actually evaluated, so the declared no-progress skip is reachable: after a `run` and a subsequent `recheck` at an unchanged proof digest, the receipt's `inputDigest` names the digest that `recheck` evaluated, and a second `recheck` at that same digest takes the `check.skipped-no-progress` path instead of re-running the gate command.
- [x] R2. The classification source of every FSM `decide` is recorded and distinguishable: a run log or trace row states whether an action's value came from a decision backend or from the declared default, and the `failure-class` lane's `retryable` outcomes are reachable when a backend is configured.
- [x] R3. Spawn-bearing guard tests declare an explicit time budget, so full-suite wall-clock load cannot turn a passing assertion into a failure: the guard suite passes repeated consecutive full-suite runs, or the affected tests carry an explicit `timeout` with a comment naming the spawn cost as the reason.

### Acceptance Criteria

- [x] AC1 — R1 — A recheck at an unchanged digest does not re-run the gate command (req: R1)
- [x] AC2 — R2 — Decision provenance is recorded and `retryable` is reachable (req: R2)
- [x] AC3 — R3 — Guard-test timing is declared, not left to the suite default (req: R3)

**Verify lens**

- **AC1** — after one `quality-gate.ts run` and two `quality-gate.ts recheck` invocations at the same proof digest, `.spur/run/<wbs>-check-receipt.json` carries `inputDigest` equal to that digest and the second recheck's log/stdout contains `check.skipped-no-progress`; the gate log for the second recheck shows no `bun run spur-check` execution.
- **AC2** — with the decision backend enabled, `--decide --node test-fail-triage` can return `value: "retryable"` and the run log names the source as a model decision; with it disabled the same call records `source: default` (or equivalent) so a reader can tell a fallback from a decision.
- **AC3** — `(cd packages/app && bun test tests/workflow/guards)` passes on N consecutive full-suite runs declared by the owner, and the `EnvShellGuardRunner` case that timed out either declares an explicit timeout with the spawn-cost comment or no longer depends on wall clock.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-26T23:14:23.155Z

- **Q: F-B policy — resolvable backend (a) or deterministic default (b)?** **Closed (operator, 2026-09-26): (b) deterministic default.** FSM-internal decides (`triage`, `test-fail-triage`) use the YAML `default` as the intended deterministic classification; the trace/run log records `source: default` so a fallback is never presented as a model decision. The unreachable `retryable` lane is collapsed so the guard set matches the reachable outcomes. Rationale: an inline driver must not depend on a configured backend; "deterministic over implicit". R2/AC2 are satisfied by provenance + a guard set with no dead lane (the "`retryable` reachable when a backend is configured" clause is superseded by the collapse).
- **Q: F-A shape — refresh single receipt (a) or per-digest receipts (b)?** **Closed (operator, 2026-09-26): (a) refresh single receipt.** `recheck` rewrites `.spur/run/<wbs>-check-receipt.json` for the digest it evaluated; anti-laundering preserved (a skip never turns FAIL into PASS; a FAIL digest still writes the FAIL verdict). X→Y→X revisit is out of scope.
- **Q: F-C approach?** **Closed (agent, per Design preference):** prefer removing the wall-clock dependency for the semantics case if injection stays readable; otherwise an explicit per-test `timeout` with a spawn-cost comment.

### Design

Fix direction per finding; the owner picks the final shape.

**F-A (R1).** Two candidate shapes, both keeping `run` authoritative: (a) `recheck` refreshes the receipt it already has, rewriting `inputDigest`, `checks` and `completedAt` for the digest it evaluated, so the next recheck at that digest skips; or (b) the receipt becomes a per-digest record keyed by digest, and the no-progress test looks up the digest rather than the single latest receipt. Shape (a) is the smaller diff and matches the current single-file path in `.spur/run/<wbs>-check-receipt.json`; shape (b) also fixes the case where a recheck at digest X is followed by a recheck at a digest Y that was evaluated earlier. Preserve the existing anti-laundering property: a FAIL receipt must never be rewritten to PASS by a skip, and a skip must still write the FAIL verdict for a FAIL digest.

**F-B (R2).** Decide the policy before coding: either (a) give FSM-internal decides a resolvable backend under `profile=auto`, so the model actually classifies, or (b) declare the YAML `default` as the intended deterministic classification for FSM-internal decides, drop the pretense of a model decision on that path, and record `source: default` so provenance is honest. Option (b) is cheaper and arguably correct — an inline driver must not depend on a backend being configured — but it makes the `retryable` lane a static fallback that no failure class can reach, so the YAML's three-way choice would collapse and the guard set should be simplified to match. Option (a) restores the intent but adds a backend dependency to a path that currently never fails. Do not leave the current intermediate state, where the guard set implies three outcomes and only one is reachable.

**F-C (R3).** Cheapest fix is an explicit per-test `timeout` on the spawn-bearing guard cases, with a comment naming `/bin/sh` spawn cost under suite concurrency as the reason. A stronger fix removes the wall-clock dependency by injecting the spawn result and asserting on it, keeping one end-to-end case that really spawns. Prefer the stronger fix for the semantics case if the injection stays readable.

### Plan

- [x] Reproduce F-A: one `run` + two `recheck` at a fixed digest; capture the receipt before/after and confirm the second recheck re-executes the gate command.
- [x] Implement the chosen R1 shape in `plugins/sp/scripts/quality-gate.ts`; extend `plugins/sp/tests/quality-gate.test.ts` (or the existing receipt tests) to assert the skip path fires and that a FAIL digest is never laundered to PASS.
- [x] Decide the F-B policy with the owner, then implement the chosen shape and record decision provenance; assert `retryable` reachability (or the collapsed guard set) in the workflow tests.
- [x] Apply the F-C timing fix and run the guard suite inside a full `bun run gate` at least twice to confirm stability.
- [x] Gates: `bun run gate`; `spur rule run --json`; any pipeline-relevant YAML guard changes re-validated with `spur workflow validate`.

### Solution

Three findings fixed per the Q&A decisions (F-A (a) refresh single receipt; F-B (b) deterministic default + collapse; F-C injection for the semantics case, explicit budget for real spawns).

| Req | File | Change |
| --- | --- | --- |
| R1 | `plugins/sp/scripts/quality-gate.ts:642` | Receipt write gated on `!noProgressSkip` instead of `mode === 'run'`: `recheck` persists the receipt it evaluated; a skip never rewrites a receipt (anti-laundering kept). |
| R1 | `plugins/sp/tests/quality-gate-receipt.test.ts:518` | run → recheck → recheck at one digest: second recheck skips, probe/full gate not run, receipt byte-equal. |
| R1 | `plugins/sp/tests/quality-gate-receipt.test.ts:550` | A green recheck persists PASS only because the full gate actually ran. |
| R1 | `plugins/sp/tests/quality-gate.test.ts:375` | No-digest recheck writes no receipt; recheck with a digest writes one. |
| R2 | `packages/app/src/workflow/decide.ts:65` | `DecideResult.source: 'model' \| 'default'` — `default` on every degraded row, `model` only on accepted answers. |
| R2 | `packages/app/src/services/inline-run-setup.ts:484` | Inline decide outcome threads `source`. |
| R2 | `plugins/sp/scripts/inline-run-setup.ts:561` | `--decide` appends `decide node=… value=… source=… reason=…` to the run log (helper renamed `appendRunLogLine`). |
| R2 | `config/workflows/task-pipeline.yaml:600` | `failure-class` choices collapsed to `[fix, stop]`; retryable attempt-count shell and `test-fail-triage → test-recheck` edge removed. |
| R2 | `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:329` | Stale `retryable` row fails closed; frozen order is stop, cap, fix, defense. |
| R2 | `packages/app/tests/workflow/guard-parity.test.ts:93` | Baseline fixture drops the retryable edge; `retryable` kept as a boundary value. |
| R2 | `packages/app/tests/workflow/decide.test.ts:177` | Degraded rows pin `source: 'default'`; accepted row pins `source: 'model'`. |
| R2 | `plugins/sp/tests/inline-run-setup.test.ts:443-454` | `--decide` provenance pinned in stdout, resultFile and run log. |
| R2 | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:515` | Driver doc names the `source` field and run-log line. |
| R2 | `docs/design/workflow-catalogue-refactor.md:143` | Decide row shape + failure-triage lane table updated. |
| R3 | `packages/app/tests/workflow/guards/shell.test.ts:48` | Semantics case uses an injected executor (no wall clock). |
| R3 | `packages/app/tests/workflow/guards/shell.test.ts:14` | Real-spawn metacharacter cases carry `SPAWN_TIMEOUT_MS` with the spawn-cost comment. |

Generated bundles regenerated: `plugins/sp/scripts/{quality-gate,inline-run-setup}.mjs`, `plugins/sp/lib/inline-run.generated.mjs`, CLI config bundle.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/scripts/quality-gate.ts:637-661 — receipt write gated `if (!noProgressSkip)`, `inputDigest: env.proofDigest`, `writeFileSync(abs(receiptFile))` (comment :637-641: a skip never rewrites the receipt it matched → no FAIL→PASS laundering). Test: plugins/sp/tests/quality-gate-receipt.test.ts:516-548 — run→recheck(digest-y) refreshes receipt inputDigest=digest-y (FAIL kept); second recheck at digest-y emits check.skipped-no-progress, attempts=0, no probe/full-gate execution, receipt byte-equal; no-digest recheck writes nothing (quality-gate.test.ts:375). Fresh this cycle: 46 pass / 0 fail (quality-gate-receipt + quality-gate, 3.20s). LIVE: .spur/run/0976-check-receipt.json inputDigest=sha256:613f1dc6c6d935af94a3da3158a67892071aafd58d93ee6b2ef5cbe1000592a4 == env-0976.sh proofDigest, tier full, cmd `bun run spur-check`, status PASS, durationMs 267623, completedAt 2026-09-27T01:26:38.098Z; .spur/run/0976-test-gate.status PASS (attempts: 1). |
| R2 | MET | packages/app/src/workflow/decide.ts:65 — `source: 'model' \| 'default'` (default on every degraded row, model only on accepted answers). plugins/sp/scripts/inline-run-setup.ts:559-561 — appendRunLogLine appends `decide node=… value=… source=… reason=…` to the run log. Lane collapse: config/workflows/task-pipeline.yaml:600 `choices: [fix, stop]` (retryable attempt shell + test-fail-triage→test-recheck edge removed per closed Q&A (b)). Fail-closed: packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:329 — stale `retryable` row → no lane, no attempt counted. Provenance pinned: packages/app/tests/workflow/decide.test.ts:177 + plugins/sp/tests/inline-run-setup.test.ts:443-454. Fresh this cycle: 43 pass / 0 fail (decide+triage-routing+guard-parity+guards/shell, 1.70s) and 4 pass / 0 fail (inline decide, 0.99s). 13 checkbox ticks → admission evidence folded into R2's Solution row: the only working-tree change is that 13-line docs diff (11 ticks + updated_at + the R2 Solution row citation task-pipeline.yaml :593→:600, re-verified live as the `choices: [fix, stop]` line), and this zero-diff re-certification's admission (packages/app/src/workflow/actions/agent-run.ts:1169-1185 `requireDiffAllowCleanCheck` → taskCheckClean; task-pipeline.yaml:295) is cited through that R2 Solution row — `spur task check 0976` exit 0 (pre-condition, not re-run). |
| R3 | MET | packages/app/tests/workflow/guards/shell.test.ts:13-14 — `const SPAWN_TIMEOUT_MS = 20_000;` with the spawn-cost comment (cold /bin/sh spawn under full-suite concurrency), applied to both real-spawn metacharacter cases; the semantics case uses an injected executor (wall-clock-free). Fresh this cycle: 8 pass / 0 fail within the 43-test 4-file run (1.70s, no timeout hit). Full-suite stability: gate `bun run spur-check` PASS at this digest (receipt, 267623ms; log 9251 pass / 0 fail across 534 files, 245.52s) with zero guard-timeout occurrences. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Receipt at THIS digest retained: .spur/run/0976-check-receipt.json inputDigest=sha256:613f1dc6…592a4, PASS, 267623ms; .spur/run/0976-test-gate.status PASS, attempts: 1. Skip path proven by plugins/sp/tests/quality-gate-receipt.test.ts:516-548 — a recheck at an unchanged digest emits check.skipped-no-progress, runs no gate command (probe-ran/full-ran absent from the log), attempts=0, receipt byte-equal; fresh this cycle 46 pass / 0 fail. No gate re-run performed per pre-condition ("do not redo"); anchors re-read fresh (manual-review). |
| AC2 | MET | test | Provenance recorded and distinguishable: packages/app/src/workflow/decide.ts:65 `source: 'model' \| 'default'`; run-log line plugins/sp/scripts/inline-run-setup.ts:559-561; pinned by decide.test.ts:177 (degraded→'default', accepted→'model') and inline-run-setup.test.ts:443-454 (`decide node=classify value=stop source=default reason=disabled` in stdout, resultFile, and run log); stale `retryable` fails closed with no attempt counted (triage-routing.test.ts:329); collapse live at task-pipeline.yaml:600 `[fix, stop]`. Fresh this cycle: 43 + 4 pass / 0 fail. |
| AC3 | MET | test | Timing declared: packages/app/tests/workflow/guards/shell.test.ts:13-14 SPAWN_TIMEOUT_MS=20s with spawn-cost comment on both real-spawn cases; fresh 8 pass / 0 fail (no timeout hit). Full suite at THIS digest: receipt PASS 267623ms; log .spur/run/0976-test-gate.log — "9251 pass / 0 fail" across 534 files, 245.52s, zero "timeout" occurrences, trailing proof-digest line == sha256:613f1dc6c6d935af94a3da3158a67892071aafd58d93ee6b2ef5cbe1000592a4. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
| P4 | residual-sweep | — | blocking=0 deferrable=0 advisory=0 housekeeping=0 |
| P4 | proof-input-digest | — | sha256:613f1dc6c6d935af94a3da3158a67892071aafd58d93ee6b2ef5cbe1000592a4 |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-09-26T23:20:50.985Z backlog → wip (system)
- 2026-09-27T01:36:58.487Z wip → testing (system)
- 2026-09-27T01:37:08.000Z testing → done (system)

