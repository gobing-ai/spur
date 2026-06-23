---
name: spur-dev
description: The fat daily-workflow umbrella skill for the Spur planning+execution pipeline. Converts vague feature descriptions into CLI-validated feature files with BDD acceptance criteria, decomposes them into task batches, and runs tasks through the execution pipeline with HITL gating. Delegates every deterministic step to CLI verbs; contains zero validation logic. Triggers on "plan a feature", "decompose this", "run the task", "execute task", "dev workflow", "create tasks from this", "run pipeline", or operating the full spur planning lifecycle.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - pipeline
  halves:
    - planning
    - execution
  pipeline_steps:
    - intake
    - feature-create
    - ac-generation
    - feature-check-gate
    - decomposition
    - batch-create-gate
    - task-selection
    - workflow-run
    - hitl-surfacing
  openclaw:
    emoji: "🔄"
---

# Spur Dev — The Daily-Workflow Umbrella Skill

`sp:spur-dev` is the fat skill that drives the full planning-to-execution workflow. It converts
vague intent into shipped work: plan a feature with BDD acceptance criteria, decompose it into
tasks validated by the CLI, then run those tasks through the execution pipeline with human-in-the-loop
gates. Every write to the corpus goes through a CLI verb that validates before writing — the
skill knows *how to think*; the CLI knows *what is valid*.

The two halves are a **sanctioned future split seam** (design §12.1, risk R4). Today they are one
skill because they share vocabulary, gates, and the same CLI surface. When size hurts, split at the
section boundary below — each half already owns its complete workflow independently.

## Planning half

```
vague description
  → intake (clarify scope, constraints — prompt work)
  → spur feature create … ; AC authored/generated (spur agent run, bdd templates)
  → GATE: spur feature check   (BDD validator; loop until clean)
  → decomposition (prompt work) → task-batch JSON
  → GATE: task-batch.schema.json + spur task batch-create (atomic: all-or-nothing)
```

The planning half transforms a description into a validated feature file with acceptance
criteria, then decomposes it into a batch of tasks. Two CLI gates make LLM regressions
unable to corrupt the corpus: `spur feature check` validates the AC, and
`task-batch.schema.json` validates the decomposition shape before `spur task batch-create`
writes anything.

### Step 1: Intake

When given a feature description, clarify before creating:

1. **Scope** — what is in, what is explicitly out. Record both.
2. **Constraints** — existing systems it must work with, performance/security boundaries.
3. **Success criteria** — how will we know it's done? (Feeds AC generation.)

Ask only what is ambiguous. A crisp description needs no Q&A loop — proceed directly to feature
creation.

### Step 2: Feature creation + AC generation

```bash
spur feature create "<name>" [--parent <id>]
```

The feature file lands in `docs/features/<ID>_<slug>.md`. Immediately author the `## Goal`
(single sentence) and `## Scope` (in/out bullets).

Then generate **BDD acceptance criteria** in the `## Acceptance Criteria` section using the
Gherkin template. Conventions:

- **R-numbered scenarios:** each scenario carries an `R1, R2, …` prefix in its title for
  cheap, human-readable traceability. (Coverage matching is by **normalized scenario title** —
  the R-prefix is stripped before matching — so keep the title text stable, not just the number.)
- **Two AC tiers:** core scenarios (the must-pass gate) and edge-case scenarios (advisory
  warnings — the permissive start, per DD-06). Mark edge-case scenarios explicitly.
- **Scenario-title mapping:** the scenario title is the identity key for traceability edges
  to task files — keep them stable and unique.
- Use `spur agent run` with the BDD template (`config/templates/bdd/gherkin.md`) for
  generation, or author directly if the feature is simple.

### Step 3: Feature check gate (loop)

```bash
spur feature check <id> --json
```

The BDD validator gate. A non-zero exit means findings:

1. Read each finding from the JSON output.
2. Fix the **specific** AC issue — never restructure unrelated scenarios.
3. Re-run. Loop until exit 0.

This gate catches: malformed Gherkin, missing required scenario elements, traceability gaps.
A skill regression can never corrupt the corpus — worst case is a rejected write with findings
the skill can react to.

### Step 4: Decomposition

With a clean feature, decompose into tasks:

1. Read the feature's scenarios (the AC).
2. For each scenario, design one or more tasks that implement it — each task maps to at
   least one scenario by title.
3. Produce a **task-batch JSON** document conforming to `task-batch.schema.json` — a top-level
   JSON **array** of strict task items (no `tasks` wrapper, only documented fields).

Decomposition heuristics:
- **One task = one atomic unit of work** a single agent can complete.
- **Scenario coverage:** every core scenario maps to ≥1 task; edge-case scenarios may map
  or be deferred.
- **Sub-tasks:** record `parent_wbs` (quoted, e.g. `"0042"`) for sub-tasks; note ordering in
  `background` prose (the item schema has no `dependencies` field).
- **Template variants:** choose `feature-impl` for implementation tasks (pulls Goal →
  Background from the linked feature, per B09).

The batch JSON is the LLM→CLI contract — see
[references/decomposition.md](references/decomposition.md) for the full schema and
conventions.

### Step 5: Batch-create gate

```bash
spur task batch-create --file <batch.json>
```

Atomic: all-or-nothing. If `task-batch.schema.json` validation fails, **nothing is written**
and findings are returned. The skill reads the findings, fixes the JSON, and retries. Common
failures:

- Missing required fields per the template variant's section matrix.
- Invalid status values (must be lowercase canonical).
- `feature_id` referencing a non-existent feature.
- WBS collisions (already-allocated range).

Loop until the command exits 0 — then the batch is created and each task appears in the
feature's `## Tasks` block on next `spur feature refresh`.

### Step 6: Refine before execute (the spec-completion gate)

`batch-create` lands a task at **`todo`** with its required sections (`Acceptance Criteria`,
`Design`, `Plan`) **scaffolded as guidance comments only** — the batch item carries `background`
and `requirements`, but it has no field for AC/Design/Plan, and `spur task check` gates on section
*presence*, not human content. So a freshly batch-created `todo` task is **structurally ready but
content-incomplete**: it passes `check` while its Design/Plan are still empty placeholders.

Before a task enters the execution half, fill those sections via the **refine** operation
(`/sp:dev-refine <wbs>`): read the task, elicit the missing AC/Design/Plan through targeted Q&A,
and write each via `spur task update <wbs> --section <name> --from-file`. This is the only path
that turns the `todo` HITL-review gate from a formality into a real one — a reviewer approves the
*Design*, not an empty heading.

**Do this just-in-time, per task, immediately before execution** — not in bulk at decomposition
time. Design written against a stale snapshot of the codebase rots; design written right before
`implement` reflects current reality. Refine `0042`, run `0042`; refine `0043`, run `0043`.

> **Requirements formatting:** author R-items as a GitHub task-list checkbox — `- [ ] R1. <text>`
> — so progress is trackable in the file. The L3 check accepts the `- [ ] Rn.` / `- Rn.` / `Rn.`
> forms; keep the `Rn.` (period) token so the R-numbering rule recognizes it.

---

## Execution half

```
pick task (spur task list --json)
  → spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}'
  → on HITL pause: surface to operator → spur workflow continue [run-id] [--yes]
```

The execution half runs a single task through the `task-pipeline.yaml` workflow. The
pipeline drives the work; the skill interprets results, surfaces HITL gates, and decides
next steps.

> **`/sp:dev-run` drives the pipeline — it is NEVER a pipeline step.** The command
> `/sp:dev-run <wbs>` means "run this whole pipeline." The pipeline's internal stages call
> *different* commands — `/sp:dev-implement`, `/sp:dev-unit`, `/sp:dev-review`,
> `/sp:dev-verify` — never `/sp:dev-run` itself. Calling `/sp:dev-run` from inside the
> `implement` step would recurse into another full pipeline run. The `implement` step is
> the **implement operation** (below); the verify step is `sp:code-verification`.

### The implement operation (the pipeline's implement step)

`/sp:dev-implement <wbs>` (the `implement` pipeline stage) does exactly one thing: write the
code that satisfies the task. Read the task's `## Requirements`, `## Design`, and `## Plan`
(`spur task show <wbs> --json`), implement against them, and work the plan checklist. It does
**not** run tests, review, or verify — those are the separate `test` / `review` / `verify`
stages. Keeping implement single-purpose is what lets the pipeline (not the agent) own the
loop: the agent implements, the workflow advances.

### Section ownership — `## Solution`

The implement step **owns** `## Solution` (the change-map). After writing code, before
yielding, the implement agent authors the `## Solution` section — a markdown table listing
each changed file with a `file:line` range and a one-line `what/why` summary — and writes it
via `spur task update <wbs> --section Solution --from-file <tmp>`. Write **only when the
section is bare** (absent, empty, or a known pipeline placeholder); never clobber a
hand-authored change-map. The `replaceSection` upsert guarantees missing→add,
present→replace, never duplicate. If the implement agent forgets, the pipeline's `record`
step backfills a minimal change-map from `git diff --name-only` as a safety net.


### Step 1: Task selection

```bash
spur task list --status backlog --json
spur task list --status wip --json
```

Pick a task. Priority order: WIP tasks first (continue in-progress work), then highest-priority
backlog tasks. Use `--json` for machine consumption; sort client-side by priority/created_at.

### Step 2: Pipeline run

```bash
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"<wbs>"}' --json
```

The pipeline (`kind: state-machine`) runs the work loop:

```
precheck → implement → test → review → approve(HITL) → verify → record → done
```

Each step is an `agent.run` action carrying `sp:dev-*` command inputs. The skill monitors
the run:

- **On HITL pause** (`approve` state): surface the review output to the operator.
  `spur workflow continue <run-id> --yes` to approve, or provide feedback to loop back.
- **On guard failure** (`precheck`): the task's check findings block progress — fix the
  task first.
- **On completion** (`done`): the pipeline's `record` step has already written results into
  the task's `## Testing` and `## Review` sections via `spur task update --section`.

### Step 3: Continue

After a completed task, decide next action:

- **More tasks in the feature?** Pick the next one, run again.
- **Feature complete?** Run `spur feature update <id> verifying` to mark it for
  acceptance verification.
- **All done?** Run `spur task refresh` + `spur feature refresh` to regenerate the kanban
  and index.

### Skipping HITL

Passing `--vars '{"profile":"auto"}'` to `spur workflow run` (a var choice, not a YAML fork) skips
the `approve` HITL gate — use for low-risk, well-understood tasks where operator review adds no value.
(Combine with `wbs` in one object: `--vars '{"wbs":"0042","profile":"auto"}'`.)

---

## Cross-cutting rules

### Every write is CLI-gated

Never edit a task or feature file directly. Every mutation goes through:

| Intent | CLI verb |
|--------|----------|
| Create a task | `spur task create` |
| Change status | `spur task update <wbs> <status>` |
| Edit a section | `spur task update <wbs> --section <name> --from-file <path>` |
| Create a feature | `spur feature create` |
| Batch create tasks | `spur task batch-create --file <json>` |

### Section-editing workflow

The dominant agent write pattern (hot path 2):

1. Generate the new section content to a temp file.
2. `spur task update <wbs> --section <name> --from-file <temp>` — the CLI writes it.
3. Remove the temp file.

This is the only sanctioned path for LLM-generated content to enter the corpus. The CLI
validates the section against the status-section matrix before writing.

### The section-status matrix

`spur task check <wbs> --json` returns the required and optional sections for the task's
current status. Agents ask "what does this task need now?" with zero tokens by reading the
`--json` output — no need to load and parse the matrix YAML.

### Check before write

Before editing any task file, run `spur task check <wbs>` to see what sections exist, what
is missing, and what format rules apply. The check is the single validation surface:
frontmatter schema, section-status matrix, section format rules, feature traceability.

---

## When to use

Use this skill for:

- **Planning a feature** — a description arrives; produce a feature file with AC and
  decomposed tasks.
- **Running a task** — pick a task, run it through the pipeline, handle HITL gates.
- **Continuing interrupted work** — resume a paused pipeline run.
- **Batch task creation** — decompose a feature into tasks and land them atomically.

Do **not** use this skill for:

- Looking up task/feature verbs or conventions — use the `sp:spur-tasks` /
  `sp:spur-features` companion skills.
- Gate-level constraint checking — use `sp:spur-rules`.
- Workflow authoring/tuning — use `sp:spur-workflows`.
- Documentation maintenance — use `sp:doc-evolve`.

---

## Behavior

This skill behaves as a **pipeline** operator: it converts intent into CLI-validated
artifacts, gates every write, and drives execution workflows. It owns the full planning→done
lifecycle but delegates every deterministic step to CLI verbs. It does not validate — the
CLI does.

---

## Gotchas

1. **Never skip a gate.** A clean `feature check` is the only proof the AC is valid; a
   passing `batch-create` is the only proof the decomposition is well-formed. Skip either and
   you ship corrupted corpus.
2. **The pipeline, not you, writes results.** `## Testing` and `## Review` sections are
   filled by the pipeline's `record` step. Do not edit them directly during execution.
3. **Check before every write.** Run `spur task check <wbs> --json` to know what sections
   the task needs at its current status. Guessing produces matrix violations.
4. **AC titles are identity keys.** Renaming a scenario after tasks are created breaks
   traceability edges. If you must rename, update the task's scenario references too.
5. **Batch-create is atomic.** A single schema violation rejects the entire batch. Validate
   locally against `task-batch.schema.json` before invoking the CLI.
6. **Two-halves seam.** The planning and execution halves share this skill today but are
   designed to split cleanly. Keep new logic in one half or the other — never straddle the
   seam with cross-half dependencies.

---

## Additional Resources

- [references/decomposition.md](references/decomposition.md) — the `task-batch.schema.json`
  contract, template-variant selection, scenario-to-task mapping conventions.
- [references/ac-style-guide.md](references/ac-style-guide.md) — BDD scenario authoring:
  R-numbering, the two AC tiers, scenario-title stability, Gherkin template usage.
- `config/workflows/task-pipeline.yaml` — the execution pipeline definition.
- **`sp:spur-plan`** — the front-half planning pipeline (steps 3–6: phasing → feature-ID →
  design-doc → approval). `sp:spur-dev` picks up at the handoff seam (the drafted feature list
  produced by `sp:spur-plan`); the full 1→12 chain is documented there.
- `config/workflows/planning-pipeline.yaml` — the front-half state machine.
- `config/templates/bdd/gherkin.md` — the BDD scenario template.

---

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool. The `sp:dev-*` slash commands are the primary entry points;
invoke the skill directly via `Skill(skill="sp:spur-dev", args="plan <description>")` for
the planning half, or `args="run <wbs>"` for execution. Use `spur agent run` for isolated
LLM invocations within pipeline steps.

### Codex / OpenClaw / OpenCode / Antigravity

Run `spur` CLI via the Bash tool; parse `--json` output. Invoke this skill directly for
the workflow logic — the skill is the SSOT; commands and subagents are thin wrappers.

---

**Template type**: technique
**Purpose**: Drive the full Spur planning-to-execution workflow — convert intent into CLI-validated feature files, decomposed task batches, and pipeline-driven execution with HITL gating
