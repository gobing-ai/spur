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
