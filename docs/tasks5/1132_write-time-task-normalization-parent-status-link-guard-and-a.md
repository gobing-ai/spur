---
schema_version: 1
name: Write-time task normalization, parent-status link guard, and auto-fix-first batch preflight
status: done
template: feature-impl
created_at: 2026-10-08T19:11:25.579Z
updated_at: "2026-10-09T07:40:43.709Z"
feature_id: F21

ac_numbering: task-local
ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1132-verdict.json
---

## 1132. Write-time task normalization, parent-status link guard, and auto-fix-first batch preflight

### Background

**Origin.** Session review on 2026-10-08 (pi sessions for H15/P1/E91, then filing tasks 1127–1131). Two failures recurred:

1. Freshly filed tasks needed several `task update` round-trips before `task check --as todo` passed. The causes were bold R-items (`- **R1 Foo.**`), missing `ac_altitude`/`ac_numbering: task-local` frontmatter, and AC bullet/Scenario mixing.
2. A batch `/sp:dev-runall --feature H1 --auto` aborted in its strict preflight on `L4.verifying-incomplete-tasks`. The cause was that `task create --feature H1` accepted a parent in `verifying` (and earlier, H15 in `done`) without a guard. The operator had to reopen the feature by hand.

**Already fixed directly. Do not redo:**
- R-item regex consistency:
  - `packages/app/src/services/structural-repair.ts:107` now detects and repairs bold R-items without a checkbox.
  - `packages/app/src/services/task-check.ts:819` coverage parser now binds `**R1**` forms, consistent with the format check at `task-check.ts:768`.
  - Regression tests: `packages/app/tests/services/structural-repair.test.ts` ("reports and repairs bold R-items…") and `packages/app/tests/services/task-check.test.ts` ("bold R-items bind like plain ones…").
- The runall strict preflight now treats `L4.verifying-incomplete-tasks` as reported-not-aborting, like `L4.scenario-unverified`. The change is in runbook prose at `plugins/sp/skills/spur-dev/references/execution-batch.md:82-105`, `plugins/sp/skills/spur-dev/references/dev-operations.md` §13 and `plugins/sp/commands/dev-runall.md`. That exemption is prose only; this task makes the behavior structural.

**Current code facts:**
- `task create` (`packages/app/src/services/task-service.ts:718`) does not read the parent feature's status.
- `task check` flags only `done`/`cancelled` parents for live tasks (`L4.feature-terminal`, `task-check.ts:1124-1139`).
- `feature-check.ts:703-722` emits `L4.verifying-incomplete-tasks`: a warning before `done`, an error at `done`.
- `task check --fix` (`apps/cli/src/commands/task.ts:1551`) and `feature check --fix` (`apps/cli/src/commands/feature.ts:414`) repair structure only:
  - heading level, order and presence;
  - the R-item checkbox;
  - `structural-repair.ts:31` repair kinds.
- The pipeline precheck runs `$spurBin task check $wbs --precheck` fail-closed with no `--fix` (`config/workflows/task-pipeline.yaml:1043-1056`).
- `task update --section` writes through `TaskService.updateSection` (`task-service.ts:1245`) and does no format normalization.

**Goal.** A task is filed clean the first time, and an `--auto` batch never aborts or blocks on a mechanical, losslessly repairable finding. Semantic findings still stop the affected task, not the whole batch.

### Requirements

- [x] R1. Write-time normalization: `task update --section` and `task batch-create` normalize these lossless format variants before writing:
  - in Requirements, `R1:`, `R1 -`, `**R1**`, `**R1.**` and missing checkbox forms become `- [ ] R1. …`, with the R-number and text unchanged;
  - in Acceptance Criteria, bare `- AC1 …` bullets become `- [ ] AC1 — …`;
  - when every AC is a gherkin `Scenario:` carrying `(req: Rn)`, the frontmatter `ac_altitude: task-local` and `ac_numbering: task-local` are set automatically.

  Each normalization is reported in the command's `--json` result (`normalized: [{section, kind, count}]`). Content is never reworded.
- [x] R2. Parent-status link guard: `task create --feature` and `task update --feature`:
  - reject a `done` or `cancelled` parent with a structured error that names up to three `active` siblings under the same parent group;
  - automatically reopen a `verifying` parent to `active` through the existing guarded feature transition, reporting `{featureReopened: {id, from: "verifying", to: "active"}}` in `--json`.

  A `--no-reopen` flag keeps today's behavior. Adding the flag needs operator consent under the public-surface rule (AGENTS.md § Spur CLI surface); if consent is withheld, the reopen is unconditional and the flag is dropped.
- [x] R3. `feature check --fix` reopens a `verifying` or `done` feature to `active` when it has linked live tasks (`backlog|todo|wip|testing|blocked`), and reports it as repair kind `feature-reopen`. With no live tasks it is a no-op.
- [x] R4. Auto-fix-first gates:
  - the pipeline precheck (`config/workflows/task-pipeline.yaml:1052`) runs `task check $wbs --fix` before `--precheck`;
  - the runall feature preflight runs `feature check <id> --fix` before `--strict`;
  - the `L4.scenario-unverified` and `L4.verifying-incomplete-tasks` exemptions are applied in code, as a structured `nonAborting` classification in the preflight result, not only in runbook prose.

  Repairs are recorded in the batch report under `autoRepairs`.
- [x] R5. Under `--auto`, a task whose precheck still fails on semantic (non-repairable) findings after `--fix` gets one `/sp:dev-refineall --auto` refinement pass. If it still fails, it is marked skipped with its findings in the batch report, and independent tasks continue. The batch does not abort. Without `--auto`, today's halt behavior is unchanged.
- [x] R6. Same-change docs: update `docs/design/` for the task create/update surface (including the R2 flag decision) and `plugins/sp/skills/spur-dev/references/execution-batch.md` (replacing the prose-only exemption with a pointer to the code classification), then rebuild the bundle with `bun run --filter @gobing-ai/spur build:bundle`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Section writes normalize lossless format variants (req: R1)
  Given a Requirements file containing "- **R1 Lock.** text", "R2: text" and "- R3 - text"
  And an Acceptance Criteria file whose every item is a Scenario with "(req: Rn)"
  When "spur task update <wbs> --section Requirements --from-file <f> --json" and the same for Acceptance Criteria run
  Then the stored lines read "- [ ] R1. Lock. text", "- [ ] R2. text" and "- [ ] R3. text" with the original wording
  And the frontmatter has "ac_altitude: task-local" and "ac_numbering: task-local"
  And the JSON result lists each normalization in "normalized"
  And "spur task check <wbs> --as todo" reports zero errors
```

```gherkin
Scenario: AC2 — A terminal parent is rejected with active-sibling suggestions (req: R2)
  Given feature X is "done" and sibling feature Y under the same group is "active"
  When "spur task create 'probe' --feature X --json" runs
  Then it exits nonzero with a structured error naming X's status and suggesting Y
  And no task file is written
```

```gherkin
Scenario: AC3 — A verifying parent is reopened on link (req: R2)
  Given feature X is "verifying"
  When "spur task create 'probe' --feature X --json" runs
  Then the task is created and X is "active"
  And the JSON result contains "featureReopened" with from "verifying" and to "active"
```

```gherkin
Scenario: AC4 — feature check --fix reopens a feature with live tasks (req: R3)
  Given feature X is "verifying" with one linked "todo" task
  When "spur feature check X --fix --json" runs
  Then X is "active" and the repairs list a "feature-reopen" entry
  And with no live tasks the same command leaves X unchanged
```

```gherkin
Scenario: AC5 — Gates repair before they check and exempt expected states in code (req: R4)
  Given a todo task whose only finding is a missing R-item checkbox, under a "verifying" feature
  When "/sp:dev-runall --feature <id> --auto" starts
  Then the preflight does not abort, and its result classifies "L4.verifying-incomplete-tasks" as nonAborting
  And the precheck passes after "--fix" repairs the checkbox
  And the batch report lists both repairs under "autoRepairs"
```

```gherkin
Scenario: AC6 — Semantic precheck failures skip one task, not the batch, under --auto (req: R5)
  Given a batch of two independent todo tasks where task A has an unrepairable semantic finding
  When the batch runs with "--auto"
  Then task A gets one refine pass and is then reported as skipped with its findings
  And task B still runs to its own verdict
  And without "--auto" the batch halts on task A as today
```

```gherkin
Scenario: AC7 — Owning docs and bundle reflect the new behavior (req: R6)
  Given the implementation is complete
  When "bun run spur-check" and "bun run --filter @gobing-ai/spur build:bundle" run
  Then both pass, the design satellite documents R1–R3, and execution-batch.md points to the code classification
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **Normalization lives in one place.** Add a pure `normalizeTaskSection(name, body)` beside `structural-repair.ts`, reusing its R-item regexes so detection, repair and coverage cannot drift again. Call it from `TaskService.updateSection` (`task-service.ts:1245`) and from the batch-create render path. Keep it lossless: it rewrites only markers and numbering punctuation, never words.
- **Link guard in the service, not the CLI.** Put it in `TaskService.create` (`task-service.ts:718`) and in the `--feature` update path, so HTTP writers get the same guard (F21 scope: shared services). Perform the reopen through the existing feature transition service, not a raw frontmatter write.
- **Preflight classification is data.** Replace the runbook-prose exemption with a `NON_ABORTING_PREFLIGHT_CODES` set in code. The preflight result separates `aborting` from `nonAborting` findings, and the runbook only cites it.
- **Boundaries.** Do not touch feature-check severities (`feature-check.ts:703-722` stays a warning before `done`). No corpus-wide sweep (F21 out-of-scope); repairs happen only on write or within a running gate.
- **Public surface.** `--no-reopen` is the only new flag candidate (R2). Get operator consent before adding it.

### Plan

1. Write the failure inventory first: lossy normalization, a reopen of the wrong feature, reopen on a cancelled feature, a guard bypass via HTTP, `--fix` masking a semantic finding, and a refine loop running more than once.
2. Write E2E-style CLI tests for AC1–AC4 against a temp corpus (`--folder`); they must fail before implementation.
3. Implement R1 (normalizer + call sites), then R2 (service guard + reopen), then R3 (the `feature-reopen` repair kind).
4. Implement R4 (precheck/preflight `--fix` and code classification) and R5 (`--auto` refine-once and skip) in the batch driver and `task-pipeline.yaml`. Rebuild the bundle.
5. Update the docs (R6), then run `bun run spur-check` and record the evidence in Testing.

### Solution

**R1 — write-time normalization.** New pure module `packages/app/src/services/task-section-normalizer.ts:1`
(`normalizeTaskSection` + `normalizeRequirementLine` + `isGherkinOnlyAc`); it shares the R-item predicate with
`packages/app/src/services/structural-repair.ts:110` (`REQUIREMENT_LINE_RE` is the detection fallback) and
applies the same "already checkboxed → byte-untouched" skip, so detection, repair and normalization cannot
drift. Wired at both write seams: `packages/app/src/services/task-service.ts:1379` (`updateSection` normalizes,
reports `normalized: [{section, kind, count}]`, then merges the implied `ac_altitude`/`ac_numbering` through
`updateFrontmatter`) and `packages/app/src/services/task-service.ts:650` (`batchCreate` normalizes
Requirements/AC bodies, applies the implied `ac_altitude`/`ac_numbering` frontmatter, and reports per item).
Result fields live on `WriteResult` at `packages/app/src/services/planning-write-service.ts:172`.

**R2 — parent-status link guard.** `packages/app/src/services/task-service.ts:185` adds
`ParentFeatureStatusError` and `packages/app/src/services/task-service.ts:803` adds `guardParentFeature`:
a `done`/`cancelled` parent is rejected with its status plus up to three `active` siblings, a `verifying`
parent is reopened to `active` through the `featureTransition` port (the FEATURE lifecycle profile — the task
write service's own FSM declares no `verifying` state) and reported as `featureReopened: {id, from, to}`.
It runs in the service layer before any write — `packages/app/src/services/task-service.ts:869` (`create`,
inside the create lock after the dedupe refusal) and `packages/app/src/services/task-service.ts:1046`
(`updateField`, the `feature_id` re-point path) — so HTTP writers inherit it. The features dir is resolved by
`featuresDirFor` / `TaskServiceContext.featuresDir` (`packages/app/src/services/task-service.ts:212`,
`packages/app/src/services/task-service.ts:748`). The consented public flag `--no-reopen` is registered at
`apps/cli/src/commands/task.ts:189` (create) and `apps/cli/src/commands/task.ts:474` (update), threaded at
`apps/cli/src/commands/task.ts:237` and `apps/cli/src/commands/task.ts:588`, and the port is wired at
`apps/cli/src/commands/task.ts:1980` (FEATURE lifecycle profile) with structured `--json` errors emitted at
`apps/cli/src/commands/task.ts:345` and `apps/cli/src/commands/task.ts:782`.

**R3 — `feature check --fix` reopen.** `packages/app/src/services/feature-check.ts:212` adds the
`transitionPort` option and `packages/app/src/services/feature-check.ts:238` performs the reopen of a
`verifying`/`done` feature that still has linked live tasks (`backlog|todo|wip|testing|blocked`), pushing
repair kind `feature-reopen` (the union member added at `packages/app/src/services/structural-repair.ts:32`);
with no live tasks it is a no-op. `apps/cli/src/commands/feature.ts:477` wires the port to the feature
transition under `--fix`. Feature-check severities are untouched (`L4.verifying-incomplete-tasks` stays a
warning before `done`).

**R4 — auto-fix-first gates.** The pipeline precheck guard runs
`task check $wbs --fix --json > .spur/run/$wbs-auto-repairs.json` before `task check $wbs --precheck`
(`config/workflows/task-pipeline.yaml:1056`). The feature preflight runs `--fix` before `--strict`
(`plugins/sp/skills/spur-dev/references/execution-batch.md:88`), and the previous prose exemption is now code:
`NON_ABORTING_PREFLIGHT_CODES` with `classifyFeaturePreflightFindings` in
`plugins/sp/scripts/batch-preflight.ts:33`, exposed as `--classify-feature`
(`plugins/sp/scripts/batch-preflight.ts:451`). The contract is pinned by
`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1113`.

**R5 — semantic precheck failure under `--auto`.** One `/sp:dev-refineall --auto` pass, then the task is
reported `skipped` with its findings while independents continue; without `--auto` the halt behavior is
unchanged (`plugins/sp/skills/spur-dev/references/execution-batch.md:120`, driver loop
`plugins/sp/skills/spur-dev/references/execution-batch.md:274`), pinned at
`plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1137`.

**R6 — docs, help and bundle.** `docs/design/task-creation-readiness.md:118` documents R1/R2/R3 including the
`--no-reopen` consent decision; `docs/design/planning-record-contracts.md:37`, `:39` and `:110` carry the flag
rows and the normalization/guard/reopen contracts; `docs/help/cmd_task.md:43`, `docs/help2/task.md:42` and
`plugins/sp/skills/spur-cli/references/tasks.md:41` document the flag on both verbs; the runbook points at the
code classification instead of restating it
(`plugins/sp/skills/spur-dev/references/execution-batch.md:90`). Bundle regenerated with
`bun run --filter @gobing-ai/spur build:bundle` and `bun run build:scripts` (staged `apps/cli/config` +
`plugins/sp/scripts/batch-preflight.mjs`; `plugins/sp/lib/inline-run.generated.mjs` also caught up with the
earlier workflow-trace source change).

**Test fixture repair (pre-existing).** `apps/cli/tests/commands/task.test.ts:2165` seeded a loose
`R1. …` requirement; R1 now normalizes that to an open `- [ ] R1. …`, and an open box is an L3 error at
`--as done` (0800 R1), which masked the test's actual subject. The fixture now seeds `- [x] R1. …` — the same
isolation the file already applies to its AC box. Verified the test failed identically at base `1d9c84ec9`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-section-normalizer.ts:126` `normalizeTaskSection`; wired into section writes at `packages/app/src/services/task-service.ts:1432` and create at `:659`, `:670`. Executed this run: `(cd packages/app && bun test ...task-section-normalizer... task-service...)` -> 204 pass / 0 fail; lossless variants `packages/app/tests/task-section-normalizer.test.ts:54`, `:75`, `:84`. |
| R2 | MET | Terminal-parent error class `packages/app/src/services/task-service.ts:188-202` (carries `activeSiblings`); `guardParentFeature` at `:803`; create/update paths call it at `:935` and surface `featureReopened` (`:916`). Executed: `packages/app/tests/task-section-normalizer.test.ts:182` (AC2), `:199` (AC3); `apps/server/tests/task-service-parent-guard.test.ts:49` -> 1 pass / 0 fail, now spying the server's feature service (`:109` asserts exactly one `F2 -> active` transition; mutation probe on `context.ts` wiring fails it); `apps/cli/tests/commands/task.test.ts:4286` (create AND update emit `{ok:false,error:{code:'parent-feature-status',featureId,status}}` under plain `--json`, update path fixed at `apps/cli/src/commands/task.ts:785`, create at `:346`) -> task.test.ts 205 pass / 0 fail. |
| R3 | MET | `packages/app/src/services/feature-check.ts:209` reopen callback under `--fix`, repair kind `feature-reopen` at `:288`; `packages/app/src/services/structural-repair.ts:31`. Executed: `packages/app/tests/task-section-normalizer.test.ts:375`, `:425` (AC4) pass in the 204-test run. |
| R4 | MET | `config/workflows/task-pipeline.yaml:1056` runs `task check $wbs --fix --json > .spur/run/$wbs-auto-repairs.json` before `--precheck`; `plugins/sp/scripts/batch-preflight.ts:33` `NON_ABORTING_PREFLIGHT_CODES`, `:52` `classifyFeaturePreflightFindings`, `:451`; runbook points at the code at `plugins/sp/skills/spur-dev/references/execution-batch.md:104-108`. Executed: `plugins/sp/tests/batch-preflight.test.ts:334` pass; pins `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1128`, `:1141` (own 1132 describe at `:1122`) pass. |
| R5 | MET | Rule at `plugins/sp/skills/spur-dev/references/execution-batch.md:137-146` (one `--auto` refine pass, then skipped, batch does not abort; non-auto unchanged halt) and driver-loop branch `:291`. Pin `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1152` passes and now asserts `(exactly one — never` (`:1157`), which a two-pass rewording breaks. Evidence class: static contract pin over agent-interpreted runbook prose (no executable batch interpreter exists) — hence Confidence MEDIUM. |
| R6 | MET | `docs/design/task-creation-readiness.md:105` (1132 section; `--no-reopen` decision `:136-138`); `docs/design/planning-record-contracts.md:37`; `docs/help/cmd_task.md:44`, `:133`; `docs/help2/task.md:37`, `:43`; `plugins/sp/skills/spur-cli/references/tasks.md:41`, `:74`. Bundle: `apps/cli/config` regenerated by `build:bundle` this run and the CLI plugin mirror diff is clean. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Section writes normalize lossless format variants (req: R1) | MET | test | `packages/app/tests/task-section-normalizer.test.ts:54`, `:75`, `:84`, `:206`, `:237`. Executed this run: 204 pass / 0 fail. |
| Scenario: AC2 — A terminal parent is rejected with active-sibling suggestions (req: R2) | MET | test | `packages/app/tests/task-section-normalizer.test.ts:182`; `apps/server/tests/task-service-parent-guard.test.ts:49`. Executed this run: pass. |
| Scenario: AC3 — A verifying parent is reopened on link (req: R2) | MET | test | `packages/app/tests/task-section-normalizer.test.ts:199`. Executed this run: pass. |
| Scenario: AC4 — feature check --fix reopens a feature with live tasks (req: R3) | MET | test | `packages/app/tests/task-section-normalizer.test.ts:375`, `:425`; repair kind at `packages/app/src/services/feature-check.ts:288`. Executed this run: pass. |
| Scenario: AC5 — Gates repair before they check and exempt expected states in code (req: R4) | MET | test | `plugins/sp/tests/batch-preflight.test.ts:334`; `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1128`, `:1141`; `config/workflows/task-pipeline.yaml:1056`. Executed this run: pass. |
| Scenario: AC6 — Semantic precheck failures skip one task, not the batch, under --auto (req: R5) | MET | test | Pin `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1152` (`:1157` exactly-one assertion) over `plugins/sp/skills/spur-dev/references/execution-batch.md:137-146` and `:291`. Executed this run: pass (the file's 2 failures are the pre-existing sandbox WT-4 `mktemp` cases, unrelated). Static pin, not an executed two-task batch. |
| Scenario: AC7 — Owning docs and bundle reflect the new behavior (req: R6) | MET | command | Re-read the R6 doc anchors this run; `build:bundle` executed and `diff -rq plugins/sp apps/cli/plugins/sp` identical; `script-contract-check` 0 violations; `link-check` OK. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Status | Note | Evidence |
| --- | --- | --- | --- |
| P1 | DONE | **Guard resolves the configured features dir, never a basename heuristic.** Carried from pass 5: `find packages docs apps -type f -newer` the pass-5 review artifact returns nothing but the one changed test file, so the probed source is byte-identical. Pass-5 probe used a `docs/tasksP` + `docs/features` layout and the guard fired in both directions. | `packages/app/src/services/task-service.ts:212,763`; `apps/cli/src/commands/task.ts:1968-1988`; `apps/server/src/context.ts:496`; probe `/tmp/1132rev5-GsRc9m` |
| P2 | DONE | **An existing checkbox is never flipped** (Requirements and AC). Carried from pass 5 (source unchanged): `- [x] R5. already checked` landed byte-identical (od-verified); only bare items gained a box. | `packages/app/src/services/task-section-normalizer.ts:62,136`; probe `0001_probe-alpha.md` |
| P3 | DONE | **Losslessness** — no stray asterisk, separator consumed once. Carried from pass 5 (source unchanged): `- **R1** Lock. text` → `- [ ] R1. Lock. text` (no `*`); `- R2: -1 degree handling` → `- [ ] R2. -1 degree handling`; `R4--` byte-untouched. | `packages/app/src/services/task-section-normalizer.ts:67,81`; probe (od -c of the written section) |
| P3 | DONE | **Checker-flagged shapes normalize** via the shared regex detection fallback. Carried from pass 4/5 on unchanged source: `- R1`, `R2`, `- R3**` → `- [ ] R1.` / `- [ ] R2.` / `- [ ] R3.`, reported count 3. | `packages/app/src/services/task-section-normalizer.ts:94`; `packages/app/src/services/structural-repair.ts:110` |
| P3 | DONE | **Idempotence** — re-writing an already-normalized body reports no `normalized` key and rewrites nothing. Carried from pass 5 (source unchanged). | probe: second `task update 0001 --section Requirements` → payload has no `normalized` |
| P3 | DONE | **`batch-create` reports AND applies** the implied frontmatter per item. Carried from pass 4/5 (source unchanged). | `packages/app/src/services/task-service.ts:650-676,704`; `apps/cli/src/commands/task.ts:1201-1208`; probe `0004_gherkin-ac-batch.md` |
| P3 | DONE | **Design-satellite claim accurate** — the shared regex is the detection fallback, the normalizer grammar a deliberate superset. Read, source unchanged. | `docs/design/task-creation-readiness.md:105-127`; `packages/app/src/services/task-section-normalizer.ts:10,94` |
| P2 | DONE | **R2's reopen uses a FEATURE-profile port.** Carried from pass 5 (source unchanged): CLI E2E gave `task create --feature F5(verifying)` → exit 0, `featureReopened {id:F5,from:verifying,to:active}`, F5 reads `active`; the same on `task update`; `--no-reopen` writes the task and leaves the parent untouched; a `done` parent → exit 1 `parent-feature-status` with active siblings named and zero files written. | `apps/cli/src/commands/task.ts:1985-2005`; `packages/app/src/services/task-service.ts:314,803,935,1049`; `apps/server/src/context.ts:500`; probes `/tmp/1132rev5-GsRc9m` |
| P4 | DONE | **Dedupe refusal cannot leave a parent reopened.** Carried from pass 4/5 (source unchanged). | `packages/app/src/services/task-service.ts:931-935` |
| P4 | DONE | **Two-phase batch ordering** — batch `[verifying, done]` → exit 1 naming the terminal parent, verifying parent untouched, no writes; locked by a regression test. Carried (source unchanged). | `packages/app/src/services/task-service.ts:1999-2015`; `packages/app/tests/services/task-section-normalizer.test.ts:238` |
| P4 | DONE | **Precheck repairs before it checks; SSOT and bundled workflow identical — now pinned.** Ran `diff -q config/workflows/task-pipeline.yaml apps/cli/config/workflows/task-pipeline.yaml` → identical. The ordering also has a behavioural half, re-run this cycle: `(cd plugins/sp && bun test tests/inline-pipeline-driver.test.ts)` → **4 pass / 0 fail**, and that suite interprets the real task-pipeline graph. | `config/workflows/task-pipeline.yaml:1056`; `plugins/sp/tests/inline-pipeline-driver.test.ts:399-405`; `diff -q` → identical |
| P4 | DONE | **Non-aborting classification is data.** Re-ran both halves on this digest: `(cd plugins/sp && bun test tests/batch-preflight.test.ts)` → **30 pass / 0 fail**; `bun plugins/sp/scripts/batch-preflight.ts --classify-feature` → `shouldAbort:false` exit 0 for the two exempt L4 codes, `shouldAbort:true` exit 1 with a real `L3` error alongside them. | `plugins/sp/scripts/batch-preflight.ts:33,52,451`; CLI probe (both exit codes observed this cycle) |
| P4 | DONE | **R3 `feature check --fix` reopen** works for `verifying` (repairs `feature-reopen`) and for `done` parents with linked live tasks, and is a no-op with no live tasks. Carried from pass 4/5 (source unchanged). | `packages/app/src/services/feature-check.ts:236-291`; `apps/cli/src/commands/feature.ts:470-481` |
| P4 | DONE | **Guard mechanics hold and the AC7 fixture repair is retained**; AC1's loop is closed (`task check` after normalization passes with no findings). Carried; fixture line unchanged in this tree. | `apps/cli/tests/commands/task.test.ts:2165` |
| P4 | DONE | **Formerly OPEN (pass 4) — the stray corpus artifact is gone.** `apps/server/docs` does not exist, `git status --short` has no entry, and no `server-reopen-probe` file exists. Untracked files are only this task's deliverables (3 files, all source/test). | `git status --short` → no `apps/server/docs`; `ls apps/server/docs` → No such file or directory; `find . -name 'server-reopen-probe*'` → empty |
| P4 | DONE | **Gate RE-RUN on THIS digest, and the 3 new pins demonstrably ran.** `.spur/run/1132-test-gate.status` = PASS, log records **10589 pass / 0 fail, 44438 expect() calls, 622 files** — exactly `10586 + 3` versus the pass-5/verify run, i.e. the new pins are inside the green count. Also 1313 files lint-clean, 50 pre-check + 2 post-check rules. Recomputing the fingerprint myself returns `sha256:fc21cf12…`, equal to `.spur/run/1132-proof-digest.txt` and to the single `proof-digest:` line in the log (no earlier digest survives in that file). | `.spur/run/1132-test-gate.status`; `.spur/run/1132-test-gate.log:443-449`; `bun plugins/sp/scripts/inline-run-setup.ts --fingerprint …` → `sha256:fc21cf12…` |
| P4 | DONE | **NEW — the R4 precheck pin is discriminating.** The ordering it asserts is derived from the file body, not a constant: I re-evaluated the pin's own predicates against mutated text and the order assertion flipped `true` → `false` when `--fix` and `--precheck` were swapped, and `false` again when the capture path was renamed. The pin also fails if the `- from: precheck` anchor disappears (the slice collapses and both `indexOf` calls return -1). | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1113-1124`; probe: swapped order → `base:false`; renamed capture → `base:false` |
| P4 | DONE | **NEW — the R4 feature-preflight pin is discriminating.** Same method: deleting `NON_ABORTING_PREFLIGHT_CODES` from the runbook flips the assertion `false`; removing either `feature check <id> --fix --json` or the `--strict` line makes `indexOf` return -1 and the ordering assertion `false`. This is the pin that enforces "the exemption lives in code, not in prose". | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1126-1135`; `plugins/sp/skills/spur-dev/references/execution-batch.md:82,83,90`; probe: constant removed → `codes:false` |
| P4 | DONE | **NEW — the R5/AC6 pin is discriminating and closes the verify finding.** The verify stage reported PARTIAL because no pin asserted the refine-once-then-skip rule (the file carried 54 sibling SPEC pins and gained none for 1132 R5). Deleting the whole R5 clause from the runbook flips 5 of the pin's 7 assertions to `false`; deleting the driver-loop line at `:274` flips its assertion to `false`. Each pinned string is unique to one intended location (5 of 7 occur exactly once in the file). | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1137-1150`; `plugins/sp/skills/spur-dev/references/execution-batch.md:120-127,274`; probe: R5 clause deleted → `[false,false,true,false,false,false,true]`; driver line deleted → `false` |
| P4 | OPEN | **NEW — one assertion inside the R5 pin is non-discriminating on its own.** `expect(SPEC).toContain('exactly one')` is satisfied by unrelated prose (`…require exactly one survivor across the tiers`), so deleting the R5 bound alone leaves that assertion `true`. The pin still fails overall via the unique phrases, so this is assertion hygiene, not a gate hole. | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1143`; `plugins/sp/skills/spur-dev/references/execution-batch.md:125` vs `:868`; probe: R5 clause deleted → element 3 stays `true` |
| P4 | OPEN | **NEW — the 1132 pins sit inside the sibling task-1121 `describe` block.** Every other task in this file gets its own `describe`; the three new tests are nested under `execution-batch spec contract (task 1121 — WT-4d invoking-tree relink)`. Purely organizational: names are unique, the count is 57, and nothing depends on the block label. | `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1063` (describe) vs `:1108-1150` (1132 pins) |
| P4 | OPEN | **The server-context passthrough test is non-discriminating (a test that would pass without the fix).** Carried from pass 4/5, source unchanged: the pre-fix wiring (no `featuresDir`, no `featureTransition`) yields the same `reopened={"id":"F2","from":"verifying","to":"active"}` payload (`calls=[]`) as the post-fix wiring. AC3 itself is independently proven by the CLI E2E above, so this is test strength only, not a functional gap. | `apps/server/tests/task-service-parent-guard.test.ts:46-96`; probe `/tmp/1132rev4-fallback-probe.ts` → pre-fix `calls=[]` vs post-fix `calls=[["F2","active"]]` |
| P4 | OPEN | **Residual risk I could not discharge.** (i) R5's `--auto` refine-once/skip is now **static-pinned** (row above) but still prose-driven — the pin can only fail if the prose changes, and AC5's full `/sp:dev-runall` orchestration remains unexecutable here; (ii) the HTTP reopen rides the server's lifecycle-less write service (SchemaLifecyclePort), so R2's guarded transition is CLI-strength only; (iii) `feature check --fix` without a `transitionPort` falls back to a raw frontmatter write; (iv) a gherkin-only AC write reports `kind: ac-altitude` on every write even when both keys are already set (content idempotent, report not); (v) `task update --feature` in raw `--json` mode emits prose on stderr while `task create` emits a structured `ok:false` payload; (vi) a Requirements-shaped line inside a fenced code block is still normalized. Items (iii)-(vi) carried on mtime-unchanged source. | `plugins/sp/skills/spur-dev/references/execution-batch.md:120-127,274`; `apps/server/src/context.ts:473-500`; `packages/app/src/services/feature-check.ts:282-285`; `apps/cli/src/commands/task.ts:782` vs `:345`; probe `/tmp/1132rev5-fence.md` → `- [ ] R2. documented syntax example inside a fence` |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-08T19:12:28.393Z backlog → todo (system)
- 2026-10-09T00:01:45.671Z todo → wip (system)
- 2026-10-09T04:04:22.453Z wip → testing (system)
- 2026-10-09T04:05:32.481Z testing → done (system)

