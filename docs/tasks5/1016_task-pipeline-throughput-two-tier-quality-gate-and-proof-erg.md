---
schema_version: 1
name: "Task pipeline throughput: two-tier quality gate and proof ergonomics"
status: todo
template: issue
created_at: 2026-09-30T13:44:22.914Z
updated_at: "2026-09-30T14:00:40.622Z"
feature_id: A9

ac_numbering: task-local
ac_altitude: task-local
---

## 1016. Task pipeline throughput: two-tier quality gate and proof ergonomics

### Background

Filed from the A9 post-batch review (root-cause RC1 + improvement I1). Largest measured time sink of the A9 runall (31.5h wall; first→last task commit 21h09m). Full-repo `bun run spur-check` (≈4–5 min) ran PER ATTEMPT: ~30 gate runs ≈ 2–2.5h pure gate time. Churn multipliers: task 1000 = 4 gate attempts + 5 verify-answer rewrites (lint rejections: `AC-2` alias confusion; `file` evidence type rejected for AC rows → `static-ref` → then `static-ref + command` needed); task 1003 = ~12 gate attempts (fingerprint/digest churn: stale `.spur/run/<wbs>-proof-digest.txt` vs fresh fingerprint; a wrong `--feature-file` name (`…cli-owned-rules…` vs `…cli-owned-logic…`) silently produced a DIFFERENT digest instead of failing closed). Evidence anchors: task commits `39924a522`..`04e3505d6`; per-task commit gaps 4h43m (1002→1003) and 4h41m (1006→1007); recorded action durations were nominal round numbers (45m/60m implement, 22.5–35m review), not measured wall time. Baseline doc: `docs/reports/i31/0912-workflow-baseline.md` F4.

### Requirements

- [ ] R1. task-pipeline qualityGate becomes two-tier: during implement/iterate stages run targeted workspace tests only (touched workspaces + related tests per the sp:spur-check light tier); the full `bun run spur-check` runs exactly ONCE per task at the verify boundary.
- [ ] R2. Fingerprint-bound receipts: a PASS full-gate receipt keyed by proof digest (`.spur/run/<wbs>-check-receipt.json`, sp:spur-check pattern) skips re-gate when the digest is unchanged; a FAILED receipt never blocks a re-run.
- [ ] R3. Fingerprint is computed once per run and persisted atomically; gate start FAILS CLOSED on a stale digest file or a nonexistent `--feature-file`/`--task-file` path — no silent different-digest fallback (the 1003 bug class).
- [ ] R4. Verify-answer pre-validation loop: the driver lints the draft answer (verify-answer-lint in packages/app) BEFORE the verdict attempt; on findings it applies targeted repairs — evidence-type upgrade map (`file`→`static-ref`→`static-ref + command`), row-id normalization to exact `R<n>`, ensure ≥1 scenario-keyed row — then re-lints; max 2 repair cycles, then surface remaining findings to the operator. No blind full-file rewrites.
- [ ] R5. Lint findings are machine-readable (`--json`) so the repair loop is code, not prose.
- [ ] R6. Recorded action durations measure real wall time per stage (Date.now around dispatch), not nominal constants.
- [ ] R7. No gate bypass: two-tier is a scheduling change; the full gate still gates `done` on FAIL.

### Acceptance Criteria

- [ ] AC1 — A task pipeline runs targeted tests during stages and the full gate exactly once at the boundary (req: R1, R7)
- [ ] AC2 — Same-digest re-entry skips the full gate via receipt; a changed digest re-runs it (req: R2)
- [ ] AC3 — A bad feature/task file path fails closed with a clear error (req: R3)
- [ ] AC4 — A verify-answer draft auto-repairs evidence-type/row-id findings without a full manual rewrite; unresolved findings surface after ≤2 cycles (req: R4, R5)
- [ ] AC5 — Action durations recorded are measured wall time (req: R6)

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

1. Read current wiring: `config/workflows/task-pipeline.yaml` (qualityGateCmd env), `plugins/sp/scripts/inline-run-setup.ts` + its lib source in packages/app (A9 W3 move, `265e070c4`).
2. Split the gate invocation into light-tier cmd (stage-time) + boundary cmd (full gate); thread the receipt path through.
3. Receipt store: reuse/extend the sp:spur-check receipt shape; skip-at-same-digest logic; FAILED never blocks.
4. Fail-closed fingerprint checks (R3): existence + digest-file freshness before gate start.
5. Lint `--json` + repair map (R4/R5) + bounded loop (≤2 cycles) in the driver's verify-answer authoring step.
6. Measured durations (R6) at the action-record site.
7. Unit tests: receipt skip, digest mismatch re-run, fail-closed paths, repair cycles (repairs then surfaces), duration measurement.
8. Dogfood: one 1-task batch dry-run end-to-end; record before/after stage timings in Testing.

### Root Cause

Gate cost was paid per-attempt instead of per-boundary, and the proof chain (fingerprint + verify-answer) had no machine-readable repair path. Every lint rejection cost a full human-loop rewrite, and every digest hiccup cost a 4–5 minute full-repo gate — the two churn loops multiplied each other inside an already-sequential batch.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Unit tests per R2/R3/R4/R6 (receipt skip; mismatch re-run; fail-closed; repair-then-surface; measured durations).
- Dogfood dry-run (1 task): record stage timings and gate-run count before vs after.
- `bun run plugin-smoke`; targeted workspace tests only until the boundary gate.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Baseline: `docs/reports/i31/0912-workflow-baseline.md` F4 (two-tier + receipts pattern).
- Lint internals: verify-answer-lint.ts (alias rules ~:446/:454); task-verdict.ts (deriveVerdict :44, extractAcceptanceCriteria :189, resolveAcIdentity :431).
- Lib move anchor: commit `265e070c4`. A9 task commits `39924a522`→`04e3505d6` (gap evidence).
- Sibling task: 1017 (execution model — consumes these receipts).

### History
