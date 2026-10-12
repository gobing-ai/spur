---
schema_version: 1
name: Name the consumer that requires a retired inline-run bundle export instead of a bare guard denial
status: todo
template: issue
created_at: 2026-10-12T21:12:25.453Z
updated_at: "2026-10-12T21:13:50.524Z"
feature_id: A33

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
---

## 1185. Name the consumer that requires a retired inline-run bundle export instead of a bare guard denial

### Background

Observed on 2026-10-12 while running a `--worktree` batch in `gobing-ai/ts-libs` (tasks 0109/0110/0111).
All three tasks reached `done`, but none of the three features (F1, L1, N1) could advance out of `active`:
each has every linked task `done`, yet the feature lifecycle refuses the `verifying` entry.

Reproduction chain (every command run in `/Users/robin/xprojects/ts-libs`, spur = the source checkout
binary `/Users/robin/xprojects/spur-new/apps/cli/spur.js`):

```
$ spur feature sync F1 --json
GuardDeniedError: Lifecycle transition denied for feature F1: State "verifying" onEnter shell failed
(exit 1). Command "env -u SPUR_WORKFLOW_RUN_ACTIVE $spurBin workflow run feature-verification.yaml
--vars "{\"featureId\":\"$featureId\",\"spurBin\":\"$spurBin\"}"" exited with 1

$ spur workflow run feature-verification.yaml --vars '{"featureId":"F1","spurBin":"spur"}' --json
{ "status": "failed", "finalState": "verify", "transitionsTaken": 0,
  "reason": "Command \"bun .spur/scripts/feature-verify.mjs verify --feature-id \"$featureId\" --run-id \"$__runId\"\" exited with 1" }

$ bun .spur/scripts/feature-verify.mjs verify --feature-id F1 --run-id diag-…
feature-verify: Error: module /Users/robin/xprojects/spur-new/apps/cli/plugins/sp/lib/inline-run.generated.mjs
is missing feature-verification seams (openInlineRunProjectDb, ArtifactDao) — reinstall/upgrade @gobing-ai/spur
```

Two things are wrong, and they are separable:

1. **The consumer is stale by construction and nothing says so.** `ts-libs` carries a *project-layer*
   override — `.spur/workflows/feature-verification.yaml` (2426 B, written 2026-09-23) — which wins
   by-name resolution over the bundled definition and whose `onEnter` calls a hand-written port
   `.spur/scripts/feature-verify.mjs` (8505 B, tracked; last touched 2026-10-03). That port requires
   `openInlineRunProjectDb` and `ArtifactDao` as *named exports* of the generated inline-run bundle.
   Both were **deliberately retired** hours before this observation:
   - `8f51a752d refactor(sp): retire the DB/DAO bundle surface and share entry resolution` (2026-10-12 00:30)
     — "The inline bundle now exports application operations only: the low-level DB and DAO handles that a
     plugin entry could have driven directly are gone from both the runtime bundle and its declarations, so
     persistence is reachable only through an operation that owns it."
   - the surviving comment at `scripts/commands/bundle-plugin-lib.ts:837` says the same in one line:
     "entry keeps argv/usage only — it no longer opens the project DB or constructs an ArtifactDao".
   - `efd78f058 refactor(app): own the feature-verification receipt pass` moved the receipt pass into the app,
     which is why the bundled `apps/cli/config/workflows/feature-verification.yaml` no longer needs a
     project-side port at all.
   Measured on the current bundle (`plugins/sp/lib/inline-run.generated.mjs`, 2106992 B, mtime 2026-10-12 13:49):
   `openInlineRunProjectDb` appears 9 times and `ArtifactDao` 3 times **in the file body** but with **zero
   named exports**; `startFeatureVerificationReceipt`, `completeFeatureVerificationReceipt`,
   `captureFeatureReceiptDigest`, `resolveWorkflowDefinition` and `splitLaunchCommand` are all still exported.
   So the retirement is real, intentional, and partial only in the sense that the consumer was left behind.

2. **The failure is diagnosed as something it is not.** The port's own message says
   "reinstall/upgrade @gobing-ai/spur" — advice that cannot work, because the installed bundle is the current
   one; the stale artifact is the consumer. One layer up, the operator sees only
   `Lifecycle transition denied … State "verifying" onEnter shell failed (exit 1)`: no override path, no
   port path, no missing export name, and no way to tell this apart from a genuine verification FAIL. The
   nested `spur workflow run` reports `reason: Command "bun .spur/scripts/feature-verify.mjs …" exited with 1`
   with `transitionsTaken: 0`, i.e. the diagnosable stderr exists but is never lifted into the outer failure.

Blast radius: any project that took the plugin's earlier guidance and still carries a project-layer
`feature-verification.yaml` + port over this surface. Every such feature is permanently stuck `active`
(ADR-119: a feature is not done until the verification pass records PASS), with no path forward from the
error text alone. In this instance three features (F1, L1, N1) are affected.

Why this belongs to A33: this feature already owns the sibling case and shipped its remedy. Task 1120
("superskill install sp does not refresh the installed lib/inline-run.generated.mjs") produced the stale-*
bundle* guard — `plugins/sp/lib/inline-run-app.ts` → `resolveAppEntry()` / `loadInlineApp()`, whose header
states the intent: *"the first missing export then surfaces as a bare `app.readInstalledInventory is not a
function`. This helper names the skew (bundle path, missing exports, both remedies) instead."* That guard
covers the installed bundle. What is missing is the same treatment for a **consumer** (a rooted port or a
project-layer override) that requires an export the shipped entry no longer provides — same class, one
layer out, and this time the wrong remedy is not merely missing but actively stated.

Not the plugin's job: the port itself. `grep -rln 'feature-verify.mjs' plugins/` returns nothing — the port
is consumer-owned (`ts-libs/.spur/scripts/feature-verify.mjs`, tracked in that repo). The plugin-side work is
the diagnosis, the guidance and the compatibility check, not rewriting a downstream project's script.

### Requirements

- [ ] R1. When a project-layer workflow override invokes a script that requires a generated-bundle export the shipped entry no longer provides, the failure names the override path, the consumer script path, the required-but-missing export name(s), and the bundle that lacks them — never a bare guard denial or an unqualified "exited with 1".
- [ ] R2. The diagnosis offers only remedies that can work: remove the project-layer override so the bundled definition applies, or migrate the consumer to the current app-owned operation. The shipped guidance must not tell a consumer to reinstall/upgrade when the installed bundle is already current.
- [ ] R3. `feature-lifecycle`'s `verifying` entry surfaces that diagnosis to the operator while keeping today's fail-closed semantics: `verifying → done` still requires a bound PASS receipt (ADR-119), and a stale-consumer failure is distinguishable from a genuine verification FAIL.
- [ ] R4. A regression fixture pins the behaviour end-to-end: a project whose `feature-verification.yaml` override invokes a script requiring a retired export produces the named diagnosis, a non-`done` terminal state, and the unchanged refusal to complete the feature — while a project with no override (or a migrated one) still reaches PASS.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A stale consumer override is named, not merely denied (req: R1)
  Given a project whose project-layer feature-verification.yaml override invokes a script that requires an export the shipped inline-run entry no longer provides
  When the feature lifecycle enters verifying for a feature whose linked tasks are all done
  Then the surface failure names the override path, the consumer script path, the missing export name, and the bundle path
  And no message in the chain advises reinstalling an already-current bundle

Scenario: AC2 — Remedies are actionable and distinguishable (req: R2, R3)
  Given the same stale-consumer project
  When the failure is reported
  Then it offers removing the override (bundled definition applies) or migrating the consumer to the current operation
  And the operator can tell it apart from a genuine verification FAIL, which continues to report the verification command's own output
  And the feature does not complete: verifying -> done still requires a bound PASS receipt

Scenario: AC3 — The fixture pins diagnosis and fail-closed behaviour together (req: R4)
  Given the regression fixture projects
  When the fixture suite runs
  Then the stale-consumer project asserts the named diagnosis and the non-done terminal state
  And the migrated/no-override project still records a PASS receipt and reaches done
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-10-12T21:13:36.973Z

#### Q&A entry — 2026-10-12T21:13Z

**Q: Why A33 rather than a workflow-reliability feature?** A33 owns this exact surface and already shipped
the sibling remedy: task 1120 added the stale-*bundle* guard in `plugins/sp/lib/inline-run-app.ts`
(`resolveAppEntry`/`loadInlineApp`), whose stated purpose is to name a missing export instead of letting it
surface as a bare failure. This task is the reciprocal case over the same surface. D63 — whose scope lists
"catalogue-wide source/installed/override compatibility" and would otherwise have been the natural owner —
is `done`, and D3's `## Scope` is empty, so neither could host the placement without reopening or inventing
scope.

**Q: Should the fix restore `openInlineRunProjectDb` / `ArtifactDao` to the bundle entry instead?** No. The
retirement is deliberate policy, not an accident: `8f51a752d` states that persistence must be reachable only
through an operation that owns it, and the surviving comment at `scripts/commands/bundle-plugin-lib.ts:837`
records the same. Re-exporting the low-level DB/DAO handles would reverse an accepted decision to make one
consumer's stale port work.

**Q: Is the consumer's port in scope?** No. `grep -rln 'feature-verify.mjs' plugins/` returns nothing — the
port is consumer-owned (`ts-libs/.spur/scripts/feature-verify.mjs`). This task owns the diagnosis, the
shipped guidance and the compatibility signal; deleting or migrating a downstream project's script is that
project's own change.

**Q: Does the nested `spur workflow run` already carry what is needed?** Partly. It fails with
`transitionsTaken: 0` and a `reason` naming the failed command, but the *diagnosable* text (the seam-missing
throw) is only in the child's stderr, which the outer surfaces never lift — which is why the operator sees a
bare guard denial. The fixture must therefore assert the outer surface, not just the child's exit code.

**Q: Scope of the guidance change?** Ship the migration instruction wherever a consumer would look before
writing such an override (the packaged workflow's own header comment already documents the receipt contract;
the guidance surface should state that a project-layer override is no longer required and what to do with an
existing one). No new public CLI verb is required by this task.

### Design

Approach: reuse the seam that already owns "name the skew", and lift the child's diagnosis into the outer
failure. Two bounded edits, one shared helper.

**1. A reciprocal compatibility check beside the existing guard.** `plugins/sp/lib/inline-run-app.ts` already
resolves the app entry and, for `portable: true` entries, refuses a stale bundle by naming the missing
exports (`resolveAppEntry` / `loadInlineApp`, shipped for task 1120). Add the reciprocal direction: given a
consumer module path, import it and name the exports it requires but the shipped entry does not provide —
into the same error shape (consumer path, missing export(s), bundle path, both remedies). Keep it a pure
function of (consumer path, entry) so it is unit-testable without launching a workflow.

**2. Lift the child failure into the surface the operator reads.** Today the diagnosable stderr dies inside
the nested `spur workflow run`. At the point where a shell step's non-zero exit becomes a lifecycle denial
(`feature-lifecycle`'s `verifying` entry, and the nested-workflow failure path in the workflow service),
classify the child's output: a seam/consumer-compat signature produces the named diagnosis; anything else
keeps today's message. Fail-closed behavior is unchanged — the transition is still denied, `verifying → done`
still needs a bound PASS receipt.

**Tradeoffs and alternatives.**

- *Preflight before entering `verifying`* (validate the override's script up front, so the operator gets the
  message before any nested run) is the strongest UX, but it is a second code path that must resolve the
  override exactly as name resolution does; if the two ever disagree the preflight becomes a liar. Preferred:
  put the check at the failure boundary first (one path, always correct), and add a preflight only if a later
  measurement shows the nested run is expensive enough to matter.
- *Static analysis of the override's YAML* (parse the `onEnter` command, inspect the referenced script's
  imports) is rejected: the command is interpolated shell, and a static reader would need to model the
  shell's variables to be right.
- *Re-exporting the retired seams* is rejected — see `### Q&A` (it reverses an accepted decision).
- *Silencing the failure to a warning* is rejected: a feature must not complete on an unverified pass.

Keep the change inside the existing generated-bundle/guard surface (A33's boundary); no new public CLI verb,
no schema change, no workflow-graph change.

### Plan

- [ ] 1. Reproduce on a fixture, not on the downstream project: build a temp project carrying a project-layer `feature-verification.yaml` whose `onEnter` runs a stub consumer script requiring a name the entry does not export, then drive `spur feature sync` and capture the current bare denial (this is the regression the fixture must later flip).
- [ ] 2. Add the reciprocal compatibility helper beside `resolveAppEntry`/`loadInlineApp` in `plugins/sp/lib/inline-run-app.ts`: name the consumer path, the missing export(s), the bundle path and the two actionable remedies; unit-test it with a stub consumer.
- [ ] 3. Lift the diagnosis into the outer failure (`feature-lifecycle`'s `verifying` entry + the nested-workflow failure path): classify the child's output, emit the named diagnosis for a consumer-compat signature, and leave every other failure's message unchanged.
- [ ] 4. Extend the regression fixture to assert both directions: the stale-consumer project reports the named diagnosis and does not reach `done`, and a migrated/no-override project still records a PASS receipt and reaches `done`.
- [ ] 5. Update the shipped guidance that a consumer would read before writing such an override (packaged workflow header and the consumer-facing migration note): state that a project-layer override is no longer required, and give the two remedies for an existing one.
- [ ] 6. Run the affected plugin tests and the repo gate; confirm no public CLI verb, schema or workflow-graph change was introduced.

### Root Cause

The retirement is intentional and the consumer is stale; the defect is that nothing says so, and the
surviving hint says the opposite of the truth.

Verified chain (all evidence re-runnable from the commands in `### Background`):

1. `feature-lifecycle`'s `verifying` entry invokes `feature-verification.yaml`
   (`apps/cli/config/workflows/feature-lifecycle.yaml`, caller wiring task 0880).
2. Name resolution selects the **project layer** copy: `ts-libs/.spur/workflows/feature-verification.yaml`
   overrides the bundled `apps/cli/config/workflows/feature-verification.yaml`.
3. That override's `verify` onEnter runs the consumer port
   `bun .spur/scripts/feature-verify.mjs verify --feature-id … --run-id …`.
4. The port's `requireModule()` demands seven names as functions from the generated bundle
   (`.spur/scripts/feature-verify.mjs`, the `missing = [...]` list at ~line 37):
   `startFeatureVerificationReceipt`, `completeFeatureVerificationReceipt`, `captureFeatureReceiptDigest`,
   `resolveWorkflowDefinition`, `splitLaunchCommand`, `openInlineRunProjectDb`, `ArtifactDao`.
5. Two of those were retired by `8f51a752d` (2026-10-12 00:30) and are no longer exported:
   `scripts/commands/bundle-plugin-lib.ts:837` documents the removal ("entry keeps argv/usage only — it no
   longer opens the project DB or constructs an ArtifactDao"), and the generated bundle confirms it
   (`openInlineRunProjectDb` 9 body hits / 0 named exports; `ArtifactDao` 3 / 0).
6. So `requireModule` throws, the port exits 1, the nested `spur workflow run` exits 1 with
   `transitionsTaken: 0`, and `feature-lifecycle` reports only
   `GuardDeniedError … State "verifying" onEnter shell failed (exit 1)`.

Two independent root causes, both plugin-owned (the consumer's port is not):

- **R-a — no compatibility check for a consumer over the bundle surface.** The existing guard
  (`plugins/sp/lib/inline-run-app.ts`, `resolveAppEntry`/`loadInlineApp`, shipped for task 1120) names a
  stale *installed bundle*. Nothing performs the reciprocal check: is a *consumer* requiring exports this
  entry no longer provides? Nothing distinguishes a project-layer override from the bundled definition when
  the override fails, either, so the operator cannot tell a stale consumer from a real verification FAIL.
- **R-b — the migration path is not delivered to consumers.** The retirement changed the contract that
  rooted ports were written against, and no shipped guidance or detection tells a project to delete its
  project-layer `feature-verification.yaml` override (the bundled definition now owns the pass end-to-end)
  or to migrate a port to the app-owned operation. The only text a consumer sees recommends reinstalling a
  bundle that is already current.

Not the root cause (checked, to keep the fix honest):

- Not a stale bundle: the generated bundle is current (2106992 B, mtime 2026-10-12 13:49) and does export
  the other five seams the port needs, so this is a partial contract change, not a refresh failure — the
  task-1120 remedy (reinstall/upgrade) genuinely does not apply.
- Not a workflow-resolution bug: the project-layer override winning by name is the documented behaviour.
- Not a file-path accident: the port resolves `spur` → realpath → walks up to the bundle, which is exactly
  what its header documents; it finds the current bundle and is rejected by it.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
