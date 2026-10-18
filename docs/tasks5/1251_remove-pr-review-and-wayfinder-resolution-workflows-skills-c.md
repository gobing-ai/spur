---
schema_version: 1
name: Remove pr-review and wayfinder-resolution workflows; skills call the verbs directly
status: todo
template: feature-impl
created_at: 2026-10-18T05:10:06.872Z
updated_at: "2026-10-18T05:53:34.282Z"
feature_id: D66
priority: P1
tags:
  - workflow
  - builder
  - wayfinder
  - breaking

estimate_hours: 6
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

- [ ] R1. config/workflows/pr-review.yaml and wayfinder-resolution.yaml are deleted, are absent from the rebuilt apps/cli/config bundle, and their config/pipeline-budgets.json entries are removed. `spur workflow list --json` from a project without seeded copies names neither.
- [ ] R2. /sp:dev-pr-review and sp:pr-reviewing describe their modes (status, review, submit, fix, rerun, collect) as direct `spur builder pr-*` verb sequences. No text refers to a workflow state order, and the plugin README row drops `pr-review.yaml`.
- [ ] R3. sp:wayfinder keeps its investigate procedure as a skill procedure. references/pipeline-resolution.md is removed, and no wayfinder file names the workflow.
- [ ] R4. packages/app/src/services/pr-review/index.ts doc text and `PR_REVIEW_HELP`, plus packages/app/src/services/done-transition-guard.ts:7, stop naming the deleted workflows.
- [ ] R5. The hidden deprecated `spur builder pr` alias is kept. No skill, command, agent or workflow invokes it; they call `spur builder pr-status | pr-check | pr-open | pr-review`.

Out of scope: removing stale seeded copies from existing `~/.config/spur/workflows` (init never deletes; 1252 documents the cleanup); feature-verification (1246).

### Acceptance Criteria

- [ ] AC1 — The bundled workflow set no longer ships feature-verification, pr-review or wayfinder-resolution (req: R1)
- [ ] AC2 — Callers, skills and docs describe only the surviving workflows (req: R2, R3, R4, R5)

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

- [ ] 1. Failing check (R1, R3, R4, R5): a plugins/sp test asserts that no file under plugins/sp, packages/app/src or config/ names `pr-review.yaml` or `wayfinder-resolution`, and that no plugin markdown invokes `spur builder pr` without a `-<verb>` suffix.
- [ ] 2. Rewrite dev-pr-review.md, the pr-reviewing SKILL.md, the README row and the wayfinder SKILL.md link (R2, R3).
- [ ] 3. Delete the two YAML files, the wayfinder reference and the budget entries. Rebuild the bundle (R1).
- [ ] 4. Fix the pr-review module text and the done-transition-guard comment (R4).
- [ ] 5. Update the tests listed in Design. Run targeted tests in plugins/sp, packages/app, apps/cli and scripts, then `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-18T05:21:28.222Z feature_id Q → D66 (system)

