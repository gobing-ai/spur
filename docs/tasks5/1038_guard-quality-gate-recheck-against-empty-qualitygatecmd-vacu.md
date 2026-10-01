---
schema_version: 1
name: Guard quality-gate recheck against empty qualityGateCmd (vacuous PASS)
status: done
template: issue
created_at: 2026-10-01T16:18:43.411Z
updated_at: "2026-10-01T18:56:10.547Z"

feature_id: D9
done_forced: "true"
done_reason: Core intent (no vacuous PASS on empty qualityGateCmd) shipped in 5edc4e868 and test-pinned; verdict PARTIAL only on R2 wording (mode not named in guard message) and R3 (explicit FAIL receipt written instead of none - auditable-rejection design accepted). Deviations documented in Review findings table.
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

- [x] R1. In `plugins/sp/scripts/quality-gate.ts` (and regenerated `.mjs` twin via `bun run build:scripts`), when the mode executes the gate command (`recheck`; extend to `run` if the same vacuous path exists there), reject an empty or whitespace-only `qualityGateCmd` with a clear error and non-zero exit before recording any receipt.
- [x] R2. The guard message names the missing env var and the mode, e.g. `qualityGateCmd is required for recheck mode`.
- [x] R3. No receipt file is written when the guard rejects.

### Acceptance Criteria

- AC1: `wbs=x runId=y proofDigest=z quality-gate.mjs recheck` (no `qualityGateCmd`) exits non-zero with the R2 message and writes no receipt — verified by running the command in a temp cwd and quoting rc/output.
- AC2: With `qualityGateCmd="bun run spur-check"` set, recheck behavior is unchanged (existing suite/tests stay green; targeted test run quoted).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

- [x] R1-R3 in `quality-gate.ts` main/runQualityGate path; regenerate twin.
- [x] Add/extend test covering empty-command rejection (fail-first check).
- [x] `bun run spur-check` on the change; commit.

### Root Cause

An absent command previously reached the empty-shell success path and produced a vacuous PASS. The first guard repair rejected it but still wrote a FAIL receipt and omitted the mode; the current shared-service guard at `packages/app/src/services/quality-gate.ts:583` and receipt condition at `:683` close both literal contract gaps. Fresh shipped-node probes reject absent/blank commands with exit 1, name each mode, write no new receipt and preserve seeded evidence.

### Solution

- `packages/app/src/services/quality-gate.ts:583` rejects absent/whitespace commands before probes, shell execution or receipt reuse in both run and recheck. `:586` names qualityGateCmd and the mode.
- `packages/app/src/services/quality-gate.ts:683` writes no receipt on guard rejection, preserving any existing receipt byte-for-byte. Valid command execution still produces its evaluated PASS/FAIL receipt.
- `plugins/sp/scripts/quality-gate.ts:57` propagates the shared result as a nonzero failure exit; shipped generated twins contain the same implementation.
- Fresh service/plugin tests and node-twin probes pass. The earlier forced-close deviation is retained as history and superseded by literal R1-R3 compliance.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. |
| R2 | MET | `packages/app/src/services/quality-gate.ts:586` names qualityGateCmd and the mode. `packages/app/tests/services/quality-gate.test.ts:83` pins the diagnostic. Fresh node probe prints mode run/recheck requires env qualityGateCmd to be non-empty; exit 1 in both modes (origin: D9 final verification, `.spur/run/D9-finalverify/quality-probe.json`). |
| R3 | MET | `packages/app/src/services/quality-gate.ts:683` writes a receipt only when a command was present; `packages/app/tests/services/quality-gate.test.ts:84` verifies seeded PASS remains untouched. Fresh node probes: no receipt on absent command, seeded receipt byte-identical after whitespace rejection; both modes exit 1. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | command | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. `packages/app/src/services/quality-gate.ts:586` names qualityGateCmd and the mode. `packages/app/tests/services/quality-gate.test.ts:83` pins the diagnostic. Fresh node probe prints mode run/recheck requires env qualityGateCmd to be non-empty; exit 1 in both modes (origin: D9 final verification, `.spur/run/D9-finalverify/quality-probe.json`). `packages/app/src/services/quality-gate.ts:683` writes a receipt only when a command was present; `packages/app/tests/services/quality-gate.test.ts:84` verifies seeded PASS remains untouched. Fresh node probes: no receipt on absent command, seeded receipt byte-identical after whitespace rejection; both modes exit 1. |
| AC2 | MET | test | `plugins/sp/tests/quality-gate.test.ts:16` proves valid commands return PASS and failed commands return FAIL. Full service regression suite and shipped twin probes preserve valid-command execution and receipt semantics. Focused application suite: 65 pass, 0 fail; plugin suite: 151 pass, 0 fail; both exit 0. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Final inline review

Scope: tagged task implementation plus the final D9 fixes. Dimensions: functional, security, efficiency, correctness, usability, architecture. Fresh focused commands pass (65 application tests, 151 plugin tests, 121 dispatch tests).

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | functional | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. | All numbered requirements trace to fresh executable evidence; no open completeness finding. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. |
| R2 | MET | `packages/app/src/services/quality-gate.ts:586` names qualityGateCmd and the mode. `packages/app/tests/services/quality-gate.test.ts:83` pins the diagnostic. Fresh node probe prints mode run/recheck requires env qualityGateCmd to be non-empty; exit 1 in both modes (origin: D9 final verification, `.spur/run/D9-finalverify/quality-probe.json`). |
| R3 | MET | `packages/app/src/services/quality-gate.ts:683` writes a receipt only when a command was present; `packages/app/tests/services/quality-gate.test.ts:84` verifies seeded PASS remains untouched. Fresh node probes: no receipt on absent command, seeded receipt byte-identical after whitespace rejection; both modes exit 1. |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | security, efficiency, correctness, usability | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. | No open P1-P3 finding: fail-closed parsing, bounded work, diagnostic clarity and regression behavior reviewed. |

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | architecture | `packages/app/src/services/quality-gate.ts:583` rejects absent/blank commands before probe, gate execution and receipt reuse in both modes; `packages/app/tests/services/quality-gate.test.ts:71` covers blank commands despite reusable PASS evidence. Fresh shipped-node-twin probe: run/recheck exit 1, no fresh receipt; focused application run: 65 pass, 0 fail, exit 0. | Shared service and existing script boundaries remain intact; standalone generated twins and real-fixture test seams need no structural change. |

#### Retained review and resolved follow-ups

**Evidence**

- Live E2E on the shipped twin (plugins/sp/scripts/quality-gate.mjs after regeneration): fresh cwd, `wbs=1038 runId=run-1038 proofDigest=z qualityGateCmd=` recheck → rc=1, log `quality-gate: mode recheck requires env \`qualityGateCmd\` to be non-empty`, no receipt file. Second probe: seeded PASS receipt (real cmd), then whitespace-cmd run → rc=1, `mode run` named, seeded receipt untouched (status PASS, cmd intact).
- Behavior lives in one implementation: packages/app/src/services/quality-gate.ts (guard message :586, receipt condition :683); the plugin script is ADR-130 glue over the bundled generated twin — build:plugin-lib + build:scripts keep them in lockstep.
- Full chain green: packages/app quality-gate 24 pass (empty-cmd test rewritten to pin the R2 message and the untouched PASS receipt), plugins/sp twin 2 pass, bun run spur-check green (lint, typecheck, 9574 tests, post rules 2/2).
- Design alignment: docs/design/workflow-catalogue-refactor.md already declared the writer contract — "run and recheck both persist the full-tier receipt for the digest they actually evaluated" — so a guard rejection (nothing evaluated) recording no receipt is the documented contract; the old FAIL-receipt-on-reject was code drift from the design doc, not a stronger audit trail.

| Priority | Finding | Resolution |
|----------|---------|------------|
| P3 | This fix reverses the previously accepted deviation ("FAIL receipt on reject is strictly stronger"): the prior close documented that tradeoff, this reopen supersedes it at the operator's direction. | Resolved: literal R1-R3 now pass fresh shipped-twin probes and service tests. Reversal justified by the writer contract above: auditable red state still lands in log/status/findings, and receipts now bind only executed commands — matching the design doc and the literal R1–R3. |
| P4 | The in-test guard message assertions match the exact template; future wording changes must update two test files (packages/app + any twin pin). | Accepted: message template is small and centrally defined; no production shared constant needed. |

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-01T16:53:11.184Z todo → wip (system)
- 2026-10-01T16:55:40.877Z wip → testing (system)
- 2026-10-01T16:55:55.043Z testing → done (system)
- 2026-10-01T17:33:00.633Z done → wip (system)
- 2026-10-01T17:52:25.427Z wip → testing (system)
- 2026-10-01T17:52:26.093Z testing → done (system)

