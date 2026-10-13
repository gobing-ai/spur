---
schema_version: 1
name: Name the consumer that requires a retired inline-run bundle export instead of a bare guard denial
status: done
template: issue
created_at: 2026-10-12T21:12:25.453Z
updated_at: "2026-10-13T03:01:54.975Z"
feature_id: A33

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1185-verdict.json
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

- [x] R1. When a project-layer workflow override invokes a script that requires a generated-bundle export the shipped entry no longer provides, the failure names the override path, the consumer script path, the required-but-missing export name(s), and the bundle that lacks them — never a bare guard denial or an unqualified "exited with 1".
- [x] R2. The diagnosis offers only remedies that can work: remove the project-layer override so the bundled definition applies, or migrate the consumer to the current app-owned operation. The shipped guidance must not tell a consumer to reinstall/upgrade when the installed bundle is already current.
- [x] R3. `feature-lifecycle`'s `verifying` entry surfaces that diagnosis to the operator while keeping today's fail-closed semantics: `verifying → done` still requires a bound PASS receipt (ADR-119), and a stale-consumer failure is distinguishable from a genuine verification FAIL.
- [x] R4. A regression fixture pins the behaviour end-to-end: a project whose `feature-verification.yaml` override invokes a script requiring a retired export produces the named diagnosis, a non-`done` terminal state, and the unchanged refusal to complete the feature — while a project with no override (or a migrated one) still reaches PASS.

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

**Declared execution surfaces (escalation answer, 2026-10-12 — operator chose to widen, not to bypass the guard).**
The Design's item-2 hook points and the R4 fixture live outside the surfaces this body named before,
so the implement hop's diff-scope guard (0487 R1, default on) would reject them as `out-of-scope`.
This task is authorised to touch, in addition to the paths already named above:
`packages/app/src/workflow/lifecycle-adapter.ts` (the `verifying` onEnter denial report —
`State "<to>" onEnter shell failed (exit N)`, where the child's diagnosable stderr dies),
`packages/app/src/workflow/actions/shell.ts` (the nested-run failure composition
`Command "<cmd>" exited with <code>`, which is what the outer denial echoes),
`packages/app/tests/workflow/` (app-side regression tests),
`plugins/sp/tests/` (plugin-side unit tests for the reciprocal helper),
`config/workflows/feature-verification.yaml` (the packaged definition's guidance header),
`config/workflows/feature-lifecycle.yaml` (the `verifying` entry that must surface the diagnosis).
Rationale: AC1 requires the *outer* `feature sync` denial to name the override path, the consumer
script path, the missing export(s) and the bundle path. Only the app-side denial/nested-run
composition can produce that string, so those hook points must be inside the declared surface
rather than reached around it.

### Plan

- [x] 1. Reproduce on a fixture, not on the downstream project: build a temp project carrying a project-layer `feature-verification.yaml` whose `onEnter` runs a stub consumer script requiring a name the entry does not export, then drive `spur feature sync` and capture the current bare denial (this is the regression the fixture must later flip).
- [x] 2. Add the reciprocal compatibility helper beside `resolveAppEntry`/`loadInlineApp` in `plugins/sp/lib/inline-run-app.ts`: name the consumer path, the missing export(s), the bundle path and the two actionable remedies; unit-test it with a stub consumer.
- [x] 3. Lift the diagnosis into the outer failure (`feature-lifecycle`'s `verifying` entry + the nested-workflow failure path): classify the child's output, emit the named diagnosis for a consumer-compat signature, and leave every other failure's message unchanged.
- [x] 4. Extend the regression fixture to assert both directions: the stale-consumer project reports the named diagnosis and does not reach `done`, and a migrated/no-override project still records a PASS receipt and reaches `done`.
- [x] 5. Update the shipped guidance that a consumer would read before writing such an override (packaged workflow header and the consumer-facing migration note): state that a project-layer override is no longer required, and give the two remedies for an existing one.
- [x] 6. Run the affected plugin tests and the repo gate; confirm no public CLI verb, schema or workflow-graph change was introduced.

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

R1/R2/R3/R4 landed as the Design's two bounded edits plus one shared helper and the packaged guidance. Change map (repo-root paths):

- `packages/app/src/workflow/consumer-compat.ts:55` — `consumerBundleSkew`: the reciprocal of the 1120 stale-*bundle* guard. Reads the missing export names and the entry path out of a consumer's own compat complaint (`<module|entry|bundle> <path> is missing <label> (<name>, …)`), bounded to `MAX_MISSING_EXPORTS` names (`:48`). The consumer's own complaint is the only place those names exist; static analysis of an interpolated shell command or of a consumer's imports is rejected (task Design).
- `packages/app/src/workflow/consumer-compat.ts:70` — `staleConsumerDiagnosis`: the operator-facing text — consumer path, missing export(s), entry path, override path when known — offering only the two remedies that can work (remove the project-layer override so the bundled definition applies; migrate the consumer to the current app-owned operation), and retiring the reinstall/upgrade advice the consumer's own message carried (R2).
- `packages/app/src/workflow/consumer-compat.ts:98` — `projectConsumerScript`: which script a shell command invokes, project-rooted only (`<workdir>/.spur/`, the tree a project override owns). A plugin-shipped script is deliberately not classified here — for it a stale generated bundle IS the right diagnosis (1120).
- `packages/app/src/workflow/consumer-compat.ts:113` — `nestedWorkflowRunTarget`: the `workflow run <file>` target an `onEnter` shell invokes, so the denial resolves the override the way bare-name resolution selected it.
- `packages/app/src/workflow/consumer-compat.ts:125` — `definitionConsumerScript`: the consumer read from the resolved definition's own `onEnter` commands (authoritative), never from the child's prose.
- `packages/app/src/workflow/consumer-compat.ts:146` — `projectConsumerFailure`: the classification the nested-run boundary consumes; `null` for every failure that is not a project-rooted consumer with a compat complaint.
- `packages/app/src/workflow/actions/shell.ts:191` — the nested shell failure path: `Command "<cmd>" exited with <code>` keeps its prefix and gains the diagnosis only for a failing project-rooted consumer whose output carries the compat signature; every other failure keeps its exact previous message (R1, second surface).
- `packages/app/src/workflow/lifecycle-adapter.ts:366` — the denial line `State "${to}" onEnter shell failed (exit N).` is unchanged; the diagnosis is appended to it (`:372`), so the operator's failure is widened rather than replaced.
- `packages/app/src/workflow/lifecycle-adapter.ts:389` — `staleConsumerDenial`: resolves the nested definition project-first, fires only when the resolved layer is the project layer (an override), and names the override path, consumer path, missing export(s) and entry path. Fail-closed semantics untouched: the hop is still denied, and `verifying → done` still requires a bound PASS receipt (ADR-119).
- `config/workflows/feature-verification.yaml:18` — packaged guidance header (R2): a project-layer override is no longer required since the pass moved into the application; remove the override so the bundled definition applies, or migrate the port to the app-owned operation `runFeatureVerification`; a reinstall cannot supply a retired export.

Tests:

- `packages/app/tests/workflow/consumer-compat.test.ts:55` — unit pins for `consumerBundleSkew` (complaint parsing, the shipped script's wording, the `MAX_MISSING_EXPORTS` bound) and, in the blocks that follow, `staleConsumerDiagnosis` (both remedies present, reinstall retired), `projectConsumerScript`, `nestedWorkflowRunTarget`, `definitionConsumerScript`, `projectConsumerFailure` (`null` for every other failure).
- `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:247` — R4 fixture over the real CLI and the real `verifying` entry, four scenarios: (a) stale consumer → the denial names the override path, the consumer path, `openInlineRunProjectDb` and the entry path, offers both remedies, carries no reinstall advice, and the feature stays `active`; (b) the nested `workflow run --json` reason carries the same diagnosis with `transitionsTaken: 0`; (c) a genuine verification FAIL (`verificationCmd: false`) records FAIL and fabricates no consumer diagnosis (R3 distinguishability); (d) a migrated consumer records a PASS receipt and reaches `done`.

Acceptance trace: AC1 by (a)+(b) (all four facts named on the surface failure, no reinstall advice offered); AC2 by the two-remedy diagnosis, the remedy-only packaged guidance, and (c); AC3 by (a) and (d).

Scope note (design deviation, explicit): the Plan placed the reciprocal helper in `plugins/sp/lib/inline-run-app.ts`, but both hook points the same Design names live in `packages/app`, and plugin code is not importable from app code (`sp-plugin-standalone`, ADR-065/130) — the Design's "one shared helper" therefore lives once in `packages/app/src/workflow/consumer-compat.ts` so both boundaries share a single spelling. `plugins/sp/lib/inline-run-app.ts` and the generated bundle are untouched, and the stale-*bundle* contract keeps its 1120 behaviour.

Boundary respected: no re-export of `openInlineRunProjectDb`/`ArtifactDao`, no migration or deletion of the downstream port, no new public CLI verb, no schema change, no workflow-graph change (the packaged header is a comment).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/lifecycle-adapter.ts:366-373` keeps the `State "<to>" onEnter shell failed (exit N).` denial verbatim and appends the named diagnosis; `packages/app/src/workflow/lifecycle-adapter.ts:389-411` resolves the nested target project-first, fires only when `resolved.layer !== 'project'` is false, and reads the consumer from the resolved definition's own `onEnter` commands; text composed at `packages/app/src/workflow/consumer-compat.ts:70-80` (consumer path, missing exports, entry path, override path). Second surface: `packages/app/src/workflow/actions/shell.ts:186-203` composes `Command "..." exited with N` plus the diagnosis for a failing project-rooted consumer and keeps the previous string otherwise. Executable proof: `spur feature sync F1 --json` on a throwaway project with a project-layer override runs the full chain and the surface failure names all four facts — `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:248-265` (override path, consumer path, `openInlineRunProjectDb`, entry path on the outer denial) and `:268-285` (the nested failure `reason` carries the same three names with `transitionsTaken: 0`). Premise: the shipped entry exports `runFeatureVerification` and does not export `openInlineRunProjectDb` or `ArtifactDao` — `plugins/sp/lib/inline-run.generated.mjs` export list, retirement documented at `scripts/commands/bundle-plugin-lib.ts:836-842`. |
| R2 | MET | `config/workflows/feature-verification.yaml:13-24` is the packaged guidance a consumer reads before writing an override: it states no project-side override is required, gives exactly the two remedies (remove the override so this definition applies; migrate the port to `runFeatureVerification`, the bundled export), and states a reinstall cannot supply a retired export. The runtime diagnosis carries the same two remedies and retires the reinstall advice at `packages/app/src/workflow/consumer-compat.ts:70-80`. Executable proof: `packages/app/tests/workflow/consumer-compat.test.ts:77-88` requires the two remedies and exactly one reinstall mention, the one that says it does not add the names; `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:259-264` asserts the real CLI output contains both remedies and matches no reinstall-or-upgrade advice. |
| R3 | MET | Distinguishability is structural: classification requires the consumer's compat complaint (`packages/app/src/workflow/consumer-compat.ts:55-67`), so a genuine verification FAIL keeps the child's own output — pinned at `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:288-297` (records FAIL, output carries no consumer diagnosis, feature stays `active` at `:297`). Fail-closed is unchanged: the stale consumer's hop is still denied and the feature stays `active` at `:264`; `verifying -> done` still runs `$spurBin feature check $featureId --strict --as done` at `config/workflows/feature-lifecycle.yaml:88-98` (unmodified — ADR-119 bound PASS receipt), and the migrated direction only reaches `done` after a PASS receipt records: `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:300-311`. |
| R4 | MET | The regression fixture is real-CLI end to end over throwaway project roots under the OS tmp dir, and pins all four behaviours: stale consumer -> named diagnosis plus non-done terminal state (`packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:248-265`), nested reason (`:268-285`), genuine FAIL still FAIL (`:288-297`), migrated consumer -> PASS receipt then `done` (`:300-311`). Verifier-run command: `(cd packages/app && bun test tests/workflow/consumer-compat.test.ts tests/workflow/feature-lifecycle-stale-consumer.test.ts)` -> 19 pass, 0 fail, 63 expect() calls across 2 files, 8.92s. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A stale consumer override is named, not merely denied (req: R1) | MET | test | `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:248-265` drives the real `spur feature sync F1 --json` against a throwaway project root carrying a project-layer override plus a `.spur/scripts/feature-verify.mjs` requiring the retired export, and asserts the failure contains the override path, the consumer script path, `openInlineRunProjectDb`, and the entry path, plus that the output matches no reinstall-or-upgrade advice. Same-chain nested surface: `:268-285`. Unit pins of the composition: `packages/app/tests/workflow/consumer-compat.test.ts:32-57` and `:149-152`. Verifier-run result: 19 pass, 0 fail. |
| AC2 — Remedies are actionable and distinguishable (req: R2, R3) | MET | test | Remedies pinned at `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:259-263` and `packages/app/tests/workflow/consumer-compat.test.ts:77-88` (both remedies offered, the only reinstall mention is the one retiring it); remedy-only packaged prose at `config/workflows/feature-verification.yaml:13-24`. Distinguishable from a genuine verification FAIL at `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:288-297`: that run records `FAIL`, fabricates no consumer diagnosis, and the feature stays `active`; fail-closed completion is pinned by the two-hop migrated run at `:300-311`, where `verifying -> done` is reached only after the PASS receipt. Verifier-run result: 19 pass, 0 fail. |
| AC3 — The fixture pins diagnosis and fail-closed behaviour together (req: R4) | MET | test | `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:248-265` asserts the named diagnosis and the non-done state together (`expect(featureStatus(root)).toBe('active')` at `:264`); `:300-311` asserts the migrated consumer records a PASS receipt and reaches `done`. Verifier-run command over both fixture files: 19 pass, 0 fail, 63 expect() calls, 2 files, 8.92s. Supporting gate receipt: `.spur/run/1185-check-receipt.json` -> PASS at `inputDigest` sha256:81b732b2d17564dc835b7cb1027bc74ee74c2a2f1921c3963cdfc4b6cc0acfc8, which equals the working-tree fingerprint recomputed by the verifier. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** — no P1/P2 findings. Review run by the pipeline's `review` stage on the working tree at proof digest `sha256:81b732b2…` (three dimensions: functional traceability, SECUA, architectural depth).

**Confidence:** MEDIUM

The level is MEDIUM because the gap below is real: every requirement row is MET with `file:line` evidence and every finding is dispositioned, but the diagnosis was exercised against the R4 fixture's re-created consumer rather than the live downstream `ts-libs` port, and no reviewer-run command backs the green suite (that is the pipeline's attested gate receipt, `sha256:81b732b2…`).

#### Requirements traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 — a project-layer override whose consumer needs a retired export names override + consumer + missing export(s) + bundle | MET | `packages/app/src/workflow/lifecycle-adapter.ts:366` (denial kept verbatim) + `:372` (diagnosis appended); `:389-412` `staleConsumerDenial` resolves the nested target, fires only when `resolved.layer === 'project'` (`:403`), and reads the consumer from the resolved definition's own `onEnter` (`:404`); message composed at `packages/app/src/workflow/consumer-compat.ts:70-79`. Premise verified: `openInlineRunProjectDb`/`ArtifactDao` are absent from `plugins/sp/lib/inline-run.generated.d.mts`; the retirement is documented at `scripts/commands/bundle-plugin-lib.ts:836-842`. |
| R1 (second surface) | MET | `packages/app/src/workflow/actions/shell.ts:188-203` composes `Command "…" exited with N` + the diagnosis for a failing project-rooted consumer, and reproduces the exact previous string otherwise (`:198-201`). |
| R2 — only remedies that can work | MET | `config/workflows/feature-verification.yaml:13-24` states the override is no longer required, gives both remedies (remove the override; migrate to `runFeatureVerification`), and the diagnosis itself retires the reinstall advice at `packages/app/src/workflow/consumer-compat.ts:78`. `runFeatureVerification` is a real export (`scripts/commands/bundle-plugin-lib.ts:838-842`, `plugins/sp/lib/inline-run.generated.d.mts:26`) and the migrated fixture consumer calls it successfully. |
| R3 — surfaced to the operator, fail-closed unchanged, distinguishable from a genuine FAIL | MET | Classification is gated on the compat complaint shape (`packages/app/src/workflow/consumer-compat.ts:40,55-67`), so a verification FAIL keeps the child's own output; the transition is still denied and the feature stays `active` (fixture `packages/app/tests/workflow/feature-lifecycle-stale-consumer.test.ts:288-297`); `verifying → done` still needs a bound PASS receipt. |
| R4 — both directions pinned end to end | MET | Same fixture over the real CLI and the real `verifying` entry: stale (`:248-265`), nested reason (`:268-285`), genuine FAIL (`:288-297`), migrated → PASS → `done` (`:300-311`). |

#### Findings

| Priority | Location | Finding | Disposition |
| --- | --- | --- | --- |
| P3 | `packages/app/src/workflow/consumer-compat.ts:98-107` | Recognition is bounded to `<workdir>/.spur/`, documented as a `shortcut:` at `:96`. R1's antecedent is any project-layer override script, so a port at `<workdir>/scripts/verify.mjs` still gets the bare `exited with N`. Fail-open (the old message), never a wrong one. | DEFER — the observed instance and the R4 fixture both live under `.spur/scripts/` (`docs/tasks5/1185_name-the-consumer-that-requires-a-retired-inline-run-bundle-.md` Background); widening the bound is a follow-up. |
| P3 | `packages/app/src/workflow/consumer-compat.ts:125-143` | A multi-script override can name the WRONG consumer: `definitionConsumerScript` returns the first project-rooted script (`:139-141`) while the export names come from the actually failing child (`:147-149`). No case covers >1 consumer (`packages/app/tests/workflow/consumer-compat.test.ts:126-144` is single-command). | DEFER — smallest fix is to fail open when the resolved definition holds more than one distinct project-rooted consumer; recorded in the wrap residuals. |
| P4 | `packages/app/src/workflow/consumer-compat.ts:33-35` | The comment claims the recognised shape is what "every generated-bundle consumer emits", but the plugin's own 1120 guard emits a different one (`plugins/sp/lib/inline-run-app.ts:57-62`), so such a consumer is silently unclassified. | DEFER — soften the comment or extend the regex. |
| P4 | `packages/app/src/workflow/consumer-compat.ts:41` | The captured `entry` is unbounded (only the export names are bounded, `:48`) and is embedded verbatim at `:76`. | DEFER — bound it or validate it as a path. |
| P4 | `packages/app/src/workflow/consumer-compat.ts:99-104` | `projectConsumerScript` compares an unresolved `join(workdir,'.spur')+sep` against `resolve(workdir, token)`, so a relative `workdir` silently disables recognition. Both call sites are absolute today (`packages/app/src/workflow/lifecycle-adapter.ts:350`, `packages/app/src/workflow/actions/shell.ts:189`). | DEFER — one-line hardening: `resolve(workdir)` once. |
| P4 | `packages/app/src/workflow/lifecycle-adapter.ts:399` | `staleConsumerDenial` resolves without the `registered` layer while the real run passes `resolveWorkflowPaths(...)` (`apps/cli/src/commands/workflow.ts:772-774`). Only a `workflows.paths`-registered copy can be missed, and never as a wrong path (`packages/app/src/workflow/workflow-resolver.ts:215-243` probes `<cwd>/<file>` then `<cwd>/.spur/workflows/<file>` before the shared layer). | DEFER — pass the registered layer when convenient. |

#### Architectural depth

The Design placed the helper beside the task-1120 `resolveAppEntry`/`loadInlineApp` guard in `plugins/sp/lib/inline-run-app.ts`; it landed in `packages/app/src/workflow/consumer-compat.ts`. The deviation is **justified** (both hook points are app-side, and one shared spelling beats two copies) and **recorded** in `## Solution` ("Scope note (design deviation, explicit)"). The 1120 bundle-side guard keeps its behaviour (`plugins/sp/lib/inline-run-app.ts` unmodified). Contract ownership is linked only by comment, which the P4 above addresses. No workflow-graph or schema change: the YAML edit is a comment block and `resolveWorkflowDefinition` digests the parsed object (`packages/app/src/workflow/composition-baseline.ts:30-34`), so digests and baselines are unchanged. No golden/byte-identity baseline breaks (`onEnter shell failed` appears only in the new test and this task; the one shell-message assertion is `toContain` at `packages/app/tests/workflow/actions/shell.test.ts:102`).

#### Residual risk

R1 traceability is exact only for `.spur/`-rooted consumers; a multi-script override can name the wrong consumer; a consumer emitting the 1120 wording stays unclassified (all fail-open to the pre-1185 message). The diagnosis is proven against the fixture's re-created consumer, not the live downstream port. Merge verdict: **OK**.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-12T23:03:49.659Z todo → wip (system)
- 2026-10-13T02:10:46.295Z wip → testing (system)
- 2026-10-13T02:18:43.847Z testing → wip (system)
- 2026-10-13T03:01:31.251Z wip → testing (system)
- 2026-10-13T03:01:54.957Z testing → done (system)

