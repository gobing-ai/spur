---
template: standard
schema_version: 1
name: "Realign .spur/workflows definitions with the enhanced sp plugin (SECU→SECUA, feature-dev delegation, stale copy re-sync)"
description: ""
status: done
type: task
profile: standard
feature_id: D
parent_wbs: null
priority: P1
tags: []
dependencies: []
created_at: "2026-06-29T04:56:01.854Z"
updated_at: 2026-06-29T05:30:17.718Z
---

## 0150. Realign .spur/workflows definitions with the enhanced sp plugin (SECU→SECUA, feature-dev delegation, stale copy re-sync)

### Background
The `/sp:dev-*` slash commands, the `sp:super-coder` agent, and the `sp:spur-dev` /
`sp:code-verification` skill backends recently received massive enhancements (commits up to
`fdab3f1`). The seeded **reference workflow definitions** under `config/workflows/` were not carried
along and now describe a pre-enhancement pipeline. Because `spur init` seeds these files into every
new project, the drift propagates: users copy workflows that model the *wrong* current contract.

#### Two concrete enhancements the workflows must absorb

1. **Code-review framework renamed `SECU` → `SECUA`** — Security, Efficiency, Correctness,
   Usability, Architecture. The command (`plugins/sp/commands/dev-review.md`) and the operation
   catalog (`plugins/sp/skills/spur-dev/references/dev-operations.md §2`) already say `SECUA`; the
   workflow `review` step and the skill's `execution-workflow.md` stage table still say `SECU`.
2. **Dev-command chaining contracts finalized** — `--next` now means a specific chain
   (`refine → run → verify → done`, each command advancing one FSM hop), documented verbatim in
   `dev-refine.md:80`, `dev-run.md:34`, `dev-verify.md:33`. The `feature-dev.yaml` execute-tasks
   step describes this chain *incorrectly*.

#### Verified topology (so implementation does not edit the wrong copy)

| Location | Git | Role | Action |
|---|---|---|---|
| `config/workflows/` | tracked (real files) | **canonical source** — `spur init` seed origin + `make-lifecycle-adapter` fallback (`packages/config/src/bundled-config.ts` walks up to `config/`) | **edit here** |
| `.spur/workflows/` | tracked **symlink → `config/workflows/`** (git mode `120000`) | runtime resolution path (`workflows.paths` default in `apps/cli/src/commands/workflow.ts:55`) | auto-updated via symlink — **do not edit separately** |
| `.spur/config/workflows/` | tracked (real dir) | this project's seeded `.spur/` copy; scaffold-manifest target (`apps/cli/src/config/scaffold-manifest.ts:43-50`); **stale** on `feature-dev` + `task-pipeline` | **re-sync from canonical after the fix** |
| `apps/cli/spur-cli/config/workflows/` | **gitignored** | `build:bundle` artifact (`apps/cli/package.json:45`) | **ignore** — regenerated from `config/` |

Net effective edit surface for the workflow YAMLs: **two real directories** — `config/workflows/`
(the fix) and `.spur/config/workflows/` (re-sync). The symlink makes `.spur/workflows/` track
canonical for free.

#### Feature linkage

Primary: **D — Workflows** (these are the workflow definitions). Secondary: **H1 — spur-dev umbrella
skill** (the skill-side SECUA fix in §6 lands in `plugins/sp/skills/spur-dev/`). Linked to `D`;
H1 noted here for traceability.

#### Decision locked (operator-confirmed)

`feature-dev.yaml` **keeps its two explicit FSM states** (`brainstorm` → `plan`) — it is NOT
collapsed into a single `--next` auto-chaining step. Rationale: matches the engine's "pipeline owns
the loop" principle (ADR-022, restated in `execution-workflow.md:42`), preserves
`spur workflow trace` fidelity (a decompose failure halts *at* `plan`, not hidden inside
`brainstorm`), and keeps an independent guard per transition edge. The new
`/sp:dev-brainstorm --feature --next` auto-chain is the right ergonomic for a human typing at the
CLI, but the wrong idiom *inside* an FSM (it nests sequencing inside sequencing — an R6
conflicting-pattern smell). Commands inside the two states therefore stay un-`--next`'d.
### Acceptance Criteria
```gherkin
Feature: Workflow definitions consistent with the enhanced sp plugin

  Scenario: Review step uses the SECUA framework name
    Given config/workflows/task-pipeline.yaml
    When the review state description is read
    Then it names "SECUA" (Security, Efficiency, Correctness, Usability, Architecture)
    And the token "SECU" no longer appears anywhere under config/workflows/

  Scenario: feature-dev execute-tasks delegation matches the execution-batch SSOT
    Given config/workflows/feature-dev.yaml execute-tasks state
    When its agent.run delegation prose is read
    Then it enumerates pending tasks via "spur task list --feature ${featureId} --status todo --json"
    And it runs each task through config/workflows/task-pipeline.yaml
    And it threads ${profile} and ${agent} into the per-task --vars
    And it halts and reports on the first non-PASS verdict
    And it no longer claims "/sp:dev-refine <wbs> --auto --next ... chains implement → verify → done"

  Scenario: feature-dev names the real task-pipeline stages
    Given config/workflows/feature-dev.yaml
    When the execute-tasks description references the per-task pipeline stages
    Then the sequence reads "precheck → implement → test → review → approve → verify → record → done"
    And it contains no phantom "refine" pipeline stage

  Scenario: Seeded .spur copy matches canonical
    Given the canonical fix is applied to config/workflows/
    When .spur/config/workflows/{task-pipeline,feature-dev}.yaml are diffed against canonical
    Then both diffs are empty (byte-identical)

  Scenario: Upstream skill SECU leftover is fixed
    Given plugins/sp/skills/spur-dev/references/execution-workflow.md
    When line 48's review-stage row is read
    Then it says "SECUA-framework" (matching dev-operations.md §2 and dev-review.md)

  Scenario: Workflows still validate and the gate is green
    Given the edited workflow YAMLs
    When "spur workflow validate" is run on task-pipeline.yaml and feature-dev.yaml
    Then both pass
    And "bun run lint" is clean
    And the symlink readlink .spur/workflows still points at config/workflows
    And git status shows only the intended files (4 workflow YAMLs + 1 skill reference)
```

- [ ] AC-1: `config/workflows/task-pipeline.yaml` review step says SECUA; no `SECU\b` under `config/workflows/`
- [ ] AC-2: `feature-dev.yaml` execute-tasks delegation matches `execution-batch.md §3` (enumerate → per-task pipeline → `${profile}`/`${agent}` in `--vars` → halt on first non-PASS)
- [ ] AC-3: `feature-dev.yaml` references the correct 8-stage task-pipeline sequence; no phantom `refine` stage
- [ ] AC-4: `.spur/config/workflows/{task-pipeline,feature-dev}.yaml` byte-identical to canonical
- [ ] AC-5: `execution-workflow.md:48` says SECUA-framework
- [ ] AC-6: `spur workflow validate` passes both edited workflows; `bun run lint` clean; symlink intact; `git status` shows only the 5 intended files
### Design

**Design goal: realign 5 files with the current sp plugin contract — prose-only, zero FSM-structural change.**

The drift is exclusively in human-readable prose (descriptions, agent.run inputs, a doc table row).
No `states[]`, `transitions[]`, `guards`, or `vars` declarations change. Because `spur workflow
validate` checks structure, prose-only edits are valid-by-construction — the only schema risk is
YAML quoting inside the rewritten `execute-tasks` `input` block (handled below).

#### Fix catalog (one design per drift)

| # | File | Drift | Fix |
|---|------|-------|-----|
| 1 | `config/workflows/task-pipeline.yaml:89` | `review` description says `SECU` | → `SECUA-framework code review via /sp:dev-review (Security, Efficiency, Correctness, Usability, Architecture)` |
| 2 | `config/workflows/feature-dev.yaml` `execute-tasks.input` | Claims `/sp:dev-refine --auto --next chains implement → verify → done` (wrong chain) | Rewrite to the canonical per-task batch driver: enumerate → `workflow run task-pipeline.yaml --async` → `workflow trace` poll → verdict-file inspect → halt on first non-PASS |
| 3 | same `input` block | `${vars.profile}` and `${vars.agent}` declared but never threaded into per-task `--vars` | Plumb both into the per-task `--vars '{"wbs","profile","agent"}'` JSON |
| 4 | `feature-dev.yaml` `execute-tasks.description` | Lists pipeline stages as `refine → implement → test → review → verify → record → done` (phantom `refine`, missing `precheck`/`approve`) | → `precheck → implement → test → review → approve → verify → record → done` (the 8 real `states[]` of task-pipeline.yaml) |
| 6 | `plugins/sp/skills/spur-dev/references/execution-workflow.md:48` | `review` row says `SECU-framework` | → `SECUA-framework` (matches dev-review.md + dev-operations.md §2, the upstream source of the drift) |

Fix #5 is the mechanical re-sync of the two seeded copies (no independent design).

#### YAML-quoting analysis (the one real risk, fix #2)

The rewritten `execute-tasks` `input` must embed a `--vars '{"wbs":"<wbs>",...}'` JSON literal
inside a YAML scalar. Three options, evaluated:

- **`>` folded scalar (current style)** — folds newlines to spaces; the embedded `'{"wbs":...}'`
  survives, but the multi-line shell command becomes one long line. Acceptable for a delegation
  prose block; risky if the fold mangles a `'` that YAML could read as a scalar boundary.
- **`|` literal scalar** — preserves newlines/quotes verbatim. Safest for an embedded shell
  command with JSON quoting. **Chosen** if validation fails under `>`.
- **plain scalar** — rejected; cannot contain `:`/`{` safely.

**Decision: keep `>` first (minimal diff, R3), fall back to `|` only if `spur workflow validate`
rejects.** The fallback is one-character (`>` → `|`); both are documented in the Plan's Step 2b.

#### Why fix #2's delegation prose mirrors `execution-batch.md §3` (not the dev-refine chain)

The `--next` ergonomic (`/sp:dev-refine <wbs> --auto --next` → dev-run → dev-verify) is a
**human-typing shorthand**. Inside an FSM, nesting that chain inside `execute-tasks` would:
(a) duplicate the FSM's own sequencing (each `--next` hop is itself a transition), violating
ADR-022's "pipeline owns the loop"; (b) destroy `spur workflow trace` fidelity — a decompose
failure would halt *inside* `brainstorm` rather than *at* `plan`; (c) remove the independent
guard per transition edge. The `execution-batch.md §3` pattern (async pipeline launch + trace
poll + verdict-file inspect) is the SSOT for programmatic batch driving and is what
`sp:super-coder` (the batch orchestrator) already implements. Fix #2 mirrors it verbatim.

#### Re-sync boundary (fix #5)

Only the two edited workflows need copying; the other four in `.spur/config/workflows/` are
already byte-identical to canonical (verified during planning). `.spur/workflows/` is a symlink
to `config/workflows/` (verified `readlink`) and needs no action. `apps/cli/spur-cli/config/` is
gitignored build output and is explicitly out of scope.

#### What is NOT in this design (out of scope, R2/R3)

- No change to `task-pipeline.yaml` `verify` step's `--fix all` (intentional auto-repair).
- No change to the four other canonical workflows (no drift in them).
- No change to `feature-dev.yaml` header comment's `Shape:` line (correct as-is).
- No FSM structural edit anywhere (states/transitions/guards/vars untouched).
- No build-output regeneration (`apps/cli/spur-cli/config/` is gitignored).

#### Verification design

AC-6 is the gate: `spur workflow validate` on both edited workflows (catches the YAML-quoting
risk), `bun run lint` clean (catches MD/YAML format drift), `readlink .spur/workflows` intact
(confirms symlink not broken by the re-sync), and `git status` listing exactly the 5 intended
files (catches accidental scope creep). The byte-identical check (AC-4) is a `diff` between
each canonical file and its `.spur/config/` counterpart — empty diff = pass.

### Plan
Surgical, prose-only edits — **no FSM structural change** (no state/transition/guard edits), so
schema validity is preserved by construction. Five files, two of which are mechanical re-syncs.

#### Step 1 — `config/workflows/task-pipeline.yaml` (fix #1: SECU → SECUA)

- Line 89, the `review` state `description`:
  - From: `description: SECU code review via /sp:dev-review.`
  - To:   `description: SECUA-framework code review via /sp:dev-review (Security, Efficiency, Correctness, Usability, Architecture).`
- No other change to this file. Do **not** touch the `verify` step's `--fix all` (intentional
  auto-repair) or any guard.

#### Step 2 — `config/workflows/feature-dev.yaml` (fixes #2, #3, #4)

Three edits, all inside the `execute-tasks` state and its description block:

- **2a (fix #4 — stage naming), line ~66** in the `execute-tasks` state `description`:
  - From: `...runs each task through task-pipeline.yaml (refine → implement → test → review → verify → record → done). It`
  - To:   `...runs each task through task-pipeline.yaml (precheck → implement → test → review → approve → verify → record → done). It`
  - Reason: `refine` is a planning-half operation, not a task-pipeline stage; the real pipeline
    has 8 stages including `precheck` and `approve` (per `task-pipeline.yaml` `states[]`).

- **2b (fix #2/#3 — delegation prose), lines ~71-75** in the `onEnter` `agent.run` `input` block:
  - From (the factually-wrong chain):
    ```
    Run every pending task under feature ${vars.featureId} to done. Enumerate with
    `${vars.spurBin} task list --feature ${vars.featureId} --status todo --json`, then
    for each task run the task-pipeline (e.g. /sp:dev-refine <wbs> --auto --next, which
    chains implement → verify → done). Stop and report on the first non-PASS verdict.
    ```
  - To (matches `execution-batch.md §3` SSOT — enumerate, per-task pipeline, vars threaded, halt):
    ```
    Run every pending task under feature ${vars.featureId} to done. Enumerate with
    `${vars.spurBin} task list --feature ${vars.featureId} --status todo --json`; then for
    each WBS run the standard single-task pipeline VERBATIM:
    `${vars.spurBin} workflow run config/workflows/task-pipeline.yaml --vars
    '{"wbs":"<wbs>","profile":"${vars.profile}","agent":"${vars.agent}"}' --async --json`,
    polling `${vars.spurBin} workflow trace <run-id>` until terminal and inspecting
    `.spur/run/<wbs>-verdict.json`. Stop and report on the first non-PASS verdict (a failing
    task fails the feature).
    ```
  - Reason: (a) removes the wrong `/sp:dev-refine ... chains implement → verify → done` claim;
    (b) threads `${vars.profile}` and `${vars.agent}` into the per-task `--vars` (fix #3 — they
    were declared but never plumbed down); (c) matches the canonical batch driver pattern in
    `plugins/sp/skills/spur-dev/references/execution-batch.md §3` (`--async` + `workflow trace`
    poll + verdict-file inspection).
  - **Mind YAML quoting**: the `--vars` JSON contains single quotes inside a YAML block scalar
    (`input: >`). Keep the existing `>` folded-scalar style; the embedded `'{"wbs":...}'` is fine
    inside a folded scalar as long as indentation is consistent. Verify with `spur workflow
    validate` after editing — if the folded scalar mangles the JSON, switch that step to a literal
    block scalar (`input: |`) to preserve newlines/quotes exactly.

- Leave the file header comment block's `Shape: brainstorm → plan → execute-tasks(delegated loop)
  → feature-verify → done` UNCHANGED — it is correct and reflects the locked 2-state decision.

#### Step 3 — `plugins/sp/skills/spur-dev/references/execution-workflow.md` (fix #6)

- Line 48, the `review` stage table row:
  - From: `| `review` | `/sp:dev-review <wbs>` — SECU-framework review of the diff. | [dev-operations.md §2 review](dev-operations.md) |`
  - To:   `| `review` | `/sp:dev-review <wbs>` — SECUA-framework review of the diff. | [dev-operations.md §2 review](dev-operations.md) |`
- This is the upstream source of the workflow drift; fixing it makes skill + commands + workflows
  all agree on SECUA.

#### Step 4 — re-sync the stale seeded copies (fix #5)

After Steps 1-2 land in canonical, overwrite the two stale `.spur/config/workflows/` copies so the
scaffold-target matches the seed source:

```bash
cp config/workflows/task-pipeline.yaml .spur/config/workflows/task-pipeline.yaml
cp config/workflows/feature-dev.yaml   .spur/config/workflows/feature-dev.yaml
```

(The other four workflows in `.spur/config/workflows/` are already identical to canonical — no copy
needed. Do **not** touch `.spur/workflows/` — it is a symlink and updates for free. Do **not** touch
`apps/cli/spur-cli/config/` — gitignored build output.)

#### Tooling rules (project conventions)

- Edit YAML/MD with the **Edit** tool (exact-string replace), never `sed`/`awk`.
- The `cp` re-sync in Step 4 is the one acceptable shell mutation (mechanical file copy of two
  derived artifacts; no dedicated CLI verb exists for re-seeding a single workflow).
- Run all `spur` commands via `bun run apps/cli/src/index.ts <cmd>` (the `.ts` bin runs under Bun).

- [ ] Step 1 — task-pipeline.yaml SECUA wording
- [ ] Step 2 — feature-dev.yaml delegation + stage-naming (2a, 2b)
- [ ] Step 3 — execution-workflow.md:48 SECUA
- [ ] Step 4 — re-sync .spur/config/workflows/ (2 files)
- [ ] Verification gate (see Acceptance Criteria scenario 6)
### Solution
**Change-map: 5 files, prose-only YAML/MD edits, zero FSM-structural change.**

| File:line | What | Why |
|---|---|---|
| `config/workflows/task-pipeline.yaml:89` | `review` state `description`: `SECU` → `SECUA-framework code review via /sp:dev-review (Security, Efficiency, Correctness, Usability, Architecture)` | Fix #1 — align with the SECUA rename in dev-review.md + dev-operations.md §2 |
| `config/workflows/feature-dev.yaml:62-79` | `execute-tasks` state: rewrote `description` stage list (8 real stages, no phantom `refine`) AND `onEnter.agent.run.input` delegation prose (canonical batch driver: enumerate → `workflow run task-pipeline.yaml --async` → `workflow trace` poll → verdict-file inspect → halt on first non-PASS; `${vars.profile}`/`${vars.agent}` threaded into per-task `--vars`) | Fixes #2/#3/#4 — remove wrong `--next` chain claim, thread declared-but-unused vars, name real pipeline stages |
| `.spur/config/workflows/task-pipeline.yaml` | Mechanical re-sync from canonical (byte-identical) | Fix #5 — stale seeded copy |
| `.spur/config/workflows/feature-dev.yaml` | Mechanical re-sync from canonical (byte-identical) | Fix #5 — stale seeded copy |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:48` | `review` stage table row: `SECU-framework` → `SECUA-framework` | Fix #6 — upstream source of the workflow drift |

**YAML quoting:** the rewritten `execute-tasks` `input` uses a `>` folded scalar embedding `--vars '{"wbs":"<wbs>",...}'` JSON. `spur workflow validate` confirms the fold preserved the quotes — no fallback to `|` literal scalar needed.

**Not changed (intentional):** `verify` step `--fix all` (auto-repair by design); the 4 other canonical workflows (no drift); `feature-dev.yaml` header `Shape:` comment (correct as-is); any `states`/`transitions`/`guards`/`vars` declarations (zero structural edit); `apps/cli/spur-cli/config/` (gitignored build output).
### Testing
**Verdict: PASS** — all 6 acceptance criteria MET. Verified `/sp:dev-verify 0150 --auto --focus all --fix all --force` (standalone, `--force` re-audit of a `done` task).

| Req | Status | Evidence |
|-----|--------|----------|
| AC-1 (SECUA in task-pipeline) | **MET** | `config/workflows/task-pipeline.yaml:89` → `SECUA-framework code review via /sp:dev-review (Security, Efficiency, Correctness, Usability, Architecture).`; `rg "SECU\b" config/workflows/` returns nothing |
| AC-2 (feature-dev delegation matches execution-batch §3) | **MET** | `config/workflows/feature-dev.yaml` execute-tasks `onEnter.agent.run.input` now enumerates via `spur task list --feature ... --status todo --json`, runs each WBS through `workflow run config/workflows/task-pipeline.yaml --vars '{...}' --async`, polls `workflow trace`, inspects `.spur/run/<wbs>-verdict.json`, halts on first non-PASS; the wrong `/sp:dev-refine ... chains implement → verify → done` claim is removed |
| AC-3 (correct 8-stage sequence) | **MET** | `feature-dev.yaml` execute-tasks description → `precheck → implement → test → review → approve → verify → record → done`; no phantom `refine` stage |
| AC-4 (.spur copy == canonical) | **MET** | `diff config/workflows/{task-pipeline,feature-dev}.yaml .spur/config/workflows/...` both empty (byte-identical) |
| AC-5 (skill SECUA) | **MET** | `plugins/sp/skills/spur-dev/references/execution-workflow.md:48` → `SECUA-framework review of the diff.` |
| AC-6 (gate green) | **MET** | `spur workflow validate` → `valid:true` for both edited workflows; `bun run lint` clean (Biome 377 files + 7 workspace typechecks exit 0); `readlink .spur/workflows` → `config/workflows` (symlink intact, runtime path carries SECUA); `git status` scoped to the 5 target files (+ benign `docs/features/` roster refresh) |

**Fix-pass (`--fix all`):** no repairs needed — the implementation was already present and correct in the working tree at verify time. All 6 requirements MET on first traceability pass; the bounded fix loop did not engage.
### Review

SECUA review of the 5-file diff (prose/description edits to workflow YAML + one skill markdown row). `--focus all`.

| # | Severity | Dimension | Finding |
|---|----------|-----------|---------|
| — | — | Security | No findings. No secrets, no input handling, no executable code paths changed — edits are YAML `description`/`input` strings and a markdown table cell. |
| — | — | Efficiency | No findings. The rewritten `feature-dev` delegation adds `--async` + `workflow trace` polling, which is *more* efficient than a blocking run for long agent pipelines (matches `execution-batch.md §3`). |
| — | — | Correctness | No findings. The new delegation threads `${vars.profile}`/`${vars.agent}` into the per-task `--vars` (previously declared-but-unused vars now plumbed); the 8-stage sequence and SECUA naming match the authoritative command/skill SSOTs. `spur workflow validate` confirms the folded-scalar `--vars` JSON parses correctly — no YAML-quoting regression. |
| — | — | Usability | No findings. The corrected stage names and accurate chain description make the seeded reference workflows teach the *right* pattern to users who copy them — the core purpose of the task. |
| P4 (minor, non-blocking) | minor | Architecture | The 2-state `brainstorm → plan` shape in `feature-dev.yaml` is preserved per the locked decision — correctly upholds the ADR-022 "pipeline owns the loop" principle and keeps `spur workflow trace` fidelity (independent guard per edge). Consistent with sibling `task-pipeline.yaml`. No action. |

**Architecture note (positive):** the fix eliminates a real seam violation — the old delegation hid the per-task execution behind a misleading single-command claim; the new prose makes the canonical `workflow run task-pipeline.yaml` boundary explicit, matching how the batch driver (`execution-batch.md`) and `/sp:dev-run --mode full` express the same fan-out. No new coupling introduced.

**Verdict: PASS** — zero blockers, zero majors, one informational architecture observation (no action). The change is surgical, schema-valid, gate-green, and faithful to the spec.
### References
#### Files to modify (5)

- `config/workflows/task-pipeline.yaml` — fix #1 (SECUA wording, line 89)
- `config/workflows/feature-dev.yaml` — fixes #2/#3/#4 (execute-tasks delegation + stage naming)
- `.spur/config/workflows/task-pipeline.yaml` — fix #5 (re-sync, mechanical copy)
- `.spur/config/workflows/feature-dev.yaml` — fix #5 (re-sync, mechanical copy)
- `plugins/sp/skills/spur-dev/references/execution-workflow.md` — fix #6 (SECUA, line 48)

#### Ground-truth contracts (read before editing — the SSOT for each claim)

- `plugins/sp/commands/dev-review.md` — SECUA framework, `--focus`/`--fix` flags
- `plugins/sp/commands/dev-verify.md:33` — `--next` terminal-chain semantics (`testing → done`)
- `plugins/sp/commands/dev-run.md:34` — `--next` resolves to `implement`; `todo → wip → testing`
- `plugins/sp/commands/dev-refine.md:80` — `--next` chains `refine → dev-run → dev-verify`
- `plugins/sp/commands/dev-brainstorm.md:36` — `--feature --next` auto-invokes `dev-plan` (the
  ergonomic deliberately NOT used inside the FSM — see Background "Decision locked")
- `plugins/sp/skills/spur-dev/references/dev-operations.md §2-§4` — SECUA review, verify, run ops
- `plugins/sp/skills/spur-dev/references/execution-workflow.md §"pipeline internal stages"` — the
  stage→operation table (also carries fix #6 on line 48)
- `plugins/sp/skills/spur-dev/references/execution-batch.md §3` — the canonical per-task batch
  driver pattern that fix #2's rewritten delegation must mirror (`spur workflow run
  task-pipeline.yaml --vars '{...}' --async` + `workflow trace` poll + verdict-file inspect)

#### Topology / mechanism references

- `packages/config/src/bundled-config.ts:30` — `bundledConfigRoot()` resolves canonical `config/`
- `apps/cli/src/config/scaffold-manifest.ts:43-50` — seeds `config/workflows/*` → `.spur/config/workflows/*`
- `apps/cli/src/commands/workflow.ts:55` — runtime workflow search path default `.spur/workflows/`
- `apps/cli/src/workflow/make-lifecycle-adapter.ts:11-28` — bundled-first, then `.spur/workflows/`
- `apps/cli/package.json:45` — `build:bundle` produces the gitignored `apps/cli/spur-cli/config/`
- ADR-022 — "orchestration is configuration; the pipeline owns the loop" (the principle behind the
  2-state decision)

#### Project rules in force

- `docs/.tasks/` task files: `tasks` CLI only — never the Write tool (this task authored via
  `spur task create` + `spur task update --section --from-file`).
- Surgical changes; match surrounding style; no drive-by edits to guards or unrelated workflows.

#### Audited, intentionally NOT changed

- `config/workflows/{task-lifecycle,feature-lifecycle,basic,planning-pipeline}.yaml` — no
  command/framework drift; guards reference stable verbs (`spur task check`, `spur feature check`).
- `task-pipeline.yaml` `verify` step `--fix all` — intentional pipeline auto-repair, not drift.
- `apps/cli/spur-cli/config/workflows/` — gitignored; regenerated by `build:bundle`.
- `execution-workflow.md` lines other than 48 — no other SECU occurrences (verified via `rg`).

#### Out-of-band note

The original planning artifact for this work: `~/.claude/plans/melodic-sparking-patterson.md`
(superseded by this task file as the authoritative implementation spec).
### History
- 2026-06-29T05:09:33.212Z todo → wip (system)
- 2026-06-29T05:09:33.584Z wip → testing (system)
- 2026-06-29T05:11:34.345Z testing → done (system)
