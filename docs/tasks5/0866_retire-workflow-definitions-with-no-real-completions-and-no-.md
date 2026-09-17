---
schema_version: 1
name: Retire workflow definitions with no real completions and no live caller
status: done
template: feature-impl
created_at: 2026-09-16T10:45:25.220Z
updated_at: "2026-09-17T17:20:01.037Z"
feature_id: D62
priority: P1
tags:
  - workflow
  - retirement
  - adr-076

---

## 0866. Retire workflow definitions with no real completions and no live caller

### Background

config/workflows/ holds 11 definitions. Measured on 2026-09-16 from .spur/spur.db, `basic` (31 runs, 0 done) and `feature-dev` (22 runs, 0 done) record no completion ever; their only recent activity is a single failed sweep on 2026-09-13T06:07 shared with `docs-pipeline`. `docs-pipeline` has exactly one `done`, from 2026-07-04, but is referenced by ADR-071's proof chain and holds a config/pipeline-budgets.json entry, so it is evaluated rather than assumed. Critically, `task-lifecycle` (564 runs) and `feature-lifecycle` (136 runs) must NOT be retired: they are externally driven status FSMs invoked by requestTransition from `spur task` / `spur feature`, and their zero action_runs rows reflect the trace gap closed by task R4, not absent traffic.

### Requirements

- [x] R1. Retire every definition that records zero runs reaching `done` in the retention window AND has no invoking command, skill, agent, script, or config outside tests and documentation.
- [x] R2. Refuse retirement for a definition with real traffic, including one driven by requestTransition rather than auto-run actions; report the run count and most recent run that kept it. Absence of action_runs rows is never evidence of absent traffic.
- [x] R3. Remove each retired definition's config/pipeline-budgets.json entry in the same change.
- [x] R4. Update docs/design/workflow-composition-contract.md's target inventory dispositions for every definition whose status changes.

### Acceptance Criteria

```gherkin
Feature: Workflow execution economy: contract-first stages, inline traceability, and graph retirement

  @core
  Scenario: R1 — Workflow definitions with no real completions and no live caller are retired
    Given a workflow definition that records zero runs reaching a "done" status within the retention window
    And no command, skill, agent, script, or config outside tests and documentation invokes it
    When the retirement change lands
    Then the definition is removed from config/workflows/
    And its config/pipeline-budgets.json entry is removed with it
    And "spur workflow list" returns only the retained definitions

  @core
  Scenario: R2 — Retirement is refused for an externally driven definition with real traffic
    Given a workflow definition that records runs but no action_runs rows because it is driven by requestTransition rather than by auto-run actions
    When retirement is evaluated for that definition
    Then the definition is retained
    And the evaluation reports the run count and most recent run that kept it
    And absence of action_runs rows is not treated as absence of traffic
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

The discriminator is `zero real completions AND no live caller`, not `zero action_runs`. Evaluate each of the 11 definitions against both halves and record the verdict per definition in the task's evidence, including the run counts that justify a retention. Retire by deletion (constitution: delete, don't layer) rather than by deprecation shim — nothing calls these, so no shim has a consumer. `docs-pipeline` gets an explicit evaluated verdict either way; if retained, record what keeps it.

### Plan

1. Query .spur/spur.db for runs, done-count and last-run per workflow_name; record the table.
2. For each candidate, grep for invoking references excluding tests, docs corpus and CHANGELOG.
3. Produce the per-definition verdict table (retire / retain + reason).
4. Delete retired YAML files and their pipeline-budgets entries.
5. Update the workflow-composition-contract inventory dispositions.
6. Run spur workflow list and the project gate; confirm no dangling reference.

### Solution

Retirement set: `basic`, `docs-pipeline`, `feature-dev` — the three definitions that meet **both**
halves of R1 (zero real completions **and** no invoking surface outside tests/documentation).
`pr-review` meets the first half only (live spine caller) and `wayfinder-resolution` meets neither
(one real completion), so both are retained, as are the two lifecycle FSMs R2 protects.

#### Evidence — per-definition verdict (all 11)

Source: `.spur/spur.db` of the repository's main tree, read 2026-09-16 (`runs` joined to
`metadata_json.dryRun`). "Non-dry" is the decisive column: every recent row for the retired three is
a dry probe from a shared 2026-09-13 sweep, which is what made an `action_runs`-only reading
conclude "zero traffic". **Discriminator used: zero completions in the whole retained run history —
strictly stronger than the AC's "within the retention window" (`workflow.logRetentionDays`, default
30 d), so the verdict does not depend on where the window edge falls.**

| Definition | runs | non-dry | real `done` | last non-dry run | invoking surface outside tests + docs | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| `basic` | 31 | **0** | **0** | — | none (`surface-drift-inventory` probe repointed in this change) | **RETIRE** |
| `docs-pipeline` | 23 | **0** | **0** | — | none — the `/sp:dev-run --mode implement` caller declared at `plugins/sp/README.md:630` was never wired | **RETIRE** |
| `feature-dev` | 22 | **0** | **0** | — | `package.json:73` `features` script (removed in this change) | **RETIRE** |
| `task-pipeline` | 275 | 220 | 34 | 2026-09-15 | `/sp:dev-run`, `/sp:dev-runall`, `bun run tasks` | RETAIN |
| `task-lifecycle` | 564 | 545 | 40 | 2026-09-16 | `requestTransition` from `spur task` (`packages/app/src/workflow/lifecycle-adapter.ts:47`) | RETAIN (R2) |
| `feature-lifecycle` | 136 | 118 | 29 | 2026-09-15 | `requestTransition` from `spur feature` (`packages/app/src/workflow/lifecycle-adapter.ts:54`) | RETAIN (R2) |
| `wrapup-pipeline` | 99 | 60 | 35 | 2026-09-15 | `/sp:dev-wrap`, `/sp:dev-wrapall`, `config/proportional-route-table.ts:55` | RETAIN |
| `idea-pipeline` | 76 | 53 | 13 | 2026-09-16 | `/sp:dev-idea`, `/sp:dev-plan`, `packages/app/src/workflow/idea-handoff.ts:220` | RETAIN |
| `history-anatomy` | 59 | 46 | 7 | 2026-09-15 | daily job at `config/config.example.yaml:60`, `sp:history-anatomy` | RETAIN |
| `wayfinder-resolution` | 28 | 6 | 1 (2026-07-19) | 2026-07-19 | operator free-form (`spur workflow run`), documented at `plugins/sp/README.md:631` | RETAIN |
| `pr-review` | 21 | 1 | 0 | 2026-08-16 | `plugins/sp/scripts/pr-reviewing.ts` is the spine SSOT behind `/sp:dev-pr-review` | RETAIN (caller half fails) |

R2 report for the two protected FSMs: `task-lifecycle` 545 non-dry runs / 40 real `done`, most
recent `done` 2026-09-16T00:30:15Z; `feature-lifecycle` 118 non-dry runs / 29 real `done`, most
recent `done` 2026-09-15T06:34:48Z. Their zero `action_runs` is correct for a pure status FSM driven
by `requestTransition` — never read as absent traffic.

#### `docs-pipeline` — the explicitly evaluated case

Weighed and rejected as keepers: (a) the ADR-071 digest-bound proof chain — its docs half is two
definition-contract test files, i.e. tests, which R1 excludes from the caller test, and the shipped
*mechanism* (`done-transition-guard`) is covered by the retained `task-pipeline` half;
(b) the `config/pipeline-budgets.json` entry — R3 says remove it with the definition, so it cannot be
a keeper; (c) the "docs-only task" procedure — real, but it runs through
`/sp:dev-run --mode implement` + `spur task record` on `task-pipeline.yaml`, not through this graph.
Verdict: **retire**.

#### Change map

- Deleted definitions: `config/workflows/basic.yaml`, `config/workflows/docs-pipeline.yaml`,
  `config/workflows/feature-dev.yaml` (R1).
- `.github/workflows/publish.yml:64` — the post-bundle asset assertion repointed
  `- basic.yaml` → `+ task-pipeline.yaml` (verify-stage remediation: the assertion must name a
  surviving bundled workflow).
- `config/pipeline-budgets.json:31-48`, `:56-60`, `:70-75` — the three budget entries removed (R3);
  the gate now reports `check-pipeline-budgets: PASS (6 pipelines, 0 violations)`.
- `docs/design/workflow-composition-contract.md:3` (Status: the docs half of the ADR-071 chain
  retired with its subject) and `:15-17` + retained-definition rows (R4 inventory dispositions).
- `package.json` — the `features` script (the only non-test/non-doc invoker of
  `feature-dev.yaml`) removed; its former line `:73` no longer exists, so this entry names the
  removal without a surviving anchor; `:61` dropped the `feature-dev-precheck` conversion from
  `build:scripts`.
- `config/plugin-scripts.json` — the `feature-dev-precheck` standard-script entry (its former line
  `:30` no longer exists, so this entry names the removal without a surviving anchor) removed with the
  script; `plugins/sp/scripts/feature-dev-precheck.ts` + `.mjs` deleted (its stated purpose was to
  port `feature-dev.yaml`'s precheck shell one-for-one, so the retirement leaves it no consumer).
- `plugins/sp/scripts/surface-drift-inventory.ts:641` — the hard-coded `workflow validate basic.yaml`
  JSON probe repointed to `task-pipeline.yaml`; the generic `sweepWorkflows` walk needs no change.
  One of two invocation-surface edits — the other is the `.github/workflows/publish.yml:64` repoint
  above.
- `packages/app/src/services/done-transition-guard.ts:5-9`, `:16-18` — comments updated: the
  `--no-lifecycle` caller and the measured-verdict example no longer name a live deleted file.
- `scripts/commands/real-run-cost.ts:25-27` — cohort size 11 → 8.
- Fixture/dependent updates that keep the retained tests honest:
  `apps/cli/tests/commands/init.test.ts:132`, `packages/config/tests/bundled-config.test.ts:26`
  (seed + bundled-asset expectations), `packages/app/tests/workflow/workflow-resolver.test.ts:216`,
  `:496` and `packages/app/tests/services/workflow-service.test.ts:3322` (bundled-layer fixture
  repointed to `wrapup-pipeline`), `packages/app/tests/workflow/wrapup-pipeline.test.ts:124-133`
  (dropped the `feature-dev` version pin), `plugins/sp/tests/inline-pipeline-parity-check.test.ts:18`
  (catalogue count 11 → 8).
- Retired with their subject (definition-contract tests, no source coverage):
  `packages/app/tests/workflow/basic-workflow.test.ts` (0771 soft-probe contract),
  `docs-pipeline-proof-chain.test.ts` (0760/0785), `docs-pipeline-measured-verdict.test.ts`
  (0704/0769), `feature-dev-definition.test.ts` (0604 R5/0782), and
  `plugins/sp/tests/feature-dev-precheck.test.ts`.

#### Accepted losses and deferred items (not silently dropped)

- Coverage retired with the subjects: the 0771 compound-command soft-probe contract (its only carrier
  was `basic.yaml`'s `check` state) and the docs-side proof-bracket/measured-verdict contracts. Both
  are definition-content contracts; no `packages/**/src` line loses coverage.
- Stale **documentation** references to the retired definitions remain and are deliberately out of
  this change's scope (R1 excludes documentation; R4 names one file): `plugins/sp/README.md:623-631`,
  `plugins/sp/skills/spur-dev/references/cross-cutting.md` (workflow inventory table),
  `docs/inventory/d8-0731-workflow-fit-classification.md`, `docs/help/**`, `docs/design/essential-workflow-checks.md`,
  `plugins/sp/skills/spur-dev/references/gate-checklists.md`, plus trailing comments in retained
  definitions (`config/workflows/idea-pipeline.yaml:6`, `pr-review.yaml:4,8`,
  `wayfinder-resolution.yaml:48`) — left untouched on purpose because editing a retained definition
  changes its `definitionDigest`.
- `spur workflow list` on this machine still shows the three names from the **registered** layer
  (`/Users/robin/node_modules/@gobing-ai/spur/config/workflows`, the installed 0.3.85 build). The
  repo-owned layers (`shared` + `project`) return exactly the 8 retained definitions; the installed
  copy clears at the next publish/bundle rebuild.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both halves re-derived this stage, independently of the recorded table. (a) Zero real completions: fresh read of the main tree DB `/Users/robin/xprojects/spur-new/.spur/spur.db` (`runs` grouped by `workflow_name`, split on `metadata_json.dryRun`) gives `basic` 31 runs / 0 non-dry / 0 `done` ever, `docs-pipeline` 23 / 0 / 0 real `done` (its single `done` row is 2026-07-04T23:03:35.115Z with `dryRun: 1`, so it is not a real completion), `feature-dev` 22 / 0 / 0; the most recent rows of all three are the shared 2026-09-13T06:07 dry sweep. Retained definitions keep real traffic in the same read: `task-pipeline` 275 / 220 non-dry / 34 real `done`, `task-lifecycle` 564 / 545 / 40, `feature-lifecycle` 136 / 118 / 29, `wrapup-pipeline` 99 / 60 / 35, `idea-pipeline` 76 / 53 / 13, `history-anatomy` 60 / 47 / 7, `wayfinder-resolution` 28 / 6 / 1, `pr-review` 21 / 1 / 0 (caller half). (b) No live caller: `config/workflows/basic.yaml`, `config/workflows/docs-pipeline.yaml`, `config/workflows/feature-dev.yaml` are gone (`ls` -> `No such file or directory`; 3 tracked deletions) and `config/workflows/` holds exactly the 8 retained definitions; the `features` script is removed from `package.json` (its neighbours survive at `package.json:72`), the `feature-dev-precheck` entry is gone from `config/plugin-scripts.json` and its carriers `plugins/sp/scripts/feature-dev-precheck.ts` + `.mjs` are deleted together, `package.json:61` (`build:scripts`) no longer converts it, the release asset assertion is repointed at `.github/workflows/publish.yml:64`, the inventory probe is repointed at `plugins/sp/scripts/surface-drift-inventory.ts:641`, and a repo-wide sweep for the three names outside tests and documentation returns only comments and skill/README reference prose (`scripts/commands/real-run-cost.ts:26`, `packages/app/src/services/done-transition-guard.ts:7`, `config/workflows/pr-review.yaml:4`). Executable carrier checks: `bun run inline-pipeline-parity-check` -> `ok (9 actions, 2 guards agree across 8 workflows)`; `bun plugins/sp/scripts/script-contract-check.ts` -> `23 script(s) baselined (11 standard, 12 repo-only), 0 violation(s) — PASS` (no orphan left by the deleted script pair). |
| R2 | MET | Both protected FSMs are retained with the count and most recent run that kept them, re-derived this stage: `task-lifecycle` 564 runs / 545 non-dry / 40 real `done`, most recent `done` 2026-09-16T00:30:15.846Z (all 40 `done` rows are non-dry); `feature-lifecycle` 136 / 118 / 29, most recent `done` 2026-09-15T06:34:48.114Z (all 29 non-dry). Their zero `action_runs` is treated as the `requestTransition` trace gap (ADR-117), never as absent traffic, and the externally driven callers are named at `packages/app/src/workflow/lifecycle-adapter.ts:47` (`task-lifecycle`) and `packages/app/src/workflow/lifecycle-adapter.ts:55` (`feature-lifecycle`). A caller-half-only definition is also refused retirement in the recorded verdict: `pr-review` 21 runs / 1 non-dry / 0 `done`, kept behind `plugins/sp/scripts/pr-reviewing.ts` (spine SSOT of `/sp:dev-pr-review`), and `wayfinder-resolution` with its single real `done` (2026-07-19T23:29:17.748Z). |
| R3 | MET | `config/pipeline-budgets.json:5` retains exactly 6 entries (`task-pipeline`, `idea-pipeline`, `wrapup-pipeline`, `pr-review`, `history-anatomy`, `wayfinder-resolution`) and carries none for `basic`, `docs-pipeline` or `feature-dev`; the removals are in the same 25-file diff as the definition deletions. Fresh gate run this stage: `bun scripts/commands/pipeline-budgets.ts` -> `check-pipeline-budgets: PASS (6 pipelines, 0 violations)`. |
| R4 | MET | `docs/design/workflow-composition-contract.md` carries an updated disposition for every definition whose status changed: `:4` re-scopes Status after the docs half of the ADR-071 chain retired with its subject; `:15`, `:16`, `:17` mark `docs-pipeline`, `feature-dev`, `basic` as deleted 2026-09-16 with the retirement reason and, for `docs-pipeline`, the evaluated keep/reject argument; every retained definition whose status is asserted carries a measured note with counts — `:19` `pr-review` (caller half), `:21` `wayfinder-resolution`, `:22` `task-lifecycle` 545/40, `:23` `feature-lifecycle` 118/29 — and the discriminator is stated with it. Every count matches this stage's independent DB read. One incidental clause inside the `feature-dev` row overstates a side effect; the disposition itself is correct (see Notes). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Workflow definitions with no real completions and no live caller are retired | MET | command | `ls config/workflows/` -> exactly 8 retained definitions, and `config/workflows/basic.yaml`, `docs-pipeline.yaml`, `feature-dev.yaml` all report `No such file or directory` (3 tracked deletions in the 25-file diff). Removal from the catalogue: `SPUR_SKIP_GLOBAL_CONFIG=true bun apps/cli/src/index.ts workflow list --json` -> `total 8, bySource {shared: 8}`, retired names absent, names `pr-review, task-lifecycle, wayfinder-resolution, feature-lifecycle, idea-pipeline, history-anatomy, task-pipeline, wrapup-pipeline`; the deployed-bundle path agrees — `bun scripts/spur-dev.ts bundle-config /tmp/v0866-verify-bundle` emits those 8 files and no `basic.yaml`, so the release assertion `test -f apps/cli/config/workflows/task-pipeline.yaml` at `.github/workflows/publish.yml:64` under `set -euo pipefail` is satisfiable (the pass-1 blocker). Budget entries: `bun scripts/commands/pipeline-budgets.ts` -> `check-pipeline-budgets: PASS (6 pipelines, 0 violations)`, with no entry for the retired three in `config/pipeline-budgets.json`. Completion and caller halves re-derived from `/Users/robin/xprojects/spur-new/.spur/spur.db` (see R1); the retained catalogue is additionally pinned executably by `plugins/sp/tests/inline-pipeline-parity-check.test.ts:22` and `packages/config/tests/bundled-config.test.ts:26`. Caveat, not a diff defect: the plain `bun apps/cli/src/index.ts workflow list --json` on this machine prints 19 entries (11 `registered` + 8 `shared`) because the operator's global `~/.config/spur/config.yaml:283` registers the separately installed `@gobing-ai/spur@0.3.85` workflow folder as `workflows.paths`; the repo-owned layer is exactly the retained 8 (see Notes). |
| Scenario: R2 — Retirement is refused for an externally driven definition with real traffic | MET | command | Fresh DB read over `/Users/robin/xprojects/spur-new/.spur/spur.db` reports the run count and the most recent keeping run for both `requestTransition`-driven FSMs — `task-lifecycle` 564 runs / 545 non-dry / 40 real `done`, most recent `done` 2026-09-16T00:30:15.846Z; `feature-lifecycle` 136 / 118 / 29, most recent `done` 2026-09-15T06:34:48.114Z — and both definitions remain present in `config/workflows/` with the retention note and the count recorded at `docs/design/workflow-composition-contract.md:22`, `:23`. Zero `action_runs` is explicitly not read as absent traffic; the external drivers are cited at `packages/app/src/workflow/lifecycle-adapter.ts:47` and `:55`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 0866 (pass 2, fresh evidence chain)

**Scope:** worktree diff vs base `750cc5c4c` — 25 files, +201/−2932 (3 workflow definitions deleted, 5 definition-contract tests deleted with their subjects, fixtures repointed, 5 source/config/CI touch-ups including `.github/workflows/publish.yml:64`)
**Dimensions:** functional traceability, security, efficiency, correctness, usability, architecture
**Verdict:** PASS — 0 P1, 0 P2, 5 P3 (minor), 2 P4 (advisory); no finding blocks the P1/P2 gate
**Re-entry context:** pass 2 of the review state (0703 R4 re-entry). The pass-1 defect — `.github/workflows/publish.yml:64` still asserting the deleted `basic.yaml` after `build:bundle` — is **resolved** in the reviewed diff (operator-consented one-line repoint to `task-pipeline.yaml`), both prior PARTIAL verify findings were re-checked against the current tree, and one new finding (#3) covers the file the remediation added.
**Independence:** reviewer session is separate from implement; implementation context reached this stage only via the persisted task spec, the recorded diff and run artifacts.

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P3 (minor) | correctness | The `feature-dev` retirement row asserts that the "`integration-review` defect record" was retired with the definition. It was not. The defect register still carries both entries as live, unannotated S1 defects against a file that no longer exists (§F rows 1–2, §I item 2), and the fit-classification inventory still records `feature-dev`/`docs-pipeline`/`basic` as classified graphs. Row 1's underlying defect (`command.gate` forwarding `timeoutMs` under the wrong key) is genuine and **unaffected** by this retirement — `command-gate.ts:157` is untouched — so the false clause reads as "a live S1 defect was closed here". Fix by dropping the clause or annotating the register rows with the 0866 retirement reference. | `docs/design/workflow-composition-contract.md:16` vs `docs/inventory/d8-0729-workflow-contract-inventory.md:99`, `:100`, `:135`; `docs/inventory/d8-0731-workflow-fit-classification.md:46`, `:69`, `:95` |
| 2 | P3 (minor) | functional | R1's third clause ("`spur workflow list` returns only the retained definitions") is still not observable on this machine: `workflow list --json` prints **19 entries — 11 `registered` + 8 `shared`** — and the three retired names (`basic`, `docs-pipeline`, `feature-dev`) come from the `registered` layer (`/Users/robin/node_modules/@gobing-ai/spur/config/workflows`, the globally installed 0.3.85 tarball) shadowing the repo layer in the declared `project → registered → shared` order. The repo-owned `shared` layer returns exactly the 8 retained definitions and `inline-pipeline-parity-check` asserts 8 deterministically, so the discrepancy is environmental, not a defect in this diff. Verify must cite the repo-layer count/parity check, not the raw list; a fresh `bun run build:bundle` + install clears the shadow. | `/Users/robin/node_modules/@gobing-ai/spur/config/workflows/` (registered, 11 files) vs `config/workflows/` (8 files); `spur workflow list --json` → `{total: 19, bySource: {registered: 11, shared: 8}}` |
| 3 | P3 (minor) | correctness | **New this pass.** The reviewed diff is 25 files, but the Solution's change map still describes 24 and never mentions `.github/workflows/publish.yml:64`, the file the verify-stage remediation repointed. The task's own evidence therefore understates its own change, and the `basic` row still presents the `surface-drift-inventory` probe as the retirement's only invocation-surface edit. Fix in the `record` stage (`--solution-from-diff` backfill) or by hand: add the publish.yml repoint to the change map with its reason (post-bundle asset assertion must name a surviving bundled workflow). Not a gate failure — no checker compares the map to the diff. | `.github/workflows/publish.yml:64` (`- basic.yaml` → `+ task-pipeline.yaml`) vs `docs/tasks5/0866_…md` §Solution / §Change map |
| 4 | P3 (minor) | correctness | Two Solution change-map anchors resolve against lines this same change deleted, so they no longer name their subject: `package.json:73` (the removed `features` script) and `config/plugin-scripts.json:30` (the removed `feature-dev-precheck` entry). `spur task check 0866 --json` emits 5 `L4.anchor-subject-mismatch` warnings for `## Solution` — these two plus three from the checker's subject heuristic firing on otherwise valid citations (`workflow-composition-contract.md:3`, `done-transition-guard.ts:5-9`). The check still reports `pass: true`, so this is wording, not a gate failure. Reword to name the removal without a surviving line number. | `spur task check 0866 --json` → `L4.anchor-subject-mismatch` × 5, all in `## Solution`; `package.json`, `config/plugin-scripts.json` |
| 5 | P3 (minor) | usability | Agent-facing documentation still advertises the retired definitions together with their never-wired callers: the plugin README workflow table (`/sp:dev-runall --feature` → `feature-dev.yaml`; `/sp:dev-run --mode implement` → `docs-pipeline.yaml`; `basic.yaml` as the generic example), the `spur-dev` inventory table and cross-cutting prose, the `spur-cli` workflow reference, and two checklists. R1 scopes the caller test to "outside tests and documentation" and the Solution declares the omission deliberately, so this is **not** non-compliance — but these are exactly the surfaces an agent reads before choosing an invocation path, and leaving them stale re-seeds the phantom-caller belief R1 exists to remove. Same file, migration rows D5-J/D5-P still name retired carriers. The retained definitions' own trailing comments (`config/workflows/pr-review.yaml:4,8`, `idea-pipeline.yaml:6`) were correctly left alone: editing a definition changes its `definitionDigest`. Recommend a follow-up `sp:doc-evolve` sweep. | `plugins/sp/README.md:623,628,630`; `plugins/sp/skills/spur-dev/references/cross-cutting.md:576,577,590,695`; `plugins/sp/skills/spur-cli/references/workflows.md:65,362,403`; `plugins/sp/skills/spur-dev/references/gate-checklists.md:152`; `docs/design/essential-workflow-checks.md:125,126,140,145`; `docs/design/workflow-composition-contract.md:34,40` |
| 6 | P4 (advisory) | architecture | R2 is enforced by recorded evidence, not by a gate: nothing stops a future task from deleting a definition with real non-dry traffic if its author writes the wrong table. Every other cost/retirement invariant in this area is machine-checked (`check-pipeline-budgets` fails a silent budget raise; the composition baseline guards query counts). Consider a later `spur workflow` retirement guard that reads run history and refuses deletion of a definition with non-dry terminal runs absent a recorded decision — the data needed (`runs × metadata_json.dryRun`) is the column this task's table used. | `docs/tasks5/0866_…md` §Evidence (per-definition verdict table); `config/pipeline-budgets.json` |
| 7 | P4 (advisory) | functional | The discriminator applied — "zero completions in the whole retained run history" — is deliberately stricter than the AC's "within the retention window". The readings diverge for exactly one definition: `wayfinder-resolution`'s only real `done` is 2026-07-19, i.e. outside a 30-day window at 2026-09-16, so a literal window reading would also satisfy the first half and leave only the human-invocation argument to keep it. The choice errs toward retention (the safe direction) and is disclosed in the Solution; record it as the feature-level convention. | `docs/design/workflow-composition-contract.md:19,27`; `docs/tasks5/0866_…md` §Evidence |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/workflows/` holds exactly the 8 retained definitions (independently listed this stage). Run history re-derived this stage from the main tree's `/Users/robin/xprojects/spur-new/.spur/spur.db` (`runs` grouped by `workflow_name`, `metadata_json.dryRun` split): `basic` 31 runs / 0 non-dry / 0 real `done`; `docs-pipeline` 23 runs / 0 non-dry / 0 real `done` — its single `done` row (2026-07-04) carries `dryRun: 1`, so "zero **real** completions" is right even though a `done` row exists; `feature-dev` 22 runs / 0 non-dry / 0 real `done`. Caller half: no remaining non-test, non-doc invoking surface — `package.json` `features` script removed, `config/plugin-scripts.json` entry + `plugins/sp/scripts/feature-dev-precheck.{ts,mjs}` deleted together, `surface-drift-inventory` probe repointed (`bun apps/cli/src/index.ts workflow validate task-pipeline.yaml --json` → `{"ok":true,"valid":true}`, exit 0), and the CI asset assertion repointed. Third AC clause carries finding 2's environmental caveat. |
| R2 | MET | Both protected FSMs retained with the count and the most recent run that kept them, re-derived this stage: `task-lifecycle` 545 non-dry / 40 real `done`, most recent `done` 2026-09-16T00:30:15.846Z; `feature-lifecycle` 118 non-dry / 29 real `done`, most recent `done` 2026-09-15T06:34:48.114Z (both match the recorded `completed_at` values). Their zero `action_runs` is treated as the ADR-117 trace gap, never as absent traffic. The caller-half retention also holds for `pr-review` (21 runs / 1 non-dry / 0 `done`; `plugins/sp/scripts/pr-reviewing.ts` + `/sp:dev-pr-review` are the declared spine SSOT) and `wayfinder-resolution` (6 non-dry / 1 real `done`, 2026-07-19). |
| R3 | MET | `config/pipeline-budgets.json` drops exactly the `docs-pipeline`, `feature-dev` and `basic` entries in the same change (6 remain); re-run this stage: `bun scripts/commands/pipeline-budgets.ts` → `check-pipeline-budgets: PASS (6 pipelines, 0 violations)`. |
| R4 | MET | `docs/design/workflow-composition-contract.md` — Status line re-scoped to `task-pipeline`, the three retired rows carry `*(deleted 2026-09-16)*` with the retirement reason, and every retained definition whose status is asserted (`pr-review`, `history-anatomy`, `wayfinder-resolution`, `task-lifecycle`, `feature-lifecycle`) carries an explicit retention note with counts. Finding 1 corrects one inaccurate clause *inside* that edit; no disposition is missing. |

##### Acceptance criteria

| Scenario | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — definitions with no real completions and no live caller are retired | MET | executed + recorded | `config/workflows/` = 8 files; the three deletions, the budget removals and the inventory dispositions are in the reviewed diff; the DB re-read reproduces zero real completions for all three; the repo-owned layer returns exactly the 8 retained names (finding 2 records the global-install caveat on the raw `workflow list`) |
| R2 — retirement refused for an externally driven definition with real traffic | MET | recorded | Retention verdicts with run counts and most recent keeping run for `task-lifecycle` and `feature-lifecycle`, re-derived from `.spur/spur.db` this stage; absence of `action_runs` explicitly not read as absent traffic (ADR-117) |

##### Verification evidence (fresh this stage)

| Command | Result |
| --- | --- |
| `.spur/run/0866-test-gate.status` / `.log` (written 15:06:11Z, ~6 s before review entry) | `PASS`; `8313 pass / 0 fail`, `33912 expect() calls`, 470 files |
| `bun run script-contract-check` | `23 script(s) baselined (11 standard, 12 repo-only), 0 violation(s) — PASS` — the deleted `feature-dev-precheck` entry/script pair leaves no orphan |
| `bun run inline-pipeline-parity-check` | `ok (9 actions, 2 guards agree across 8 workflows)` |
| `bun scripts/commands/pipeline-budgets.ts` | `check-pipeline-budgets: PASS (6 pipelines, 0 violations)` |
| `bun apps/cli/src/index.ts workflow validate task-pipeline.yaml --json` | `{"ok":true,"valid":true,…}`, exit 0 — the repointed probe works |
| `bun scripts/spur-dev.ts bundle-config /tmp/v0866-review-bundle` | `Bundled config -> /tmp/v0866-review-bundle`; emitted workflows = the 8 retained names with **no** `basic.yaml` → the repointed `test -f apps/cli/config/workflows/task-pipeline.yaml` assertion under `set -euo pipefail` is satisfiable (pass-1 blocker resolved) |
| `bun apps/cli/src/index.ts workflow list --json` | `19` entries = `11 registered` (global install, includes the 3 retired) + `8 shared` (repo) → finding 2 |
| `bun apps/cli/src/index.ts task check 0866 --json` | `pass: true`; 5 `L4.anchor-subject-mismatch` **warnings**, all in `## Solution` (finding 4); no Review-section finding |
| `.spur/spur.db` cross-check of all 11 definitions | every retired/retained verdict's run, non-dry and completion counts reproduce |
| `git status --porcelain` / `git diff --cached --name-only` | same 25-entry set as the pre-review snapshot; nothing staged |

##### Coverage / honest-loss audit

- The four deleted definition-contract tests parse their YAML and assert shell/guard text; `feature-dev-definition.test.ts` imported only the released `@gobing-ai/ts-dual-workflow-engine` plus a type-only `AgentService` import. No `packages/**/src` value symbol loses coverage, consistent with the gate run's repo-wide coverage line (`All files 99.18% lines / 99.01% functions`) staying green.
- The ADR-071 proof mechanism keeps its carrier: `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts` and `proof-input-fingerprint.test.ts` are retained; only the docs-pipeline instance retired with its subject.
- `done-transition-guard.ts` and `real-run-cost.ts` changes are comment-only; `real-run-cost`'s cohort was already derived by `readdir(config/workflows)`, so the comment now matches the code.
- Behavioural risk of the three deletions outside tests: none found — no non-test, non-doc runtime surface resolves a retired name (the residual mentions are the comment/doc surfaces in findings 1, 4 and 5).

##### Reviewer mutation statement

No source file was touched by this stage. The reviewed diff is the implement stage's diff plus the operator-consented publish.yml remediation; the only write this stage makes is the `## Review` section via `spur task update --section`, which the proof fingerprint excludes from the certified input set (`packages/app/src/workflow/proof-input-fingerprint.ts:311` scopes task content to Background/Requirements/Acceptance Criteria/Design/Plan).

**Next:** approve → `/sp:dev-verify 0866` (for R1's third clause cite the repo-layer catalogue / parity check, not the raw `workflow list`).

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-16T11:38:09.757Z todo → wip (system)
- 2026-09-16T15:22:25.498Z wip → testing (system)
- 2026-09-16T15:22:41.667Z testing → done (system)

