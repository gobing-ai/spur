---
schema_version: 1
name: Write-time task normalization, parent-status link guard, and auto-fix-first batch preflight
status: todo
template: feature-impl
created_at: 2026-10-08T19:11:25.579Z
updated_at: "2026-10-08T19:12:28.393Z"
feature_id: F21

ac_numbering: task-local
ac_altitude: task-local
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

- [ ] R1. Write-time normalization: `task update --section` and `task batch-create` normalize these lossless format variants before writing:
  - in Requirements, `R1:`, `R1 -`, `**R1**`, `**R1.**` and missing checkbox forms become `- [ ] R1. …`, with the R-number and text unchanged;
  - in Acceptance Criteria, bare `- AC1 …` bullets become `- [ ] AC1 — …`;
  - when every AC is a gherkin `Scenario:` carrying `(req: Rn)`, the frontmatter `ac_altitude: task-local` and `ac_numbering: task-local` are set automatically.

  Each normalization is reported in the command's `--json` result (`normalized: [{section, kind, count}]`). Content is never reworded.
- [ ] R2. Parent-status link guard: `task create --feature` and `task update --feature`:
  - reject a `done` or `cancelled` parent with a structured error that names up to three `active` siblings under the same parent group;
  - automatically reopen a `verifying` parent to `active` through the existing guarded feature transition, reporting `{featureReopened: {id, from: "verifying", to: "active"}}` in `--json`.

  A `--no-reopen` flag keeps today's behavior. Adding the flag needs operator consent under the public-surface rule (AGENTS.md § Spur CLI surface); if consent is withheld, the reopen is unconditional and the flag is dropped.
- [ ] R3. `feature check --fix` reopens a `verifying` or `done` feature to `active` when it has linked live tasks (`backlog|todo|wip|testing|blocked`), and reports it as repair kind `feature-reopen`. With no live tasks it is a no-op.
- [ ] R4. Auto-fix-first gates:
  - the pipeline precheck (`config/workflows/task-pipeline.yaml:1052`) runs `task check $wbs --fix` before `--precheck`;
  - the runall feature preflight runs `feature check <id> --fix` before `--strict`;
  - the `L4.scenario-unverified` and `L4.verifying-incomplete-tasks` exemptions are applied in code, as a structured `nonAborting` classification in the preflight result, not only in runbook prose.

  Repairs are recorded in the batch report under `autoRepairs`.
- [ ] R5. Under `--auto`, a task whose precheck still fails on semantic (non-repairable) findings after `--fix` gets one `/sp:dev-refineall --auto` refinement pass. If it still fails, it is marked skipped with its findings in the batch report, and independent tasks continue. The batch does not abort. Without `--auto`, today's halt behavior is unchanged.
- [ ] R6. Same-change docs: update `docs/design/` for the task create/update surface (including the R2 flag decision) and `plugins/sp/skills/spur-dev/references/execution-batch.md` (replacing the prose-only exemption with a pointer to the code classification), then rebuild the bundle with `bun run --filter @gobing-ai/spur build:bundle`.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-08T19:12:28.393Z backlog → todo (system)

