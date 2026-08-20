---
template: meta
schema_version: 1
name: "Fix 0510-run inefficiencies: per-file coverage preflight, verify anchor hygiene, coverage-diagnosis protocol, mocking conventions, precheck corpus-dirt note"
description: ""
status: done
type: meta
profile: standard
feature_id: H
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0510"]
ac_numbering: task-local
created_at: "2026-08-11T17:09:57.558Z"
updated_at: "2026-08-18T17:16:05.305Z"
---

## 0511. Fix 0510-run inefficiencies: per-file coverage preflight, verify anchor hygiene, coverage-diagnosis protocol, mocking conventions, precheck corpus-dirt note

### Background

Task 0510 completed successfully, but its run exposed one remaining commit-hygiene blind spot: the
task-pipeline precheck deliberately excludes `docs/tasks*` from its existing dirty-tree warning, so
pre-existing task-corpus edits are invisible at launch even though they can be accidentally staged
with the current task later.

The original 0511 draft proposed four additional follow-ups. They are removed after premise review:

- ts-libs commit `7830436` fixed the observed mock pollution and fixture/output leaks and is included
  in the published `0.4.27` release;
- `plugins/sp/skills/code-testing/references/stacks/bun-ts.md` already documents Bun per-file coverage
  output and loaded-module behavior;
- `plugins/sp/skills/code-testing/references/test-output-discipline.md` already requires narrow-test
  diagnosis before returning to the full suite;
- `plugins/sp/skills/code-verification/SKILL.md` already requires repo-relative, re-read `file:line`
  evidence, and H1 already owns executable AC for citation hygiene and bounded full-suite runs.

The Spur dependency catalog and lockfile resolve all eight `@gobing-ai/ts-*` packages to published
version `0.4.27`. This task therefore has no ts-libs implementation or release dependency.

### Requirements

- [x] R1. Extend the existing non-blocking dirty-tree shell action in
      `config/workflows/task-pipeline.yaml` to query pre-existing changes under `docs/tasks*` separately
      from non-corpus changes. When task-corpus changes exist, print one advisory naming the exact
      porcelain rows; always exit zero and preserve the current non-corpus warning, corpus exclusions,
      lifecycle behavior, and task statuses.

Non-goals: blocking a pipeline on corpus dirt; reporting `docs/features`; changing the existing
non-corpus warning; modifying generated/bundled workflow copies; changing ts-libs code, tests,
packages, or release automation; adding a command, flag, config key, hook, or reusable helper.

### Acceptance Criteria

```gherkin
Scenario: R1 — precheck reports task-corpus dirt without blocking
  Given a Git worktree with an uncommitted file under `docs/tasks*`
  When the task-pipeline precheck dirty-tree shell action runs
  Then it exits zero
  And it prints a corpus advisory containing the exact `git status --porcelain` row
  And it does not classify that row as a non-corpus change

Scenario: R1 — clean task corpus stays quiet
  Given a Git worktree with no uncommitted file under `docs/tasks*`
  When the same precheck action runs
  Then it exits zero
  And it prints no corpus advisory
```

### Q&A

**Q: Why is the corpus warning advisory instead of blocking?**
A: Pipeline execution legitimately updates task files. Blocking on corpus dirt would break batch and
resume flows; the missing behavior is launch-time visibility, not a new lifecycle guard.

**Q: Why report only `docs/tasks*`, not all corpus paths?**
A: The observed risk and original requirement concern task files accidentally swept into another
task's commit. Feature reporting is deliberately out of scope until the same failure is observed.

**Q: Does implementation need to edit ts-libs or wait for another release?**
A: No. The relevant upstream cleanup is in published `0.4.27`, and Spur's catalog and lockfile already
resolve all `@gobing-ai/ts-*` packages to that version.

### Design

Modify only the existing precheck dirty-tree shell action in
`config/workflows/task-pipeline.yaml`. Keep its current non-corpus query unchanged, add a second
bounded `git status --porcelain -- ':(glob)docs/tasks*/**'` query, and emit a clearly distinct
`precheck: NOTE` only when that result is non-empty. Both branches remain advisory and the action
ends with `exit 0`.

Add one focused regression test to `plugins/sp/tests/task-pipeline-resilience.test.ts`. Execute the
second precheck shell action in a temporary Git repository and prove both paths: a task-corpus file
is named without triggering the non-corpus warning, while a clean task corpus emits no advisory.
Do not introduce a helper or edit the generated `apps/cli/config/` bundle.

### Plan

- [x] P1 (R1) Extend the existing precheck dirty-tree shell action in
      `config/workflows/task-pipeline.yaml` with the separate advisory task-corpus query.
- [x] P2 (R1) Add dirty and clean task-corpus cases to
      `plugins/sp/tests/task-pipeline-resilience.test.ts` using a temporary Git repository.
- [x] P3 Verify with the focused resilience test, source-local workflow validation, and standard plus
      strict task checks for 0511.

### Solution
**R1 — task-corpus dirt advisory in the precheck dirty-tree action (advisory only, never a block).**

- `config/workflows/task-pipeline.yaml:206-224` — extended the existing precheck dirty-tree shell
  action (R6/0487). The original non-corpus `git status --porcelain -- . ':(exclude)docs/tasks*'
':(exclude)docs/features'` WARNING query is unchanged. Added a second bounded query,
  `git status --porcelain -- ':(glob)docs/tasks*/**'`, that prints a distinct `precheck: NOTE` with
  the exact porcelain rows only when task-corpus dirt exists. Both branches stay advisory and the
  action still ends with `exit 0`; lifecycle behavior and task statuses are untouched.
- `plugins/sp/tests/task-pipeline-resilience.test.ts:44-58` — new `initGitRepo` helper that seeds a
  committed `.gitkeep` under `docs/tasks4/` in a temp Git repo so untracked corpus files are listed
  individually (git collapses a fully-untracked directory into a single `?? docs/tasks4/` row).
- `plugins/sp/tests/task-pipeline-resilience.test.ts:197-208` — dirty case: an untracked
  `docs/tasks4/uncommitted.md` is named in the NOTE with the exact `?? docs/tasks4/uncommitted.md`
  row and does NOT trigger the non-corpus WARNING.
- `plugins/sp/tests/task-pipeline-resilience.test.ts:210-219` — clean case: a clean task corpus
  emits no corpus advisory (and no WARNING).

Verification (targeted probes only; the pipeline `test` hop runs the full gate):

- `bun test plugins/sp/tests/task-pipeline-resilience.test.ts` — 7 pass / 0 fail (5 existing + 2 new).
- `spur workflow validate config/workflows/task-pipeline.yaml` — `valid: true`.
- `spur task check 0511` — PASS.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1          | MET    | `config/workflows/task-pipeline.yaml:219-223` (bounded `git status --porcelain -- ':(glob)docs/tasks*/**'` query + `precheck: NOTE` advisory naming exact porcelain rows); `config/workflows/task-pipeline.yaml:224` (`exit 0` preserved); `config/workflows/task-pipeline.yaml:211-217` (non-corpus WARNING + exclusions byte-identical); regression tests `plugins/sp/tests/task-pipeline-resilience.test.ts:197-219` |

| Acceptance Criteria                                               | Status | Evidence Type | Evidence                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------ | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scenario: R1 — precheck reports task-corpus dirt without blocking | MET    | test          | `plugins/sp/tests/task-pipeline-resilience.test.ts:197-208` — test "precheck dirty-tree action names task-corpus dirt without the non-corpus warning"; asserts exit 0, NOTE present, exact row `?? docs/tasks4/uncommitted.md` present, WARNING absent. Passed this run: `bun test plugins/sp/tests/task-pipeline-resilience.test.ts` → 7 pass / 0 fail |
| Scenario: R1 — clean task corpus stays quiet                      | MET    | test          | `plugins/sp/tests/task-pipeline-resilience.test.ts:210-219` — test "precheck dirty-tree action stays quiet on a clean task corpus"; asserts exit 0, no NOTE, no WARNING. Same run, passed                                                                                                                                                               |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

- Re-audit 2026-08-11 (--force, --fix all): anchors re-read live (`config/workflows/task-pipeline.yaml:203-224`, resilience tests `:44-58,197-219`); resilience suite 7 pass / 0 fail; `spur workflow validate` valid:true; 4 unchecked boxes flipped; shippable gate `spur feature check H` pass=true, tasks 0500/0510/0511 done. Verdict artifact `.spur/run/0511-verdict.json`.
### Review
**Functional traceability** — R1 MET.

- `config/workflows/task-pipeline.yaml:219-223` — new bounded query `git status --porcelain -- ':(glob)docs/tasks*/**'` prints a distinct `precheck: NOTE - task corpus has uncommitted changes` with the exact porcelain rows only when task-corpus dirt exists; `exit 0` preserved at `config/workflows/task-pipeline.yaml:215`; the non-corpus WARNING query (`:196-202`) and its exclusions (`:(exclude)docs/tasks*`, `:(exclude)docs/features`) are byte-identical to the pre-change action; lifecycle behavior and task statuses untouched (status transition is the separate `spur task update <wbs> wip` action).

**Acceptance Criteria** — both scenarios MET with executable evidence in `plugins/sp/tests/task-pipeline-resilience.test.ts` (temp Git repo harness, `commandFor('precheck', 1)` executes the real YAML action):

- Scenario "precheck reports task-corpus dirt without blocking": test `precheck dirty-tree action names task-corpus dirt without the non-corpus warning` (`:197-208`) — asserts exit 0, `precheck: NOTE` present, exact row `?? docs/tasks4/uncommitted.md` present, `precheck: WARNING` absent (row not classified as non-corpus).
- Scenario "clean task corpus stays quiet": test `precheck dirty-tree action stays quiet on a clean task corpus` (`:210-219`) — asserts exit 0, no NOTE, no WARNING.

**SECUA** — no P1–P3 findings.

- Security: no user/LLM input is interpolated into the added shell; both `git status` queries are fixed literal pathspecs with `2>/dev/null` — no injection surface.
- Correctness: glob semantics verified empirically — `:(glob)docs/tasks*/**` matches files under `docs/tasks`, `docs/tasks2/3/4` (single-segment `*`, recursive `**`); fully-untracked new task dirs collapse to the dir row, which the advisory still names verbatim. The corpus query runs independently of the DIRTY branch, so a clean non-corpus tree with corpus dirt still prints the NOTE.
- Efficiency: one extra `git status --porcelain` at precheck — bounded, negligible.
- Usability: distinct `precheck: NOTE` prefix and actionable wording ("review before staging with this task") vs the WARNING's commit/stash framing.
- Architecture: config-local YAML extension following the existing action pattern; zero new abstraction; test uses the existing resilience harness, so it exercises the YAML source of truth.

**Design conformance** — pass with one documented deviation (advisory).

- Honors: only the precheck dirty-tree action modified; second bounded glob query as specified; NOTE advisory; `exit 0` in both branches; one focused regression test file with both paths; no edit to the generated `apps/cli/config/` bundle.
- Deviation (CHANGED): added a test-local `initGitRepo` scaffolding function (`plugins/sp/tests/task-pipeline-resilience.test.ts:44-58`). The Non-goals' "reusable helper" is read as a product-surface helper (the same sentence enumerates command/flag/config-key/hook); the test file already hosts local helpers (`executable`, `runShell`), so the addition follows the file's established pattern and adds no reusable product code. A seeded tracked file is required so git lists untracked corpus files individually instead of collapsing the directory.

**Disposition** — PASS. No P1–P3 findings; residual risk none beyond the advisory noted above.
### References

- `config/workflows/task-pipeline.yaml` — precheck dirty-tree action; current task-corpus exclusion.
- `plugins/sp/tests/task-pipeline-resilience.test.ts` — focused executable shell-action harness.
- `plugins/sp/skills/code-testing/references/stacks/bun-ts.md` — existing Bun coverage guidance.
- `plugins/sp/skills/code-testing/references/test-output-discipline.md` — existing narrow-test loop.
- `plugins/sp/skills/code-verification/SKILL.md` — existing repo-relative line-anchor contract.
- ts-libs commits `7830436` (mock/output cleanup) and `a1fe989` (`0.4.27` release).
- Bun coverage documentation: https://bun.com/docs/test/code-coverage

### History

- 2026-08-11T17:49:40.620Z backlog → wip (system)
- 2026-08-11T17:53:01.935Z wip → testing (system)
- 2026-08-11T17:53:16.518Z testing → done (system)

### Notes

Refinement disposition (2026-08-11): retained only the task-corpus precheck advisory. Removed the
coverage, diagnosis, citation, and mocking follow-ups because their prevention contracts already
exist or their concrete upstream defects shipped in ts-libs `0.4.27`.
