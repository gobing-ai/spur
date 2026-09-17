---
schema_version: 1
name: "idea-pipeline robustness: verbatim idea artifact, requirement inventory + coverage gate, task-check-aware stage prompts, --from-file, inline trace startedAt"
status: todo
template: issue
created_at: 2026-09-17T18:10:46.487Z
updated_at: "2026-09-17T21:32:40.674Z"

feature_id: I12
---

## 0887. idea-pipeline robustness: verbatim idea artifact, requirement inventory + coverage gate, task-check-aware stage prompts, --from-file, inline trace startedAt

### Background

Source: `/sp:dev-review-session --triage` over the inline `/sp:dev-idea --auto` run `3c754764-3ea9-4746-a8de-5e30f3bb2aaf` (2026-09-17, feature H13, tasks 0883–0886) plus the operator's report that long or complex idea drafts lose their trailing content in earlier runs ("more focusing on the leading part and no hints or any clue for the further follow up").

Already fixed inline by the triage (not in scope here): gate-vocabulary rule in `ac-style-guide.md` § Scenario-title stability; task-check hints in `decomposition.md` § Idea-pipeline emission; `create --json` envelope (`.ref.id`) in `spur-cli/references/features.md`; "pass the idea verbatim through every hop" note in `commands/dev-idea.md`.

Evidence of the remaining defects (all read-only checks in the review session):

- **Idea text has no durable artifact.** `config/workflows/idea-pipeline.yaml` carries the idea only as `vars.idea`, interpolated into the `start` note, the discovery prompt and the feature-create prompt; ac-generate, decompose and ready-prepare never see it. In the inline path the text is re-typed by the model at the command→skill hop: the nested `sp:spur-dev` invocation in this run carried a shortened paraphrase of the operator's idea (the five-bullet flag list collapsed into one sentence). A cheaper model at that hop loses the tail of a long draft with no way to recover it.
- **No requirement inventory or coverage check.** `idea-evaluation.md` (80 lines) and `sp:brainstorm` produce scores, premises, approaches and an "enhanced idea", but nothing enumerates the operator's explicit asks as numbered items, and neither ac-generate nor decompose is asked to map scenarios back to them. Coverage of the original ask is therefore unmeasured; the `idea-ac-check` gate only validates BDD shape.
- **Task-check vocabulary cost two rework cycles.** All four created tasks failed `L4.uncovered-task-scenario` (AC bullets were not scenario titles) and `L4.gate-language` (the gate-vocabulary words now listed in `ac-style-guide.md` § Scenario-title stability, including an enum value), forcing a feature scenario rename (R6) and an enum rename (the old value was itself a gate word; now `confirm`) after AC and design were already operator-accepted. The decompose and ac-generate stage prompts do not mention either rule (docs now do; the prompts still do not).
- **Feature-create id parse failed once.** Run log 17:44:15 "feature undefined (parent H1)" — the model read `.id` from `spur feature create --json` whose envelope is `{ref:{id}}`; corrected by hand at 17:44:22. The stage prompt says only "Use `spur feature create "<name>" --json`".
- **Inline trace action rows have zero span.** `spur workflow trace 3c754764… --json` shows discovery `startedAt == completedAt == 17:42:49.470Z` with `durationMs: 120000`; the inline `--action` path finalizes with the supplied duration but never back-dates `startedAt`, so trace durations and timestamps disagree.
- **Setup overhead before the first stage.** Run row `startedAt 17:36:39Z`, first log line `17:40:31Z`: 3:52 of reference reading before `start` executed; the inline driver has no idea-specific quick-start checklist naming the minimum files to read.

### Requirements

- [ ] R1. The idea text is persisted verbatim to `.spur/run/<runId>-idea-input.md` before discovery, in both drivers: the `start` state writes `$idea` through a shell action for headless runs, and the inline driver writes the operator's argument text unmodified before executing `start`. The precheck fails the run when the file is empty.
- [ ] R2. Every model-bearing stage prompt (discovery, feature-create, ac-generate, system-design, decompose, ready-prepare) references `.spur/run/<runId>-idea-input.md` as the authoritative ask instead of, or in addition to, `${vars.idea}`.
- [ ] R3. The idea-evaluation report carries a `## Requirement inventory` section: one numbered item `I<n>` per explicit ask in the input, each quoting or closely paraphrasing its source line, plus an `unclear` marker where the ask is ambiguous. `idea-evaluation.md` owns the template.
- [ ] R4. Acceptance-criteria generation maps coverage: each scenario lists the inventory items it covers (a `# covers: I1, I3` comment line inside the Gherkin scenario or an equivalent documented form), and a deterministic run-scoped check reports any inventory item not covered by at least one scenario. Uncovered items route through the existing capped ac-generate retry loop under `profile=auto` and surface in the interactive feature-check prompt otherwise; an explicit `deferred` disposition in the inventory is allowed and exempts the item.
- [ ] R5. The ac-generate and decompose prompts state the two task-check rules the docs now carry: AC bullets are exact scenario titles, and the `L4.gate-language` words are forbidden in titles, section bodies and enum values.
- [ ] R6. The feature-create prompt names the `--json` envelope (`.ref.id`) so the id is read correctly on the first attempt.
- [ ] R7. `/sp:dev-idea` accepts `--from-file <path>` as an alternative to the positional idea (mutually exclusive; the file body becomes the idea text, no shell quoting). Flag glossary, `dev-operations.md` § idea and the command file are updated together; this is a plugin command flag, not a public `spur` noun/verb.
- [ ] R8. Inline `--action` trace rows back-date `startedAt` by `durationMs` so `completedAt - startedAt == durationMs` in `spur workflow trace --json`.
- [ ] R9. Workflow YAML changes regenerate `apps/cli/config/` via `build:bundle`, refresh the tracked contract baseline for the new definition digest, and keep `inline-pipeline-parity-check` green.

### Acceptance Criteria

- [ ] R1 — Idea text persists verbatim as a run artifact in both drivers
- [ ] R2 — Discovery emits a numbered requirement inventory
- [ ] R3 — Coverage gate routes uncovered inventory items back to ac-generate
- [ ] R4 — Stage prompts carry the checker rules and the create envelope
- [ ] R5 — dev-idea accepts --from-file
- [ ] R6 — Inline trace action rows carry a consistent span
- [ ] R7 — Generated bundle and baselines stay green

Task-local checks: `spur task check` on a freshly created batch shows no L4 gate-language or uncovered-scenario findings; `spur workflow trace <run> --json` action rows satisfy `completedAt - startedAt == durationMs`.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**Placement.** Idea persistence and prompts live in `config/workflows/idea-pipeline.yaml` (SSOT; `apps/cli/config/` is generated). Inventory template lives in `plugins/sp/skills/spur-dev/references/idea-evaluation.md`; brainstorm's idea path (`plugins/sp/skills/brainstorm/SKILL.md`) points to it. Coverage check is a small script under `plugins/sp/scripts/` (jq-free, Bun) invoked as a `command.gate` with `softFail: true` writing `.spur/run/<runId>-idea-coverage.status`, following the `idea-ac-check` pattern (0769) so guards consume a recorded result and never re-run the CLI.

**Inventory form.** Numbered `I<n>` items under `## Requirement inventory`, each `- I<n> — <ask> (source: "<quoted fragment>")`, optional trailing `[deferred: <reason>]`. The coverage script parses the eval report and the AC content file; a scenario covers items via a `# covers: I1, I3` line placed directly under its `Scenario:` line (comments are legal Gherkin and ignored by the BDD checker — verify against `spur feature check` before choosing this form; fall back to a trailing `covers:` list in the scenario title's docstring if the checker rejects comments).

**Drivers.** Headless: `start.onEnter` adds `printf '%s\n' "$idea" > .spur/run/$__runId-idea-input.md`. Inline: `inline-pipeline-driver.md` gains an idea-specific quick-start block (files to read, the verbatim-persist step first, expected artifacts per stage) so a cheaper model does not spend minutes discovering the procedure.

**`--from-file`.** The command reads the file and passes its body as the idea; when both a positional idea and `--from-file` are given, stop with a usage error. Headless mode passes the body via `--vars` JSON exactly as today.

**Trace fix.** In the inline `--action` path (`plugins/sp/scripts/inline-run-setup.ts` → `recordAction` in `packages/app/src/workflow/action-trace.ts` or the writer it wraps), compute `startedAt = now - durationMs` when the row is created and finalized in one call. Add a unit test on the writer.

**Out of scope.** Changing `--auto`/taste-gate semantics; nesting or splitting pipeline states; public `spur` noun/verb additions; per-task Design content rules.

### Plan

1. Read `idea-pipeline.yaml` start/discovery/feature-create/ac-generate/decompose prompts, `idea-evaluation.md`, `brainstorm/SKILL.md` idea path, `inline-pipeline-driver.md`, `inline-run-setup.ts`, `action-trace.ts`.
2. Add `-idea-input.md` persistence to `start` and the inline driver; reference it from every stage prompt (R1, R2).
3. Add `## Requirement inventory` to `idea-evaluation.md`; update the discovery prompt to require it (R3).
4. Add the `covers:` form to `ac-style-guide.md` § Gherkin template and the ac-generate prompt; write `plugins/sp/scripts/idea-coverage-check.ts` + test; wire it as a `command.gate` after `idea-ac-check` with retry/interactive routing (R4).
5. Extend ac-generate and decompose prompts with the two task-check rules; extend feature-create prompt with `.ref.id` (R5, R6).
6. Add `--from-file <path>` to `commands/dev-idea.md`, `flag-glossary.md`, `dev-operations.md` § idea (R7).
7. Back-date `startedAt` in the inline action record path; unit test (R8).
8. `bun run --filter @gobing-ai/spur build:bundle`; refresh the contract baseline; `bun run inline-pipeline-parity-check`; `bun run validate-commands`; plugin tests (R9).
9. Dry-run `/sp:dev-idea --from-file <a long multi-ask draft>` on a scratch feature: confirm `-idea-input.md` equals the file, the inventory lists every ask, the coverage gate reports uncovered items, then delete the scratch feature/tasks through the CLI.

### Root Cause

The idea text is a transient workflow var, not a run artifact: nothing downstream of discovery can re-read the operator's original ask, and no stage measures coverage of it. Stage prompts predate the L4 task-check rules and the `--json` envelope, so cheaper models rediscover both by failing. The inline trace `--action` path records a duration without a start time.

### Solution

Placement follows the Design: pipeline mechanics in `config/workflows/idea-pipeline.yaml` (SSOT; `apps/cli/config/` regenerated by `build:bundle`), model-facing templates in `plugins/sp/skills/**`, the coverage gate as a plugin script, and the trace span fix in the app-layer writer.

- R1 — `config/workflows/idea-pipeline.yaml:97-104` (start shell writes `printf '%s\n' "$idea" > .spur/run/$__runId-idea-input.md`, then an `awk 'NF'` whitespace-aware emptiness gate writes `-idea-precheck-doctor.status` FAIL; a bare `test -s` would pass a newline-only file); `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:163-192` (idea-pipeline quick-start: persist verbatim FIRST, per-stage artifact table).
- R2 — every model-bearing stage prompt names `.spur/run/<runId>-idea-input.md` as the authoritative ask: discovery (`idea-pipeline.yaml:117-119`), feature-create (:151-153), ac-generate (:202), system-design (:298), decompose (:365), ready-prepare (:456-458).
- R3 — `plugins/sp/skills/spur-dev/references/idea-evaluation.md:35-41` (mandatory `## Requirement inventory` template: `- I<n> — <ask> (source: "...")`, `[unclear: ...]` still owes coverage, `[deferred: <reason>]` exempts); discovery prompt requires it (`idea-pipeline.yaml:119-120`); `plugins/sp/skills/brainstorm/SKILL.md:200-203` points discovery at the template.
- R4 — `plugins/sp/scripts/idea-coverage-check.ts` (node-builtin-only; parses the inventory section, cross-checks `# covers:` comments, writes `-idea-coverage.status`, always exits 0 — 0769 soft pattern) + `plugins/sp/tests/idea-coverage-check.test.ts`; soft shell wired after `idea-ac-check` (`idea-pipeline.yaml:234-250`); profile=auto guards conjunct the recorded coverage status (:595-646) and the interactive feature-check prompt surfaces it (:268-270); `ac-style-guide.md:206-217` documents the checker-inert `# covers:` Gherkin form; `config/plugin-scripts.json` registers the script (repo-only).
- R5 — ac-generate prompt states both task-check rules: AC bullets copy scenario titles byte-identically; `L4.gate-language` words forbidden in titles, bodies, enum values (`idea-pipeline.yaml:203`).
- R6 — feature-create prompt names the `--json` envelope: id under `.ref.id`, not top-level `.id` (`idea-pipeline.yaml:154`).
- R7 — `plugins/sp/commands/dev-idea.md` (`--from-file <path>` flag row + verbatim-persist step), `plugins/sp/skills/spur-dev/references/flag-glossary.md:297-306`, `dev-operations.md § idea` (:337-348) updated together; mutually exclusive with the positional idea; plugin command flag, no public spur noun/verb.
- R8 — `packages/app/src/workflow/action-trace.ts:206-235` (`backdateStart`: `started_at = stored completed_at - durationMs`, anchored on the stored stamp so the equality holds by construction; best-effort `action.backdate` failure recording; db ref threaded through `createWorkflowActionTraceWriter`); driver `--action` contract doc updated (`inline-pipeline-driver.md:460-462`).
- R9 — `guard-parity.test.ts:289-299` retires the 0874 one-shot `changedGuards > 0` rewrite assertion with a baseline-protocol comment (execution parity vs the refreshed fixture remains); `guard-parity-baseline.json` regenerated for the new idea-pipeline guard text; `idea-pipeline-definition.test.ts:576-674` adds the 0887 definition contract tests (R1-R6 assertions); `build:bundle` regeneration + `inline-pipeline-parity-check` / `script-contract-check` / `validate-commands` green.

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
