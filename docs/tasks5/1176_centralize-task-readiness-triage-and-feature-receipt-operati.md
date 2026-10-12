---
schema_version: 1
name: Centralize task readiness triage and feature receipt operations
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.717Z
updated_at: "2026-10-12T04:01:54.627Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 12

dependencies: ["1173"]
---

## 1176. Centralize task readiness triage and feature receipt operations

### Background

Implements: R4 — Task and feature decisions use their application owners.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Ready content offered unspecified future flags → freeze no new public API and reuse current script contracts with app-owned implementations.
- task check --precheck was treated as general readiness → it covers size/evidence only; extract operation admission as an internal pure service.
- FeatureReceiptRunPort might be reused for writes → it is a read-only validator; artifact registration stays in the application execution operation.
- Receipt runner used a hardcoded directory scan and plugin DAO constructor → app feature lookup/composition owns these operations.
- Dependency on eval task 1175 was artificial → remove it; only 1173 is prerequisite.
- Moving pure policy could force Bun on Node-only callers → use the existing pure generated bundle, keeping standalone purity tests.

### Requirements

- [ ] R1. Make app services own readiness, feature-finding classification and task triage safety decisions while preserving current plugin entry and caller contracts.
- [ ] R2. Make one app operation own the complete feature receipt execution/registration lifecycle; plugin entries no longer open the DB or instantiate ArtifactDao.
- [ ] R3. Update current planner/workflow/wrapup consumers and tests, preserving safe execution, validation, receipt fingerprints and artifact identity, without a public CLI extension.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Task and feature decisions use their application owners (req: R1)

Given the supported source and installed contracts, when the focused fixtures exercise this migration, then behavior and failure policy remain compatible. Verification lens: Move pure behavior assertions into packages/app/tests/services/planning-admission.test.ts and packages/app/tests/workflow/task-triage.test.ts; retain plugin tests/batch-preflight.test.ts and task-diffstat.test.ts as adapter contract tests. Extend packages/app/tests/workflow/feature-verification-receipt.test.ts or add feature-verification-run.test.ts for real temp-file receipt lifecycle, ID/path refusals, selected definition, spawned command failure and digest mismatch with in-memory run/artifact backing. Keep both plugin feature-verification-steps test files for source-mode refusal/installed launch. A plugin source scan must show no openInlineRunProjectDb/ArtifactDao/findFeatureFile ownership. Test injected I/O at the operation seam without mocking out the receipt writer being verified.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T03:58:09.421Z

- Closed: no public task/feature transport expansion is needed for this internal consolidation.
- Closed: preserve plugin argv/output compatibility through high-level generated application exports; never ship DAO/DB constructors as the entry contract.
- Deferred owner: operator, a separately approved owning-noun CLI transport may retire the named packaging exception later. That future change is outside this task and cannot be inferred from --auto.

### Design

No new public CLI API. Frozen internal source destinations: `packages/app/src/services/planning-admission.ts` receives existing quickReadiness/preflightTask/classifyFeaturePreflightFindings and their pure types. Keep skill command recovery hints and CLI formatting in the batch-preflight adapter. Reuse current task-check/feature-check result inputs; do not pretend task check --precheck already exposes operation-specific admission (it currently covers size/evidence). Export the pure functions through the existing generated plan-projection bundle entry, not a new runtime bundle or registry; its Node-compatible purity must remain tested. Script entry retains runPreflightCli/argv/error contracts, imports these app functions and does not parse corpus.

`packages/app/src/workflow/task-triage.ts` receives current sensitiveReasonForPath and associated policy constants; task-diffstat keeps git capture and its output artifact. Reuse the same pure generated entry for its policy export. Preserve sensitive-path precedence and first-reason/output behavior; do not change triage thresholds or let a model override the safety floor.

Add `runFeatureVerification` to `packages/app/src/workflow/feature-verification-receipt.ts` (or a sibling `feature-verification-run.ts` when needed to keep the existing pure validators isolated). This is an app operation, with injected FileSystem/process launcher/run/artifact access at the application composition boundary, not a second receipt writer. Move the current script verify body, preserving selected-definition identity, ID validation, before/after proof, durable/scratch receipt pair, safe argv spawn, timeout and status handling. Resolve configured feature files through existing app feature lookup, not the current directory-name scan in the plugin. Keep createFeatureReceiptRunPort as the existing read-side validation seam; do not confuse it with the new operation's artifact write. Export only this high-level runner through the existing inline generated entry; remove the plugin VerificationModule DAO/DB facade and filesystem shim. Keep current --module-mode source refusal contract unless an existing tested compatibility path already supplies it; public source-mode behavior is not changed by guessing a new fallback.

The standalone high-level generated runner is a named ADR-130 packaging exception pending a separately approved transport: source owner app, sole run/receipt writer existing app, installed contract same script, no DAO exposure. `wrapup-steps` continues invoking existing feature sync; retain bounded git/gh orchestration and no second lifecycle policy. Inputs/outputs are frozen to existing plugin scripts and app internal types; no new task/feature CLI flags.

Dependencies and handoff: Requires only 1173 checker/standalone conventions; remove unrelated 1175 dependency. Leaves high-level receipt runner and pure policy exports for 1177, which may consolidate packaging resolution but must not re-own policy. The new pure generated exports remain Node-compatible.

Primary references: `plugins/sp/scripts/batch-preflight.ts:115`; `packages/app/src/services/task-check.ts:615`; `plugins/sp/scripts/task-diffstat.ts:103`; `plugins/sp/scripts/feature-verification-steps.ts:138`; `packages/app/src/workflow/feature-verification-receipt.ts:170`; `packages/app/src/services/feature-receipt-run-port.ts:22`; `plugins/sp/tests/feature-verification-steps.test.ts:15`; `plugins/sp/tests/batch-preflight.test.ts:1`; `plugins/sp/tests/task-diffstat.test.ts:1`.

Environment and scope: root Bun/TypeScript workspaces and existing Superskill conversion; no dependency change. No wip tasks or extra worktrees were present at the frozen batch kickoff. Recheck conflict scope before implementation; prior A91 planning edits are part of the operator-authorized context.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [ ] 1. Verify app checking and receipt helpers plus current adapters; freeze snapshots of preflight/diffstat/receipt argv and failure cases.
- [ ] 2. Move pure admission and triage policy to the named app modules, exposing them via existing Node-pure generated entry; retain script CLI formatting/recovery helpers.
- [ ] 3. Move feature verify body into the canonical app operation with injected I/O and existing feature lookup; delegate from plugin verify entry and remove plugin DB/DAO/feature-directory scan.
- [ ] 4. Update bundle exports/types, app barrel where required, callers and focused tests. Shrink stale baseline kinds only after current scan proves them stale.
- [ ] 5. Run app service/receipt/safety tests, plugin preflight/diffstat/receipt mode tests, bundle determinism/standalone, isolated plugin-smoke and task-local gate. Leave no unapproved public source change.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065 and ADR-021. Detailed investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `plugins/sp/scripts/batch-preflight.ts:115`
- `packages/app/src/services/task-check.ts:615`
- `plugins/sp/scripts/task-diffstat.ts:103`
- `plugins/sp/scripts/feature-verification-steps.ts:138`
- `packages/app/src/workflow/feature-verification-receipt.ts:170`
- `packages/app/src/services/feature-receipt-run-port.ts:22`
- `plugins/sp/tests/feature-verification-steps.test.ts:15`
- `plugins/sp/tests/batch-preflight.test.ts:1`
- `plugins/sp/tests/task-diffstat.test.ts:1`

### History
