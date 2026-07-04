---
template: feature-impl
schema_version: 1
name: "Fix spur init + /sp:spur-init: full package scaffold and ownership contract"
description: ""
status: todo
type: task
profile: standard
feature_id: A1
parent_wbs: null
priority: P0
tags: ["approach-c", "cli", "bug"]
dependencies: []
created_at: "2026-07-03T23:35:28.251Z"
updated_at: "2026-07-03T23:49:19.376Z"
---

## 0188. Fix spur init + /sp:spur-init: full package scaffold and ownership contract

### Background

Cycle position P0 (decision D1, docs/plans/2026-07-03-feature-cycle-prioritization-brainstorm.md). Fresh-project initialization is broken in two ways today: (1) there is no clear ownership cut between `spur init` (CLI) and `/sp:spur-init` (sp-plugin skill) — both do partial scaffolding; (2) a fresh project receives insufficient config files compared to the canonical tree in this repo. The target contract: `spur init` copies the COMPLETE canonical scaffold from its bundled npm package config (`bundledConfigRoot()`), and `/sp:spur-init` is a thin adapter that always calls `spur init` first, then only adapts content (project name, docs customization) — it never creates scaffold files itself.

Current state: `apps/cli/src/commands/init.ts` (241 lines) drives scaffolding from `SCAFFOLD_MANIFEST` (`apps/cli/src/config/scaffold-manifest.ts`) — rules presets, 8 workflows, section-matrix, 5 task templates, feature/bdd templates, preserve-marked docs stubs, plus global `~/.config/spur` seeding. One verified gap: `TASK_VARIANTS` (packages/domain/src/planning/schema.ts:105) has 6 variants but the manifest ships only 5 task templates — `brainstorm.md` is missing. The full gap set must be established by audit (R1), not assumed. The skill side lives in `plugins/sp/commands/spur-init.md` + `plugins/sp/skills/spur-init/`.

### Requirements
- [ ] R1 — Audit: produce a gap matrix diffing the canonical config tree (`config/` in this repo: rules incl. category dirs, workflows, tasks, templates) plus project-root scaffolds against what `spur init` writes on a fresh directory. Record the matrix in this task's Design section before coding.
- [ ] R2 — Extend `SCAFFOLD_MANIFEST` to close every gap found in R1 (at minimum the missing `brainstorm.md` task template), keeping the manifest as pure data (no control-flow changes in init.ts beyond what a new entry class genuinely requires).
- [ ] R3 — Document the ownership contract in `docs/04_DESIGN.md` (init = file copying from package; skill = content adaptation only) in the same commit (doc-sync trigger).
- [ ] R4 — Rewrite `/sp:spur-init` (command + skill) to invoke `spur init` as its first materialization step and remove any file-creation logic that duplicates the CLI scaffold; the skill only edits content afterward.
- [ ] R5 — Regression tests: fresh-dir init is immediately functional — `spur task create`, `spur workflow validate .spur/workflows/task-pipeline.yaml`, and `spur rule run --preset recommended-pre-check` all work without manual fixes (extend `apps/cli/tests/commands/init.test.ts`).
- [ ] R6 — `spur init --force` still never overwrites preserve-marked docs; `--minimal` behavior unchanged (both covered by tests).
- [ ] R7 — Full gate green: `bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`.
### Acceptance Criteria
```gherkin
Feature: Init scaffold ownership contract

  Scenario: Fresh init writes the complete scaffold
    Given an empty project directory
    When spur init runs without flags
    Then every SCAFFOLD_MANIFEST entry exists on disk
    And .spur/tasks/templates contains one template file per TASK_VARIANTS variant

  Scenario: Fresh scaffold is immediately functional for planning commands
    Given a freshly initialized project
    When spur task create "probe" runs
    Then a task file is created without missing-template or missing-matrix errors

  Scenario: Fresh scaffold workflows validate
    Given a freshly initialized project
    When spur workflow validate .spur/workflows/task-pipeline.yaml runs
    Then the workflow is reported valid with exit code 0

  Scenario: The skill delegates scaffolding to the CLI
    Given a fresh project initialized via /sp:spur-init
    When the skill flow completes
    Then all scaffold files on disk match what spur init writes
    And only doc contents were adapted by the skill

  Scenario: Re-init preserves customized docs
    Given an initialized project with customized preserve-marked docs
    When spur init --force runs
    Then preserve-marked docs are not overwritten
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**Approach.** Manifest-driven parity: `spur init` scaffolds exclusively from `SCAFFOLD_MANIFEST` (`apps/cli/src/config/scaffold-manifest.ts`, pure data) reading `bundledConfigRoot()` sources. The fix is (a) close the manifest's gaps against the canonical tree, (b) make the sp skill a strict adapter over the CLI. No new scaffolding mechanism — extend the existing one.

**Audit findings (R1 — completed 2026-07-03).** Ran `spur init --name probe-project` in an isolated temp dir (`SPUR_GLOBAL_RULES_DIR` redirected), diffed the scaffolded tree against `config/`, and ran the three functional probes (`task create`, `workflow validate`, `rule run --preset recommended-pre-check`).

| Canonical source | Scaffolded today? | Action |
|---|---|---|
| `templates/task/brainstorm.md` | NO — the source file already exists in `config/templates/task/brainstorm.md`; `TASK_VARIANTS` (packages/domain/src/planning/schema.ts:105) has 6 variants but `SCAFFOLD_MANIFEST` ships only 5 task-template entries. Confirmed functionally: `spur task create ... --template brainstorm` in a fresh dir silently falls back to a bare frontmatter stub (no error, no real template body) because `.spur/tasks/templates/brainstorm.md` doesn't exist. | Add one `SCAFFOLD_MANIFEST` entry: `{ source: 'templates/task/brainstorm.md', target: 'tasks/templates/brainstorm.md' }`. No new bundled content needed — the source already exists. |
| Rule category dirs (`typescript/`, `structure/`, `boundary/`, `surface/`, `ui/`, `strict/`, `migration/`) under `config/rules/**/*.yaml` | NOT scaffolded to local `.spur/rules/` (manifest only ships the two flat presets `recommended-pre-check.yaml` / `recommended-post-check.yaml`) — but confirmed **not a gap**: `seedGlobalRules()` (via `@gobing-ai/ts-rule-engine`'s `bundledRulesRoot()`/`listBundledRuleFiles()`) copies every category file to `~/.config/spur/rules/**` on first `spur init`, and the rule-root resolution chain (`SPUR_RULES_PATH` → local → global → bundled) already lets `extends: [typescript, structure, boundary, surface, ui]` resolve from the global seed. Verified: `spur rule run --preset recommended-pre-check` in the fresh probe dir loaded all 29 rules (5 category extends resolved) with zero "preset not found" / "extends not found" errors. | No manifest change. Document the resolution chain explicitly in `04_DESIGN.md` §2.3 so this isn't re-litigated. |
| `rule run --preset recommended-pre-check` returns 21 `rg failed (exit 2): No files were searched` findings on the fresh probe dir | Root cause confirmed: this is **not** a scaffold gap. `config/rules/typescript/bun-tooling.yaml`, `boundary/*.yaml`, `surface/*.yaml` etc. hardcode `include: ["apps/**/*.ts", "packages/**/*.ts", ...]` globs specific to *this repo's own* monorepo layout (Spur dogfoods its own preset). A fresh project with no `apps/`/`packages/` dirs has zero matching files, so `rg` exits 2 ("no files searched") and the evaluator surfaces that as a rule finding rather than a clean skip. AC scenario 3 only requires `workflow validate` to pass (confirmed exit 0) — it does not require `rule run` to be finding-free. | Out of scope for 0188 — this is rule-content genericity, a separate concern from scaffold completeness. Not an R2 action item; flagged here for a future task. |
| `docs/04_DESIGN.md` §2.3 template inventory listing | Stale — lists `task/{default,feature-impl,issue,review,meta}.md` (5 entries), omitting `brainstorm` | Update the listing in the same commit as the manifest fix (R3, doc-sync trigger). |
| `plugins/sp/skills/spur-init/` | Does **not exist**. The task Background's premise ("The skill side lives in `plugins/sp/commands/spur-init.md` + `plugins/sp/skills/spur-init/`") is factually wrong for the second path — confirmed via filesystem search; the only `spur-init` surface is the single command file `plugins/sp/commands/spur-init.md`. | R4 scope reduced accordingly — no skill directory to restructure. |
| `/sp:spur-init` command's scaffold-vs-adapt split | Already correct: "Phase 1 — Deterministic scaffold (`spur init`)" runs first, "Phase 2 — Non-deterministic customization" delegates every doc touch to `sp:doc-evolve`. No file-creation logic in the command duplicates `SCAFFOLD_MANIFEST` output — confirmed by reading the full command body; it only invokes `spur init` (Bash) then `Skill(skill="sp:doc-evolve", ...)`. | R4 requirement already substantially satisfied. Action: tighten Phase 1's doc comment to explicitly name the ownership contract (file materialization vs. content adaptation) per R3, and add a Phase 1.5 validation step (`spur task create` / `spur workflow validate` probe) per the Design's original Plan item 3 ("validate: `spur status`, probe `spur task create`, `spur workflow validate`") — currently the command does not run this validation step at all. |

**Ownership contract (R3, R4).** `04_DESIGN.md` gains a short "init ownership" subsection: `spur init` = file materialization from the package (idempotent, `--force`-aware, preserve-marked docs never clobbered); `/sp:spur-init` = content adaptation only (project naming, docs customization, optional feature/task seeding via the normal CLI verbs) plus a post-scaffold validation probe. The command file is amended to: (1) run `spur init` [already present], (2) adapt contents via `sp:doc-evolve` [already present], (3) validate (`spur status`, probe `spur task create`, `spur workflow validate`) [missing — add].

**Testing shape (R5, R6).** Extend `apps/cli/tests/commands/init.test.ts`: a manifest-completeness invariant (every `TASK_VARIANTS` variant has a template entry; every manifest `source` exists under the bundled config root — this test is what prevents the next drift), plus a functional probe asserting `brainstorm.md` is scaffolded. Hermetic runs set `SPUR_GLOBAL_RULES_DIR` (suppresses the bundled fallback — existing convention, already used throughout `init.test.ts`).

**Constraints.** `--minimal` semantics unchanged (confirmed: `--minimal` skips `.spur/rules` and `.spur/workflows` entirely; unaffected by the new manifest entry, which lives in the non-minimal path only, matching all existing task-template entries). Preserve entries keep `writeIfNew(force=false)` behavior. Skill edits must keep `plugins/sp` structural tests (R-suite) green — no `vendors/` references (sp-no-vendor-refs rule).

**Decomposition guidance.** Confirmed: fits one task. The audit did not surface a large bundled-content gap requiring authorship — `brainstorm.md`'s source content already exists; only the manifest wiring and the command validation step are missing. No subtask split needed.

**Dependencies.** None — independent of all other cycle tasks (0189–0197).
### Plan
- [ ] Audit: `spur init` into a temp dir; diff against canonical `config/` + root scaffolds; fill the gap matrix in Design (R1).
- [ ] Close bundled-content gaps at the source (e.g. author `templates/task/brainstorm.md` if absent from the bundled config root), then add the missing `SCAFFOLD_MANIFEST` entries (R2).
- [ ] Add the manifest-completeness test (variants ↔ templates; manifest sources exist) + fresh-dir functional probes: `task create`, `workflow validate .spur/workflows/task-pipeline.yaml`, `rule run --preset recommended-pre-check` (R5).
- [ ] Verify `--force` preserve behavior + `--minimal` unchanged with tests (R6).
- [ ] Rewrite `/sp:spur-init` command + skill: `spur init` first, adaptation only after, validation step at the end; delete duplicated file-creation logic (R4).
- [ ] Sync `docs/04_DESIGN.md` with the ownership contract in the same commit (R3).
- [ ] Gate: `bun run lint && bun run test && bun run test-cf && bun run build`; `bun run spur-check` (R7).
- [ ] Manual end-to-end: initialize a brand-new temp project via `/sp:spur-init`; confirm the AC scenarios pass by hand.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

A1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
