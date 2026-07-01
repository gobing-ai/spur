---
name: cross-cutting
description: "Extracted section: cross-cutting write rules shared by both halves — every-write-is-CLI-gated, the section-editing body-only workflow, the section-status matrix, and check-before-write. These mechanics apply to all planning and execution writes."
see_also:
  - spur-dev
---

# Cross-cutting Rules

These mechanics apply to **every** write in both the planning and execution halves. The skill
knows *how to think*; the CLI knows *what is valid* — every mutation passes through a CLI verb
that validates before writing.

## Honor `--agent` — the two-surface contract

`--agent` means different things on the two command surfaces. "Current agent" is achievable on
one and physically impossible on the other, so the contract splits:

| Surface | Commands | Default (no `--agent`, or `inherit`) | Explicit `--agent <name>` / `auto` |
|---|---|---|---|
| **Inline** | `dev-plan`, `dev-refine`, `dev-brainstorm`, `dev-unit` | Run the model step **in the current session** — do NOT shell to `spur agent run`; write the result via `spur task update --section --from-file` directly | Spawn via `spur agent run "<prompt>" --agent <value>` |
| **Pipeline** | `dev-run`, `dev-review`, `dev-verify` | Forward nothing — the spawned `agent.run` step uses the configured default executor (`omp`). Current-agent execution is **not expressible** (the FSM runs a subprocess; the calling agent cannot block on itself) | Forward `--agent <value>` into the workflow `vars`, spawning that agent |

### Inline surface — the default is in-session

Inline commands are already an LLM running in the current session; the model step *is* the agent
itself. So the default performs synthesis directly from the skill's own context and lands the
result through the section-editing workflow above — no subprocess. `spur agent run` is invoked
**only** when the operator forwarded an explicit agent (`<name>` or `auto`) — a deliberate spawn
of a *different* agent.

This is a skill-behavior rule, not a CLI rule. Nothing in `packages/app` gates it; the inline
skill files carry the instruction to synthesize in-session unless an explicit agent was forwarded.

### Pipeline surface — current-agent is impossible

The dual-workflow FSM runs each stage as a subprocess (`task-pipeline.yaml`'s `agent.run` steps).
The calling agent cannot block on itself, so there is no way to express "run this stage in the
current session." The honest default is: forward nothing, and the spawned step resolves to the
configured default executor. Document this impossibility in pipeline command docs rather than
implying `inherit` runs the current agent.

### Never hardcode an agent

On both surfaces, the selector flows from the command flag so the operator can steer which agent
does the model work without editing the skill. The only special-case token is `auto` (resolve from
the current runtime) — every other value is an explicit agent name.

## Every write is CLI-gated

Never edit a task or feature file directly. Every mutation goes through:

| Intent | CLI verb |
|--------|----------|
| Create a task | `spur task create` |
| Change status | `spur task update <wbs> <status>` |
| Edit a section | `spur task update <wbs> --section <name> --from-file <path>` |
| Record verify results | `spur task record <wbs> [--solution-from-diff] [--transition <status>]` |
| Create a feature | `spur feature create` |
| Batch create tasks | `spur task batch-create --file <json>` |

## Status transitions in `--next` chains honor the FSM

The interactive `--next` step-chain (`dev-refine → dev-run → dev-verify → done`) moves a task's
status with `spur task update <wbs> <status>` **without `--no-lifecycle`**, so the lifecycle guards
run: `wip → testing` invokes `spur task check`, `testing → done` invokes
`spur task check --strict-core`. A guard failure **stops the chain as review-pending** — leave the
task at its current status, surface the blocking finding, do not advance. This is the gate that
keeps a malformed task out of `testing`/`done`.

`--no-lifecycle` is **pipeline-only**: `task-pipeline.yaml` suppresses lifecycle-run creation
because it runs the equivalent checks as its own workflow transitions (and to avoid orphaned
lifecycle runs). Never add `--no-lifecycle` to an interactive chain transition — doing so bypasses
the very guard the chain relies on for its review-pending stop.

## Section-editing workflow

The dominant agent write pattern (hot path 2):

1. Generate the new section content to a temp file.
2. `spur task update <wbs> --section <name> --from-file <temp>` — the CLI writes it.
3. Remove the temp file.

This is the only sanctioned path for LLM-generated content to enter the corpus. The CLI
validates the section against the status-section matrix before writing.

**Body-only format** (avoids the corruption class fixed in task 0115):

- **Body-only:** the temp file is the section *body* only — no `## SectionName` heading line.
  The CLI adds the canonical heading (`### SectionName` for tasks). If the temp file starts with
  a heading matching the section name the CLI strips it, but write body-only from the start.
- **No same-level sub-headings:** never use `###` sub-headings inside a task section body (e.g.
  `### AC1 — …`). They sit at the canonical section level and would become phantom sections on
  re-parse; the CLI now strips them with a stderr warning, but write clean. Use bullet lists,
  tables, or `**bold**` labels for sub-structure instead.
- **Never suppress stderr:** run `spur task update` without `2>/dev/null`. Stderr carries the
  diagnostic (including the strip warnings above); suppressing it turns a fixable error into a
  silent exit-1 that wastes a round-trip.

## The section-status matrix

`spur task check <wbs> --json` returns the required and optional sections for the task's
current status. Agents ask "what does this task need now?" with zero tokens by reading the
`--json` output — no need to load and parse the matrix YAML.

## Check before write

Before editing any task file, run `spur task check <wbs>` to see what sections exist, what
is missing, and what format rules apply. The check is the single validation surface:
frontmatter schema, section-status matrix, section format rules, feature traceability.

After writing a section, run `spur task check <wbs>` again to confirm the write introduced no
structural issues (phantom sections, matrix violations) before moving on.

## Iron Laws

Seven non-negotiable invariants for the spur-dev lifecycle. These are laws, not guidelines — a
violation is a defect in the run, not a style choice. Every competency skill and the spine consume
them; they live here because they cross every phase boundary.

1. **NEVER skip the verification gate.** A task is not done until `spur task check <wbs> --strict-core`
   returns PASS and every AC scenario has a corresponding verify command that exited 0. "I tested it
   manually" is not verification evidence.
2. **NEVER write to task/feature corpus outside the `spur` CLI.** Direct file edits to
   `docs/tasks2/*.md` or `docs/features/*.md` are forbidden. The only exception is working memory
   under `.spur/memory/`. Every other mutation goes through `spur task` / `spur feature` so the
   schema, matrix, and traceability guards run.
3. **NEVER mark a task done without a PASS verdict.** `testing → done` requires
   `spur task check --strict-core` PASS and a recorded verdict. PARTIAL or FAIL verdicts leave the
   task at `testing` and surface to the operator.
4. **NEVER proceed past a failed gate without explicit operator approval.** A failed
   `feature-check`, `batch-create`, `precheck`, `review`, or `verify` stops the run. The operator
   decides whether to fix-forward, rework, or abort — the agent does not auto-retry past a failure.
5. **NEVER suppress gate failures with `--no-verify`, `--force`, or new `biome-ignore` /
   `eslint-disable` suppressions.** Suppression is a silent bypass. If a gate fails, fix the root
   cause. A suppression added solely to silence a gate is a defect, not a fix.
6. **NEVER create a standalone PM skill or command.** Product-management judgment lives in
   `product-planning.md` as a lens applied during intake and decomposition. No `sp:product-management`
   skill, no `/sp:prd-*` commands, no `sp:super-pm` agent — unless a later task proves a stable,
   distinct routing value (ADR-022).
7. **NEVER claim completion without fresh verification evidence.** "Tests pass" must be backed by
   the actual `bun run test` tail pasted into the record. "Lint clean" must be backed by
   `bun run lint` output. Stale evidence from a prior run is not evidence — re-run the gate and
   paste the current output.

## Auto-Decision Principles

Seven principles governing `--auto` mode. `--auto` sets `profile=auto` in the workflow vars; the
principles determine which gates route around HITL and which still pause.

1. **Schema-valid → auto-approve.** If the input passes local schema validation
   (`task-batch.schema.json`, BDD validator, frontmatter schema), the gate is entered without
   pausing. The schema is the contract; schema-valid means structurally sound.
2. **Gate-passed → auto-continue.** If `spur task check`, `spur feature check`, or
   `spur workflow validate` exits 0, the run continues to the next state without surfacing.
3. **Tests-green → auto-continue.** If `bun run lint` and `bun run test` exit 0, the verify step
   continues. A red test suite is a hard stop, not an auto-retry.
4. **Verdict-PASS → auto-continue.** If the verify step produces a PASS verdict, the run advances
   to `record` and `done`. PARTIAL or FAIL verdicts surface to the operator regardless of `--auto`.
5. **Taste-decision → surface to human.** Architecture approval, naming, UX shape, and
   "is this the right abstraction" decisions are taste gates. `--auto` does not auto-resolve them.
6. **Irreversible action → surface to human.** Branch deletion, force-push, schema migration,
   `spur feature update <id> cancelled`, and any `--merge` / `--force` action pauses regardless of
   `--auto`. Irreversible is irreversible.
7. **Error → stop.** Any unexpected error (CLI crash, schema parse failure, missing file) stops the
   run. `--auto` is not a license to power through errors; it is a license to skip *objective* HITL
   pauses, not to ignore failures.

### The `--auto` routing contract

`--auto` sets `profile=auto`. The workflow YAML transitions must **route around** an auto-resolvable
HITL state **before entry** — the workflow engine does NOT auto-dismiss `hitl.confirm` states. This
is the critical contract: `--auto` is not "auto-click yes on every gate"; it is "use the transition
graph to skip gates whose objective preconditions are already met."

Concretely: an `idea-pipeline.yaml` with `profile=auto` transitions from `feature-check` directly
to `decompose` when the feature-check exits 0, never entering a `hitl.confirm` state for
`feature-check`. But `design-approval` (a taste gate) still enters `hitl.confirm` and pauses,
because there is no objective precondition that can route around it.

**Without `--auto`** (the default), all gates surface to the human — including objective gates.
The operator approves every state transition interactively. This is the safe default; `--auto` is
opt-in for trusted, low-risk runs.

## Pipeline Alignment

The system has multiple pipelines, each owning exactly one lifecycle phase. This section documents
the phase-ownership model, the no-nesting principle, and lifecycle guard respect — the structural
invariants that keep the pipeline set coherent as new ones are added.

### Pipeline phase table

| Pipeline | Lifecycle phase | Entry point | Terminal states |
|---|---|---|---|
| `idea-pipeline.yaml` | Ideation (vague idea → feature + AC + task batch) | `/sp:dev-idea` | `handoff`, `cancelled` |
| `planning-pipeline.yaml` | Design (known slug/task → design handoff) | `/sp:dev-plan` | `handoff`, `cancelled` |
| `task-pipeline.yaml` | Execution (one task → done) | `/sp:dev-run` | `done`, `failed` |
| `wrapup-pipeline.yaml` | Wrap-up (completed tasks → learning + metrics + doc-sync) | `/sp:dev-wrap`, `/sp:dev-wrapall` | `done`, `skipped` |
| `feature-dev.yaml` | Umbrella (brainstorm → plan → execute → feature-verify) | `/sp:dev-runall --feature` | `done`, `failed` |
| `basic.yaml` | Simple (generic implement/check/fix loop) | direct `spur workflow run` | `done`, `failed` |
| `feature-lifecycle.yaml` | Feature status FSM (entity lifecycle, not a phase pipeline) | `spur feature update` | `done`, `cancelled` |
| `task-lifecycle.yaml` | Task status FSM (entity lifecycle, not a phase pipeline) | `spur task update` | `done`, `cancelled` |

The two `*-lifecycle.yaml` workflows are entity FSMs, not phase pipelines. They guard persistent
entity state transitions; phase pipelines orchestrate work and may invoke lifecycle verbs but do
not replace them.

### No-nesting principle

A pipeline may invoke another workflow through a command wrapper or `spur workflow run` **only at a
phase boundary** — it must NOT inline another pipeline's state graph. Concretely:

- `feature-dev.yaml`'s `execute-tasks` state may invoke `task-pipeline.yaml` per task via
  `spur workflow run` (phase boundary: design → execution).
- `idea-pipeline.yaml`'s `handoff` state may output a command for the operator to run
  `task-pipeline.yaml` (phase boundary: ideation → execution).
- `task-pipeline.yaml`'s `implement` state must NOT contain a nested state machine for
  `code-implementation` — it dispatches the competency skill via `agent.run`, not by inlining
  another workflow's states.

Nesting state graphs couples pipelines at the implementation level, making the set unmaintainable
and breaking the "orchestration is configuration" principle (ADR-022). The no-nesting rule is the
structural invariant validated by Phase 3's `idea-pipeline.yaml` design.

### Lifecycle guard respect

New pipelines respect existing lifecycle guards — no new `*-lifecycle.yaml` workflows. Persistent
entity lifecycle legality remains in `feature-lifecycle.yaml` and `task-lifecycle.yaml`. New
pipelines advance entity status only through `spur` CLI verbs, which run the lifecycle guards:

- `task-pipeline.yaml` transitions a task `wip → testing → done` via `spur task update <wbs> <status>`
  (without `--no-lifecycle`), so `task-lifecycle.yaml` guards run.
- `wrapup-pipeline.yaml` does NOT mutate task status — it consumes completed tasks. If it advances
  a feature, it does so via `spur feature update <id> <status>`, running `feature-lifecycle.yaml`
  guards.
- `idea-pipeline.yaml` creates features and tasks via `spur feature create` and
  `spur task batch-create`, which run the lifecycle creation guards.

A new pipeline that needs to mutate entity status must do so through the CLI verb, never by
writing the file directly. This is the seam between phase orchestration (pipelines) and entity
legality (lifecycle FSMs).

## Learning Log Convention

Working learnings are captured in `.spur/memory/learnings.md` — a markdown scratchpad, NOT a
CLI-gated corpus artifact. The `wrapup-pipeline.yaml` `learning-capture` step writes to it.

**Format:**

```markdown
## <YYYY-MM-DD> — Task <WBS>

- **Convention discovered:** <what the agent learned about the project>
- **Error hit and resolved:** <what went wrong, how it was fixed>
- **Pattern that worked:** <approach worth repeating>
- **Gotcha:** <what to watch for in future tasks>
```

**Rules:**

- **Not CLI-gated.** The file is written directly by the wrap-up pipeline's `learning-capture`
  agent.run step. It does not go through `spur task update` or `spur feature update`.
- **Not a validated corpus.** The file is a working scratchpad. High-value learnings are promoted
  to `docs/99_PROJECT_CONSTITUTION.md §8` (lessons) by the `doc-sync` step (via `sp:doc-evolve`),
  not by the learning-capture step itself.
- **Append-only within a session.** New entries are appended; existing entries are not rewritten.
- **Grouped by date and task.** Each entry has a date and task WBS header so the operator can
  trace a learning back to its source task.
- **Operator-readable.** Markdown, not JSON. The operator can read and grep this file directly
  without parsing.

## Session Checkpoint Convention

Long-running pipelines write resumable checkpoints to `.spur/memory/sessions/` so an interrupted
run can be resumed. The convention is documented here; the actual checkpoint write/read actions
in pipeline YAMLs are added in Phase 4 (task 0171).

**Format:** Markdown file with YAML frontmatter:

```yaml
---
session_id: "2026-07-01-0167"
workflow: "task-pipeline"
run_id: "wf_..."
task_wbs: "0167"
feature_id: "I"
phase: "verify"
last_gate: "review-approved"
timestamp: "2026-07-01T18:30:00Z"
next_action: "run verification"
---

## Session Notes

<free-form markdown: what was done, what's pending, any blockers>
```

**Write checkpoints after:**

- Every HITL gate decision (approved/rejected/deferred).
- Every phase transition in `planning-pipeline`, `task-pipeline`, `feature-dev`, `idea-pipeline`,
  and `wrapup-pipeline`.
- Every terminal state (`done`, `failed`, `cancelled`, `skipped`).

**Read checkpoints when:**

- `/sp:dev-run --continue` or `/sp:dev-runall --continue` is used.
- The operator asks to resume a task or feature.
- A workflow run is paused and later continued (`spur workflow continue <run-id>`).

**Rules:**

- **Not CLI-gated.** Checkpoint files are written directly by the pipeline's checkpoint action
  (a `shell` step that writes to `.spur/memory/sessions/<session-id>.md`). They do not go through
  `spur task update`.
- **Not a validated corpus.** Checkpoints are working memory. They are overwritten when a session
  resumes and re-checkpoints. They are NOT authoritative task state — the task file is.
- **One file per session.** The `session_id` is `<date>-<wbs-or-feature>`. A resumed session
  overwrites the same file.
- **Operator-readable.** The YAML frontmatter is machine-parseable; the body is free-form markdown
  for the operator to scan.

## Design Approval Gate

The Design Approval Gate is the taste gate between system design and decomposition in the
`idea-pipeline.yaml`. It is a HARD gate — no downstream state proceeds without design approval.

**Two layers:**

1. **Brainstorm design summary (always recorded).** The `discovery` state's `sp:brainstorm` dispatch
   always records a design summary in the brainstorm artifact. This is the "nothing is too simple"
   pattern (Phase 1, task 0168 R3) — even trivial ideas get a one-paragraph summary. The summary is
   the contract between ideation and execution.

2. **System design approval (taste gate, conditional).** When `system-design` runs (determined by
   the `needs_design` signal), the `design-approval` state pauses for the operator to approve the
   architecture. This is a taste gate, NOT an objective gate — `--auto` does NOT auto-approve it.

**Auto-mode behavior:**

- `--auto` routes around the `design-approval` HITL state BEFORE entry only when
  `vars.design_approved = true` (representing explicit prior approval from the operator).
- Without explicit prior approval, `--auto` still pauses at `design-approval` — taste gates
  are not auto-clicked (Auto-Decision Principle #5).
- The brainstorm design summary is ALWAYS recorded, regardless of `--auto` — `--auto` does not
  bypass the "nothing is too simple" pattern.

**The `needs_design` signal routing:**

The signal is emitted by the `discovery` state's brainstorm dispatch and written to
`.spur/run/idea-needs-design.json`. The `feature-check` state's transition guards read it to
determine routing:

| `design` var | `needs_design` signal | Route |
|---|---|---|
| `force` | (ignored) | `system-design` -> `design-approval` -> `decompose` |
| `skip` | (ignored) | `decompose` (skip system-design; brainstorm summary still recorded) |
| `auto` | `true` | `system-design` -> `design-approval` -> `decompose` |
| `auto` | `false` | `decompose` (skip system-design) |
| `auto` | (missing) | `system-design` (ties lean design) |

See [brainstorm/SKILL.md](../../brainstorm/SKILL.md) § "Design Approval Gate" for the brainstorm-side
contract (6 patterns + `needs_design` criteria).
