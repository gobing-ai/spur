---
name: spur-plan
description: "Front-half planning pipeline — phasing, feature-ID derivation, and design-doc generation (steps 3–6). Turns a brainstormed feature draft into an approved design doc + drafted feature list, then hands off to sp:spur-dev. Triggers on: 'plan a feature', 'design doc generation', 'derive feature id', 'planning pipeline', 'front-half workflow', 'spur-plan'."
license: Apache-2.0
version: 1.0.0
created_at: 2026-06-19
updated_at: 2026-06-19
type: technique
platform: sp
tags: [planning, design-doc, feature-id, workflow-core, front-half]
metadata:
  author: spur
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: workflow-core
  interactions:
    - pipeline
    - reviewer
  operations:
    - plan-feature
    - derive-feature-id
    - author-design-doc
  pipeline_steps:
    - phasing
    - feature-id
    - design-gen
    - design-approval
    - handoff
see_also:
  - sp:brainstorm
  - sp:doc-evolve
  - sp:spur-dev
---

# sp:spur-plan — Front-Half Planning Pipeline

Turn a brainstormed feature draft into an **approved design doc + drafted feature list**, then
hand off to `sp:spur-dev` (steps 7–12). This skill is the how-to-think companion to
`config/workflows/planning-pipeline.yaml` — the YAML is the durable state machine; this skill
carries the judgment for the non-deterministic steps.

**The 1→12 chain:**

```
1–2  brainstorm → drafted feature list              sp:brainstorm         ✅ shipped
3–6  phasing → feature-ID → design-gen → approval   sp:spur-plan          🔵 THIS SKILL
7–12 feature-create → decompose → task-pipeline     sp:spur-dev            ✅ shipped
```

## Key distinction

- **`sp:brainstorm`** = ideation (steps 1–2): generate the feature draft at `docs/plans/<slug>-drafted.md`.
- **`sp:spur-plan`** = planning (steps 3–6): this skill — phasing, feature-ID, design doc, approval.
- **`sp:spur-dev`** = execution (steps 7–12): feature create, decompose, task pipeline.
- **`sp:doc-evolve`** = safety layer: enforces the constitution §5 sync triggers on every doc touch.

## Entry point

A brainstormed feature draft exists at `docs/plans/<slug>-drafted.md` (produced by `sp:brainstorm`).
If no draft exists yet, invoke `sp:brainstorm` first.

## Operations

### 1. Phasing (`02_ROADMAP` decision)

**Question:** Does this requirement need a new phase in `docs/02_ROADMAP.md`?

**Decision procedure:**
1. Read `docs/02_ROADMAP.md` current phases.
2. Read the feature draft's scope.
3. If the requirement fits an existing phase → no new phase needed.
4. If it needs a new phase → **stage** the edit: draft the new phase row, present it to the
   operator, get explicit approval. **Never auto-write `02_ROADMAP`** — it is a high-risk
   authoritative doc (§5 T5; Q3). Write the staged edit to `docs/plans/<slug>-02-stage.md` for
   the operator to commit.

**`profile=auto`:** skip the HITL gate; assume no new phase unless the draft explicitly says so.

### 2. Feature-ID derivation

**Goal:** allocate the correct parent + child feature ID.

**Procedure:**
1. Scan `docs/features/` for the parent feature (by name or scope match).
2. Scan `docs/05_FEATURES.md` for the parent's current children to determine the next child id.
3. Allocate the child id using the **same rule as `spur feature create`** — digit ≤9 per level
   (R-FEATURE-ID). Do not invent a parallel scheme.
4. Record the derived id for the design-doc step.

**Grounding:** verify the allocation by running `spur feature list --json` and confirming the
parent exists and the child id is unused.

### 3. Design-doc generation

**Goal:** author `docs/design/<slug>.md` from the feature draft.

**Procedure:**
1. Read `docs/plans/<slug>-drafted.md` (the brainstorm output).
2. Read the parent feature's scope from `docs/features/<parent>.md`.
3. Author the design doc covering: architecture, module boundaries, data flow, surface shapes
   (commands/flags/schemas), risks, open items.
4. **Invoke `sp:doc-evolve`** to stage the `04_DESIGN` index edit (the new design doc's entry in
   `docs/04_DESIGN.md` §index). **Never auto-write the `04_DESIGN` index** — it is a high-risk
   authoritative doc (§5 T3; Q3). Stage to `docs/plans/<slug>-04-stage.md`.
5. The design doc itself (`docs/design/<slug>.md`) is a **derived** doc — safe to auto-write.

**Agent tier (Q8 — advisory, not enforced):** use the highest-quality coding agent available for
design-doc generation. Tier preference: Claude Code 4.8 > Codex > pi/GLM-5.2 > pi/deepseek. This
is guidance recorded in prose; the operator selects the agent at launch.

### 4. Design-doc approval (HITL gate)

**The highest-leverage gate.** Present the design doc to the operator. Loop until approved:

- **Approved** → proceed to handoff.
- **Rework** → return to step 3 (design-doc generation) with the operator's feedback.
- **Cancelled** → terminal.

**`profile=auto`:** skip the gate; assume the design doc is acceptable as-drafted.

### 5. Handoff

The pipeline terminates at an **approved design doc + drafted feature list**. The handoff seam is
the drafted-feature-list file at `docs/plans/<slug>-drafted.md`. Hand off to `sp:spur-dev`, which
starts at `spur feature create` and runs steps 7–12.

Explicitly tell the operator: "Front-half complete. Invoke `/sp:dev-run` or `sp:spur-dev` to
execute the back half (feature create → decompose → task pipeline)."

## Running the pipeline

### Via the workflow engine (durable, resumable)

```bash
spur workflow run config/workflows/planning-pipeline.yaml \
  --vars '{"slug":"auth-migration","profile":"interactive"}'
```

The HITL gates pause for `spur workflow continue`. `profile=auto` skips the gates for unattended runs.

### Via the skill directly (in-process)

Invoke the operations above in order. Use `sp:doc-evolve` for every authoritative-doc touch.
This is the path when running inside a coding agent session (no separate workflow run needed).

## Doc-write discipline (Q3 — hybrid by risk)

| Doc | Write mode | Why |
|-----|-----------|-----|
| `docs/design/<slug>.md` | **auto-write** (derived) | New artifact; gated by `spur feature check` later |
| `docs/features/<id>.md` | **auto-write** (derived) | New artifact; atomic writes via `spur feature create` |
| `05_FEATURES.md` index | **auto-write** via `spur feature refresh` | Derived; already gated |
| `02_ROADMAP.md` phasing | **stage** for human commit | High-risk authoritative; §5 T5 |
| `04_DESIGN.md` index | **stage** for human commit | High-risk authoritative; §5 T3 |

Every touch — auto-write or staged — invokes `sp:doc-evolve` to enforce the §5 sync triggers.

## Grounding (fat-skill verification)

Every `spur …` claim in this skill is grounded against a real CLI verb:

| Claim | Verb |
|-------|------|
| Feature ID allocation rule | `spur feature create` / `spur feature list --json` |
| Feature index refresh | `spur feature refresh` |
| Workflow validation | `spur workflow validate config/workflows/planning-pipeline.yaml` |
| Workflow run | `spur workflow run config/workflows/planning-pipeline.yaml --vars '{...}'` |
| Doc sync enforcement | `sp:doc-evolve sync-check` |

If a verb does not exist, the skill says so explicitly rather than inventing it.

## See also

- **sp:brainstorm** — step 1–2 entry point; produces the feature draft this skill consumes.
- **sp:doc-evolve** — invoked at every authoritative-doc touch; enforces §5 sync triggers.
- **sp:spur-dev** — step 7–12 back half; the handoff target.
- **`config/workflows/planning-pipeline.yaml`** — the durable state machine; validates against
  `@gobing-ai/spur/schemas/state-machine-workflow.schema.json`.
