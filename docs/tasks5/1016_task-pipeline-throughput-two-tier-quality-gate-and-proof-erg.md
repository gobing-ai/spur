---
schema_version: 1
name: "Task pipeline throughput: two-tier quality gate and proof ergonomics"
status: todo
template: issue
created_at: 2026-09-30T13:44:22.914Z
updated_at: "2026-09-30T14:36:18.145Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1016. Task pipeline throughput: two-tier quality gate and proof ergonomics

### Background

Filed from the A9 post-batch review (root cause RC1). Re-verified 2026-09-30: **one of the seven original requirements is still open; the rest already exist or were dropped.** The task is narrowed to that one.

A9 measured ~30 full `bun run spur-check` runs (4–5 min each) for 8 tasks; task 1000 took 4 gate attempts around 5 verify-answer rewrites, task 1003 about 12.

| Original requirement | Status on 2026-09-30 |
| --- | --- |
| R1 two-tier gate | Exists. Green path runs the full gate once (`config/workflows/task-pipeline.yaml` `test` state); `quality-gate.ts light` is the changed-scope tier (0939); recheck is probe-then-full (0587); a FAIL receipt at the same digest skips the recheck (0940). |
| R2 PASS receipt skips re-gate | **Open.** The receipt is written and `quality-gate.ts status` reports `reuse: true`, but `runQualityGate` (`packages/app/src/services/quality-gate.ts:549`) never reads it for PASS — only `receiptFailsAtDigest` for the no-progress FAIL case (`:579`). |
| R3 fingerprint fails closed | Exists. `inline-run-setup.ts --fingerprint` with a nonexistent `--feature-file` or `--task-file` prints `… does not exist … an explicitly supplied spec must be readable` and exits 1. `<wbs>-proof-digest.txt` is not a harness artifact. |
| R4 auto-repair of the verify answer | Dropped. Lint messages already name the accepted values (`verify-answer-lint.ts:70-121`); rewriting an evidence type in code (`file` → `static-ref + command`) would assert evidence nobody produced. |
| R5 machine-readable lint | Exists. `spur task verdict <wbs> --json` prints `{wbs, lintFindings:[{line, rule, message}]}` and exits 1 (`apps/cli/src/commands/task.ts:1284-1297`, task 1003). |
| R6 measured durations | Dropped. The driver contract already requires measured wall clock (`inline-pipeline-driver.md:497-507`); a host-inline stage has no process boundary the script could time. |

Why R2 matters: a non-PASS verify routes through `test-fix` → `test-recheck` (`task-pipeline.yaml:426`), and re-entering `test` does the same. When the repair touched only the verify answer, the proof-input digest is unchanged and a full-tier PASS receipt for it is already on disk, yet the full gate runs again.

### Requirements

- [ ] R1. `runQualityGate` in modes `run` and `recheck`: when `readReceiptStatus(.spur/run/<wbs>-check-receipt.json, env.proofDigest)` returns `reuse: true` (full-tier PASS at the current digest), skip the probe and the gate command, write one line `check.reused — full-tier PASS receipt at input digest <digest>; gate skipped` to stdout and `<wbs>-test-gate.log`, write `PASS` to `<wbs>-test-gate.status`, and leave the receipt file untouched.
- [ ] R2. Every other receipt state — `missing`, `failed`, `stale`, `light-only`, or an empty `proofDigest` — runs exactly as today, including the 0940 no-progress FAIL skip and the lock-retry loop.

Out of scope: `task-pipeline.yaml`, the plugin glue `plugins/sp/scripts/quality-gate.ts` and `inline-run-setup.ts` (at its 250-line budget), the light tier, the receipt schema, verify-answer lint, action durations.

### Acceptance Criteria

- [ ] AC1 — A full-tier PASS receipt at the current digest skips the gate (req: R1)
  Layer: `packages/app/tests/services/quality-gate.test.ts`. With a PASS/full receipt whose `inputDigest` equals `env.proofDigest`, and `qualityGateCmd` set to a command that writes a sentinel file, `runQualityGate('run', …)` and `runQualityGate('recheck', …)` each leave the sentinel absent, write `PASS` to the status file, log the `check.reused` line, and leave the receipt bytes unchanged.
- [ ] AC2 — Any other receipt state still runs the gate (req: R2)
  Layer: same file. For a missing receipt, a PASS receipt at a different digest, a `tier: light` PASS receipt, a FAIL receipt in `run` mode, and an empty `proofDigest`, the sentinel command runs. The existing 0940 no-progress test stays green unedited.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-30T14:33:12.800Z

#### Q&A entry — 2026-09-30 (refinement)

- **Does reuse break "review is only entered through a full green gate"?** No (closed). Reuse requires `status: PASS` + `tier: full` + digest match (`readReceiptStatus`, `quality-gate.ts:276-287`), i.e. a full green gate did run on exactly these proof inputs. It is the same rule `quality-gate.ts status` and the `sp:spur-check` skill already apply by hand.
- **How many of the ~30 A9 gate runs this removes?** Not measured (open to measurement, not to design): the per-run digests were not kept. The saving applies to every re-entry where only the verify answer or a non-proof task section changed.
- **Overlap with 1017?** 1017 was removed as already implemented; nothing here depends on it.
- **Overlap with 1018 / 1019?** None in source (closed). 1019 regenerates the `.mjs` twins of `residual-scan` and `workflow-step-profile`; this task regenerates `plugins/sp/lib/quality-gate.generated.*`. Different files, but both rebuild generated plugin output — run the two tasks one after the other, each from a clean tree.

#### Q&A entry — 2026-09-30T14:36:18.144Z

#### Q&A entry — 2026-09-30 (refinement)

- **Does reuse break "review is only entered through a full green gate"?** No (closed). Reuse requires `status: PASS` + `tier: full` + digest match (`readReceiptStatus`, `quality-gate.ts:276-287`), i.e. a full green gate did run on exactly these proof inputs. It is the same rule `quality-gate.ts status` and the `sp:spur-check` skill already apply by hand.
- **How many of the ~30 A9 gate runs this removes?** Not measured (open to measurement, not to design): the per-run digests were not kept. The saving applies to every re-entry where only the verify answer or a non-proof task section changed.
- **Overlap with 1017?** 1017 is cancelled (already implemented by 0984, 1012, 0931, 0510); nothing here depends on it.
- **Overlap with 1018 / 1019?** None in source (closed). 1019 regenerates the `.mjs` twins of `residual-scan` and `workflow-step-profile`; this task regenerates `plugins/sp/lib/quality-gate.generated.*`. Different files, but both rebuild generated plugin output — run the two tasks one after the other, each from a clean tree.

### Design

At the top of `runQualityGate`, next to the existing `noProgressSkip` computation (`quality-gate.ts:578-586`), compute `reusePass = readReceiptStatus(abs(rel('-check-receipt.json')), env.proofDigest ?? '').reuse`. When true: tee the `check.reused` line to stdout and the log, write `PASS` to the status file, and return the same result shape a green gate returns, without entering the probe or the gate loop and without calling the receipt writer. No new export, flag, env var or file.

### Plan

1. Write the AC1 and AC2 cases in `packages/app/tests/services/quality-gate.test.ts` first; run `(cd packages/app && bun test tests/services/quality-gate.test.ts)` and see AC1 fail.
2. Add the PASS-reuse branch in `runQualityGate` (Design).
3. Re-run the test file; then `bun run build:plugin-lib` to regenerate `plugins/sp/lib/quality-gate.generated.*`, and `(cd plugins/sp && bun test tests/quality-gate-receipt.test.ts)`.
4. `bun run plugin-smoke`; `bun run spur-check`.

### Root Cause

Check receipts (0939) were wired for reporting (`status`) and for the FAIL no-progress case (0940), but the gate runner itself never honored a PASS receipt, so every re-entry at an unchanged proof digest paid for a full gate again.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- `(cd packages/app && bun test tests/services/quality-gate.test.ts)` — AC1, AC2.
- `(cd plugins/sp && bun test tests/quality-gate-receipt.test.ts)`; `bun run plugin-smoke`; `bun run spur-check`.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/services/quality-gate.ts`: `receiptFailsAtDigest` `:260`, `readReceiptStatus` `:276`, `runQualityGate` `:549`, no-progress skip `:572-586`.
- `config/workflows/task-pipeline.yaml`: gate vars `:138-147`, `test` `:364-417`, `test-fix` `:426`, `test-recheck` `:471-496`.
- Tasks 0587 (probe-then-full), 0939 / ADR-124 (receipts, light tier), 0940 (no-progress skip), 1003 (verdict lint).
- Baseline: `docs/reports/i31/0912-workflow-baseline.md` F4.

### History
