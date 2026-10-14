---
schema_version: 1
name: Recover the pipeline from a host-contended (timeout-shaped) gate FAIL instead of a sticky no-progress skip
status: wip
template: standard
created_at: 2026-10-13T21:13:56.059Z
updated_at: "2026-10-14T00:42:51.748Z"

priority: P2
estimate_hours: 3
---

## 1198. Recover the pipeline from a host-contended (timeout-shaped) gate FAIL instead of a sticky no-progress skip

### Background

A `dev-runall` batch (`runall-1193-1195-1068-1193`, 2026-10-13) ended `failed-check` without a code defect. Sequence: the `test` hop failed first on an unrelated rule false positive; three `test-recheck` runs then failed with a **different test each time** (3 x 20s timeouts -> 2 x 20s timeouts -> 1 assertion), every one green in isolation (`decide*.test.ts` 34/34, `proof-fingerprint` 14/14). Once the first FAIL receipt existed at the run's input digest, the next recheck wrote `check.skipped-no-progress — full-tier FAIL receipt at input digest sha256:e297af31...; recheck skipped` and returned FAIL **without running the chain**, so the pipeline's bounded repair hop could not recover and the task stopped at `wip`.

Mechanism: `packages/app/src/services/quality-gate.ts:893-905` computes `noProgressSkip = receiptFailsAtDigest(receipt, env.proofDigest)`. The guard is correct for its purpose (a fix pass that changed nothing tracked can only reproduce the failure) but it cannot tell a deterministic failure from an environmental one — under host contention the failures are per-test timeouts, which a re-run on a quieter host does not reproduce. One contended FAIL is therefore sticky until the proof digest moves, i.e. until someone edits the tree.

Root cause of the underlying flakes is tracked separately (suite isolation); this task is the **recovery** half: the pipeline must be able to retry a contended FAIL once, bounded, without inventing a verdict. Evidence artifacts: `.spur/run/1193-check-receipt.json` (status FAIL, digest sha256:e297af31...), `.spur/run/1193-test-gate.log` (contains the `timed out after 20000ms` lines and the skip line), `.spur/run/1193-check-receipt.false-fail-contention*.json` (the earlier contended receipts, preserved deliberately).

**Refine corrections (2026-10-13, refineall ready re-audit)**

- Issue triage: one issue (a contended FAIL receipt makes every later recheck at the same digest skip) → `valid`: `receiptFailsAtDigest` (`quality-gate.ts:281-290`) and the skip (`:893-907`) are unchanged. `4dab6bcc0` raised the per-test budget 20s → 60s and made the digest tests hermetic, which lowers the frequency but does not remove the stickiness.
- Design step "read the receipt's gate log (`checks[].logPath`)" → `runQualityGate` truncates that same log for **every** mode at `quality-gate.ts:853-854`, before the skip decision, so a log read at skip time is always empty and the retry could never fire → Design now captures the prior log text before the truncation.
- Predicate "every failure line matches `/timed out after \d+ms/`" → Bun prints a timeout as two lines, `(fail) <name> [<n>ms]` then `^ this test timed out after <n>ms.` (reproduced with `bun test` 1.4.3), so no single failure line matches → predicate restated as a pairing count.
- Evidence "`.spur/run/1193-test-gate.log` contains the `timed out after 20000ms` lines and the skip line" → the log was overwritten by later runs; it now holds one assertion failure (`proof.fingerprint action > rejects a non-string expect…`) and no timeout line → tests build their own fixture log; the 1193 artifacts stay as history only.
- Test location `packages/app/tests/services/quality-gate*.test.ts` → the no-progress tests live in `plugins/sp/tests/quality-gate-receipt.test.ts:576-639` (`describe('recheck no-progress skip (0940 R2)')`) → new cases go there.

### Requirements

- [ ] R1. A `recheck` whose prior full-tier FAIL receipt is bound to the current proof digest re-runs the chain once instead of skipping when the **prior** gate log is timeout-shaped, and tees the literal line `check.retry-contended` to stdout and the new log. Timeout-shaped means: at least one `(fail) ` line, and the number of `(fail) ` lines equals the number of lines matching `/this test timed out after \d+ms/`.
- [ ] R2. The contended retry is bounded to one per input digest: the used digest is recorded in `.spur/run/<wbs>-contended-retry` (one line, the digest), and a recheck whose digest equals that record skips exactly as today (`check.skipped-no-progress`).
- [ ] R3. The retry never fabricates a verdict: PASS is earned only from a green chain, and a red retry writes findings/status/verdict/receipt through the existing FAIL path unchanged.
- [ ] R4. A prior log with any non-timeout failure, no `(fail) ` line, or no readable file keeps today's skip.

Out of scope: the flakes themselves (task 1199 owns suite isolation); `MAX_GATE_ATTEMPTS` and the SQLite-lock retry loop; the pipeline-owned test-fix attempt counter; any CLI flag, env var, workflow var or YAML key.

### Acceptance Criteria

- [ ] AC1 — A timeout-only FAIL receipt re-runs the recheck instead of skipping: with a FAIL full receipt at `digest-1` and a prior log holding two `(fail)` + two `this test timed out after 60000ms.` lines, `runQualityGate('recheck', …)` runs the full command and the new log contains `check.retry-contended`, not `check.skipped-no-progress`. (req: R1)
- [ ] AC2 — The retry is spent once per digest: a second recheck at `digest-1` after a red retry skips with `check.skipped-no-progress`, and `.spur/run/<wbs>-contended-retry` holds `digest-1`. (req: R2)
- [ ] AC3 — A green retry yields PASS: when the full command exits 0 on the retry, the status file reads `PASS`, the receipt is PASS, and the log names `check.retry-contended`. (req: R3)
- [ ] AC4 — Non-timeout or unreadable prior logs keep the skip: a prior log with one timeout plus one assertion failure, a log with no `(fail)` line, and a missing log each produce `check.skipped-no-progress` without running the full command. (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

- CLOSED (2026-10-13, refineall ready re-audit): log source — capture the prior log before the truncation at `quality-gate.ts:854`; rejected adding a failure-shape field to the receipt schema (a `RECEIPT_SCHEMA_VERSION` bump invalidates every stored receipt for one boolean).
- CLOSED: retry bound — a per-wbs marker file holding the spent digest. A fresh digest naturally resets it; no cleanup step is needed.

### Design

**WHERE.** `packages/app/src/services/quality-gate.ts` — `runQualityGate`: the log truncation (`:853-854`) and the no-progress skip (`:893-907`); a new exported pure helper beside `receiptFailsAtDigest` (`:281`). Tests: `plugins/sp/tests/quality-gate-receipt.test.ts`, inside `describe('recheck no-progress skip (0940 R2)')` (`:578`).

**HOW.**
1. Before `writeFileSync(abs(logFile), '')`, when `mode === 'recheck'`, read the existing log into `priorLog` (`''` when the file is missing).
2. Add `export function isTimeoutShapedLog(text: string): boolean` — count lines starting with `(fail) ` and lines matching `/this test timed out after \d+ms/`; return `fails > 0 && fails === timeouts`.
3. Compute `retryContended = noProgressSkip && isTimeoutShapedLog(priorLog) && readMarker() !== env.proofDigest`, where the marker is `rel('-contended-retry')`. When true: write the digest to the marker, tee `check.retry-contended — <n> timeout-shaped failure(s) at input digest <d>; retry 1/1\n` to stdout and the log, and leave `gateRc` at 0 so the normal probe → full path runs. Otherwise the skip block runs unchanged.

**Frozen names.** `isTimeoutShapedLog`; marker file `.spur/run/<wbs>-contended-retry`; log literal `check.retry-contended`. No new CLI flag, env var, workflow var, YAML key or receipt field.

**Anti-patterns.** Do not make every FAIL retryable. Do not read the log after the truncation. Do not touch the test-fix attempt counter or `MAX_GATE_ATTEMPTS`. Do not relax the skip for a receipt at a different digest. Do not turn a retry into a PASS.

**Coverage.** `quality-gate.ts` is per-file coverage-measured (`bunfig.toml`), so the AC1–AC4 cases must cover both helper branches and the marker read/write.

**Concurrency.** Sibling 1199 (suite isolation) removes the flakes' cause; this task only recovers from them. No file overlap with 1199/1200 beyond reading test logs.

### Plan

1. In `plugins/sp/tests/quality-gate-receipt.test.ts` (no-progress describe), add AC1 with a fixture prior log; confirm it fails today (log shows `check.skipped-no-progress`).
2. Implement `isTimeoutShapedLog`, the pre-truncation `priorLog` read, and the marker + log line in `quality-gate.ts`.
3. Add AC2, AC3 and the three AC4 cases.
4. Focused run: `(cd plugins/sp && bun test tests/quality-gate-receipt.test.ts)`.
5. Full gate once on a quiet host: `bun run spur-check`.

### Solution

Contended-retry recovery in `runQualityGate`, plus the pure helper and its tests. Frozen names honored: `isTimeoutShapedLog`, `.spur/run/<wbs>-contended-retry`, log literal `check.retry-contended`; no new CLI flag, env var, workflow var, YAML key or receipt field.

| File:line | Change |
| --- | --- |
| packages/app/src/services/quality-gate.ts:297 | `countTimeoutShapedFailures` — private count of `(fail) ` lines and `/this test timed out after \d+ms/` lines (two independent tests, matching R1's predicate). |
| packages/app/src/services/quality-gate.ts:313 | `isTimeoutShapedLog(text)` — exported pure helper: `fails > 0 && fails === timeouts` (R1; R4 for every non-timeout / no-`(fail)` shape). |
| packages/app/src/services/quality-gate.ts:319 | `readContendedRetryDigest(markerPath)` — marker read; missing/unreadable → `''` (R2). |
| packages/app/src/services/quality-gate.ts:891 | capture `priorLog` BEFORE the recheck log truncation at `:893`; `recheck`-only, missing → `''` (the log is never read after truncation, per the design correction). |
| packages/app/src/services/quality-gate.ts:939 | `receiptFailsNow` — the original 0940 predicate (`commandPresent && mode === 'recheck' && receiptFailsAtDigest`) factored out unchanged. |
| packages/app/src/services/quality-gate.ts:949 | `retryContended = receiptFailsNow && isTimeoutShapedLog(priorLog) && readContendedRetryDigest(...) !== proofDigest`; `noProgressSkip = receiptFailsNow && !retryContended`. |
| packages/app/src/services/quality-gate.ts:954 | retry branch writes the spent digest to `.spur/run/<wbs>-contended-retry` and tees `check.retry-contended — <n> timeout-shaped failure(s) at input digest <d>; retry 1/1` to stdout and the log, leaving `gateRc` at 0 so the normal probe → full path runs. |
| packages/app/src/services/quality-gate.ts:960 | `else if (noProgressSkip)` — today's 0940 skip, unchanged, when the log is not timeout-shaped or the digest was already spent. |
| packages/app/src/services/quality-gate.ts:1036 | receipt-write guard stays `!noProgressSkip`: a retry is not a skip, so a green retry persists a PASS receipt and a red one a FAIL receipt through the existing path (R3 — no verdict is minted). |
| scripts/commands/bundle-plugin-lib.ts:508 | add `isTimeoutShapedLog` to `QUALITY_GATE_DECLS` so the generated `.d.mts` surface matches the module's exports. |
| plugins/sp/lib/quality-gate.generated.mjs:1 | regenerated bundle twin of the changed source via `bundleQualityGateLib()`. |
| plugins/sp/lib/quality-gate.generated.d.mts:81 | regenerated declaration; names `isTimeoutShapedLog`. |
| plugins/sp/scripts/quality-gate.mjs:1 | regenerated ADR-130 script twin (`superskill script convert sp quality-gate.ts`). |
| plugins/sp/tests/quality-gate-receipt.test.ts:760 | AC1 — a timeout-shaped prior log re-runs the recheck; the log names `check.retry-contended`, not `check.skipped-no-progress`. |
| plugins/sp/tests/quality-gate-receipt.test.ts:801 | AC2 — a second recheck at the same digest skips; the marker holds `digest-1` (the red retry's log is timeout-shaped again, so only the marker stops it). |
| plugins/sp/tests/quality-gate-receipt.test.ts:854 | AC3 — a green retry writes PASS status + PASS receipt and names `check.retry-contended`. |
| plugins/sp/tests/quality-gate-receipt.test.ts:892 | AC4 — mixed-failure / no-`(fail)` / missing prior logs all keep `check.skipped-no-progress`, run no chain, and write no marker. |

Rationale: the retry reuses the existing bounded gate path instead of inventing a verdict — `gateRc` stays 0 and the only new decision is "run the chain once more", so PASS/FAIL is earned exactly as any other gate run. The one-per-input-digest bound is a marker file, so a fresh digest resets it with no cleanup step. Only a fully timeout-shaped log qualifies (R4), so a deterministic FAIL keeps today's sticky skip; a receipt at a different digest still never skips (receiptFailsAtDigest unchanged).

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T21:42:08.371Z backlog → todo (system)
- 2026-10-14T00:42:51.748Z todo → wip (system)

