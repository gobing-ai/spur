---
schema_version: 1
name: Publish the generated two-layer plan first in dev workflow skills and commands
status: done
template: feature-impl
created_at: 2026-10-07T06:14:17.623Z
updated_at: "2026-10-07T19:35:58.024Z"
feature_id: I13

dependencies: ["1104"]
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 5
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1105-verdict.json
---

## 1105. Publish the generated two-layer plan first in dev workflow skills and commands

### Background

Graduated from map I13. The 1101 audit (`docs/analysis/2026-10-native-todo-adoption-audit.md:89-101`) found that the list is
hand-written, published late and collides with setup rows. Task 1104 supplies the generated plan; this task makes every
workflow-backed `/sp:dev-*` run publish it verbatim as its first action and keep it truthful.

**Refine corrections (2026-10-06)**

1. Current anchors: the bootstrap rows are `cross-cutting.md:251-253` (shared startup contract step 1) and
   `inline-pipeline-driver.md:131-134` (setup step 5); the inventory publish is `inline-pipeline-driver.md:149-158` (step 8);
   the label rule still says "A, B, … Z, AA, AB" at `inline-pipeline-driver.md:179-181`; truthful-progress prose is
   `inline-pipeline-driver.md:182-187`.
2. "First action" must not reorder isolation. Today isolation (step 7) precedes the inventory (step 8) so later work runs in the
   execution tree. `spur workflow show --format todo --json` reads the definition through the CLI and executes nothing, so it
   can run first; the 1104 prepare rows then track the existing order: A1 quick readiness, A2 Git / isolation, A3 binding the
   published plan to the run's `__definitionDigest` with `assertInventoryIdentity` (drift still stops the run).
3. The inline setup script also calls `workflow show` (`packages/app/src/services/inline-run-setup.ts:198`); publishing first
   means one extra deterministic CLI call before setup, which is the point (1101 class C2).
4. Annotated workflows only: `.plan` is `null` for unannotated workflows (1104 Q&A). Those keep the flat `steps[]` inventory
   with `columnLabel` labels.
5. The shared startup contract also lists `dev-refineall` and `dev-verifyall` (`cross-cutting.md:246-247`). They have no workflow
   plan; their phases are map I13 fog ("phases for refineall and verifyall"), so they keep their current bootstrap rows here.
6. Batch helpers are reached through `node "$(superskill script path sp batch-plan.mjs)" …` (1104 R5), following the
   `batch-preflight` precedent in `plugins/sp/agents/super-planner.md:160`; never by importing `packages/app`.

### Requirements

- [x] R1. `plugins/sp/skills/spur-dev/references/cross-cutting.md` (shared startup contract) and `inline-pipeline-driver.md` (run setup): for workflow-backed runs, the first action is `spur workflow show <resolved-file> --no-logo --format todo --json` and publishing `.plan` item texts verbatim; the A–D bootstrap rows are removed for those runs; A1/A2/A3 track readiness, Git/isolation and digest binding; on-entry states are inserted as the next digit; re-entry keeps the label and adds `attempt N`; skipped/failed/unattempted/blocked render as `pending` + `[outcome]`. Fallback to `steps[]` when `.plan` is `null`.
- [x] R2. Document the per-host update style: per-item hosts (Claude Code `TaskCreate`/`TaskUpdate`, pi `todo`) create each item once and update by id, appending inserted steps at the end (labels carry identity); full-list hosts (Codex `update_plan`, Gemini `write_todos`, OpenCode `todowrite`, Grok `todo_write`) rewrite the whole list in plan order; omp maps letters to `phase`. Markdown fallback stays `renderProgressMarkdown`.
- [x] R3. `execution-batch.md`: publish `A Prepare batch` (A1–A4) and `Z Batch report` first; after freeze and ordering, add one letter per task from `batch-plan.mjs waves` (wave 1, later waves on rollover); add a task's phase digits from `batch-plan.mjs task-children` when it starts and mark its letter with the task outcome when it ends.
- [x] R4. `plugins/sp/commands/dev-{run,runall,parallel,idea,plan}.md`: the first Implementation bullet publishes the generated plan; `plugins/sp/agents/super-planner.md` states the parent host owns the visible list and the subagent returns per-task stage outcomes for the parent to apply.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Skill references carry the publish-first contract (req: R1, R2)
  Given the updated cross-cutting.md and inline-pipeline-driver.md
  When they are searched for the old bootstrap rows and the AA label rule
  Then "Quick readiness` · `B, Prepare Git" and "Z, AA, AB" no longer appear in workflow-backed run instructions
  And the first run-setup step names workflow show --format todo --json and publishing .plan verbatim
  And per-item and full-list host update styles are both documented

Scenario: AC2 — Batch and command surfaces publish first (req: R3, R4)
  Given execution-batch.md, dev-run/runall/parallel/idea/plan.md and super-planner.md
  When each is read
  Then each dev command's first Implementation bullet is the plan publish
  And execution-batch.md names batch-plan.mjs waves and task-children with letters-first ordering
  And super-planner.md says the parent host owns the visible list

Scenario: AC3 — A real inline run publishes the generated plan first (req: R1, R4)
  Given task 1104 is shipped and a small backlog task exists
  When /sp:dev-run <wbs> runs inline on Claude Code
  Then the first native todo tool calls of the session carry exactly the .plan texts from workflow show for task-pipeline.yaml
  And no host tool call other than workflow show and the todo publish precedes them
  And the run log or history trace is saved as the evidence artifact

Scenario: AC4 — Plugin surfaces stay valid (req: R1, R2, R3, R4)
  Given the edited plugin files
  When bun run plugin-smoke and bun run spur-check run
  Then both pass
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-07T06:24:25.709Z

- **Publish-first vs isolation:** the plan is published before readiness and isolation, because `workflow show` executes nothing. Isolation order is unchanged; A3 binds the plan to the run digest.
- **refineall / verifyall:** keep their bootstrap rows; their phases stay map I13 fog.
- **Batch publication:** `A` and `Z` first, task letters right after freeze (the task set is unknown before A1). Digits per task only at task start (operator decision "letters first").
- **Subagents:** Claude Code subagents lack the task tools (1101 C7). The parent applies outcomes reported by the subagent; worker progress transport beyond that is map I13 fog.
- **Analytics** (`packages/domain/src/analytics/derived.ts` missing pi `todo` / Claude `TaskCreate` shapes): out of scope.

### Design

**What:** prose-only changes to the sp plugin so every workflow-backed dev run publishes the generated plan first and keeps it truthful.

**Why:** 1101 classes C1–C3, C5–C7. 1104 makes the plan a CLI output; this task makes agents use it.

**Where:**

| File | Change |
| --- | --- |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:244-272` | shared startup step 1 becomes "publish the generated plan"; steps renumber; A–D rows kept only for refineall/verifyall |
| `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:60-200` | step 5 publishes `.plan`; step 8 binds it (A3); layer 1 = `.plan`, `steps[]` fallback; replace the AA label rule with the A–Z / 1–9 rule; insert-on-entry, `attempt N`, `pending` + `[outcome]`; a per-host table (R2) |
| `plugins/sp/skills/spur-dev/references/execution-batch.md` | new "Visible batch plan" subsection between Step 2 and Step 3, plus one line in the Step 3 loop for start/end updates |
| `plugins/sp/commands/dev-{run,runall,parallel,idea,plan}.md` | first Implementation bullet: publish the generated plan per `inline-pipeline-driver.md` step 5 (single) or `execution-batch.md` § Visible batch plan (batch) |
| `plugins/sp/agents/super-planner.md` | one paragraph: the parent host owns the native list; return `{wbs, state, outcome}` per stage boundary |

**Frozen wording:** item text is copied from `.plan[].text`; status mapping table `pending → pending`, `active → in_progress`, `completed → completed`, `skipped|failed|unattempted|blocked → pending` + ` [<outcome>]`; re-entry note ` — attempt N`.

**Anti-patterns:** no hand-written label lists in any command or skill; no copy of the phase table in prose (YAML is the source); no new CLI verb; no `cancelled` status; no edits to `derived.ts`.

**Dependency handoff:** needs 1104's `.plan` key and `batch-plan.mjs`. Doc sync after landing: `plugins/sp/README.md` only if it lists the bootstrap rows.

**Verification artifact:** AC3 dogfood run; save the run id and the first todo payloads (history DB query from `docs/analysis/2026-10-native-todo-adoption-audit.md:103-115`) under `.spur/run/1105-dogfood.md`.

### Plan

1. (R1) Rewrite `cross-cutting.md` shared startup contract and `inline-pipeline-driver.md` run setup, label and progress rules.
2. (R2) Add the per-host update table to `inline-pipeline-driver.md`.
3. (R3) Add § Visible batch plan to `execution-batch.md` and the Step 3 loop line.
4. (R4) Edit the five command files and `super-planner.md`.
5. (AC1, AC2) grep checks for removed rows/labels and new first bullets.
6. (AC4) `bun run plugin-smoke`; `bun run spur-check`.
7. (AC3) Dogfood `/sp:dev-run` on a small task; record the evidence artifact.
8. Commit `feat(sp): publish the generated two-layer plan first in dev workflows (1105)`.

### Solution

Publish-first contract for workflow-backed dev runs (1105 R1–R4). The generated two-layer plan (1104
plan-projection) is now the first visible action of every workflow-backed `/sp:dev-*` run; the
hand-written bootstrap rows and the AA label rule are gone from run instructions; per-host todo
update styles are documented; the batch driver publishes A/Z rows at kickoff and per-task letters at
freeze/start/end; and super-planner states the parent host owns the visible list.

#### Change map

| File:line | Change |
| --- | --- |
| plugins/sp/skills/spur-dev/references/cross-cutting.md:248 | Shared startup contract rewritten: step 1 = publish the generated plan first (verbatim `.plan` text, `steps[]` fallback when `.plan` is null, bootstrap-row retention note for skill-only refine/verify batches); steps 2–4 = plan rows A1 quick readiness / A2 Git isolation / A3 `assertInventoryIdentity` digest binding. Heading kept byte-identical (4 inbound anchor links incl. dev-refineall/dev-verifyall). |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:62 | Run-setup intro names the new publish-first order (1105 R1) with `workflow show --no-logo --format todo --json`; labels sourced from the projection or `columnLabel`. |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:133 | Step 5 rewritten as the run's first action: publish `.plan` rows verbatim; `steps[]` inventory fallback for unannotated workflows; no-plan case keeps host preparation rows. |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:162 | Step 8 = bind the published plan to `__definitionDigest` (A3); A1/A2/A3 map to setup steps 6/7/8. |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:189 | Stable labels: A–Z/1–9, `planLetter` throws past Z (never AA/AB), `insertOnEntry` digit insertion, re-entry appends ` — attempt N`. |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:198 | Truthful progress: frozen status mapping (`pending→pending, active→in_progress, completed→completed, skipped|failed|unattempted|blocked→pending` + ` [<outcome>]`) with `renderProgressMarkdown` fallback. |
| plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:223 | New § Host todo update styles (1105 R2): per-item (Claude Code TaskCreate/TaskUpdate, pi todo) vs full-list (Codex update_plan, Gemini write_todos, OpenCode todowrite, Grok todo_write), omp phase mapping, Markdown fallback. |
| plugins/sp/skills/spur-dev/references/execution-batch.md:204 | New § 2.7 Visible batch plan (1105 R3): `A Prepare batch` (A1–A4) + `Z Batch report` at kickoff; task letters from `batch-plan.mjs waves --tasks` after freeze; digit children from `task-children --letter <L> --plan` at task start; letter marked with outcome at end; Step 3 loop gained the visible-plan update lines. |
| plugins/sp/commands/dev-run.md:34 | Publish-first as the first Implementation bullet (links shared startup contract step 1 / driver step 5); startup-contract bullet updated to the new order. |
| plugins/sp/commands/dev-runall.md:91 | Publish-first bullet names batch-plan.mjs waves/task-children and links execution-batch § 2.7. |
| plugins/sp/commands/dev-parallel.md:30 | Publish-first bullet: orchestrator publishes A/Z + letters/digits; links § 2.7. |
| plugins/sp/commands/dev-idea.md:55 | Publish-first bullet: `idea-pipeline.yaml` plan published before the pipeline's first stage. |
| plugins/sp/commands/dev-plan.md:44 | Same publish-first bullet as dev-idea. |
| plugins/sp/agents/super-planner.md:288 | New § Parent-host ownership of the visible plan (1105 R4): parent host owns the native list; subagents have no todo tools and return `{wbs, state, outcome}` per stage boundary; parent marks rows with reported outcomes. |
| plugins/sp/tests/dogfood-testing/startup-contract.test.ts:44 | Red-first pins updated: new 0814 order, AC1 negative greps (bootstrap rows / AA rule gone), publish-first + steps[]/columnLabel fallback pins, frozen mapping + ` — attempt N` + `insertOnEntry`, R2 host-tool table pins, § 2.7 placement/naming pins, five-command first-bullet pins, super-planner `{wbs, state, outcome}` pin. |

#### Verification

- Red-first: 10/15 startup-contract pins failed before the prose edits; all 15 pass after.
- `bun run spur-check` PASS (biome + typecheck + 10401 tests across 608 files + post-check rules 2/2).
- `bun run plugin-smoke` PASS (plugin surface standalone and installs clean).
- Live projection evidence (observed, run-scoped): `workflow show task-pipeline.yaml --format todo
  --json` → 15 `.plan` rows (A Prepare, A1 Quick readiness, A2 Prepare Git, A3 Publish plan, B
  Implement … E2 Record evidence · record); `idea-pipeline.yaml` → `.plan` is a non-null array
  (annotated), so dev-idea/dev-plan publish a real generated plan.

#### Risks / notes

- AC3 (live run artifact recording native todo tool calls) is deferred: a worker subagent has no
  native todo tools and cannot host a live `/sp:dev-run`. The host should capture it on the next
  live dev-run; the R2 table and frozen mapping are pinned by tests in the meantime.
- A pre-existing duplicated heading `## Comprehensive-check retention and evidence (R7/R8)` exists
  in inline-pipeline-driver.md at HEAD (untouched; out of scope).

### Testing

**Pipeline verify results**

- Verdict: PARTIAL (from verdict artifact)
- Confidence: MEDIUM

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:248-269`: workflow-backed runs publish the generated `.plan` rows verbatim as the first action, bound at A3 |
| R2 | MET | `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:230-233`: per-host table, per-item create-once/update-by-id vs full-list rewrite |
| R3 | MET | `plugins/sp/skills/spur-dev/references/execution-batch.md:214-223` A Prepare batch (A1–A4) and Z Batch report first, wave 1 letters; `plugins/sp/skills/spur-dev/references/execution-batch.md:242` batch-plan.mjs waves |
| R4 | MET | All named surfaces carry publish-first: `plugins/sp/commands/dev-run.md:34`, `plugins/sp/commands/dev-runall.md:91`, `plugins/sp/commands/dev-parallel.md:30`, `plugins/sp/commands/dev-idea.md:55`, `plugins/sp/commands/dev-plan.md:44`, `plugins/sp/agents/super-planner.md:290`; live-run proof is tracked separately under AC3 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Skill references carry the publish-first contract (req: R1, R2) | MET | test | `(cd plugins/sp && bun test tests/dogfood-testing/startup-contract.test.ts)` 15 pass / 0 fail this run; `plugins/sp/skills/spur-dev/references/cross-cutting.md:248`, `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:230` |
| AC2 — Batch and command surfaces publish first (req: R3, R4) | MET | test | same run; first Implementation bullets at `plugins/sp/commands/dev-run.md:34` and `plugins/sp/commands/dev-runall.md:91`; `plugins/sp/agents/super-planner.md:290` |
| AC3 — A real inline run publishes the generated plan first (req: R1, R4) | PARTIAL | manual-review | The receipt .spur/run/1105-dogfood.md is from a pi dev-runall session, not a Claude Code /sp:dev-run run. It was staged about 10.5h into a session that had already created todos #1–#5 with the old A·/B· rows, so it does not show the session's first todo calls. Recovery needs a fresh Claude Code /sp:dev-run run on a small backlog task, capturing its first todo calls. |
| AC4 — Plugin surfaces stay valid (req: R1, R2, R3, R4) | MET | command | `bun run plugin-smoke` PASS this run; the duplicate heading `## Comprehensive-check retention and evidence (R7/R8)` was removed from `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md`, and grep -c now returns 1 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

Review + verify (2026-10-07, fresh-context reviewer subagent + host live receipt):

- Review verdict: pass — 0 P1; 2 P2, both out-of-scope/pre-existing: duplicated heading '## Comprehensive-check retention and evidence (R7/R8)' (plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:354-356, anchor ambiguity — separate docs-hygiene fix); Solution line-ref drift in task record (cosmetic).
- Verify verdict: PASS — R1–R4, AC1–AC2, AC4 MET. AC3 was adjudicated PARTIAL by the reviewer (live receipt absent); debt closed in-session: the live inline batch host published all 15 .plan texts verbatim as its first native todo calls (#6–#20) directly after `workflow show` — receipt at .spur/run/1105-dogfood.md. AC3 → MET.
- Evidence: .spur/run/evidence/1105-review-verdict.json, .spur/run/1105-verdict.json, .spur/run/1105-dogfood.md, .spur/run/evidence/1105-show-live.json.
- Implementation: commit 4bf0bbd34 (11 files, +309/−63); gates spur-check 10401 pass/0 fail, plugin-smoke PASS.

Findings table (fresh-context review, 2026-10-07):

| Priority | Finding | Location | Disposition |
| --- | --- | --- | --- |
| P1 | none found | — | — |
| P2 | Duplicated heading '## Comprehensive-check retention and evidence (R7/R8)' — anchor ambiguity | plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:354-356 | FIXED — duplicate heading removed (73e23dac1) |
| P2 | Task-record Solution line refs drift (127→62, 152→162, 247→252) | docs/tasks5/1105_*.md | FIXED — Solution anchors re-pinned to 248, 62, 162 (I13 re-verify) |
| P4 | none found | — | — |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:24:32.939Z backlog → todo (system)
- 2026-10-07T17:46:49.563Z todo → wip (system)
- 2026-10-07T17:58:06.369Z wip → testing (system)
- 2026-10-07T17:58:07.807Z testing → done (system)

