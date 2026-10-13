---
schema_version: 1
name: Recover the pipeline from a host-contended (timeout-shaped) gate FAIL instead of a sticky no-progress skip
status: backlog
template: standard
created_at: 2026-10-13T21:13:56.059Z
updated_at: "2026-10-13T21:14:18.100Z"

priority: P2
estimate_hours: 3
---

## 1198. Recover the pipeline from a host-contended (timeout-shaped) gate FAIL instead of a sticky no-progress skip

### Background

A `dev-runall` batch (`runall-1193-1195-1068-1193`, 2026-10-13) ended `failed-check` without a code defect. Sequence: the `test` hop failed first on an unrelated rule false positive; three `test-recheck` runs then failed with a **different test each time** (3 x 20s timeouts -> 2 x 20s timeouts -> 1 assertion), every one green in isolation (`decide*.test.ts` 34/34, `proof-fingerprint` 14/14). Once the first FAIL receipt existed at the run's input digest, the next recheck wrote `check.skipped-no-progress — full-tier FAIL receipt at input digest sha256:e297af31...; recheck skipped` and returned FAIL **without running the chain**, so the pipeline's bounded repair hop could not recover and the task stopped at `wip`.

Mechanism: `packages/app/src/services/quality-gate.ts:893-905` computes `noProgressSkip = receiptFailsAtDigest(receipt, env.proofDigest)`. The guard is correct for its purpose (a fix pass that changed nothing tracked can only reproduce the failure) but it cannot tell a deterministic failure from an environmental one — under host contention the failures are per-test timeouts, which a re-run on a quieter host does not reproduce. One contended FAIL is therefore sticky until the proof digest moves, i.e. until someone edits the tree.

Root cause of the underlying flakes is tracked separately (suite isolation); this task is the **recovery** half: the pipeline must be able to retry a contended FAIL once, bounded, without inventing a verdict. Evidence artifacts: `.spur/run/1193-check-receipt.json` (status FAIL, digest sha256:e297af31...), `.spur/run/1193-test-gate.log` (contains the `timed out after 20000ms` lines and the skip line), `.spur/run/1193-check-receipt.false-fail-contention*.json` (the earlier contended receipts, preserved deliberately).

### Requirements

- [ ] R1. A `recheck` whose prior full-tier FAIL receipt is bound to the current proof digest AND whose gate log records only timeout-shaped failures (`timed out after <n>ms`) re-runs the chain once instead of skipping, and records that decision in the gate log with the literal line `check.retry-contended`.
- [ ] R2. The contended retry is bounded to one per input digest: a second FAIL at the same digest (retry already used) skips exactly as today (`check.skipped-no-progress`).
- [ ] R3. The retry never fabricates a verdict: PASS is still earned from a real green chain, and a red retry writes findings/status/verdict by the existing FAIL path unchanged.
- [ ] R4. A receipt whose log carries any non-timeout failure keeps today's skip; a receipt with no readable log fails closed to today's skip.

### Acceptance Criteria

- [ ] AC1 — A timeout-only FAIL receipt re-runs the recheck instead of skipping (req: R1)
- [ ] AC2 — A second FAIL at the same digest skips with `check.skipped-no-progress` (req: R2)
- [ ] AC3 — A green retry yields PASS and the gate log names the contended retry (req: R3)
- [ ] AC4 — A log with any non-timeout failure, or a missing log, skips as today (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**WHERE.** `packages/app/src/services/quality-gate.ts` — the `noProgressSkip` block in `runQualityGate` (`:893-905`) and its helpers (`receiptFailsAtDigest`, receipt reading).

**HOW.** (1) Add a predicate over the gate log text: timeout-shaped iff every failure line matches `/timed out after \d+ms/` and there is at least one (a green-looking log must not qualify). (2) Resolve the receipt's gate log path the same way the receipt records it (`checks[].logPath`) and read it relative to the run cwd. (3) Make the skip `receiptFailsAtDigest(...) && !(timeoutOnly && retryBudgetLeft)`; persist the used-retry state per digest (e.g. `.spur/run/<wbs>-contended-retry.json` keyed by digest) so the bound survives a process restart. (4) Tee `check.retry-contended — <n> timeout-shaped failure(s) at digest <d>; retry 1/1` to stdout and the log.

**Frozen names.** Log line literal `check.retry-contended`. No new CLI flag, env var, workflow var, or YAML key. No change to `MAX_GATE_ATTEMPTS` or the SQLite-lock retry loop (a different, in-loop mechanism).

**Anti-patterns.** Do not make every FAIL retryable (a deterministic red must keep skipping). Do not touch the pipeline-owned test-fix attempt counter. Do not relax the skip when the receipt binds to a *different* digest. Do not convert a retry into a PASS.

**Test requirement.** `quality-gate.ts` is coverage-measured (`bunfig.toml` 90/90 per file), so write the failing test first — a fixture receipt + gate log pair in `packages/app/tests/services/quality-gate*.test.ts` — and keep the new branches covered.

**Evidence.** `.spur/run/1193-test-gate.log` (real timeout lines + the skip line) and `.spur/run/1193-check-receipt.json` are the fixture shape to copy.

### Plan

1. Read `packages/app/tests/services/quality-gate*.test.ts` for the existing no-progress fixture pattern; add a test that fails today: FAIL receipt at digest D + log with only `timed out after 20000ms` lines -> the chain must run and the log must carry `check.retry-contended`.
2. Implement the timeout-only predicate, the per-digest retry marker, and the log line in `quality-gate.ts`.
3. Add the R2 test (second FAIL at the same digest skips) and the R4 tests (non-timeout failure skips; missing log skips).
4. Focused run: `(cd packages/app && bun test tests/services/quality-gate.test.ts)`.
5. Full gate once, quiet host: `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
