---
schema_version: 1
name: Publish the generated two-layer plan first in dev workflow skills and commands
status: todo
template: feature-impl
created_at: 2026-10-07T06:14:17.623Z
updated_at: "2026-10-07T06:25:37.967Z"
feature_id: I13

dependencies: ["1104"]
priority: P1
ac_numbering: task-local
ac_altitude: task-local
estimate_hours: 5
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

- [ ] R1. `plugins/sp/skills/spur-dev/references/cross-cutting.md` (shared startup contract) and `inline-pipeline-driver.md` (run setup): for workflow-backed runs, the first action is `spur workflow show <resolved-file> --no-logo --format todo --json` and publishing `.plan` item texts verbatim; the A–D bootstrap rows are removed for those runs; A1/A2/A3 track readiness, Git/isolation and digest binding; on-entry states are inserted as the next digit; re-entry keeps the label and adds `attempt N`; skipped/failed/unattempted/blocked render as `pending` + `[outcome]`. Fallback to `steps[]` when `.plan` is `null`.
- [ ] R2. Document the per-host update style: per-item hosts (Claude Code `TaskCreate`/`TaskUpdate`, pi `todo`) create each item once and update by id, appending inserted steps at the end (labels carry identity); full-list hosts (Codex `update_plan`, Gemini `write_todos`, OpenCode `todowrite`, Grok `todo_write`) rewrite the whole list in plan order; omp maps letters to `phase`. Markdown fallback stays `renderProgressMarkdown`.
- [ ] R3. `execution-batch.md`: publish `A Prepare batch` (A1–A4) and `Z Batch report` first; after freeze and ordering, add one letter per task from `batch-plan.mjs waves` (wave 1, later waves on rollover); add a task's phase digits from `batch-plan.mjs task-children` when it starts and mark its letter with the task outcome when it ends.
- [ ] R4. `plugins/sp/commands/dev-{run,runall,parallel,idea,plan}.md`: the first Implementation bullet publishes the generated plan; `plugins/sp/agents/super-planner.md` states the parent host owns the visible list and the subagent returns per-task stage outcomes for the parent to apply.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-07T06:24:32.939Z backlog → todo (system)

