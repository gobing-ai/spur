---
template: meta
schema_version: 1
name: "Fix feature-E batch run lessons: Solution file:line first-write, feature Scope hygiene, gate-adjacent test coverage, release trigger verification, host cache-read growth"
description: ""
status: done
type: meta
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0508"]
ac_numbering: task-local
created_at: "2026-08-11T15:09:56.354Z"
updated_at: "2026-08-11T17:00:35.989Z"
---

## 0510. Fix feature-E batch run lessons: Solution file:line first-write, feature Scope hygiene, gate-adjacent test coverage, release trigger verification, host cache-read growth

### Background
The completed feature-E batch (tasks 0506–0508) exposed five reusable execution defects. Current-tree verification narrows each defect to an existing seam; no raw session or conversation log is required for implementation.

1. The Solution checker and implementation reference already require a `file:line` change map, but `TaskService.updateSection` still writes an invalid authored Solution and leaves the later lifecycle check to reject it.
2. `FeatureCheckService` already emits `L3.scope-delineation` when Scope lacks an In/Out split, but the finding is a warning and feature-scoped `dev-runall` does not run a strict feature check before freezing the batch. The late feature transition therefore becomes the first blocking check.
3. The targeted-test-first rule says to run narrow tests before one full project check, but it does not tell an implementer which downstream workspaces must typecheck/test when a shared domain or app type changes.
4. The ts-libs release script pushes the aggregate release tag and only prints a `gh run list` suggestion. Its Publish workflow already supports both aggregate-tag `push` and `workflow_dispatch`, so a missed push event can be recovered without deleting or re-pushing tags.
5. Task 0508 now dispatches eligible stages to native subagents, but the host batch procedure does not explicitly project `task show` and workflow-trace JSON to metadata. Loading full task bodies or trace output into the controller defeats that context isolation.

Task 0510 hardens those five existing seams. It changes no task-pipeline YAML, adds no command flag, and requires no new telemetry or session parser.
### Requirements
- [ ] R1. Reject an explicitly authored `Solution` body that lacks a recognized `file:line` citation before `TaskService.updateSection` writes the task file. Reuse the checker’s citation predicate so write-time and `task check` behavior cannot drift; preserve valid backticked citations and adjacent file/line table cells. The rejected write exits non-zero and leaves task content plus `updated_at` unchanged.
- [ ] R2. For an effective `feature:<id>` batch selector (including `--feature <id>` sugar), run source-local `spur feature check <id> --strict --json` once before task-list resolution and freezing. Abort before any task pipeline action when it fails, reporting its findings. Explicit/status/ready selectors remain unchanged, and the existing Scope finding severity remains unchanged globally.
- [ ] R3. Make targeted verification dependency-aware without running the full project check inside implementation. Freeze a changed-path matrix: domain changes run affected domain tests plus app/CLI consumer tests and domain/app/CLI typechecks; app changes run affected app plus CLI tests and app/CLI typechecks; CLI changes run affected CLI tests and CLI typecheck; shared plugin flag/command contract changes run their focused structure/parity tests. Run only applicable rows, then let the pipeline execute the single full project check.
- [ ] R4. In the ts-libs `bumpVersion(..., { push: true })` path, verify that the aggregate tag created a Publish workflow run before returning. Use a bounded `gh run list --workflow publish.yml --json ...` lookup matched to the aggregate tag; if no push run appears, dispatch `publish.yml` once with `--ref <aggregate-tag>` through its existing `workflow_dispatch` trigger and confirm that run exists. Fail loudly if neither run appears. Never delete, move, or re-push an existing tag as automatic recovery.
- [ ] R5. Keep batch-controller reads metadata-only. When execution-batch needs task status/dependencies/feature ID or workflow terminal state, project CLI JSON to those fields before it reaches the host context; do not ingest task `content`, Solution/Testing/Review bodies, or full workflow output on the green path. On failure, read only the bounded error/status evidence needed for the report. Preserve task 0508 native-subagent dispatch.

Non-goals: changing feature-check finding severities corpus-wide; adding a task/feature/agent flag; editing workflow YAML; re-running a stage or full suite to collect evidence already returned; numeric token/cost targets; raw session-log analysis; automatic remote-tag deletion/re-push; waiting for npm publication inside `bumpVersion`; or changing task 0508 dispatch semantics.
### Acceptance Criteria
Scenario: R1 — Invalid authored Solution is rejected before mutation
  Given a task file and a body-only Solution source with no recognized file:line citation
  When `spur task update <wbs> --section Solution --from-file <path> --json` runs
  Then it exits non-zero with `Solution must contain at least one file:line citation`
  And the task file content and updated_at are unchanged
  And a body with a backticked citation or adjacent file/line table cells still writes successfully

Scenario: R2 — Feature-scoped batches check the feature before resolving tasks
  Given an effective `feature:<id>` selector whose feature has an L3 Scope warning
  When `dev-runall` begins selector resolution
  Then it runs `spur feature check <id> --strict --json` exactly once
  And aborts with those findings before `spur task list` or any task pipeline action
  And an explicit WBS/status/ready selector does not add a feature check

Scenario: R3 — Targeted verification covers changed workspaces and consumers
  Given a change under domain, app, CLI, or a shared plugin command contract
  When the implement operation chooses targeted checks
  Then it applies only the matching changed-path matrix rows
  And includes the named downstream consumer tests and package typechecks
  And it does not run the full project check before the pipeline test action

Scenario: R4 — Release returns only after a Publish run exists
  Given ts-libs `bumpVersion` pushes the aggregate release tag
  When the matching push-triggered Publish run is visible
  Then the release reports that run ID/URL and returns without dispatching another run
  But when the bounded lookup finds no push run
  Then it dispatches `publish.yml` once with the aggregate tag ref and confirms the dispatched run
  And neither path deletes, moves, or re-pushes a tag

Scenario: R5 — The host batch loop consumes metadata, not task or trace bodies
  Given a batch resolves, orders, and observes tasks on the green path
  When it invokes task-show or workflow-trace JSON commands
  Then host-visible output is projected to status, dependencies, feature ID, run ID, and terminal state only
  And task content plus full workflow output are absent
  And failure reporting reads only bounded error evidence
### Q&A
**Q: Why is task 0510 linked to feature H instead of H1?**

A: H1 has a closed feature-level acceptance contract, and 0510’s task-local scenarios are not a subset of it. H is the grouping feature for the agent-facing `plugins/sp` and `sp:dev-*` layer; task-local scenarios are valid there. The ts-libs release check is an explicit upstream handoff inside this cross-cutting hardening task.

**Q: Why reject the Solution write instead of adding more implementation prose?**

A: The prose already exists in both `code-implementation/SKILL.md` and `implementation-patterns.md`, yet an invalid first write still landed. Reusing the existing checker predicate at `TaskService.updateSection` is the smallest deterministic fix and preserves one definition of a valid citation.

**Q: Why not make `L3.scope-delineation` an error everywhere?**

A: Many features are intentionally drafted before their Scope is complete. The defect is execution timing: a feature-scoped batch should not start with a known strict finding. A selector-local strict preflight catches it without changing unrelated feature authoring or corpus severity.

**Q: Why use a changed-path matrix instead of always running CLI tests and every typecheck?**

A: Always running all consumers recreates the full project check inside implementation. The matrix covers the known dependency direction—domain → app → CLI—while limiting work to affected tests and typechecks.

**Q: Why use workflow dispatch instead of deleting and re-pushing the aggregate tag?**

A: `.github/workflows/publish.yml` already declares `workflow_dispatch`, and the publish job is idempotent. Dispatching the existing tag ref preserves immutable release tags and is a safer recovery for a missed push event.

**Q: Does R4 wait until npm publication finishes?**

A: No. It proves a Publish run exists and reports its ID/URL. Watching completion and checking npm remain operator/release-consumer steps; this task removes the silent “no workflow run” state only.

**Q: What does R5 measure?**

A: A checkable procedure, not a token target: the controller’s command output excludes full task and trace bodies. Token/cost comparison may be collected later, but it is not required to implement or verify this task.

No open design decisions remain.
### Design
**R1 — validate authored Solution at the shared task-write seam**

- In `packages/app/src/services/task-check.ts`, export one `hasSolutionFileLineCitation(body)` helper that contains the current direct-citation and adjacent-table-cell logic; use it inside `TaskCheckService` so no rule is duplicated.
- In `packages/app/src/services/task-service.ts`, after stripping a leading section heading but before `writeService.updateSection`, reject `sectionName === 'Solution'` when the helper returns false. Explicit Solution updates must be complete; placeholder creation through task templates/`sections init` remains unchanged because it uses a different path.
- Use the existing checker message verbatim: `Solution must contain at least one file:line citation`. Do not update the file, timestamp, or history on rejection.
- Extend `packages/app/tests/services/task-service.test.ts` for rejection/no-mutation and both accepted citation shapes; extend `apps/cli/tests/commands/task.test.ts` for text/JSON non-zero behavior. Update the `spur task update` row in `docs/04_DESIGN.md` in the same Spur commit.

**R2 — strict feature preflight only for feature-derived batches**

- In `plugins/sp/skills/spur-dev/references/execution-batch.md` Step 1, normalize selector precedence first. If the effective selector is `feature:<id>`, run `bun run apps/cli/src/index.ts feature check <id> --strict --json` in this monorepo (installed projects use their resolved `spur` binary) before `task list`, freeze, dependency resolution, or worktree task execution.
- A failed check aborts the batch with verdict `aborted`, zero attempted tasks, and the structured feature findings. If explicit `--tasks` overrides `--feature`, no feature check runs because the effective selector is not feature-derived.
- Project the rule into `plugins/sp/commands/dev-runall.md` and `plugins/sp/skills/spur-dev/references/dev-operations.md`. Do not alter `FeatureCheckService`, `L3.scope-delineation` severity, `feature sync`, or batch-create.
- Extend `plugins/sp/tests/skill-structure.test.ts` with markers for strict check, pre-resolution ordering, abort shape, and non-feature exclusion.

**R3 — changed-path targeted-check matrix**

Add one table to `plugins/sp/skills/code-implementation/SKILL.md` and link it from `plugins/sp/skills/spur-dev/references/cross-cutting.md` targeted-test-first guidance:

| Changed surface | Required targeted tests | Required typechecks |
| --- | --- | --- |
| `packages/domain/src/**` public type/query | affected domain test; affected app service test; affected CLI command test | `@gobing-ai/spur-domain`, `@gobing-ai/spur-app`, `@gobing-ai/spur` |
| `packages/app/src/**` public service/type | affected app test; affected CLI command test | `@gobing-ai/spur-app`, `@gobing-ai/spur` |
| `apps/cli/src/**` | affected `apps/cli/tests/**` file | `@gobing-ai/spur` |
| shared plugin flag/command/reference | affected plugin structure/contract test; add `flag-contract-parity.test.ts` only when the shared flag surface changes | no package typecheck unless TypeScript also changed |

Use `bun run --filter <workspace> typecheck` for the listed workspaces. The matrix augments narrow behavior tests; it never authorizes `bun run spur-check`, `bun run test`, or another full project check inside implement. Extend the same `skill-structure.test.ts` block so the dependency direction and the “parity only for flag changes” limit cannot drift.

**R4 — bounded upstream Publish-run assurance**

- Upstream owner: `/Users/robin/xprojects/ts-libs/scripts/lib/release-commands.ts`; regression tests: `scripts/tests/release-commands.test.ts`; operator documentation: `docs/PACKAGE_RELEASE.md`.
- Add `ensurePublishWorkflowRun(aggregateTag, runner)` at the release-command seam. Production uses the existing command runner; tests inject deterministic command results. Query recent `publish.yml` runs as JSON and match `headBranch === aggregateTag` plus event `push` or `workflow_dispatch`.
- After the aggregate tag push, perform at most three list attempts with a fixed five-second interval. If no matching push run exists, execute exactly `gh workflow run publish.yml --ref <aggregateTag>` once, then perform one final lookup for the matching dispatched run. Return its database ID and URL; throw if absent or if `gh` fails.
- Do not edit `.github/workflows/publish.yml`: `workflow_dispatch` already exists. Do not call `dropTags`, delete remote refs, re-push tags, wait for job completion, or poll npm.
- Tests cover immediate push-run success, bounded lookup followed by one dispatch, final absence failure, malformed gh JSON, and no tag-mutation command. Run ts-libs script tests plus its required lint/test/build gates in that repository.

**R5 — metadata-only host controller**

- In `execution-batch.md`, require every controller-side `task show --json` to pipe/project only `{wbs,status,dependencies,feature_id}` and every green-path trace observation to project `{runId,status,terminalState}`. Raw `content`, section bodies, and workflow `output` remain stage/subagent data.
- On failure, request only the terminal error and a bounded tail/anchor set needed for the batch report; never stream or reread an entire trace merely to summarize status.
- Preserve task 0508’s sequential native-subagent dispatch and host fallback. This is prompt-runtime discipline; add structural assertions to `skill-structure.test.ts`, not a new cache, telemetry field, or parser.

**Cross-task contract:** task 0508 is the sole hard dependency and is already done; R5 preserves its dispatch contract. Tasks 0506/0507 supply completed batch context only and are not re-owned. R4 changes the upstream ts-libs repository and must be committed and validated there separately before the Spur-side commit is verified. No downstream WBS is declared.

**Traceability:** feature H is a grouping feature without feature-level scenarios; task-local R1–R5 acceptance criteria are authoritative.

**Anti-patterns:** no duplicate citation regex; no invalid-write-then-check loop; no global Scope severity change; no full project check inside implement; no unconditional parity suite; no workflow-file edit; no remote-tag mutation; no npm polling; no raw task/trace bodies in the host controller; no numeric cache-token threshold.
### Plan
- [ ] P1 (R1) Export/reuse the Solution citation predicate, reject invalid explicit Solution updates before mutation, add task-service/CLI regressions, and update `docs/04_DESIGN.md`.
- [ ] P2 (R2, R5) Add feature-derived strict preflight plus metadata-only host projections to execution-batch, project the operator contract into dev-runall/dev-operations, and extend plugin structure tests.
- [ ] P3 (R3) Add the changed-path targeted-check matrix to code-implementation, link it from targeted-test-first guidance, and pin the dependency direction/conditional parity rule in structure tests.
- [ ] P4 (R4) In `~/xprojects/ts-libs`, implement bounded Publish-run lookup plus one workflow-dispatch fallback, update release documentation, and run focused release-command tests and upstream completion gates. Do not mutate workflow YAML or existing tags.
- [ ] P5 (R1–R5) Run Spur focused tests first (`task-service`, task CLI, plugin structure), then the repository completion gates, task verification, and intentional status checks in both repositories. Do not inspect raw session/conversation logs or run a real release as test evidence.
### Solution
All five seams hardened. R1–R3/R5 land in the Spur monorepo; R4 is committed separately in the
upstream ts-libs repository (cross-task contract). No task-pipeline YAML, CLI flag, or workflow
file changed.

| File | Change |
| --- | --- |
| `packages/app/src/services/task-check.ts:265` | New exported `hasSolutionFileLineCitation(body)` — the single citation predicate (backticked `` `path:line` `` / bare `path.ext:line` / adjacent file+line table cells) extracted from the L3 checker. |
| `packages/app/src/services/task-check.ts:504` | L3 `solution-file-line` finding now calls the shared predicate; the direct-citation regex is no longer duplicated at check time. |
| `packages/app/src/services/task-service.ts:33,1115` | `updateSection` rejects an explicit `Solution` body without a citation **before** any write — throws `SectionMutationError('invalid-solution', 'Solution must contain at least one ` + '`file:line` citation')` (verbatim checker message), leaving content/`updated_at`/history untouched. |
| `packages/app/src/services/task-service.ts:115-118` | `SectionMutationError` code union extended with `invalid-solution` (stable exit-code mapping). |
| `apps/cli/src/commands/task.ts:480` | `task update` catch maps `SectionMutationError` → `[code] message` with exit 3 (validation), matching the `sections` command; generic errors stay exit 1. |
| `packages/app/tests/services/task-service.test.ts:933-985` | New describe: rejection (no mutation, error shape) + accepted backticked citation + accepted adjacent table cells + non-Solution writes unaffected. |
| `apps/cli/tests/commands/task.test.ts:437-458` | New CLI tests: text and `--json` modes exit 3 with the verbatim message; byte-identical file after rejection. |
| `apps/cli/tests/commands/task.test.ts:429,867,1920` | Existing Solution-body tests updated to carry citations; the two done-gate L3 regressions (P3 backstop + fallback gate) now plant the invalid Solution directly in the file since the CLI write seam rejects it. |
| `docs/04_DESIGN.md:985` | `spur task update` row documents the write-time Solution citation validation (task 0510 R1). |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:67-92` | R2: feature-derived strict preflight — effective `feature:<id>` selector runs `feature check <id> --strict --json` once, before task-list resolution/freeze; non-zero aborts with verdict `aborted` + structured findings; explicit/status/`ready` selectors add no check. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:323-352` | R5: metadata-only host controller — `task show --json` projects `{wbs,status,dependencies,feature_id}`, green-path trace projects `{runId,status,terminalState}`, failure reads stay bounded; task 0508 dispatch preserved. |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:747-748` | AC traceability rows for 0510 R2/R5. |
| `plugins/sp/commands/dev-runall.md:37` | Operator surface projects the feature-preflight rule (strict check once, abort shape). |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:291` | `runall` operation projects the same feature-preflight contract. |
| `plugins/sp/skills/code-implementation/SKILL.md:95-133` | R3: changed-path targeted-check matrix (domain → app → CLI dependency direction, workspace typechecks via `bun run --filter`, conditional `flag-contract-parity.test.ts`, never a full project check inside implement). |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:439` | Targeted-test-first guidance links the matrix and applies only matching rows before the single pipeline gate. |
| `plugins/sp/tests/skill-structure.test.ts:1256-1293` | Structural invariants pin R2 (strict preflight markers, pre-resolution ordering, abort shape, non-feature exclusion), R3 (matrix rows + parity limit), R5 (metadata projections + bounded failure reads). |
| `~/xprojects/ts-libs/scripts/lib/release-commands.ts` (commit `3642eca`) | R4: `ensurePublishWorkflowRun(aggregateTag, spawn?, sleep?)` — bounded `gh run list` lookup (3 × 5s) matching `headBranch === aggregateTag` + `push`/`workflow_dispatch`; one `workflow_dispatch` fallback at the immutable tag ref; final lookup; returns run ID/URL or throws. `bumpVersion` push path calls it; `git`/`mustGit`/`dropTags` accept an injectable spawn. |
| `~/xprojects/ts-libs/scripts/tests/release-commands.test.ts` (commit `3642eca`) | 21 tests: immediate push-run, bounded+dispatch, final-absence, malformed JSON, gh failure, no-tag-mutation on any path, plus full `bumpVersion`/`dropTags`/`publishPackages` coverage via `mock.module` workspace/npm seams and scripted spawn. |
| `~/xprojects/ts-libs/scripts/tests/release.test.ts` (commit `3642eca`) | Push-arg tests moved here (real module, un-mocked). |
| `~/xprojects/ts-libs/docs/PACKAGE_RELEASE.md` (commit `3642eca`) | Verify section documents the run-assurance + dispatch-fallback behavior; troubleshooting row updated. |

Deferred: none. All five requirements implemented; R4 validated and committed upstream first per
the cross-task contract.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/task-service.ts:1114` rejects `Solution` bodies without a citation before `writeService.updateSection`; shared predicate `packages/app/src/services/task-check.ts:265` reused by the L3 checker at `packages/app/src/services/task-check.ts:504`; CLI exit mapping `apps/cli/src/commands/task.ts:480`. Tests: `packages/app/tests/services/task-service.test.ts:933` (rejection, no mutation, error shape), `apps/cli/tests/commands/task.test.ts:437` (text + `--json` exit 3, byte-identical file). Ran: `bun test packages/app/tests/services/task-service.test.ts --test-name-pattern "Solution file:line"` → 4 pass; `bun test apps/cli/tests/commands/task.test.ts` → 148 pass. |
| R2 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:67` feature-derived strict preflight (`feature check <id> --strict --json`, once, before task-list resolution, abort verdict `aborted` + findings, non-feature exclusion); projected in `plugins/sp/commands/dev-runall.md:37` and `plugins/sp/skills/spur-dev/references/dev-operations.md:291`. Structure markers: `plugins/sp/tests/skill-structure.test.ts:1256-1280`. Ran: `bun test plugins/sp/tests/skill-structure.test.ts --test-name-pattern "0510"` → 3 pass. |
| R3 | MET | Changed-path matrix `plugins/sp/skills/code-implementation/SKILL.md:95` (domain → app → CLI rows, workspace typechecks, conditional `flag-contract-parity.test.ts`, never a full project check); linked from targeted-test-first guidance `plugins/sp/skills/spur-dev/references/cross-cutting.md:439`; parity-limit pinned `plugins/sp/tests/skill-structure.test.ts:1282`. Ran: structure tests 3 pass (above). |
| R4 | MET | Upstream commit `3642eca` in `~/xprojects/ts-libs`: `ensurePublishWorkflowRun` in `scripts/lib/release-commands.ts` (bounded 3×5s lookup matching `headBranch === tag` + `push`/`workflow_dispatch`, one dispatch fallback at the immutable tag ref, final lookup, throw on absence/gh failure; no tag mutation); `bumpVersion` push path wires it; `git`/`mustGit`/`dropTags` accept injectable spawn. Tests: `scripts/tests/release-commands.test.ts` → 21 pass. Gates: `bun run lint` exit 0, `bun run test` exit 0 (1925 pass; `release-commands.ts` 96.00% funcs / 97.49% lines — above the per-file 90% gate), `bun run build` exit 0. Docs: `docs/PACKAGE_RELEASE.md`. |
| R5 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:323` metadata-only controller (task-show projection `{wbs,status,dependencies,feature_id}`, trace projection `{runId,status,terminalState}`, bounded failure reads, task 0508 dispatch preserved); projections applied at Step 1 / 2.3 / 3.1; AC rows `plugins/sp/skills/spur-dev/references/execution-batch.md:747-748`; structure markers `plugins/sp/tests/skill-structure.test.ts:1285`. Ran: structure tests 3 pass (above). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Invalid authored Solution rejected before mutation | MET | test | `packages/app/tests/services/task-service.test.ts:933` (rejects, content+updated_at unchanged, error shape), `apps/cli/tests/commands/task.test.ts:437,455` (text + `--json` exit 3, byte-identical); accepted citation shapes at `task-service.test.ts:953,967` (backtick + adjacent table cells). Ran this run, 4 + 148 pass. |
| Scenario: R2 — Feature-scoped batches check the feature before resolving tasks | MET | test | `plugins/sp/tests/skill-structure.test.ts:1256-1280` pins the preflight contract (strict check once, before task list, abort shape, non-feature exclusion) in `plugins/sp/skills/spur-dev/references/execution-batch.md:67` and the operator projections. Ran this run, 3 pass. |
| Scenario: R3 — Targeted verification covers changed workspaces and consumers | MET | test | `plugins/sp/tests/skill-structure.test.ts:1282` pins the matrix rows (dependency direction, downstream consumer tests, `bun run --filter <workspace> typecheck`, parity-only-for-flag-changes) in `plugins/sp/skills/code-implementation/SKILL.md:95`. Ran this run, 3 pass. |
| Scenario: R4 — Release returns only after a Publish run exists | MET | test | `~/xprojects/ts-libs/scripts/tests/release-commands.test.ts` — 21 tests covering immediate push-run success, bounded lookup + exactly one dispatch, final-absence failure, malformed JSON, gh failure, and no tag-mutation on any path (incl. via `bumpVersion` push path and `dropTags`). Ran this run, 21 pass; upstream gates lint/test/build exit 0. |
| Scenario: R5 — The host batch loop consumes metadata, not task or trace bodies | MET | test | `plugins/sp/tests/skill-structure.test.ts:1285` pins the metadata-only projections and bounded-failure rule in `plugins/sp/skills/spur-dev/references/execution-batch.md:323`; task 0508 dispatch preservation asserted. Ran this run, 3 pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Architecture | `~/xprojects/ts-libs/scripts/lib/release-commands.ts:96-101` | Optional `spawn`/`sleep` params on `bumpVersion`/`dropTags`/`ensurePublishWorkflowRun` are test seams on public exports. Accepted: mirrors the existing `npmViewVersion(..., spawn?)` / `npmPublish(..., spawn?)` pattern in the same module and is backward-compatible (defaults to real `spawnSync`/`Bun.sleep`). |
| P4 | Correctness | `~/xprojects/ts-libs/scripts/lib/release-commands.ts:228-235` | The dispatch fallback performs one immediate final `gh run list`; GH Actions API eventual consistency can miss a just-queued run and throw. Documented, fail-loud failure mode (task Q&A: "throws if absent"); operator re-checks the Actions tab. No tag mutation occurs. |
| P4 | Efficiency | `plugins/sp/skills/spur-dev/references/execution-batch.md:323` | R5 (metadata-only controller) is prompt-runtime discipline, not machine-enforced; drift protection relies on the structure-test markers in `plugins/sp/tests/skill-structure.test.ts:1256`. Accepted per design — no new cache, telemetry field, or parser. |
| P4 | Correctness | `apps/cli/src/commands/task.ts:480-486` | `task update` catch now maps `SectionMutationError` to exit 3 (`[code] message`) instead of the generic exit 1. Verified by the new CLI tests asserting exit 3 for text and `--json` modes; generic errors still exit 1. |

**Disposition: PASS.** Functional traceability: R1 (write-seam rejection + shared predicate + service/CLI regressions + DESIGN row), R2 (feature-derived strict preflight + operator projections + structure markers), R3 (changed-path matrix + cross-cutting link + parity-limit marker), R4 (upstream ts-libs commit `3642eca`, 21 tests, lint/test/build gates green), R5 (metadata-only projections + bounded failure reads) — all MET with test evidence. SECUA: no P1–P3 findings; four P4 advisories documented above, none blocking. Architecture: the shared citation predicate, the release-command seam, and the selector-local preflight each land on existing seams with no engine/schema change (ADR-022 preserved). Residual risk: none material — the four P4 items are accepted tradeoffs recorded here rather than deferred work.
### References
- Dependency: task 0508 (`docs/tasks4/0508_fine-tune-inline-execution-surface-subagent-first-dispatch-f.md`)
- Solution checker: `packages/app/src/services/task-check.ts` (`L3.solution-file-line`)
- Task section write seam: `packages/app/src/services/task-service.ts` (`updateSection`)
- Task regressions: `packages/app/tests/services/task-service.test.ts`, `apps/cli/tests/commands/task.test.ts`
- Batch driver: `plugins/sp/skills/spur-dev/references/execution-batch.md`
- Operator projections: `plugins/sp/commands/dev-runall.md`, `plugins/sp/skills/spur-dev/references/dev-operations.md`
- Targeted verification: `plugins/sp/skills/code-implementation/SKILL.md`, `plugins/sp/skills/spur-dev/references/cross-cutting.md` § Targeted-test-first verification loop
- Plugin contract gate: `plugins/sp/tests/skill-structure.test.ts`
- Spur surface documentation: `docs/04_DESIGN.md` `spur task update` section
- Upstream release implementation: `/Users/robin/xprojects/ts-libs/scripts/lib/release-commands.ts`
- Upstream release tests/docs: `/Users/robin/xprojects/ts-libs/scripts/tests/release-commands.test.ts`, `/Users/robin/xprojects/ts-libs/docs/PACKAGE_RELEASE.md`
- Existing upstream trigger: `/Users/robin/xprojects/ts-libs/.github/workflows/publish.yml` (`push.tags` plus `workflow_dispatch`)
### History
- 2026-08-11T16:54:12.957Z backlog → wip (system)
- 2026-08-11T16:58:30.200Z wip → testing (system)
- 2026-08-11T17:00:35.989Z testing → done (system)
