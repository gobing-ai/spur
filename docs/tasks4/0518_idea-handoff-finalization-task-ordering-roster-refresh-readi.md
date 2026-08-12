---
template: feature-impl
schema_version: 1
name: "Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0515"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.890Z"
updated_at: "2026-08-12T01:57:57.575Z"
---

## 0518. Idea handoff finalization: task ordering, roster refresh, readiness-gated recommendation

### Background
Split from task 0515 (feature I2, decomposition 2026-08-11). This task owns the post-create finalization exposed by dogfood: encode decomposition order after atomic batch creation, refresh the feature's generated task roster, evaluate the newly created tasks, and generate a conditional handoff report. Task 0515 supplies the Goal/Scope and design-feedback contract; 0519 adds regression coverage.

Current-tree premises verified during ready refinement: `decompose` emits only `*-idea-task-batch.json`; `batch-create-run` currently invokes batch-create without `--json`; success transitions directly to a static runall note. Source-local `task batch-create --json` returns `{ created, wbs, parentsWired }`, with `wbs[]` in input-array order; `task deps <wbs> set ...`, `feature refresh --feature <id>`, and `task check <wbs> --json` already provide every deterministic seam required.

Implements feature I2 scenario R14. Ordering: after 0515, before 0519. No public CLI verb/flag, task-batch schema field, dependency, persistence, or transport is added.

Rubric: E3 D1 L1 C0 R0 = 5 → split; post-create mechanics remain separate from guidance and tests.
### Requirements
- [ ] R1. Decomposition always emits `.spur/run/${vars.__runId}-idea-task-order.json` as an array of `{ name, depends_on_names[] }`. After `task batch-create --json`, map input names to returned WBS values by their documented shared order, reject duplicate/missing/unknown names, and apply each non-empty dependency set through `spur task deps <wbs> set ... --json` before handoff.
- [ ] R2. After dependency application, run `spur feature refresh --feature <id> --json` so the feature roster reflects the created tasks and statuses.
- [ ] R3. Check every WBS from the captured batch-create result and write `.spur/run/${vars.__runId}-idea-handoff.md`: any failed `task check` recommends `/sp:dev-refineall --feature <id> --auto --depth ready` and omits runall; an all-pass set recommends `/sp:dev-runall --feature <id> --auto`. The terminal note points only to this report.

Non-goals: new CLI finalizer, task-list title lookup, task-batch schema changes, task execution, or changes to 0515's feature/design guidance.
### Acceptance Criteria
```gherkin
Feature: Safe idea-pipeline planning handoff
  Scenario: R1 — Idea handoff is safe to execute
    Given decomposition emits a non-empty task-order sidecar
    When batch creation succeeds
    Then each dependency is applied with spur task deps or the pipeline fails before handoff

  Scenario: R2 — Idea handoff is safe to execute
    Given task batch creation succeeds
    When post-create finalization completes
    Then spur feature refresh has regenerated the feature task roster

  Scenario: R3 — Idea handoff is safe to execute
    Given at least one created task fails spur task check
    When the handoff report is generated
    Then it recommends ready-depth refineall and does not recommend runall
```
### Q&A
- **Canonical artifacts:** `*-idea-task-order.json`, `*-idea-batch-create-result.json`, and `*-idea-handoff.md`, all run-scoped.
- **Order shape:** a JSON array of `{ name: string, depends_on_names: string[] }`; emit `[]` when no ordering exists. It is private workflow data and is not added to `task-batch.schema.json`.
- **Name mapping:** zip validated batch item names with `batch-create --json` `wbs[]` by index, after equal-length and unique-name checks. Do not re-query `task list` or guess between duplicate titles.
- **Workflow shape:** add one `handoff-finalize` state between successful batch creation and terminal handoff. A dependency/refresh/mapping error fails the run; an unready task is a successful planning outcome recorded as a refineall recommendation.
- **Readiness profile:** plain `task check --json` evaluates task structure without promoting expected in-batch prerequisite warnings; strict feature verification remains a later execution concern.
### Design
Modify only `config/workflows/idea-pipeline.yaml` and affected planning guidance. Keep `task-batch.schema.json` unchanged.

`decompose` must emit the existing task batch and the private `.spur/run/${vars.__runId}-idea-task-order.json` array. A following shell action validates that the sidecar is an array, that batch task names are unique, and that every sidecar name/dependency refers to exactly one batch name; `[]` is valid.

Change `batch-create-run` to capture source-local `$spurBin task batch-create --file ... --json` output atomically in `.spur/run/$__runId-idea-batch-create-result.json`. The command writes the existing done sentinel only after JSON parses and `created == (.wbs | length)`; failure retains the existing retry behavior. The CLI contract guarantees `wbs[]` order matches the input batch order.

Add state `handoff-finalize` between `batch-create-run` success and `handoff`. Its shell action:

1. Zips batch item names to result WBS values after equal-length/unique-name checks.
2. Applies each non-empty `depends_on_names` list with `$spurBin task deps <wbs> set <dep-wbs...> --json`; any mapping or CLI error exits non-zero before terminal handoff.
3. Runs `$spurBin feature refresh --feature "$featureId" --json`.
4. Runs `$spurBin task check <wbs> --json` for the frozen result WBS list and writes one Markdown handoff report containing feature ID, WBS list, per-task outcome, and exactly one next command: ready-depth refineall if any check fails, otherwise auto runall.

Change the terminal note to point at `*-idea-handoff.md`; remove the static runall command. Do not add a CLI verb, script abstraction, schema field, title lookup, or task execution. Task 0519 owns regression assertions for the new state/artifacts.
### Plan
- [ ] Emit and validate the canonical run-scoped order sidecar during decomposition (R1).
- [ ] Capture/validate atomic `batch-create --json` output and preserve existing retry sentinels (R1).
- [ ] Add `handoff-finalize`; zip batch names to result WBS values, apply `task deps`, and fail on any ambiguous/missing mapping or CLI error (R1).
- [ ] Refresh the feature roster, check the frozen WBS list, and generate the mutually exclusive refineall/runall handoff report (R2/R3).
- [ ] Point the terminal note to the report and sync affected planning guidance; do not touch CLI/schema/runtime surfaces.
- [ ] Run workflow validation plus `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts`; 0519 adds the focused regression cases.
### Solution
All changes are within the 0518 scope: `config/workflows/idea-pipeline.yaml` (workflow SSOT), the affected planning guidance (`plugins/sp/skills/spur-dev/references/planning-workflow.md` Step 5.6), and static contract assertions in `packages/app/tests/workflow/idea-pipeline-definition.test.ts`. No CLI verb, task-batch schema field, title lookup, or task execution was added.


- **decompose** (`config/workflows/idea-pipeline.yaml:279`): description now names the private order sidecar; the reset shell (`config/workflows/idea-pipeline.yaml:291`) also cleans `*-idea-task-order.json`, `*-idea-batch-create-result.json`, `*-idea-handoff.md`; the agent input (`config/workflows/idea-pipeline.yaml:295`) instructs emission of `.spur/run/${vars.__runId}-idea-task-order.json` — a JSON array of `{ name, depends_on_names[] }` per batch item (`[]` valid, every name/dependency must match exactly one batch name); a new post-agent shell action (`config/workflows/idea-pipeline.yaml:298`) validates fails closed via `jq -e`: sidecar is an array, batch names unique, sidecar names and deps ⊆ batch names (`flatten` keeps `[]` valid — `add` on an empty array yields null in jq).
- **batch-create-run** (`config/workflows/idea-pipeline.yaml:327`): description documents the atomic capture contract; the command (`config/workflows/idea-pipeline.yaml:339`) now runs `task batch-create --file ... --json`, writes stdout to a `.tmp`, and only after `jq -e ".created == (.wbs | length)"` passes does `mv` the temp to `.spur/run/$__runId-idea-batch-create-result.json` and write the done sentinel. CLI error or malformed result → failed sentinel (existing retry guards unchanged, idempotency preserved via the done-sentinel early exit).
- **handoff-finalize** (`config/workflows/idea-pipeline.yaml:351`, new state): single shell action (`config/workflows/idea-pipeline.yaml:362`) that (1) zips batch item names to result WBS values after equal-length/unique-name checks, emitting a name→wbs→deps TSV; (2) applies each non-empty `depends_on_names` list via `$spurBin task deps <wbs> set <dep-wbs...> --json`, exiting non-zero on any MISSING mapping or CLI error; (3) runs `$spurBin feature refresh --feature "$featureId" --json`; (4) runs `$spurBin task check <wbs> --json` for the frozen WBS list and writes `.spur/run/$__runId-idea-handoff.md` (feature ID, run ID, WBS list, per-task PASS/FAIL table, exactly one next command: `/sp:dev-refineall --feature <id> --auto --depth ready` when any check fails, else `/sp:dev-runall --feature <id> --auto`). An unready task is a successful planning outcome (report recommendation), not a run failure.
- **handoff** (`config/workflows/idea-pipeline.yaml:421`): terminal note (`config/workflows/idea-pipeline.yaml:431`) now points at `*-idea-handoff.md`; the static `Next: /sp:dev-runall ...` command was removed.
- **transitions** (`config/workflows/idea-pipeline.yaml:682`): `batch-create-run` success edge rerouted to `handoff-finalize` (still guarded on the done sentinel); new unconditional `handoff-finalize → handoff` edge (`config/workflows/idea-pipeline.yaml:705`). Header shape comment updated (`config/workflows/idea-pipeline.yaml:11`).
- Verification: the shell actions were simulated end-to-end against stubbed `spur` (success/failure/idempotent batch-create; valid/unknown-dep/unknown-name/duplicate-name/empty sidecar validation; check-fail → refineall, all-pass → runall), including the exact `/bin/sh -c` folded commands extracted from the parsed YAML.


- New "Task ordering (decompose / handoff-finalize)" contract block (`plugins/sp/skills/spur-dev/references/planning-workflow.md:241`): sidecar shape and run-scoped paths, name→WBS zipping via the captured batch-create result, `spur task deps` application, `feature refresh`, per-task `task check`, and the mutually exclusive refineall/runall recommendation; terminal note points at the report.


- Run-scoped artifact stem list extended (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:129`) with `idea-task-order.json`, `idea-batch-create-result.json`, `idea-dep-map.tsv`, `idea-check-results.jsonl`, `idea-handoff.md`; dynamic per-task check tmp prefix (`$__runId-idea-check-`) asserted directly (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:151`).
- New "task ordering, roster refresh, handoff report (0518)" describe block (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:277`), 7 tests: sidecar emission instruction; fail-closed sidecar validation; atomic `--json` capture before the done sentinel; `batch-create-run → handoff-finalize → handoff` edge placement (done-sentinel guard + always edge); `task deps`/`feature refresh` usage; per-task check + report with one next command; terminal note points at the report and no longer hardcodes runall.

Static contract assertions only — 0519 owns the focused regression cases.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `config/workflows/idea-pipeline.yaml` decompose: agent.run input instructs emission of `.spur/run/${vars.__runId}-idea-task-order.json` ("a JSON array of { name, depends_on_names[] } per batch item; `[]` valid, exactly one entry per batch item"); post-agent shell validates fails closed via `jq -e` (array, unique batch names, unique sidecar names, sidecar names ⊆ batch names, batch names ⊆ sidecar names [F2 converse], deps ⊆ batch names). batch-create-run captures `task batch-create --file … --json` atomically (`*.tmp` + `mv`, done sentinel only after `jq -e ".created == (.wbs |
| R2 | MET | `config/workflows/idea-pipeline.yaml` handoff-finalize: `$spurBin feature refresh --feature "$featureId" --json >/dev/null` runs after dependency application and before task checks/report, so the feature roster reflects created tasks and statuses. |
| R3 | MET | handoff-finalize checks every WBS from the frozen result (`for wbs in $WBS_LIST`) via `task check --json`; each row appended to `*-idea-check-results.jsonl` under ` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Idea handoff is safe to execute | MET | test | Definition test `decompose validates the sidecar fails closed` asserts the sidecar jq (array, unique batch names, bidirectional name coverage, deps ⊆ batch names); `batch-create-run captures --json result atomically` asserts `.tmp` + `mv` + `.created == (.wbs |
| Scenario: R2 — Idea handoff is safe to execute | MET | test | Definition test `handoff-finalize applies ordering through spur task deps and refreshes the roster (R1/R2)` asserts `feature refresh --feature "$featureId" --json` appears in the handoff-finalize command; inspection of the extracted command confirms refresh runs after deps application and before task checks/report. |
| Scenario: R3 — Idea handoff is safe to execute | MET | command | Stub-spur simulation (exact extracted command, `/bin/sh -c`): check-fail (valid JSON `pass:false` + exit 1) → report recommends `/sp:dev-refineall --feature I2 --auto --depth ready`, runall absent, table shows I2.001 PASS / I2.002 FAIL; all-pass → `/sp:dev-runall --feature I2 --auto`, refineall absent. F1 regression: non-JSON stderr-only check → action exits 1, no report, no runall (fail closed); empty-output check → rc 1 via row-count assertion, no report. Pre-fix differential: old loop on the non-JSON stub exited 0 recommending runall with the failing task missing from the table. Definition test `handoff-finalize checks every created task… (R3)` pins `>> "$CHECKS" |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
Verdict: **PASS (with findings)** — 0 P1, 1 P2, 1 P3, 4 P4. R1–R3 traceability confirmed against the worktree diff; SECUA shell-in-YAML surface reviewed (`$featureId` quoting, jq over untrusted batch result, deps-application error handling). 25 definition tests pass (`bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts`).

| ID | Sev | Location | Finding | Evidence |
|----|-----|----------|---------|----------|
| F1 | P2 | idea-pipeline.yaml `handoff-finalize` check loop | The per-task check loop swallows jq failures: the loop's exit status is its last body command (`rm -f "$TMP"`, always 0), so a non-JSON `task check --json` output drops that task from `*-idea-check-results.jsonl` without failing the run. `spur task check`'s exception path writes stderr text only and no JSON (`apps/cli/src/commands/task.ts:1060-1063` catch → `context.output.error` → exit 1). The dropped task then vanishes from both the report table and `any(.[]; .pass == false)`, so an unready task can silently flip the recommendation to **runall** — violating R3's "any failed check ⇒ refineall, no runall" invariant. Normal check failures emit a JSON array with exit 1 and are handled correctly; only the throw path (e.g. hard frontmatter parse error in a freshly batch-created task) triggers the drop. | `for wbs in $WBS_LIST; do … jq -c … >> "$CHECKS"; rm -f "$TMP"; done && NEXT=$(jq -r … 'any(.[]; .pass == false)')` |
| F2 | P3 | idea-pipeline.yaml `decompose` sidecar validation | Coverage is one-directional: the validator proves sidecar names ⊆ batch names and deps ⊆ batch names, but never the converse (every batch name appears in the sidecar). A partial sidecar (agent omits one batch item) silently skips `task deps` for that task with no error. Duplicate sidecar `name` entries are also not rejected (harmless today — deps re-applied idempotently — but R1 names "reject duplicate/missing/unknown names" and the agent prompt requires "one entry per batch item"). Fix is one extra jq term: `(($b[0] \| map(.name)) - (map(.name))) \| length == 0`. | decompose jq: `(map(.name) - ($b[0] \| map(.name))) \| length == 0` (no converse) |
| F3 | P4 | idea-pipeline.yaml `handoff-finalize` deps loop | `$deps` and `$WBS_LIST` are unquoted word-split expansions (`$own` is correctly quoted). Shell variable expansion is never re-parsed as syntax, so command substitution is impossible; residual risk is glob expansion if a WBS value ever contained glob metacharacters. WBS values are CLI-generated alphanumeric IDs (`A1`, `A1.1`), so this is theoretical. | `$spurBin task deps "$own" set $deps --json`; `for wbs in $WBS_LIST` |
| F4 | P4 | idea-pipeline.yaml `decompose` validation / `handoff-finalize` | Self-dependencies and A→B→A cycles are not rejected at sidecar validation. Cycles are caught downstream: `task check` L4 runs after deps application, so a cycle surfaces as a FAIL → refineall recommendation (self-correcting, matches design intent). Self-dep relies on the `task deps` CLI guard. | sidecar jq has no cycle/self check |
| F5 | P4 | idea-pipeline.yaml `handoff-finalize` | ~50-line folded shell block in YAML (name→WBS zip, deps loop, check loop, report writer). The state is one opaque command string; a mid-chain failure fails the run but with a hard-to-read trace. Matches the pre-existing workflow style (folded `&&` chains), so this is consistency over novelty. | `handoff-finalize` onEnter command |
| F6 | P4 | idea-pipeline.yaml `decompose` reset list | Reset removes the order sidecar, batch result, handoff report, and sentinels, but not `*-idea-dep-map.tsv` / `*-idea-check-results.jsonl`. Harmless today (run-scoped names; both are `rm -f`'d at finalize onEnter) but an asymmetry for resume-path audits. | decompose onEnter `rm -f` list |

**Traceability**

- **R1 — PASS (F2 gap).** Sidecar emission instructed in the decompose agent input (`.spur/run/${vars.__runId}-idea-task-order.json`, array of `{name, depends_on_names[]}`); post-agent jq validates fails closed (array / unique batch names / name+dep coverage, `[]` valid). `batch-create-run` captures `--json` atomically (`.tmp` + `mv`; done sentinel only after `jq -e ".created == (.wbs | length)"`; failure → `.failed` sentinel preserving retry). `handoff-finalize` zips batch names to `.wbs[]` by index after equal-length/unique-name checks; MISSING mapping → `exit 1`; each non-empty dep set applied via `$spurBin task deps <wbs> set <deps...> --json` before refresh/report; CLI error → `exit 1` (fail before handoff). CLI contracts verified against source: `batch-create --json` emits `{created, wbs, parentsWired}` (task.ts:731-734), `task deps <wbs> set … --json` exists (task.ts:506-510).
- **R2 — PASS.** `$spurBin feature refresh --feature "$featureId" --json` runs after deps application; `feature refresh --feature` + `--json` verified (feature.ts:295-301).
- **R3 — PASS (F1 gap).** Per-task `task check --json` over the frozen result WBS list; report `.spur/run/${vars.__runId}-idea-handoff.md` carries feature ID, run ID, WBS list, per-task PASS/FAIL table, and exactly one next command: `/sp:dev-refineall --feature <id> --auto --depth ready` when any `.pass == false`, else `/sp:dev-runall --feature <id> --auto`. Terminal note points only at the report; static runall removed.

**SECUA**

- `$featureId` quoted at every shell site (`"$featureId"` in refresh; `--arg feature "$featureId"` into jq — `--arg` is injection-safe; report `echo "Feature: $featureId"` is write-only, never executed).
- jq programs are fixed literals; only `--arg`/`--slurpfile` bind untrusted data (batch result, sidecar, checks) — no string interpolation into programs.
- Non-JSON or partial `batch-create` output → `jq -e` fails → failed sentinel → retry path (fail-closed). Dep mapping MISSING guards fail the run before handoff. Check loop is the one fail-open spot (F1).

**Residual risk** — F1 requires `task check --json` to emit non-JSON (the exception path); normal failures produce valid JSON arrays with exit 1 and are handled correctly. Two-line hardening: `jq -c … >> "$CHECKS" || exit 1` plus a row-count assertion (`CHECKS` lines == WBS count) before computing NEXT. Recommend 0519 (regression task) add a non-JSON-check-output case or land the hardening there.

**Disposition** — PASS; proceed to verify. F1 (P2) tracked for 0519 hardening or pre-merge fix; F2 (P3) optional one-term tightening; P4s informational.
### References
- Feature: I2, scenario R14
- Design: `docs/design/plugin-surface-parity.md` §9
- Workflow SSOT: `config/workflows/idea-pipeline.yaml`
- CLI contracts: `spur task batch-create --json`; `spur task deps`; `spur task check`; `spur feature refresh --feature`
- Dependency: 0515
- Dependent task: 0519
### History
- 2026-08-12T01:45:53.532Z todo → wip (system)
- 2026-08-12T01:57:56.368Z wip → testing (system)
- 2026-08-12T01:57:57.575Z testing → done (system)
