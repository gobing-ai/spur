---
schema_version: 1
name: Guard quality-gate recheck against empty qualityGateCmd (vacuous PASS)
status: todo
template: issue
created_at: 2026-10-01T16:18:43.411Z
updated_at: "2026-10-01T16:31:48.152Z"

feature_id: D9
---

## 1038. Guard quality-gate recheck against empty qualityGateCmd (vacuous PASS)

### Background

**Finding (P3) from task 1033's Review, observed live during the 2026-10-01 D9 batch session.** Invoking the quality gate outside the pipeline —

```
wbs=1033 runId=<id> proofDigest=<digest> node plugins/sp/scripts/quality-gate.mjs recheck
```

— with `qualityGateCmd` unset produced a **PASS receipt in ~7 ms**. Nothing ran: an empty command string exits rc 0, the gate treats rc 0 as pass, and a receipt is recorded exactly as if `bun run spur-check` (the real ~5-minute gate) had executed.

**Root cause chain:** `plugins/sp/scripts/quality-gate.ts` `main()` validates `wbs` presence but never checks `qualityGateCmd`; `runQualityGate` (see anchors around `quality-gate.ts:44-55` for the env read) forwards the empty string to the shell runner, whose empty-command rc-0 path yields a vacuous pass. The recheck mode has no minimum-evidence floor.

**Why it matters:** the sp pipeline's non-negotiable done gate is "a real verify PASS" (repo AGENTS.md). A vacuously minted receipt lets a task transition or an operator claim a gate PASS with zero checks executed — silent evidence fabrication, not a crash. It also poisons anything that later trusts receipt digests (e.g. the L4 feature gate).

**Surface and shape:**
- Source: `plugins/sp/scripts/quality-gate.ts` (guard in `main()` before any receipt write; keep `runQualityGate` pure).
- Bundled twin: `plugins/sp/scripts/quality-gate.mjs` must be regenerated after the `.ts` edit — `bun run build:scripts` (same twin convention used for `wrapup-steps` in 1033, commit `c6ebf0c75`). Forgetting the twin is the known failure mode.
- Tests: extend the existing quality-gate suite under `plugins/sp/tests/` (locate it first; if none, add one minimal case file). Test the guard, not the shell.

**In scope:** rejecting empty/whitespace-only `qualityGateCmd` in every mode that executes a command (`recheck` confirmed; audit `run` for the identical path while there), clear error naming the missing env var and mode (`qualityGateCmd is required for recheck mode`), non-zero exit, **no receipt file written on reject**.

**Out of scope (anti-drift):** receipt schema changes; light/run gate semantics; driver or workflow YAML changes; adding env-var validation to unrelated scripts; touching the strict done gate. This is a fail-closed guard on one entry point.

**Traceability:** 1033 Review P3 (authoring evidence); surface shipped under feature D9 (proportional gate rollout); sibling contract documented in `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md` driver contract section.

### Requirements

- R1: In `plugins/sp/scripts/quality-gate.ts` (and regenerated `.mjs` twin via `bun run build:scripts`), when the mode executes the gate command (`recheck`; extend to `run` if the same vacuous path exists there), reject an empty or whitespace-only `qualityGateCmd` with a clear error and non-zero exit before recording any receipt.
- R2: The guard message names the missing env var and the mode, e.g. `qualityGateCmd is required for recheck mode`.
- R3: No receipt file is written when the guard rejects.

### Acceptance Criteria

- AC1: `wbs=x runId=y proofDigest=z quality-gate.mjs recheck` (no `qualityGateCmd`) exits non-zero with the R2 message and writes no receipt — verified by running the command in a temp cwd and quoting rc/output.
- AC2: With `qualityGateCmd="bun run spur-check"` set, recheck behavior is unchanged (existing suite/tests stay green; targeted test run quoted).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [ ] R1-R3 in `quality-gate.ts` main/runQualityGate path; regenerate twin.
- [ ] Add/extend test covering empty-command rejection (fail-first check).
- [ ] `bun run spur-check` on the change; commit.

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
