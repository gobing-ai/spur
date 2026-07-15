---
template: feature-impl
schema_version: 1
name: Batch task execution — /sp:dev-runall + dependency-ordered driver + sp:super-coder orchestrator
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-28T04:23:18.035Z
updated_at: 2026-06-28T05:40:19.105Z
---

## 0141. Batch task execution — /sp:dev-runall + dependency-ordered driver + sp:super-coder orchestrator

### Background
The `sp:spur-dev` skill and the `/sp:dev-*` commands already take a vague feature description all
the way to a shipped, verified single task: plan → decompose → `batch-create` → run one task through
`config/workflows/task-pipeline.yaml` (precheck → implement → test → review → approve → verify →
record → done). What is missing is **batch execution**: running a *set* of task files in one
operation, in dependency-correct order.

This task adds that missing layer without new engine code or schema changes, reusing three existing
seams:

1. **Status vocabulary** — `packages/domain/src/planning/schema.ts:20` defines
   `backlog, todo, wip, testing, blocked, done, cancelled`. Pseudo-list selectors map directly to
   `spur task list --status <s> --json`.
2. **Dependencies already modeled** — `schema.ts:251` `dependencies: z.array(z.string()).optional()`.
   Topological ordering is derivable from existing frontmatter; no migration needed.
3. **Single-task execution is one `spur workflow run`** — a batch is N sequential pipeline runs with
   dependency gating between them. Per ADR-022 ("orchestration is configuration"), the batch driver
   is a **loop in the skill**, not a new meta-workflow FSM — HITL surfacing, per-task verdict
   inspection, and continue/halt decisions need agent judgment between runs that a flat FSM cannot
   express.


```
/sp:dev-runall  →  sp:super-coder (BATCH ORCHESTRATOR)  →  spur workflow run task-pipeline.yaml (task N)
                                                                  │
                                                                  └─ agent.run steps spawn vars.agent (omp/…)
                                                                     ◄── NOT super-coder's responsibility
```

`sp:super-coder` owns the spaces **between** task runs: resolve+freeze the set, topo-sort, run each
task's pipeline in order, inspect terminal state, decide continue/halt, emit the batch report. It
does **not** decide how an individual `agent.run` step (implement/test/review) executes — that stays
the pipeline's concern via `vars.agent` (default `omp`, pinned in `task-pipeline.yaml`).

**Explicitly deferred (do NOT build in this task):**

- **Parallel execution** of independent tasks (needs git-worktree isolation to avoid corpus /
  working-tree contention). v1 is sequential.
- **Interactive within-step Q&A** — a headless subprocess `agent.run` agent asking the operator a
  real question. This waits for the **workspace module + inbox module + `spur agent` team mode**.
  `sp:super-coder` surfaces blockers/HITL only at the **batch boundary** (between task runs), not
  from inside a pipeline step.
### Acceptance Criteria
```gherkin
Feature: Batch task execution via /sp:dev-runall

  # ── R1: selector grammar ──────────────────────────────────────────────
  Scenario: R1.1 Run an explicit WBS list
    Given tasks 0040, 0042, 0051 exist
    When the operator runs "/sp:dev-runall --tasks 0040,0042,0051"
    Then the batch resolves exactly those three tasks
    And no other task is included

  Scenario: R1.2 Run a status pseudo-list
    Given several tasks have status "todo"
    When the operator runs "/sp:dev-runall --tasks todo"
    Then the batch resolves every task whose status is "todo" via "spur task list --status todo --json"

  Scenario: R1.3 Run a feature-scoped selection
    Given feature A1 has linked tasks
    When the operator runs "/sp:dev-runall --feature A1" (or the equivalent --tasks form)
    Then the batch resolves every task whose feature_id edge is A1

  Scenario: R1.4 Run the "ready" pseudo-list
    Given a task in "todo" whose dependencies are all "done"
    And a task in "todo" whose dependency is still "wip"
    When the operator runs "/sp:dev-runall --tasks ready"
    Then only the dependency-satisfied task is selected
    And the dependency-blocked task is excluded with a reported reason

  # ── R2: frozen set + dependency ordering ───────────────────────────────
  Scenario: R2.1 The selected set is frozen at kickoff
    Given the batch resolved a set from "--tasks todo"
    When a task transitions to "wip" mid-batch as it runs
    Then the working set does not shrink or re-query
    And every originally-selected task is still attempted in plan order

  Scenario: R2.2 Tasks run in topological dependency order
    Given task 0042 depends on 0040 and both are in the set
    When the batch runs
    Then 0040's pipeline completes before 0042's pipeline starts

  Scenario: R2.3 A dependency cycle aborts the batch
    Given 0040 depends on 0042 and 0042 depends on 0040
    When the batch is planned
    Then the batch aborts before running any task
    And the report names the cycle path

  Scenario: R2.4 An unmet out-of-set dependency blocks the dependent subtree
    Given 0042 depends on 0099, 0099 is not in the set and is not "done"
    When the batch runs
    Then 0042 and its descendants are blocked (not silently run)
    And the report lists them as blocked with the unmet dependency
    And independent tasks still run

  Scenario: R2.5 A satisfied out-of-set dependency is allowed
    Given 0042 depends on 0099, 0099 is not in the set but is "done"
    When the batch runs
    Then 0042 is treated as dependency-satisfied and runs

  # ── R3: failure policy (stop-the-batch default) ────────────────────────
  Scenario: R3.1 First pipeline failure halts the batch
    Given task 0040 runs and its pipeline ends in "failed"
    When the batch is in default mode (no --keep-going)
    Then the batch halts after 0040
    And remaining tasks are reported as "not attempted"
    And the report lists succeeded, failed, and remaining tasks

  Scenario: R3.2 --keep-going skips the failed subtree and continues
    Given task 0040 fails and task 0050 does not depend on it
    When the operator passed "--keep-going"
    Then 0040's dependents are skipped (reported)
    And 0050 still runs

  # ── R4: per-task execution reuses the existing pipeline unchanged ──────
  Scenario: R4.1 Each task runs through the standard pipeline
    When the batch runs task 0040
    Then it invokes "spur workflow run config/workflows/task-pipeline.yaml --vars {wbs:0040,...}"
    And the per-task pipeline (precheck→…→done/failed) is used verbatim with no new FSM

  Scenario: R4.2 --auto propagates the HITL profile to each task run
    When the operator passes "--auto"
    Then every per-task pipeline run is invoked with profile=auto (HITL approve gate skipped)

  Scenario: R4.3 --agent pins the per-task step executor, not the orchestrator
    When the operator passes "--agent claude"
    Then "agent" is merged into each per-task --vars so agent.run steps spawn claude
    And sp:super-coder remains the batch orchestrator regardless of --agent

  # ── R5: sp:super-coder orchestrator boundary ──────────────────────────
  Scenario: R5.1 super-coder drives between runs, never inside a step
    Given sp:super-coder is the batch orchestrator
    Then it resolves/orders the set, runs each pipeline, inspects each terminal verdict, decides continue/halt
    And it does NOT decide how an individual agent.run step executes (that is vars.agent's concern)

  Scenario: R5.2 Batch report is emitted at completion
    When the batch finishes (clean, halted, or aborted)
    Then a structured report lists per-task outcome (done/failed/blocked/skipped/not-attempted) and the batch verdict
```

- [ ] R1.1 Run an explicit WBS list
- [ ] R2.1 The selected set is frozen at kickoff
- [ ] R3.1 First pipeline failure halts the batch
- [ ] R4.1 Each task runs through the standard pipeline
- [ ] R5.1 super-coder drives between runs, never inside a step
### Design
Zero engine code, zero schema changes. Three artifacts, all over existing CLI verbs and the existing
per-task pipeline (ADR-022: orchestration is configuration / loops in the skill).

**⛔ IMPLEMENTATION CONSTRAINTS — read before writing anything (binding, not advisory):**

- **Deliverables are MARKDOWN ONLY.** This task ships exactly three `.md` files (a command, an
  agent, a skill reference) plus small edits to two existing `.md` files. Do **NOT** write a `.ts`,
  `.js`, or any executable script. The selector resolution, dependency ordering, topo-sort, and
  driver loop are **agent reasoning expressed in prose** over existing CLI verbs (`spur task list
  --json`, `spur task show --json`, `spur workflow run`) — that is the entire point of ADR-022
  ("orchestration is configuration / loops in the skill"). A committed TS "batch-driver" library is
  a direct violation and will be rejected: it re-implements in code what the skill+CLI already do.
- **No new engine code, no new package, no new dependency.** Nothing under `packages/` or `apps/`
  changes.
- **If — hypothetically — a script were ever justified, it would live under
  `plugins/sp/scripts/<subfolder>`, NEVER under a skill's subtree** (`plugins/sp/skills/*/scripts/`
  is the loser pattern, flagged for cleanup). But for THIS task no script is justified at all.
- **The topo-sort is not "too complex for prose."** It is Kahn's algorithm over the `dependencies[]`
  frontmatter the orchestrator already reads; describe it as a procedure the agent follows, the same
  way `execution-workflow.md` describes the pipeline sequencing. Do not reach for code to "make it
  testable" — the test surface is the markdown behavior + CLI calls, validated by the existing
  plugins/sp gate, not a unit-tested library.


| # | Artifact | Path | Role |
|---|----------|------|------|
| A | `/sp:dev-runall` command | `plugins/sp/commands/dev-runall.md` | Thin wrapper: parse `--tasks`, `--keep-going`, `--auto`, `--agent`, `--json`; delegate to the skill batch op |
| B | Batch driver reference | `plugins/sp/skills/spur-dev/references/execution-batch.md` | The driver loop: resolve+freeze → topo-sort → per-task pipeline run → verdict inspect → continue/halt → report |
| C | `sp:super-coder` agent | `plugins/sp/agents/super-coder.md` | Batch orchestrator that runs the driver loop in its own context (name-only reuse of rd3:super-coder; no logic relationship) |

Plus minimal wiring edits:
- `spur-dev/SKILL.md` — add `runall` to the execution-half step table + Additional Resources link to `execution-batch.md`.
- `spur-dev/references/execution-workflow.md` — one cross-link to the batch reference (single-task vs batch entry points).


```
--tasks <value>:
  ^[0-9, ]+$        → explicit WBS list (split on comma)
  feature:<id>      → spur task list --feature <id> --json
  ready             → status ∈ {todo,backlog} AND every dependencies[] entry resolves to done
  todo|backlog|wip|blocked|testing → spur task list --status <value> --json
  (else)            → error: unknown selector, list the valid forms
```

Resolution happens **once at kickoff** → frozen ordered plan (R2.1). The driver iterates the frozen
plan; it never re-queries `spur task list` to recompute membership mid-batch.


1. Build the dependency graph over the **frozen set** using each task's `dependencies[]` frontmatter.
2. For each dependency edge to a task **outside** the set: resolve its current status via
   `spur task show <wbs> --json`.
   - status `done` → edge satisfied, drop it (R2.5).
   - status ≠ `done` → mark the dependent (and transitively its in-set descendants) **blocked**;
     exclude from execution; record the unmet dep for the report (R2.4).
3. Topological sort the remaining in-set, non-blocked tasks (Kahn's algorithm).
4. Cycle (Kahn leaves nodes unsorted) → **abort** the whole batch, report the cycle path (R2.3).
5. Result = the ordered execution plan.


```
plan = resolve(--tasks) → freeze → order(deps)        # may abort (cycle) or pre-block (unmet dep)
report = []
for wbs in plan:                                       # sequential — v1, no parallelism
    if any dependency of wbs failed earlier in THIS batch:
        report += skipped(wbs, reason); continue       # only relevant under --keep-going
    run: spur workflow run config/workflows/task-pipeline.yaml \
           --vars {wbs, profile: (auto if --auto else standard), agent: (--agent if set)}
    inspect terminal state (done | failed) + .spur/run/<wbs>-verdict.json
    report += outcome(wbs)
    if terminal == failed:
        if --keep-going: mark wbs + in-batch dependents as failed/skipped; continue
        else:            HALT; remaining → not-attempted; break    # stop-the-batch default (R3.1)
emit batch report (per-task outcome + batch verdict)
```

The per-task `spur workflow run` is invoked **verbatim** — the batch never edits the pipeline YAML
and never reaches into a step. `--agent` flows into the per-task `--vars.agent`; `--auto` sets
`--vars.profile=auto`. These are the only two flags that cross the orchestrator→pipeline boundary.


`sp:super-coder` = **batch orchestrator only**. It runs the driver loop above. It explicitly does
NOT own step-level execution: how `agent.run` runs implement/test/review is `vars.agent`'s job
(default `omp`, pinned in `task-pipeline.yaml`). Frontmatter: `tools: [Read, Grep, Glob, Bash, Skill]`,
`skills: [sp:spur-dev]`, `model: inherit`. Its decision-autonomy is at the batch level — which task
next, is this failure fatal, is the set well-formed — bounded by the global Decision Authority table.

**Out of scope (deferred — see Background):**

- Parallel execution + git-worktree isolation.
- Interactive within-step escalation (workspace + inbox + `spur agent` team mode prerequisites).
### Plan
- [x] **P0 — Constraint:** all deliverables are markdown; no `.ts`/`.js` files (see Design →
      Implementation constraints).
- [x] **P1 — `execution-batch.md` reference (the orchestration prose).** New file
      `plugins/sp/skills/spur-dev/references/execution-batch.md`. Specify, as agent procedure (not
      code): the selector grammar + resolution order, the freeze-at-kickoff rule, the
      dependency-ordering algorithm (out-of-set resolution satisfied→drop / unmet→block-subtree,
      Kahn topo-sort, cycle→abort), the sequential driver loop (per-task `spur workflow run`,
      terminal-state + verdict inspection, stop-the-batch default, `--keep-going` subtree skip), and
      the batch-report shape. Pure orchestration over `spur task list --json` / `spur task show
      --json` / `spur workflow run`. (R1, R2, R3, R5.2)
- [x] **P2 — `/sp:dev-runall` command.** New file `plugins/sp/commands/dev-runall.md`: frontmatter
      (`description`, `argument-hint`, `allowed-tools`), argument table (`--tasks`, `--keep-going`,
      `--auto`, `--agent`, `--json`), deterministic delegation
      `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")`, platform notes mirroring `dev-run.md`.
      (R1, R4.2, R4.3)
- [x] **P3 — `sp:super-coder` agent.** New file `plugins/sp/agents/super-coder.md`: orchestrator
      role, the between-runs-only boundary (R5.1 — never reaches into a pipeline step; step execution
      is `vars.agent`'s job), decision-autonomy bounded by the global Decision Authority table,
      `tools: [Read, Grep, Glob, Bash, Skill]`, `skills: [sp:spur-dev]`, output = batch report.
      Name-only reuse of rd3:super-coder (no logic relationship). (R5)
- [x] **P4 — Skill wiring.** Edit `spur-dev/SKILL.md`: add the `runall` operation to the execution
      step table + an Additional-Resources link to `execution-batch.md`. Edit
      `references/execution-workflow.md`: one cross-link distinguishing single-task (`run`) vs batch
      (`runall`) entry points. Add the `runall` operation routing so the command's delegation
      resolves to the new reference.
- [x] **P5 — Verification.** `bun run lint` (Biome + tsc), `bun run test` (incl. plugins/sp markdown
      structure tests if any), `bun run build`. The acceptance surface is the markdown behavior +
      CLI calls — there is no unit-tested library to add. `git status` shows only the intended
      markdown files.
- [x] **P6 — Docs sync (same commit).** `04_DESIGN.md` — add `/sp:dev-runall` to the CLI surface
      block. `05_FEATURES.md §H1` — mark batch execution. No ADR needed (reuses ADR-022's
      loop-in-skill stance — and is the canonical example of it).
### Solution
Batch task execution shipped as **markdown orchestration** (ADR-022 — zero engine code, zero schema
changes). Three new artifacts + wiring edits; the per-task pipeline (`task-pipeline.yaml`) is reused
verbatim.

| File:line | What / why |
|-----------|-----------|
| `plugins/sp/commands/dev-runall.md:1` | `/sp:dev-runall` thin command (new, 1–87) — argument table (`--tasks`/`--keep-going`/`--auto`/`--agent`/`--json`), selector grammar, two-surface `--agent` contract, deterministic `Skill(skill="sp:spur-dev", args="runall $ARGUMENTS")` delegation. Mirrors `dev-run.md`. (R1, R4.2, R4.3) |
| `plugins/sp/agents/super-coder.md:1` | `sp:super-coder` batch orchestrator (new, 1–151) — the between-runs driver. Orchestrator boundary (R5.1: never reaches into a pipeline step; step execution is `vars.agent`'s job), decision-autonomy table bounded by the global Decision Authority table, batch-boundary-only HITL surfacing, batch-report output. Name-only reuse of rd3:super-coder. (R5) |
| `plugins/sp/skills/spur-dev/references/execution-batch.md:1` | The batch algorithm as prose (new, 1–239): selector resolution (R1), freeze-at-kickoff + Kahn topo-sort + cycle/out-of-set-dep policy (R2), the sequential driver loop with `--vars` passthrough (R3/R4), failure policy (R3), batch-report shape (R5.2), and an AC traceability table mapping every R to its step. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:18` | Registered `runall` as operation #13 with full behavior contract; corrected the Skill()-command list at L18 (added `brainstorm`), the count at L21 (8→9), and the operation count at L3 (→13). |
| `plugins/sp/skills/spur-dev/SKILL.md:100` | Added the "Batch run" row to the execution step table + `execution-batch.md` Additional-Resources link. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:23` | Cross-link distinguishing single-task (`run`) vs batch (`runall`) entry points. |
| `docs/04_DESIGN.md:785` | §7.8 — added `runall` (#13) to the `sp:dev-*` operation surface + table; repaired a broken sentence and stale "11 operations" count introduced during authoring. |
| `docs/05_FEATURES.md:150` | §9 — added the batch-execution feature row under the Planning Layer (✅), naming selectors, ordering, failure policy, and the deferred slices. |

**Design constraint honored:** no `.ts`/engine code. Selector resolution, dependency ordering, and
the driver loop are agent reasoning over existing CLI verbs (`spur task list --json`, `spur task show
--json`, `spur workflow run`). A `batch-driver.ts` was produced during the first pipeline run and
**removed** — it re-implemented in code what the skill+CLI already provide, violating the loop-in-skill
stance; the Design block was subsequently hardened with an explicit markdown-only guardrail to prevent
recurrence.

**Deferred (not in this task):** parallel execution (needs git-worktree isolation); interactive
within-step Q&A (waits for workspace + inbox + `spur agent` team mode). `sp:super-coder` surfaces
blockers only at the batch boundary.
### Testing

### Review
**Verdict: PASS (artifacts authored; gate pending operator verification).** The three markdown
deliverables + wiring are present and convention-clean. The first pipeline run also produced an
over-scoped `batch-driver.ts` (510 LOC, 57 tests) which was **removed** as an ADR-022 violation
(orchestration is prose, not engine code); the Design block was hardened with a markdown-only
guardrail. The findings below are the residual items carried from that run that remain relevant.

| Sev | Area | Finding | Resolution |
|-----|------|---------|-----------|
| P2 | Convention (latent) | `plugins/sp` is **not** a Bun workspace (no `package.json`), so `bun run typecheck` (`--filter '*'`) never reaches it; `biome check` and `bun test` do. For markdown-only deliverables this is moot, but it is a real latent gap for any future plugin TS (the `daily-summary.ts` precedent shares it). | No action for this task (markdown only). Tracked as a latent risk if plugin TS grows — would need a `plugins/sp/tsconfig.json` + gate wiring. |
| P3 | Traceability | The task's R1–R5 BDD scenarios are not yet propagated into feature H1's own AC (DD-09 subset rule → L4 WARNs on `spur task check`). | Planning-half follow-up: `spur feature` AC update for H1. Warnings only; non-blocking. |
| P3 | Verification | The batch algorithm's behavior surface (selectors, topo-order, failure policy) is markdown + CLI calls, not a unit-tested library. End-to-end proof is a dogfood run of `/sp:dev-runall` against a real multi-task set (R5.2 batch report). | Verify by dogfooding `/sp:dev-runall --tasks ready` once a 2+ task set with dependencies exists. |

#### Pass — what's correct

- **Orchestrator boundary (R5.1):** `super-coder.md` explicitly scopes the agent to between-runs work
  and disclaims step-level execution (`vars.agent`'s job) — matching the ratified design.
- **Selector + ordering (R1/R2):** `execution-batch.md` specifies all four selectors, freeze-at-kickoff,
  Kahn topo-sort with WBS-ascending tie-break, cycle→abort, and satisfied/unmet out-of-set dep policy,
  with a 1:1 AC traceability table.
- **Failure policy (R3):** stop-the-batch default + `--keep-going` subtree skip documented in both the
  reference and the agent's Always/Never rules.
- **Per-task reuse (R4):** the pipeline is invoked verbatim via `spur workflow run --async` + trace
  polling; only `--auto`/`--agent` cross the orchestrator→pipeline boundary, both into `--vars`.
- **Conventions:** command mirrors `dev-run.md`; agent mirrors `expert-dev.md`; wiring is consistent
  across `dev-operations.md` / `SKILL.md` / `execution-workflow.md`.
### References
Follow-up: deferred batch-execution slices (parallel runs + interactive within-step escalation) tracked in task 0142.
### History
- 2026-06-28T04:39:01.236Z todo → wip (system)
- 2026-06-28T04:58:37.655Z wip → todo (system)
- 2026-06-28T05:16:13.897Z todo → wip (system)
- 2026-06-28T05:16:13.996Z wip → testing (system)
- 2026-06-28T05:30:08.288Z testing → done (system)
