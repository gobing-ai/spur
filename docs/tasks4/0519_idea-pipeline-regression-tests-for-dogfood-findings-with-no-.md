---
template: feature-impl
schema_version: 1
name: "Idea-pipeline regression tests for dogfood findings with no-surface guard"
description: ""
status: done
type: task
profile: standard
feature_id: I2
parent_wbs: null
priority: P2
tags: ["idea", "workflow", "plugins/sp"]
dependencies: ["0518"]
ac_numbering: task-local
created_at: "2026-08-11T22:25:19.899Z"
updated_at: "2026-08-12T02:12:55.846Z"
---

## 0519. Idea-pipeline regression tests for dogfood findings with no-surface guard

### Background
Split from task 0515 (feature I2, decomposition 2026-08-11). This final task locks the four dogfood defects behind focused workflow-definition and plugin-contract tests after 0515/0518 land: Goal/Scope intent, persistent design feedback and AC reconciliation, dependency/order finalization, and roster/readiness-aware handoff. It also proves the feature stayed on the harness/documentation surface.

Current test owners verified during ready refinement: `packages/app/tests/workflow/idea-pipeline-definition.test.ts` parses `config/workflows/idea-pipeline.yaml` and already asserts run-scoped artifacts/transitions; `plugins/sp/tests/skill-structure.test.ts` owns cross-surface Markdown contracts. `apps/cli/schemas/task-batch.schema.json` must remain unchanged and reject the private order field.

Implements feature scenarios R10 and R14. Ordering: after 0518; no production behavior beyond the workflow/guidance changes already owned by 0515/0518.

Rubric: E2 D1 L1 C0 R0 = 4 → split verification slice.
### Requirements
- [ ] R1. Extend `idea-pipeline-definition.test.ts` and `skill-structure.test.ts` with focused assertions for all four defects: Goal/Scope CLI writes; run-scoped design feedback plus AC recheck; order-sidecar mapping/dependency application; roster refresh plus mutually exclusive refineall/runall handoff recommendations.
- [ ] R2. Prove the private order sidecar did not change `apps/cli/schemas/task-batch.schema.json`, and review the 0515/0518/0519 diff to confirm no public CLI command/flag, package dependency, persistence schema, transport, or unrelated runtime file changed.

Non-goals: new test file, end-to-end agent execution, CLI/schema modification, duplicated workflow parser, or broad snapshot testing.
### Acceptance Criteria
```gherkin
Feature: Idea-pipeline regression coverage
  Scenario: R1 — Idea handoff is safe to execute
    Given the four dogfood findings are encoded as tests
    When the focused suite runs against an unhardened idea-pipeline definition
    Then each test fails and passes only with the 0515/0518 changes in place

  Scenario: R2 — Refinement changes no runtime surface
    Given the change set is limited to harness guidance and tests
    When the diff is reviewed
    Then no public CLI surface, task-batch schema, dependency, persistence, or transport changes
```
### Q&A
- **Workflow test owner:** extend `packages/app/tests/workflow/idea-pipeline-definition.test.ts`; it already parses the definition and understands states, actions, transitions, and run-scoped paths.
- **Plugin contract owner:** extend `plugins/sp/tests/skill-structure.test.ts` only for the mirrored planning-workflow/dev-idea statements.
- **No-surface proof:** assert the task-batch schema has no `depends_on_names` property and remains closed; verify the scoped git diff for CLI/package/schema/persistence/transport paths instead of adding a permanent diff-dependent test.
- **Execution scope:** tests inspect workflow/guidance contracts; they do not launch an agent or create real corpus tasks.
### Design
Extend existing test owners only.

In `packages/app/tests/workflow/idea-pipeline-definition.test.ts`, add focused cases that inspect parsed YAML/raw text for:

1. `feature-create` expected Goal/Scope artifacts and both `feature update --section` calls; Goal prompt excludes decomposition/checklist instructions.
2. The run-scoped `idea-design-review.md` path, fixed feedback/reconciliation headings, retry prompt consumption, and `feature check` on both design-to-decompose paths.
3. The `idea-task-order.json` and `idea-batch-create-result.json` artifacts, `handoff-finalize` state, batch/result length and unique-name validation markers, and `task deps ... set` before handoff.
4. `feature refresh --feature`, per-WBS `task check`, `idea-handoff.md`, refineall-when-failed/runall-when-clean strings, and absence of the old static runall terminal note.

Add a schema assertion in the same file (or the existing schema test owner if already imported) that `task-batch.schema.json` remains closed and has no `depends_on_names`, `dependencies`, or order-sidecar field. In `plugins/sp/tests/skill-structure.test.ts`, assert the affected planning-workflow/dev-idea guidance names the canonical artifacts and conditional recommendation without copying shell logic.

Use property/string assertions with diagnostic messages, not a full YAML snapshot. Verification reviews the commits for 0515/0518/0519 and requires no diff under `apps/cli/src`, task-batch schema, package manifests/lockfile, `packages/domain`, or `packages/contracts`. Do not create a new test file or run the workflow with real agents.
### Plan
- [ ] Add workflow-definition regressions for Goal/Scope and design-feedback/AC-recheck behavior (R1).
- [ ] Add workflow-definition regressions for order mapping/deps and roster/check/handoff behavior, including removal of the static runall note (R1).
- [ ] Extend the plugin structural owner for canonical planning guidance and add the closed-schema/no-order-field assertion (R1/R2).
- [ ] Run `bun run apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json`, `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts`, and `bun test plugins/sp/tests/skill-structure.test.ts`.
- [ ] Review the 0515/0518/0519 scoped diff and confirm no CLI source, task-batch schema, package manifest/lockfile, persistence, contracts, or transport change; run task/feature checks and record evidence (R2).
### Solution
Regression tests locking the four dogfood findings plus the R2 no-surface guard. Tests only — no runtime code, no CLI surface, no schema change.

**packages/app/tests/workflow/idea-pipeline-definition.test.ts** (0519 describe block appended after the 0515/0518 blocks, `:370-437`):
- `handoff-finalize validates batch/result equal length and unique batch names before zipping` — pins the `(.wbs | length) == ($b[0] | length)` and `($b[0] | map(.name) | unique | length) == ($b[0] | length)` markers gating the name→WBS zip (F1, finding 3/4).
- `handoff recommendation is mutually exclusive: any-fail ⇒ refineall, all-pass ⇒ runall` — pins the `any(.[]; .pass == false)` NEXT computation and both exact recommendation strings (`/sp:dev-refineall --feature <id> --auto --depth ready` vs `/sp:dev-runall --feature <id> --auto`), written via `echo "$NEXT"` with no hardcoded second command (finding 4).
- `static runall recommendation is gone from the whole workflow definition, not just the note` — raw-text absence of `Next: /sp:dev-runall` / `Next command: /sp:dev-runall` anywhere in the YAML (finding 4 pre-fix had it in both the state description and terminal note).
- `task-batch.schema.json stays closed and carries no order-sidecar field (R2)` — parses the public schema, asserts `type: array`, `items.additionalProperties: false`, and that `depends_on_names` / `dependencies` / `dependsOnNames` / `order` are absent from `items.properties` (R2 no-surface guard; the private sidecar stays workflow-run data).

Findings 1–2 (Goal/Scope CLI writes; run-scoped design-review artifact + AC recheck on both design exits) are already locked by the 0515 R1/R2 describe blocks in the same file (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:165-283`), added by 0515's implementation and verified green here; finding 3's sidecar emission/validation and finding 4's roster refresh/check loop are locked by the 0518 block (`packages/app/tests/workflow/idea-pipeline-definition.test.ts:285-368`). This task adds the regression invariants those blocks rely on and the closed-schema assertion none covered.

**plugins/sp/tests/skill-structure.test.ts** (0519 describe block, `:1468-1515`): reads `spur-dev/references/planning-workflow.md` Step 5.6 and asserts (a) all six canonical run-scoped artifacts are named (`idea-goal.md`, `idea-scope.md`, `idea-design-review.md`, `idea-task-order.json`, `idea-batch-create-result.json`, `idea-handoff.md`); (b) the Goal/Scope and design-review contracts are stated in guidance prose without shell logic (`Goal is intent only`, fixed headings, `spur feature update --section` + `"Acceptance Criteria" --from-file`, `spur feature check <id>`); (c) the ordering contract (`depends_on_names`, `spur task deps <wbs> set`, `spur feature refresh --feature <id> --json`, `spur task check <wbs> --json`) and the mutually exclusive recommendation (`exactly **one** next command`, refineall-when-unready / runall-otherwise).

No new top-level test file (both owners extended in place), no new dependencies, no runtime files, no public CLI/flag, no task-batch schema change, no persistence/transport change — verified via scoped `git status`/`git diff`: zero diff under `apps/cli/src`, `apps/cli/schemas/task-batch.schema.json`, `package.json`/lockfile, `packages/domain`, `packages/contracts`.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Four dogfood defects encoded as tests in the two owners. `packages/app/tests/workflow/idea-pipeline-definition.test.ts` (438 lines, 29 tests) adds describe blocks for 0515 R1 (Goal/Scope body-only artifacts + `spur feature update --section` persistence + Goal prompt excludes decomposition/checklist), 0515 R2 (run-scoped `idea-design-review.md`, fixed `## Proposed design` / `## Operator feedback` / `## Reconciliation` headings, retry-prompt consumption, `spur feature check` on both design exits), 0518 (sidecar fails-closed validation jq, batch-create `--json` atomic capture, `handoff-finalize` ordering via `task deps <wbs> set`, `feature refresh --feature`, per-WBS `task check`, exactly-one-next-command), and 0519 invariants (equal-length/unique-name zip guard; mutual exclusivity `any(.[]; .pass == false)` ⇒ refineall else runall; static `Next: /sp:dev-runall` absent from the whole definition). `plugins/sp/tests/skill-structure.test.ts` (1514 lines, 54 tests) adds the 0519 block (3 tests) asserting planning-workflow.md Step 5.6 names the canonical artifacts (`idea-goal.md`, `idea-scope.md`, `idea-design-review.md`, `idea-task-order.json`, `idea-batch-create-result.json`, `idea-handoff.md`), pins contract prose (Goal is intent only; in/out-of-scope; fixed headings; reconciliation via `feature update --section` + `"Acceptance Criteria" --from-file`; `feature check`) and the ordering sidecar + conditional recommendation (`depends_on_names`, `spur task deps <wbs> set`, `spur feature refresh --feature <id> --json`, `spur task check <wbs> --json`, exactly one next command: refineall-when-failed else runall) — contract prose only, no shell logic copied. |
| R2 | MET | `apps/cli/schemas/task-batch.schema.json` is unchanged in the working tree (`git diff HEAD` empty) and verified closed: `items.additionalProperties: false`, and no `depends_on_names` / `dependencies` / `dependsOnNames` / `order` property (jq/grep over the schema + guard test `task-batch.schema.json stays closed and carries no order-sidecar field (R2)` at idea-pipeline-definition.test.ts:417-437). Scoped diff review (working tree vs HEAD, all I2 changes): zero modified files under `apps/cli/src`, `apps/cli/schemas`, `packages/domain`, `packages/contracts`, package manifests, or `bun.lock`; no db/migration/persistence/transport files anywhere in `git status`. The 0515/0518/0519 cluster is confined to harness/documentation surface: `config/workflows/idea-pipeline.yaml` (workflow guidance), `plugins/sp/skills/spur-dev/references/planning-workflow.md` (guidance prose), the two test owners, and task/feature/design docs (`docs/tasks4/0515…0519`, `docs/design/plugin-surface-parity.md`). No public CLI command/flag, package dependency, persistence schema, or transport change. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R1 — Idea handoff is safe to execute | MET | test | Differential proof executed live. Current tree: `bun test packages/app/tests/workflow/idea-pipeline-definition.test.ts` → 29 pass / 0 fail (130 expect); `bun test plugins/sp/tests/skill-structure.test.ts` → 54 pass / 0 fail (497 expect); `bun apps/cli/src/index.ts workflow validate config/workflows/idea-pipeline.yaml --json` → `{"ok":true,"valid":true}`. Against the unhardened (HEAD) `config/workflows/idea-pipeline.yaml` + `planning-workflow.md` (working copies saved to /tmp, HEAD versions checked out, suites re-run, fixed files restored byte-identical — md5 match): 20 fail / 9 pass and 3 fail / 51 pass. Every pre-fix failure is in the new 0515/0518/0519 regression blocks (Goal/Scope artifacts; design-review feedback contract incl. failing-check routing; sidecar validation and atomic capture; handoff-finalize ordering/roster/report; mutual-exclusive recommendation; static-runall absence; planning-workflow canonical-artifact/conditional-guidance pins) — the tests fail without the 0515/0518 fixes and pass only with them. |
| Scenario: R2 — Refinement changes no runtime surface [docs-only] | MET | static-ref | `git status --porcelain -- apps/cli/src apps/cli/schemas packages/domain packages/contracts '**/package.json' bun.lock bun.lockb` → empty (no changes). Schema guard test (idea-pipeline-definition.test.ts:417-437) asserts `schema.type === 'array'`, `schema.items.additionalProperties === false`, and absence of `depends_on_names`/`dependencies`/`dependsOnNames`/`order`; direct inspection of `apps/cli/schemas/task-batch.schema.json` confirms `additionalProperties: false` and no ordering field (`grep -c "depends_on_names\ |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

Three-dimensional review of 0519's slice (regression tests + no-surface guard) in the
`spur-new-runall-i2-c763` worktree. Reviewed files:
`packages/app/tests/workflow/idea-pipeline-definition.test.ts` (0519 block :370-437),
`plugins/sp/tests/skill-structure.test.ts` (0519 block :1468-1516), and the task file.
All markers ground-truthed against the live `config/workflows/idea-pipeline.yaml`,
`apps/cli/schemas/task-batch.schema.json`, and `spur-dev/references/planning-workflow.md`.

**Traceability (R1) — PASS.** All four findings have locking assertions. F1 (Goal/Scope intent):
0515 R1 block pins body-only intent files, `spur feature update --section Goal|Scope --from-file`,
and decomposition/checklist exclusion. F2 (design feedback + AC recheck): 0515 R2 block pins the
run-scoped `idea-design-review.md` headings, reconciliation via `feature update --section
"Acceptance Criteria" --from-file`, `feature check` on both design exits, and the fail-closed
content check. F3 (order sidecar/deps): 0518 block pins sidecar emission, jq fail-closed
validation (`type == "array"`, unique names, bidirectional coverage), `task deps ... set`, plus
0519's zip guard `(.wbs | length) == ($b[0] | length)` and unique-name marker (YAML:382). F4
(roster/readiness handoff): 0518 block pins `feature refresh --feature`, the check loop with
`|| exit 1` and row-count assertion; 0519 block pins `any(.[]; .pass == false)` NEXT computation
with exactly one `echo "$NEXT"` (YAML:409,431) and the whole-definition absence of
`Next: /sp:dev-runall` / `Next command: /sp:dev-runall`. Differential proof holds: pre-fix HEAD
YAML:286 still hardcodes `Next: /sp:dev-runall --feature ${vars.featureId}` and lacks the zip
guard, so the new tests fail against pre-fix and pass against current (29 + 54 green, 0 fail).

**No-surface (R2) — PASS.** `task-batch.schema.json` is unchanged in git and verified closed
(`type: array`, `items.additionalProperties: false`, 11 props, none of `depends_on_names` /
`dependencies` / `dependsOnNames` / `order`). `git diff --stat` on `apps/cli`, `packages/domain`,
`packages/contracts`, `package.json`, and lockfiles: zero. Full diff name-only: 18 files, all
`docs/`, `config/workflows/` (0515/0518-owned guidance), the two extended test owners, and
sibling-task files (0517's `cli-surface-parity.test.ts` + helpers). No CLI source, manifest,
persistence, or transport change anywhere in the batch; 0519's slice is tests + task file only.
`workflow validate --json` passes.

**SECUA — PASS.** S: test-only changes, fixed repo paths, no new surface. E: `find()` + `?? ''`
fallbacks give deterministic failures with diagnostic messages; no silent skips. C: every
assertion verified against live YAML/schema/guidance text; suite counts and Solution line
citations accurate. U: findings referenced by ID in comments, layered design documented.

**Architecture — PASS.** Extends the two existing owners in place; no new test file, dependency,
parser duplication, or snapshot testing (non-goals honored). Layering is sound: 0515/0518
presence tests → 0519 invariant pins → permanent closed-schema guard. The diff-dependent half of
R2 is correctly a manual scoped git review, not a brittle permanent diff test.


| Sev | ID | Finding | Evidence | Disposition |
|-----|----|---------|----------|-------------|
| P1  | —  | None | — | — |
| P2  | —  | None | — | — |
| P3  | P3-1 | Schema-guard test reads `schema.items.properties` without a shape guard; a future restructure (e.g., `items` → `$ref`/`allOf`) would throw at `expect(undefined, …)` instead of failing with the intended diagnostic | idea-pipeline-definition.test.ts:433-435 | Accept — the preceding `type` / `additionalProperties` assertions fail first in any realistic restructure; the guard fails loudly either way |
| P4  | P4-1 | Leak-name list (`depends_on_names`, `dependencies`, `dependsOnNames`, `order`) is illustrative; a sidecar field under a different key would slip the name loop. Real teeth are `additionalProperties: false`, which rejects any new property | :417-433 | Accept — belt-and-suspenders by design; closed schema is the primary guard |
| P4  | P4-2 | Handoff-recommendation test pins exact jq template strings; a cosmetic reword (e.g., `--depth=ready`) breaks the test despite equivalent behavior | :399-408 (YAML:409) | Accept — the defect being locked *was* the exact recommendation string, so string pinning is the contract |
| P4  | P4-3 | R1 coverage for findings 1–3 lives in the 0515/0518 describe blocks of the same file, not the 0519 block; deleting those blocks would silently drop coverage while 0519's own tests stay green | Solution note, :371-375 | Accept — explicitly documented layering; residual risk only |

- Findings 1–3 regression coverage is a property of the cumulative file state (0515/0518/0519
  blocks together); the task file documents this dependency.
- The differential proof (new tests fail pre-fix) is captured in git history only, not a CI gate;
  a future change that re-introduces a finding would be caught by the green suite, which is the
  intended guard.

**APPROVED** — proceed to verification. No blocking findings; P3/P4 items are accept-with-note
robustness observations on a test-only change set.
### References
- Feature: I2, scenarios R10 and R14
- Design: `docs/design/plugin-surface-parity.md` §§8–9
- Dependencies: 0515 (feature/design guidance), 0518 (post-create finalization)
- Workflow test owner: `packages/app/tests/workflow/idea-pipeline-definition.test.ts`
- Plugin contract owner: `plugins/sp/tests/skill-structure.test.ts`
- Closed public schema: `apps/cli/schemas/task-batch.schema.json`
### History
- 2026-08-12T02:05:04.012Z todo → wip (system)
- 2026-08-12T02:12:54.619Z wip → testing (system)
- 2026-08-12T02:12:55.846Z testing → done (system)
