---
schema_version: 1
name: Centralize task readiness triage and feature receipt operations
status: done
template: feature-impl
created_at: 2026-10-12T03:34:10.717Z
updated_at: "2026-10-13T05:40:16.076Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 12

dependencies: ["1173"]
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1176-verdict.json
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

- [x] R1. Make app services own readiness, feature-finding classification and task triage safety decisions while preserving current plugin entry and caller contracts.
- [x] R2. Make one app operation own the complete feature receipt execution/registration lifecycle; plugin entries no longer open the DB or instantiate ArtifactDao.
- [x] R3. Update current planner/workflow/wrapup consumers and tests, preserving safe execution, validation, receipt fingerprints and artifact identity, without a public CLI extension.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [x] AC1 — Task and feature decisions use their application owners (req: R1)

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

- [x] 1. Verify app checking and receipt helpers plus current adapters; freeze snapshots of preflight/diffstat/receipt argv and failure cases.
- [x] 2. Move pure admission and triage policy to the named app modules, exposing them via existing Node-pure generated entry; retain script CLI formatting/recovery helpers.
- [x] 3. Move feature verify body into the canonical app operation with injected I/O and existing feature lookup; delegate from plugin verify entry and remove plugin DB/DAO/feature-directory scan.
- [x] 4. Update bundle exports/types, app barrel where required, callers and focused tests. Shrink stale baseline kinds only after current scan proves them stale.
- [x] 5. Run app service/receipt/safety tests, plugin preflight/diffstat/receipt mode tests, bundle determinism/standalone, isolated plugin-smoke and task-local gate. Leave no unapproved public source change.

### Solution

R1 and R2 landed together: the decisions moved to their application owners and both plugin entries became adapters. R3 followed through consumers, tests and the rule/baseline surfaces the promotion touched.

Application owners:

- `packages/app/src/services/planning-admission.ts:1` — `quickReadiness`, `preflightTask`, `classifyFeaturePreflightFindings`, `NON_ABORTING_PREFLIGHT_CODES` and their pure types, moved out of the planner adapter. Pure and import-free, so it stays Node-compatible inside the generated bundle.
- `packages/app/src/workflow/task-triage.ts:1` — `sensitiveReasonForPath`, the frozen prefix/glob lists and the glob matcher. The safety floor still decides the lane before any model negotiation.
- `packages/app/src/workflow/feature-verification-run.ts:155` — `runFeatureVerification`: the whole pass (selected definition, before digest, RUNNING receipt pair + artifact registration, safe argv spawn with the 4 h ceiling, after digest, PASS/FAIL completion and status file) with injectable FileSystem/launcher/log/receipt/artifact seams.
- `packages/app/src/workflow/feature-verification-run.ts:64` — `createFeatureLookup`: the app-owned feature resolution over the configured planning folders, resolved against the operation's workdir, replacing the plugin's hardcoded directory scan.
- `packages/app/src/workflow/feature-verification-run.ts:40` — `assertSafeReceiptId`: the id refusal that protects the receipt filenames.

Packaging (existing entries only — no new bundle or registry):

- `packages/app/src/workflow/plan-projection.ts:22` — the pure policy rides the existing generated pure bundle entry.
- `scripts/commands/bundle-plugin-lib.ts:590` — the plan-projection declarations gained the policy surface; `scripts/commands/bundle-plugin-lib.ts:835` adds the receipt operation and lookup to the inline export list. Regenerated: `plugins/sp/lib/plan-projection.generated.{mjs,d.mts}`, `plugins/sp/lib/inline-run.generated.{mjs,d.mts}` and the affected script twins.

Adapters (caller contracts preserved):

- `plugins/sp/scripts/batch-preflight.ts:1` and `plugins/sp/scripts/task-diffstat.ts:1` — CLI surface, argv/usage/error contracts, recovery hints, git capture and the diffstat artifact stay; the policy is imported from the generated bundle and re-exported so existing importers are unaffected.
- `plugins/sp/scripts/feature-verification-steps.ts:1` — argv, usage, exit codes and the `--module-mode` refusal contract only (288 → 136 lines). It no longer opens the project DB, constructs an `ArtifactDao`, or scans a feature directory.

Tests:

- `packages/app/tests/services/planning-admission.test.ts:1` and `packages/app/tests/workflow/task-triage.test.ts:1` — direct policy ownership (TABLE A rows, command-aware readiness, classification; every frozen sensitive class, precedence and dotAll glob semantics).
- `packages/app/tests/workflow/feature-verification-run.test.ts:1` — real temp-file receipt lifecycle with in-memory run/artifact backing, plus one case driving the app defaults (log fd, `spawnSync` launcher, DB-backed artifact registration against a seeded run row).
- `plugins/sp/tests/batch-preflight.test.ts:1` — adapter contract, now including in-process `--classify-feature` cases; `plugins/sp/tests/feature-verification-steps.test.ts:47` asserts the source scan (no DB/DAO/scan ownership); `plugins/sp/tests/feature-verification-steps-mode.test.ts:1` keeps the source-mode refusal and installed-launch contract with the new seam name.
- `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:165` — the fixture carries the generated policy bundle as an install does, and `:176` re-points the diff base so the fixture scaffolding is not counted as fixture diff.

Rules and baseline:

- `config/rules/strict/runtime-boundaries.yaml:45` and `:82` — documented exemptions for the promoted operation (one merged log fd plus a 4 h ceiling cannot be expressed through the ProcessExecutor/FileSystem seams), the same class as the existing `quality-gate` exemption.
- `config/script-placement-baseline.json:1` — the now-thin entry's stale budget row left the shrinking baseline, and the reconcile expectations moved with it.

Deferred: retiring the two boundary exemptions needs a merged-fd/timeout option on the runtime port; 1177 keeps the packaging-resolution handoff and 1178 the measurement handoff, neither re-owned here.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Admission owner `packages/app/src/services/planning-admission.ts:120` (`quickReadiness`), `:258` (`preflightTask`), `:55` (`classifyFeaturePreflightFindings`), `:33` (`NON_ABORTING_PREFLIGHT_CODES`); triage owner `packages/app/src/workflow/task-triage.ts:38` (`sensitiveReasonForPath`) with frozen lists `:10`, `:12`. Pure bundle entry `packages/app/src/workflow/plan-projection.ts:22`; declarations `scripts/commands/bundle-plugin-lib.ts:689`, `:693`. Verifier-run: app planning-admission/task-triage/receipt/routing 72 pass / 0 fail. |
| R2 | MET | `packages/app/src/workflow/feature-verification-run.ts:155` (`runFeatureVerification`), `:64` (`createFeatureLookup`), `:40` (`assertSafeReceiptId`); exported via the inline entry `scripts/commands/bundle-plugin-lib.ts:942-943`. Plugin source scan: no `openInlineRunProjectDb`/`ArtifactDao`/`findFeatureFile` code in `plugins/sp/{scripts,hooks,lib}` outside generated bundles (only a doc comment at `plugins/sp/scripts/feature-verification-steps.ts:12`), pinned by `plugins/sp/tests/feature-verification-steps.test.ts:47`. Lifecycle tests `packages/app/tests/workflow/feature-verification-run.test.ts:91`, `:114`, `:125`, `:134`, `:149`, `:159`, `:189`, `:203`. |
| R3 | MET | Adapter contracts `plugins/sp/tests/batch-preflight.test.ts:1`, `plugins/sp/tests/task-diffstat.test.ts:1`, `plugins/sp/tests/feature-verification-steps-mode.test.ts:1`; routing fixture carries the generated bundle `packages/app/tests/workflow/task-pipeline-triage-routing.test.ts:165` and re-bases the diff `:176`; documented boundary exemptions `config/rules/strict/runtime-boundaries.yaml:45`, `:82`. Verifier-run plugin adapter suites 69 pass / 0 fail; operator-run `bun run spur-check` all pass. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Task and feature decisions use their application owners (req: R1) | MET | test | `packages/app/tests/services/planning-admission.test.ts:1`, `packages/app/tests/workflow/task-triage.test.ts:1`, `packages/app/tests/workflow/feature-verification-run.test.ts:91-203`, `plugins/sp/tests/feature-verification-steps.test.ts:47`; verifier-run 72 + 69 pass / 0 fail. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

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

**2026-10-12 — session 1 (worktree batch, partial):** R1 landed and committed as `8d9880515`.
Moved to the application owners, with the plugin adapters delegating:

- `packages/app/src/services/planning-admission.ts` — `quickReadiness`, `preflightTask`,
  `classifyFeaturePreflightFindings`, `NON_ABORTING_PREFLIGHT_CODES` and their pure types, out of
  `plugins/sp/scripts/batch-preflight.ts` (which keeps the CLI surface, argv/usage contracts and
  `recoveryHint`, and re-exports the moved names so existing callers are unaffected).
- `packages/app/src/workflow/task-triage.ts` — `sensitiveReasonForPath`, `SENSITIVE_PREFIXES`,
  `SENSITIVE_GLOBS` and the glob matcher, out of `plugins/sp/scripts/task-diffstat.ts` (which keeps
  git capture and the output artifact). The safety floor is unchanged and still decides the lane.
- Both are reached through the existing generated pure bundle entry: `plan-projection.ts` re-exports
  them (`export * from '../services/planning-admission'; export * from './task-triage';`) and
  `scripts/commands/bundle-plugin-lib.ts` declares them in `PLAN_PROJECTION_DECLS`. Regenerated:
  `plugins/sp/lib/plan-projection.generated.{mjs,d.mts}`, `plugins/sp/lib/inline-run.generated.mjs`,
  the `batch-preflight`/`task-diffstat`/`batch-plan` `.mjs` twins.
- New direct-policy suites: `packages/app/tests/services/planning-admission.test.ts` and
  `packages/app/tests/workflow/task-triage.test.ts`. The plugin suites stay as adapter contract tests.
- Verified: `bun run lint` clean; `plugins/sp` batch-preflight + task-diffstat suites 61 pass;
  `scripts/commands/bundle-plugin-lib.test.ts` 16 pass (determinism + export/declaration parity).

Remaining (R2/R3, not started): add `runFeatureVerification` to
`packages/app/src/workflow/feature-verification-receipt.ts` (or a sibling
`feature-verification-run.ts`) as the single receipt operation with injected
FileSystem/launcher/run+artifact seams and an app-owned default artifact write and feature lookup
(`FeatureService.show` over the configured features dir), export it through the existing
inline generated entry, then reduce `plugins/sp/scripts/feature-verification-steps.ts` to the argv
adapter — deleting `VerificationModule`'s `openInlineRunProjectDb`/`ArtifactDao` facade,
`findFeatureFile` and `nodeFsShim`. Add `packages/app/tests/workflow/feature-verification-run.test.ts`
with in-memory run/artifact backing (receipt lifecycle, ID/path refusals, selected definition,
spawned-command failure, digest mismatch), keep both plugin `feature-verification-steps` suites green,
and prove the plugin source scan finds no `openInlineRunProjectDb`/`ArtifactDao`/`findFeatureFile`
ownership. Then run the task-local gate and verify.

**Blocking finding for R2 (resolve before writing the operation).** The Design says to resolve the
feature spec "through existing app feature lookup". The existing lookup is `FeatureService.show(id)`
(`packages/app/src/services/feature-service.ts:325`), and its constructor requires
`{ fs, writeService, featuresDir, tasksDir }` where `writeService` is a `PlanningWriteService`. No app
factory composes that service — every current call site builds it from a CLI `CliContext`
(`apps/cli/src/commands/feature.ts:631`, `apps/cli/src/commands/task.ts:2002`,
`packages/app/src/services/task-service.ts:794`). So the operation cannot self-compose the lookup, and
the plugin adapter cannot compose it either without re-opening the composition the task exists to
remove. Pick one before implementing:

1. add a small app composition helper (e.g. `createFeatureLookup(cwd)` beside the receipt module) that
   builds `fs` + `PlanningWriteService` + `featuresDirFor(tasksDir)` — a new internal app seam, so it
   needs the same review the rest of the move gets; or
2. give `runFeatureVerification` the resolved feature spec as an explicit input (`featurePath` +
   `featureContent`) and have the *pipeline* pass it, keeping resolution out of the plugin entirely
   (the workflow already captures `featureSpecPath` at the `test` hop); or
3. keep resolution in the plugin as an explicitly named packaging exception, which contradicts R2 as
   written.

Option 2 needs no new seam and matches the existing proof-chain pattern, but changes who calls the
script (a workflow var instead of a directory scan) — a caller-contract change R1 said to preserve.
Recommend 1 if a new internal app helper is acceptable, otherwise 2 with the workflow var wired in the
same commit.

**2026-10-12 — session 2 (completion).** Option 1 was chosen for the R2 blocker: `createFeatureLookup`
is the app-owned composition helper, and it also became the operation's default lookup, so the plugin
composes nothing app-side.

- `packages/app/src/workflow/feature-verification-run.ts` owns the pass: `runFeatureVerification`
  (selected definition → before digest → RUNNING receipt pair + artifact registration → safe argv
  spawn with the 4 h ceiling → after digest → PASS/FAIL + status file) with injectable
  FileSystem/launcher/log/receipt/artifact seams and app-owned defaults; `createFeatureLookup` resolves
  the spec through the configured planning folders against the operation's workdir; `assertSafeReceiptId`
  guards the receipt filenames.
- `plugins/sp/scripts/feature-verification-steps.ts` is argv-only now (288 → 136 lines) and the source
  scan in `plugins/sp/tests/feature-verification-steps.test.ts` proves it owns no DB facade, DAO or
  feature-directory scan. Both `--module-mode` contract suites stay green with the new seam name.
- The operation and lookup are exported through the existing inline generated entry; the pure policy
  rides the existing plan-projection entry. Both bundles and every affected twin were regenerated.
- Promotion surfaced three repo-level gates that `scripts/`/`plugins/` never enforced, all fixed
  without suppressions: per-file coverage (the operation's default seams needed the real-defaults test
  plus in-process `--classify-feature` cases for the adapter), `every-export-has-tsdoc` on the moved
  exports, and two runtime-boundary rules — the latter two satisfied by documented exemptions of the
  same class as `quality-gate` (`config/rules/strict/runtime-boundaries.yaml`).
- The triage routing fixture had to ship the generated policy bundle (an install does) and re-point its
  diff base at the fixture scaffolding commit, because the bundle alone exceeds the >400-changed-lines
  safety floor that suite exercises.
- Verified: `quality gate PASS` (`.spur/run/1176-test-gate.status`), log `11124 pass / 0 fail`, 51
  pre-check + 2 post-check rules, 1363 files linted; verify answer PASS at MEDIUM confidence.
- 2026-10-12T07:12:14.949Z wip → testing (system)
- 2026-10-12T07:12:31.225Z testing → done (system)

