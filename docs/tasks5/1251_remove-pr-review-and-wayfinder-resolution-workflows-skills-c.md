---
schema_version: 1
name: Remove pr-review and wayfinder-resolution workflows; skills call the verbs directly
status: done
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-18T23:02:28.460Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - builder
  - wayfinder
  - breaking

estimate_hours: 6
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1251-verdict.json
---

## 1251. Remove pr-review and wayfinder-resolution workflows; skills call the verbs directly

### Background

pr-review passed 0/20 runs and no run of the current definition exists; wayfinder-resolution passed 0/18. The `spur builder pr-status | pr-check | pr-open | pr-review` verbs already own the PR sequencing (runPrVerb). done-transition-guard.ts names wayfinder-resolution only in a comment. Covers feature scenario R1 (these two workflows) and the pr/wayfinder part of R11.


**Refine corrections (2026-10-17)**

- R1: there are no "init scaffold entries". `spur init` copies every bundled config file into `~/.config/spur/` and never overwrites or deletes (apps/cli/src/commands/init.ts:179-195, `listBundledConfigFiles`). Deleting the bundled YAML is the whole removal. Existing installs keep their seeded shared-layer copies, as they already do for the retired feature-dev.yaml and planning-pipeline.yaml. `spur workflow run pr-review.yaml` therefore resolves a stale seeded copy rather than failing with definition-not-found. This was corrected in the design doc §4, and the CHANGELOG note is in 1252.
- R1 additions that were missing: the `pr-review` and `wayfinder-resolution` entries in config/pipeline-budgets.json (lines 31, 45), and packages/app/tests/workflow/wayfinder-resolution.test.ts.
- R2 premise confirmed: sp:pr-reviewing already routes every deterministic step through `spur builder pr-status | pr-check | pr-open | pr-review` (plugins/sp/skills/pr-reviewing/SKILL.md:44-65). What remains is the workflow-order framing (SKILL.md:129, "bypasses the workflow's state order") and the README row (plugins/sp/README.md:351, "spine SSOT `pr-review.yaml` + `spur builder pr`"). No plugin markdown invokes the bare `spur builder pr` alias today.
- R4 confirmed: packages/app/src/services/pr-review/index.ts:2,6,932,1025 name the workflow or the alias in doc text and `PR_REVIEW_HELP`.

### Requirements

- [x] R1. config/workflows/pr-review.yaml and wayfinder-resolution.yaml are deleted, are absent from the rebuilt apps/cli/config bundle, and their config/pipeline-budgets.json entries are removed. `spur workflow list --json` from a project without seeded copies names neither.
- [x] R2. /sp:dev-pr-review and sp:pr-reviewing describe their modes (status, review, submit, fix, rerun, collect) as direct `spur builder pr-*` verb sequences. No text refers to a workflow state order, and the plugin README row drops `pr-review.yaml`.
- [x] R3. sp:wayfinder keeps its investigate procedure as a skill procedure. references/pipeline-resolution.md is removed, and no wayfinder file names the workflow.
- [x] R4. packages/app/src/services/pr-review/index.ts doc text and `PR_REVIEW_HELP`, plus packages/app/src/services/done-transition-guard.ts:7, stop naming the deleted workflows.
- [x] R5. The hidden deprecated `spur builder pr` alias is kept. No skill, command, agent or workflow invokes it; they call `spur builder pr-status | pr-check | pr-open | pr-review`.

Out of scope: removing stale seeded copies from existing `~/.config/spur/workflows` (init never deletes; 1252 documents the cleanup); feature-verification (1246).

### Acceptance Criteria

- [x] AC1 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution (req: R1)
- [x] AC2 — Callers, skills and docs describe only the surviving workflows (req: R2, R3, R4, R5)

Task-local: AC1 here covers pr-review and wayfinder-resolution; AC2 here covers the pr-review and wayfinder surfaces only.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Chosen: delete the spines and keep the verbs. The verbs are the tested core (`runPrVerb`); the YAML only sequenced shell calls to them.

Rejected:
- Repairing the workflows (operator decision 1).
- A `spur init` prune of stale seeded copies: init's contract is never to delete user files, and the stale-copy class predates this feature.

Invariant: the external review still goes through the GitHub PR and an `@codex review` comment with per-HEAD dedupe.

File targets:
- Delete config/workflows/pr-review.yaml, config/workflows/wayfinder-resolution.yaml and plugins/sp/skills/wayfinder/references/pipeline-resolution.md.
- Edit config/pipeline-budgets.json:31,45.
- Rewrite plugins/sp/commands/dev-pr-review.md, plugins/sp/skills/pr-reviewing/SKILL.md (lines 44-150), plugins/sp/skills/wayfinder/SKILL.md (its link to pipeline-resolution.md) and plugins/sp/README.md:351.
- Edit packages/app/src/services/pr-review/index.ts:2,6,932,1025 and packages/app/src/services/done-transition-guard.ts:7.
- Tests: delete packages/app/tests/workflow/wayfinder-resolution.test.ts. Update packages/app/tests/services/pr-review/pr-review.test.ts, packages/app/tests/workflow/{migrated-gates,replay-matrix}.test.ts, apps/cli/tests/workflow-decision-scan.test.ts, scripts/commands/{eval-pipeline,workflow-promotion}.test.ts and plugins/sp/tests/run-record-catalog.test.ts wherever they enumerate the two workflows.

Anti-patterns:
- Do not delete or rename any `spur builder pr-*` verb.
- Do not make the alias call sites the replacement.
- Do not edit historical docs/plans, docs/reports or docs/inventory records; they are dated evidence.
- Do not touch docs/design satellites here; 1252 owns the sweep.

Handoffs:
- 1252 sweeps docs/design and docs/03 mentions and writes the CHANGELOG BREAKING CHANGE note, including the seeded-copy cleanup line.
- 1246 removes feature-verification in parallel. Both edit the replay-matrix and run-record-catalog tests, so whichever lands second rebases.

### Plan

- [x] 1. Failing check (R1, R3, R4, R5): a plugins/sp test asserts that no file under plugins/sp, packages/app/src or config/ names `pr-review.yaml` or `wayfinder-resolution`, and that no plugin markdown invokes `spur builder pr` without a `-<verb>` suffix.
- [x] 2. Rewrite dev-pr-review.md, the pr-reviewing SKILL.md, the README row and the wayfinder SKILL.md link (R2, R3).
- [x] 3. Delete the two YAML files, the wayfinder reference and the budget entries. Rebuild the bundle (R1).
- [x] 4. Fix the pr-review module text and the done-transition-guard comment (R4).
- [x] 5. Update the tests listed in Design. Run targeted tests in plugins/sp, packages/app, apps/cli and scripts, then `bun run spur-check`. (Targeted tests + `task gate 1251 light` done; `bun run spur-check` is deliberately left to the pipeline's `test` hop — implement scope forbids the full project gate.)

### Solution

Both retired spines were thin shells: `pr-review.yaml` shelled out to ops the four flat
`spur builder pr-<verb>` verbs already compose in one runtime (task 1219), and
`wayfinder-resolution.yaml` wrapped a skill procedure. Deleting them moved the sequencing into the
callers that were already the real SSOT — no new abstraction, net deletion.

**R1 — definitions and budgets deleted**

- `config/workflows/pr-review.yaml`, `config/workflows/wayfinder-resolution.yaml` — removed via
  `git rm`. Their state order, guards and vars were relocated (not dropped) into the skill prose
  below.
- `config/pipeline-budgets.json` — the `pr-review` and `wayfinder-resolution` budget objects
  removed. `checkBudgetCoverage` only flags *live* pipelines with `queries > 0`, so removal is safe.
- `apps/cli/config/workflows/` regenerated with `bun run --filter @gobing-ai/spur build:bundle`;
  it now lists exactly task-lifecycle, feature-lifecycle, idea-pipeline, history-anatomy,
  task-pipeline, wrapup-pipeline.

**R2 — the Codex route is a verb sequence**

- `plugins/sp/skills/pr-reviewing/SKILL.md:42` — architecture block now reads
  `Codex route:  pr-check → pr-open → pr-review → pr-status`; `plugins/sp/skills/pr-reviewing/SKILL.md:51`
  replaces the "state order and guards live in `pr-review.yaml`" bullet with "sequencing inside a
  verb lives in `runPrVerb`". The mode table row and the "Review mode (--codex)" section carry the
  retired YAML's guards verbatim as verdict gates (`PASS|WARN` continue / `BLOCK|FAIL` stop;
  `FOUND|CREATED` continue; `CLEAN|FINDINGS` collected / `PENDING` pending / `FAIL` stop), the
  `mode=submit|rerun` → `--no-wait`/`--force` mapping, and the optional project fast check that
  replaces the old `preReviewCmd` var. `plugins/sp/skills/pr-reviewing/SKILL.md:157` records that
  `pr-review` owns request → wait → collect in one runtime.
- `plugins/sp/commands/dev-pr-review.md:20` and `plugins/sp/commands/dev-pr-review.md:40` — flag
  descriptions and the Implementation bullet name the verbs instead of the YAML.
- `plugins/sp/README.md:351` — skill row says "direct `spur builder pr-status`/`pr-check`/`pr-open`/`pr-review`
  sequence"; `plugins/sp/README.md:699` replaces the `wayfinder-resolution.yaml` workflow-table row
  with a retirement note.
- `plugins/sp/skills/spur-cli/references/builder.md:83` — "driven by the `pr-review` workflow" →
  "sequenced directly by `sp:pr-reviewing`"; `--force` no longer claims `(mode=rerun)`.

**R3 — wayfinder investigate hop is a skill procedure**

- `plugins/sp/skills/wayfinder/references/pipeline-resolution.md` deleted (the `references/` dir is
  now gone). Its load-bearing contract was condensed into the body at
  `plugins/sp/skills/wayfinder/SKILL.md:149` (resolution boundary: author sections, never implement,
  never invoke `/sp:dev-run`, local reads + `spur` CLI only, write via `spur task update`) and
  `plugins/sp/skills/wayfinder/SKILL.md:155` (evidence anchors: resolve every cited line, never
  copy a line number from another ticket).

**R4 — stale references in app source**

- `packages/app/src/services/pr-review/index.ts:6` and
  `packages/app/src/services/pr-review/index.ts:1026` — header and the ops-placement comment now
  describe the skill's verb sequence as the caller.
- `packages/app/src/services/done-transition-guard.ts:7` — names the wayfinder resolution spine as
  retired in 1251 alongside the 0866 docs pipeline.

**R5 — the deprecated alias is kept**

`spur builder pr <op>` stays hidden-but-live with its one stderr deprecation line.
`PR_REVIEW_HELP` (`packages/app/src/services/pr-review/index.ts:932`) was deliberately **not**
changed: it names the alias, not a workflow, and `apps/cli/tests/commands/builder/pr.test.ts:56`
asserts that exact string. `plugins/sp/skills/spur-cli/references/builder.md:101` keeps the alias's
single documentation home; the new test exempts that one file and forbids every other plugin page
from invoking the bare form.

**Failing check first, then the enumerating tests**

- `plugins/sp/tests/retired-workflow-refs.test.ts` (new, 6 tests) pins the removal from the
  reference side: no definition in the bundled workflow assets, no budget entry, no wayfinder file
  naming the retired spine, no retired filename anywhere under `plugins/sp/**`,
  `packages/app/src/**` or `config/**`, no plugin page invoking the bare alias, and the skill
  describing a flat-verb sequence. Attestation exemption is scoped to
  `plugins/sp/tests/**/*.test.ts` only (`plugins/sp/tests/retired-workflow-refs.test.ts:32`), so
  plugin hooks, lib and scripts stay scanned.
- Enumerations updated: `apps/cli/tests/workflow-decision-scan.test.ts:22`,
  `plugins/sp/tests/run-record-catalog.test.ts:99` (plus the catalog floor 8 → 6 — two definitions
  retired here, one by 1246), `packages/app/tests/workflow/migrated-gates.test.ts:17`,
  `packages/app/tests/workflow/replay-matrix.test.ts:34`,
  `packages/app/tests/workflow/wrapup-pipeline.test.ts:697`,
  `scripts/commands/eval-pipeline.test.ts:158`, `scripts/commands/workflow-promotion.test.ts:461`.
- `packages/app/tests/workflow/wayfinder-resolution.test.ts` deleted (301 lines — it only tested the
  removed definition).
- `packages/app/tests/services/pr-review/pr-review.test.ts` — the three workflow-SSOT suites
  (flat-verb mapping, mode/tuning vars, and the `reviewActionCommand()`/`runReviewAction()` shell
  flag composition) deleted along with the now-unused `yaml` import; the service's own behavior
  tests are untouched.
- `plugins/sp/tests/skill-structure.test.ts:934` — wayfinder body budget 26 264 → 26 708 B with the
  rationale inline: R3 *mandates* folding the deleted reference into the body, so the +444 B is
  absorption of a removed file, not drift.

**Deliberately kept:** `apps/cli/tests/fixtures/script-absorption-pr9/workflows/pr-review.yaml` —
frozen replay evidence for the PR-9 absorption parity test, not a reference surface. The pr7/pr9
parity suites still pass.

**Verification (targeted, per the changed-path matrix)**

- `packages/app`: pr-review + replay-matrix + migrated-gates + wrapup-pipeline + run-cost-budget →
  158 pass / 0 fail. `apps/cli`: workflow-decision-scan + commands/builder/pr +
  script-absorption-pr7/pr5 parity → 90 pass / 0 fail. `scripts`: eval-pipeline +
  workflow-promotion → 51 pass / 0 fail. `plugins/sp`: retired-workflow-refs → 6 pass / 0 fail.
- Typechecks: `@gobing-ai/spur-app` and `@gobing-ai/spur` both exit 0.
- `spur task gate 1251 light`: 8 of 9 checks PASS (biome on 18 changed files, both rule presets,
  both typechecks, all four workspace test sets). Receipt `.spur/run/1251-check-receipt.json`.
- **Public-surface probe (R1).** `cd "$PROBE" && HOME="$PROBE" XDG_CONFIG_HOME="$PROBE/.config" timeout 120 bun "$TREE/apps/cli/src/index.ts" workflow list --json --no-logo`
  → exit 0, `"totalFiles": 6`, entries task-lifecycle, feature-lifecycle, idea-pipeline,
  history-anatomy, task-pipeline, wrapup-pipeline. Neither retired name resolves.
- **Public-surface probe (R5).** `bun apps/cli/src/index.ts builder pr --help --no-logo` prints the
  spine help; `builder pr status --json` from a throwaway dir prints exactly
  `spur builder pr status is deprecated; use spur builder pr-status` (one line);
  `builder pr-check --help` prints usage. Alias kept, flat verbs live.

**Residual, out of implement scope:** `rules:post` fails on `coverage-artifact: stale-tree` — the
coverage certification describes the pre-change tree, and its only documented recovery is a
canonical full-suite run (`bun run test:full`), which is the pipeline's `test` hop. The
`recommended-post-check` rules themselves have no violation attributable to this diff; the
`coverage-gate` errors it reports are on files this task never touched
(`packages/domain/src/db.ts` and siblings) and are read from the stale tracefile. The certified
tracefile was restored byte-identical (digest `8668c440…`) after a root-level targeted run had
clobbered it. Docs/design + `docs/03` + CHANGELOG sweep and the stale seeded copies under
`~/.config/spur/workflows` belong to task 1252.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Both YAMLs deleted; bundle has exactly 6 definitions; budgets clean; live `workflow list --json` probe (fresh HOME) names neither |
| R2 | MET | `pr-reviewing/SKILL.md:42,64,126-157` flat-verb sequence with verdict gates; `dev-pr-review.md:20,40`; README:351 drops the YAML |
| R3 | MET | `pipeline-resolution.md` deleted, `references/` gone; contract folded into `wayfinder/SKILL.md:149,155` |
| R4 | MET | `pr-review/index.ts:1-8,1026`, `packages/app/src/services/done-transition-guard.ts:7`; zero retired-name hits in `packages/app/src` |
| R5 | MET | Alias live (deprecation line verified); one doc home at `plugins/sp/skills/spur-cli/references/builder.md:100`; all other pages pinned clean |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution | MET | test | Both YAMLs deleted; bundle has exactly 6 definitions; `workflow list --json` probe on a fresh HOME names neither |
| R11 — Callers, skills and docs describe only the surviving workflows | MET | test | skills/commands/README and packages/app source describe the surviving workflows and the direct verbs; alias kept and documented once |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS** (confidence HIGH) — full-dimension review (functional traceability + SECUA + architectural depth), `--focus all`. Answer artifact: `.spur/run/bf577019-d726-415a-8700-b30017cbac5e-review-answer.txt`; canonical verdict `.spur/run/1251-verdict.json`.

- **R1–R5: all MET.** Both YAMLs deleted, bundle regenerated to 6 definitions, budgets cleaned; live `spur workflow list --json` probe from a fresh HOME names neither retired workflow; skills/commands/README describe the flat `spur builder pr-status|pr-check|pr-open|pr-review` sequence with no workflow state order; wayfinder resolution folded into the skill body with the reference deleted; app source and `done-transition-guard.ts` name the spines only as retired; the deprecated `spur builder pr` alias is kept, live (deprecation line verified), and documented in exactly one place.
- **AC1 [R1] / AC2 [R11]: MET** on executable evidence — re-run in this review: plugins/sp retired-workflow-refs 6/6, run-record-catalog + skill-structure 104/104; packages/app pr-review + replay-matrix + migrated-gates + wrapup-pipeline 138/138; apps/cli workflow-decision-scan + builder/pr 34/34; scripts eval-pipeline + workflow-promotion 51/51. All 0 fail.
- **Findings:** none (no P1–P4). The new pinning test's attestation exemption is correctly scoped to `plugins/sp/tests/**/*.test.ts`; the skill-structure budget bump (+444 B) is mandated absorption of the deleted reference; the pr9 replay fixture is frozen parity evidence, deliberately kept.
- **Residual (informational, not an open finding):** `rules:post` coverage-artifact stale-tree belongs to the pipeline's `test` hop (canonical full-suite re-certification); no violation is attributable to this diff.

**SECU findings** (review — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)
- 2026-10-18T22:50:13.093Z todo → wip (system)
- 2026-10-18T23:02:19.462Z wip → testing (system)
- 2026-10-18T23:02:28.435Z testing → done (system)

