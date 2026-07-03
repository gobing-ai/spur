---
description: Turn a vague idea into a feature with AC and a decomposed task batch — discovery, feature-create, AC, feature-check, system-design, decompose, batch-create, handoff
argument-hint: "\"<idea>\" [--auto] [--design] [--skip-design] [--design-approved]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill"]
---

# Dev Idea

Wraps the **idea-pipeline.yaml** workflow — the unified entry point from a vague idea to a feature,
acceptance criteria, and an executable task batch.

The pipeline runs: discovery (brainstorm) -> feature-create -> ac-generate -> feature-check ->
system-design (conditional) -> design-approval -> decompose -> batch-create -> handoff.

The pipeline STOPS at handoff — tasks are created but NOT executed. Use `/sp:dev-run` or
`/sp:dev-runall` to execute the created tasks.

## When to use

- A vague idea arrives and you want to turn it into a feature with AC and tasks.
- The operator says "I have an idea for X" or "create a feature from this idea."
- You want the full planning half (brainstorm + design + decompose) from a single entry point.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `"<idea>"` | The idea text (required, positional, quoted) | (required) |
| `--auto` | Set `profile=auto` — routes around objective HITL gates (feature-check, batch-create) BEFORE entry. Design-approval (taste) still pauses. Not `--yes-to-everything`. | off |
| `--design` | Force the system-design step to run, regardless of the `needs_design` signal. | off |
| `--skip-design` | Skip the system-design step. The brainstorm design summary is still recorded. | off |
| `--design-approved` | Set `design_approved=true` for an explicitly approved design in the current operator session; under `--auto`, routes around the design-approval taste gate. | off |

## Behavior

Thin wrapper: builds the `--vars` JSON and invokes the idea pipeline.

```bash
spur workflow run .spur/workflows/idea-pipeline.yaml \
  --vars '{"idea":"<text>","profile":"interactive|auto","design":"auto|force|skip","design_approved":"false|true"}'
```

### Design routing

The `--design` / `--skip-design` flags control whether the `system-design` state runs:

| Flags | Signal | Route |
|---|---|---|
| `--design` | (ignored) | run `system-design` |
| `--skip-design` | (ignored) | skip `system-design`; keep brainstorm summary |
| neither | `needs_design=true` | run `system-design` |
| neither | `needs_design=false` | skip `system-design` |

Ties lean design — when the signal is ambiguous, `system-design` runs.

### HITL gates

- `feature-check` and `batch-create` are objective gates — auto-routable under `--auto`.
- `design-approval` is a taste gate — NOT auto-clicked by `--auto` unless explicit prior approval
  is represented in workflow vars.


### `--auto` behavior

`--auto` sets `profile=auto` in the workflow vars. Per the Auto-Decision Principles
([cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Auto-Decision Principles"):

- **Objective HITL gates** (`feature-check`, `batch-create`) are routed around BEFORE entry —
  the workflow engine does not auto-dismiss `hitl.confirm` states. The YAML transitions skip
  the gate state entirely when the objective check passes.
- **Taste gates** (`design-approval`) still pause — the operator must explicitly approve the
  design. `--auto` does not auto-click taste gates unless an explicit prior approval
  (`design_approved=true`) is represented in the workflow vars.
- **Irreversible actions** still pause — none in this pipeline, but the principle holds.
- `--auto` is NOT `--yes-to-everything`. It auto-continues on objective pass; it surfaces
  taste and irreversible decisions to the human.

## Implementation

`$ARGUMENTS` passes the idea text and flags. The wrapper extracts the idea (first positional) and
translates `--auto`/`--design`/`--skip-design` into the vars JSON:

```bash
IDEA="<first positional from $ARGUMENTS>"
PROFILE="interactive"
DESIGN="auto"
DESIGN_APPROVED="false"
# Parse --auto -> PROFILE="auto"
# Parse --design -> DESIGN="force"
# Parse --skip-design -> DESIGN="skip"
# Parse --design-approved -> DESIGN_APPROVED="true"

spur workflow run .spur/workflows/idea-pipeline.yaml \
  --vars "{\"idea\":\"$IDEA\",\"profile\":\"$PROFILE\",\"design\":\"$DESIGN\",\"design_approved\":\"$DESIGN_APPROVED\"}"
```

On HITL pause, surface the run id and continue instruction:
`spur workflow continue <run-id> --yes` to approve, or provide feedback.

The pipeline outputs at handoff: feature id, task WBS list, and the next command to run
(`/sp:dev-run <first-wbs>` or `/sp:dev-runall --tasks feature:<id>`).

## Platform Notes

- **Claude Code:** native — `$ARGUMENTS` and `Bash` for `spur workflow run`.
- **Other platforms:** invoke `spur workflow run .spur/workflows/idea-pipeline.yaml` with the
  constructed `--vars` JSON.
