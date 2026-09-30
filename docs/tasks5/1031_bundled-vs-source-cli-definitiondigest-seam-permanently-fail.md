---
schema_version: 1
name: Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard
status: todo
template: feature-impl
created_at: 2026-09-30T21:56:16.627Z
updated_at: "2026-09-30T22:42:05.029Z"
feature_id: D9

priority: P2
ac_numbering: task-local
estimate_hours: 1
ac_altitude: task-local
---

## 1031. Bundled-vs-source CLI definitionDigest seam permanently fails feature-verification receipt guard

### Background

During feature I33 wrapup (2026-09-30) the D9-lifecycle `verifying → done` hop was denied twice: first `contract-mismatch` (receipt verifier digest ≠ completion verifier digest), then `run` (run-row `definitionDigest` ≠ receipt digest). The task was filed as a "bundled-vs-source canonicalization seam" and asked for a vintage-stable digest.

**Refine corrections (2026-09-30)**

- Claim: the two CLIs canonicalize the same `feature-verification.yaml` differently → **Disproven.** `spur workflow validate feature-verification.yaml --json` via the installed global `spur` reports digest `09165acb…`; the source CLI (`bun run apps/cli/src/index.ts`) reports `e5f5a64b…`. A `jq -S` diff of the two parsed definitions differs ONLY in the verify-step command: the installed package's YAML predates commit `04e3505d6` (no `script-root.json` resolution). Both CLIs self-report version 0.3.95. The definitions genuinely differed, so the guard rejected correctly. → R3 (vintage-stable digest) and fix directions A/B/C are withdrawn.
- Claim: the guard fails "permanently" for mixed vintages → **Root cause was a stale `spurBin` persisted in lifecycle run state.** The first attach of the feature lifecycle run was made by the installed `spur`; the engine merges persisted snapshot vars over `workflow.vars` (`ts-dual-workflow-engine` `dist/service.js:255`: `mergeVars(mergeVars(workflow.vars, snapshotVars), options.vars)`), so every later guard (`$spurBin feature check … --as done`) and the verifying `onEnter` kept running the installed binary even when the operator invoked the source CLI. → **Fixed and committed in `62499ad68` `fix(app): keep workflow guards on the caller's spurBin`** (`packages/app/src/workflow/lifecycle-adapter.ts:219-224` passes `spurBin` as an `options.vars` override; regression test `packages/app/tests/workflow/lifecycle-adapter.test.ts:98`). Now R1 (verify-only).
- Residual real defect: both rejection messages name only `name@layer (digest)` and never the resolved file, so an operator cannot see that two different installs produced two definitions. `sourcePath` is already recorded in the receipt as "diagnostic only" (`packages/app/src/workflow/feature-verification-receipt.ts:62-63`) but is never printed. → R2.

Title note: the task title keeps its original creation wording for traceability; the scope is the corrected one above.

### Requirements

- **R1** — Lifecycle guards and target `onEnter` actions of an already-attached lifecycle run execute with the `spurBin` resolved by the *current* caller, not the value persisted by whichever binary first attached the run. Landed in `62499ad68`; this task only re-verifies it and records the evidence (no further code change).
- **R2** — Every feature-verification receipt rejection that compares definition identity names the resolved definition files, so a mixed-install mismatch is diagnosable from the message alone:
  - `contract-mismatch` (verifier identity drift, `feature-verification-receipt.ts:458-464`) appends `receipt sourcePath=<verifier.sourcePath>, current sourcePath=<current.sourcePath>` and, when the two paths differ, the hint `— a different spur install resolved a different definition; re-run the verification pass and the transition with the same spur binary`.
  - `run` definition-digest mismatch (`feature-verification-receipt.ts:414-419`) appends `receipt sourcePath=<latest.verifier.sourcePath>` plus the same re-run hint.
- **R3** — Rejection semantics are unchanged: identity is still `name + layer + definitionDigest`; `sourcePath` stays diagnostic-only (a sourcePath-only difference with equal digests still passes — the 0957 contract); every existing mismatch still returns `ok: false` with the same `reason`.

### Acceptance Criteria

```gherkin
  @core
  Scenario: AC1 — a guard runs the caller's spurBin on a run attached by another binary (req: R1)
    Given a task lifecycle run first attached by an adapter whose spurBin is "false"
    When a second adapter with spurBin "true" requests the next guarded transition on the same run
    Then the transition is allowed

  @core
  Scenario: AC2 — a verifier-identity mismatch names both definition files (req: R2)
    Given a PASS receipt whose verifier definitionDigest and sourcePath differ from the current verifier
    When the done-boundary receipt check runs
    Then it fails with reason "contract-mismatch"
    And the detail contains both sourcePath values and the "different spur install" re-run hint

  @core
  Scenario: AC3 — a run-row digest mismatch names the receipt's definition file (req: R2)
    Given a PASS receipt whose recording run row carries a different definitionDigest
    When the done-boundary receipt check runs
    Then it fails with reason "run"
    And the detail contains the receipt's sourcePath and the re-run hint

  @core
  Scenario: AC4 — sourcePath alone never changes the verdict (req: R3)
    Given a PASS receipt whose verifier matches the current verifier in name, layer and definitionDigest but not sourcePath
    When the done-boundary receipt check runs
    Then it passes
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T22:39:36.822Z

- **Vintage-stable / canonicalized digest (old R3, direction A)** — rejected. The digests differed because the definitions differed (verify-step command); normalizing would hide a real contract change.
- **Guard-time re-resolution (B) / accept-either-digest (C)** — rejected for the same reason; C also weakens mutation detection.
- **`workflow continue` replaying the launch-time `spurBin`** (`packages/app/src/services/workflow-service.ts` ~1190) — out of scope. Launch-identity replay is deliberate (0784); only lifecycle adapter re-attach was defective and is fixed.
- **Stale-global-spur advisory / new verb** — not added. No public `spur` verb change (needs operator consent); the R2 hint is the diagnostic. Operator cleanup of the stale global install is a manual step, not task scope.
- **Hint condition** — the "different spur install" hint prints only when the two `sourcePath` values differ; an equal-path digest drift means the definition file was edited, and the existing "selected definition changed after the pass" wording already covers it.

#### Q&A entry — 2026-09-30T22:41:52.102Z

- **Vintage-stable / canonicalized digest (old R3, direction A)** — rejected. The digests differed because the definitions differed (verify-step command); normalizing would hide a real contract change.
- **Guard-time re-resolution (B) / accept-either-digest (C)** — rejected for the same reason; C also weakens mutation detection.
- **`workflow continue` replaying the launch-time `spurBin`** (`packages/app/src/services/workflow-service.ts` ~1190) — out of scope. Launch-identity replay is deliberate (0784); only lifecycle adapter re-attach was defective and is fixed.
- **Stale-global-spur advisory / new verb** — not added. No public `spur` verb change (needs operator consent); the R2 hint is the diagnostic. Operator cleanup of the stale global install is a manual step, not task scope.
- **Hint condition** — the "different spur install" hint prints only when the two `sourcePath` values differ; an equal-path digest drift means the definition file was edited, and the existing "selected definition changed after the pass" wording already covers it.

### Design

- **R1:** no change — `62499ad68` already merges `{ [profile.varKey]: ref.id, spurBin: this.opts.spurBin }` into `requestTransition` `options.vars` (`packages/app/src/workflow/lifecycle-adapter.ts:219-224`); the engine applies `options.vars` last, so the caller's binary wins over snapshot vars.
- **R2:** message-only edits in `packages/app/src/workflow/feature-verification-receipt.ts`, in the existing `detail` template strings:
  - `:414-419` (`reason: 'run'`): `… receipt records ${latest.verifier.definitionDigest} (receipt sourcePath=${latest.verifier.sourcePath}) — a different spur install may have attached the run; re-run the verification pass and the transition with the same spur binary`.
  - `:458-464` (`reason: 'contract-mismatch'`): keep the current text, then append `; receipt sourcePath=${verifier.sourcePath}, current sourcePath=${current.sourcePath}` and, only when `verifier.sourcePath !== current.sourcePath`, ` — a different spur install resolved a different definition; re-run the verification pass and the transition with the same spur binary`.
- **Invariants:** the `drifted` key list stays `['name', 'layer', 'definitionDigest']`; no `reason` value, return shape or check order changes; no receipt schema change.
- **Rejected:** a shared helper for the hint string — two call sites, a literal is clearer.
- **Surfaces:** `packages/app/src/workflow/feature-verification-receipt.ts` and `packages/app/tests/workflow/feature-verification-receipt.test.ts` only. `plugins/sp/lib/inline-run.generated.mjs` does not bundle this module (the lifecycle-adapter fix needed no bundle regen), but run `bun run --filter @gobing-ai/spur build:bundle` and confirm `git status` shows no generated diff.

### Plan

1. Tests first in `packages/app/tests/workflow/feature-verification-receipt.test.ts`: (a) contract-mismatch with differing sourcePaths → detail contains both paths and the hint; (b) run-row digest mismatch → detail contains receipt sourcePath and the hint; (c) same name/layer/digest, different sourcePath → `ok: true`. Run `(cd packages/app && bun test tests/workflow/feature-verification-receipt.test.ts)` — (a) and (b) fail before the change, (c) passes.
2. Edit the two `detail` strings per Design. Re-run the file: all pass.
3. Re-verify R1: `(cd packages/app && bun test tests/workflow/lifecycle-adapter.test.ts)` — the `guards run the caller-resolved spurBin` test passes.
4. `bun run spur-check`; commit `fix(app): name definition files in receipt digest mismatches (1031)`.

**Verification checks (evidence for the AC above):**

- [ ] `packages/app/tests/workflow/lifecycle-adapter.test.ts:98` passes (R1).
- [ ] New contract-mismatch test asserts both `sourcePath` values and the hint in `detail` (R2).
- [ ] New run-row mismatch test asserts the receipt `sourcePath` and the hint (R2).
- [ ] sourcePath-only test returns `ok: true`; all pre-existing receipt tests pass unchanged (R3).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature D9 (workflow seam stabilization); precedent task 0957 (sourcePath is diagnostic-only)
- Fix commit `62499ad68`; `packages/app/src/workflow/lifecycle-adapter.ts:219-224`; `packages/app/tests/workflow/lifecycle-adapter.test.ts:98`
- `packages/app/src/workflow/feature-verification-receipt.ts:58-68,414-419,450-464`
- Engine var precedence: `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/service.js:255`
- Evidence runs (I33, 2026-09-30): lifecycle run `run_a4e42b93…`; wrapup `215c6eab-95a9-463c-a676-cbda0bdf63d2`; bundled verification run `7ec2345a`
- Sibling: 1033 (wrapup pre-flight reuses the R2 diagnostics)

### History

- 2026-09-30T22:42:05.029Z backlog → todo (system)

