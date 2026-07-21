---
name: brainstorm
description: "Structured ideation: generate solution options with trade-offs and confidence scoring, then delegate to research/task-creation skills. Triggers: \"brainstorm ideas\", \"explore solutions\", \"consider options\", \"research approaches\", \"what are my options\", \"how should I approach X\"."
license: Apache-2.0
version: 1.0.0
created_at: 2026-03-25
updated_at: 2026-03-25
type: technique
platform: sp
tags: [brainstorm, ideation, solution-generation, trade-offs, workflow-core]
metadata:
  author: cc-agents
  platforms: "claude-code,codex,antigravity,opencode,openclaw"
  category: workflow-core
  interactions:
    - reviewer
    - pipeline
  severity_levels:
    - high
    - medium
    - low
  pipeline_steps:
    - input
    - ideate
    - output
see_also:
  - sp:source-driven-development
  - sp:spur-cli
  - sp:wayfinder
---

# sp:brainstorm — Structured Ideation Workflow

Generate solution options with trade-offs, recommendations, and confidence scoring. Delegates research to specialized skills.

**Key distinction:**
- **`sp:brainstorm`** = Ideation: generate approaches with trade-offs
- **`sp:wayfinder`** = Wayfinding: chart a multi-session map when the destination itself is foggy
- **research** = verify and synthesize information (delegate via `spur agent run`)
- **`sp:spur-dev`** = Task creation: structured task breakdown (planning half)
- **`sp:source-driven-development`** = Verification: source-first claim validation

## Overview

The `sp:brainstorm` skill generates multiple solution approaches with explicit trade-offs, confidence scoring, and source citations. It follows a structured 3-phase workflow: Input parsing, Ideation with research delegation, and structured Output. Unlike pure research or bare task creation, brainstorm focuses on ideation—generating and comparing options before committing to a solution path.

## Quick Start

```typescript
// Trigger: "I need to add real-time collaboration. What are my options?"
// Brainstorm generates 2-3 approaches with trade-offs, delegates research and task creation
```

The 3-phase pipeline (Input → Ideate → Output) is diagrammed once, in [Workflow](#workflow) below.

## When to Use

Activate sp:brainstorm when:

| Trigger Phrase | Description |
|----------------|-------------|
| "brainstorm ideas" | User wants multiple solution options |
| "explore solutions" | User wants to evaluate alternatives |
| "consider options" | User wants trade-off analysis |
| "research approaches" | User wants evidence-backed options |
| "what are my options?" | User wants multiple solutions |
| "how should I approach X?" | User wants recommendation with reasoning |
| "wayfind" / "chart a course" | User needs a multi-session investigation map — escalate to `sp:wayfinder` (Phase 2) |

**NOT for:**
- Pure research (use `spur agent run` for research instead)
- Task creation without ideation (use `sp:spur-dev` instead)
- Fact-checking or verification only (use `sp:source-driven-development` instead)
- Task file operations (use `sp:spur-cli` instead)
- Multi-session investigation when the destination itself is foggy (use `sp:wayfinder` instead)

## Core Principles

### 1. Two Input Modes, Clarify Before Ideating

A file-path input is read and its Background/Requirements extracted; a bare description is used
directly. Ambiguous or insufficient input (short, missing context, undefined terms, multiple valid
readings) gets one `AskUserQuestion` at a time, preferring multiple choice. Detection rule and
trigger list: [references/workflows.md](references/workflows.md#phase-1-input-processing). Frame each
clarification as a decision brief (question + stakes + recommendation + scored options): the SSOT is
[spur-dev/references/decision-brief.md](../spur-dev/references/decision-brief.md). When a structured-input
tool is available, call it directly with the decision-brief contents as its option array — do not
render the brief as markdown text and also call the tool. One channel per question; the tool wins,
markdown text is the fallback only.

### 2. Delegate Research

Don't implement research directly. Delegate to specialized skills:

```
For verification → sp:source-driven-development
For synthesis → `spur agent run`
```

**Honor `--agent`.** The default is to run synthesis **in the current session** — do not shell to
`spur agent run`; write the result via `spur task update --section --from-file` directly. Only
when the invoking command forwarded an explicit agent do you spawn it: `spur agent run "<prompt>"
--agent <value>`, where `<value>` is an explicit `<name>` or `auto` (resolve from current runtime).
Never hardcode the agent — the selector flows from the command flag. See
[spur-dev/cross-cutting.md](../spur-dev/references/cross-cutting.md) for the two-surface contract.

### 3. Generate 2-3 Approaches

Always generate multiple options, each with description, trade-offs, confidence, and sources — full
per-approach template: [references/workflows.md](references/workflows.md#approach-generation).

### 4. Confidence Scoring

Every approach and every external claim carries a HIGH/MEDIUM/LOW confidence score plus a dated
source citation — table, thresholds, and citation format:
[references/workflows.md](references/workflows.md#confidence-scoring).

### 5. Task Delegation

When user confirms approach, delegate task creation:

```
// Pseudocode: Delegate to sp:spur-dev for structured task breakdown
Skill(skill="sp:spur-dev", args="plan <approach>")

// Then use sp:spur-cli for file creation
Bash: spur task batch-create --file decomposition.json   # bare JSON array (see sp:spur-cli)
```

## Workflow

The 3 phases (Input → Ideation → Output) run in sequence; only the pattern applies at every
invocation, the step-by-step detail (validation checklist, `AskUserQuestion` example, output
template, source-citation format) is needed only inside each phase, not at the point of deciding
*whether* to invoke this skill — full detail: **[references/workflows.md](references/workflows.md)**.

```
1. INPUT    → Parse (file path or issue description), extract context, clarify if ambiguous
2. IDEATE   → Generate 2-3 approaches with trade-offs (delegate research via spur agent run)
3. OUTPUT   → Structured markdown (Overview → Approaches → Recommendations → Next Steps),
              delivered incrementally; saved to docs/plans/YYYY-MM-DD-<topic>-brainstorm.md
```

## Design Approval Gate

The Design Approval Gate is the quality gate between brainstorm output and downstream consumption.
No downstream command (`/sp:dev-idea`, `/sp:dev-plan`, `sp:spec-decomposition`) proceeds without a
recorded design summary in the brainstorm artifact. This gate enforces six patterns drawn from the
Superpowers `brainstorming` and `writing-plans` competencies.

### The six patterns

1. **Hard design-summary gate.** Every brainstorm output MUST include a `## Design Summary` section
   in the saved artifact. Downstream commands check for its presence; absence is a hard stop, not a
   warning. The summary is the contract between ideation and execution.
2. **Nothing is too simple.** Every idea gets a design summary, even if the idea is trivial. A
   one-paragraph summary is acceptable for trivial ideas; a one-line "too simple to design" note is
   not. The pattern prevents skipping the design step under time pressure.
3. **Spec self-review.** Before handoff, the brainstorm artifact is self-reviewed for: placeholders
   (`TODO`, `TBD`, `???`, empty sections), internal contradictions, scope creep beyond the stated
   scope, and ambiguity that would force the decompose step to guess. Fix before declaring done.
4. **User review gate.** The operator reviews the written brainstorm doc before downstream commands
   consume it. Under `--auto`, this taste gate is routed around only when the spec self-review
   passes cleanly AND the design summary is non-trivial; otherwise it pauses. The operator's
   override is recorded in the artifact.
5. **Incremental design presentation.** The brainstorm is presented incrementally — overview, then
   approaches, then recommendation — with the operator confirming each stage before the next. This
   formalizes the existing Phase 3 interactive delivery as a hard requirement, not a suggestion.
6. **Scope decomposition check.** The brainstorm outputs a `needs_design` boolean signal consumed
   by `idea-pipeline.yaml`'s `system-design` step. This is the contract bridge between ideation and
   the heavier `sp:sys-architecture` step.

### The `needs_design` signal

The signal is a boolean written to the brainstorm artifact's frontmatter and emitted to the calling
pipeline. It determines whether `idea-pipeline.yaml` runs the `system-design` state or routes
directly from `feature-check` to `decompose`.

| Signal | Criteria |
| --- | --- |
| `true` | multiple subsystems touched; schema/config/DTO change; new module/package/service; new transport or boundary; new dependency; cross-cutting convention |
| `false` | single-module fix; docs/chores; boundary-preserving refactor; existing pattern with no architectural impact |

**Ties lean design.** When the criteria are mixed or ambiguous, set `needs_design: true`. The cost
of an unnecessary design step is low; the cost of skipping a needed one is high.

**Flag overrides** (consumed by `idea-pipeline.yaml`, not brainstorm itself):

- `--design` forces `system-design` regardless of signal.
- `--skip-design` skips `system-design` regardless of signal (the brainstorm design summary is still
  recorded — only the heavier architecture step is skipped).

### Auto-mode behavior

With `--auto`, objective routing into the Design Approval Gate is allowed only when the spec
self-review (pattern 3) passes cleanly. The brainstorm design summary is ALWAYS recorded — `--auto`
does not bypass pattern 1 or pattern 2. The taste component of the user review gate (pattern 4)
still pauses unless the operator has encoded prior approval in the workflow vars.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The first idea is good enough — just build it." | The first idea is a baseline, not a decision. Generate 2-3 approaches so the trade-offs are visible before committing. |
| "I understand the request — skip clarifying." | Ideating on a misread wastes the whole session. Validate input clarity and the two input modes before generating options. |
| "More options are always better." | Beyond ~3, options dilute focus and stall the decision. Cap at three and delegate deeper research instead. |
| "I'll design the architecture while I brainstorm." | Brainstorm generates and scores approaches; it does not lock the design. Route a chosen approach through the Design Approval Gate. |
| "Confidence scores are subjective — skip them." | An unscored option hides its risk. Cite sources and assign confidence so the operator compares on evidence, not vibes. |

## Red Flags

- Presenting a single approach with no alternatives or trade-offs.
- Starting ideation before the input is clarified.
- More than three approaches, or approaches with no confidence score / source.
- Skipping the task-delegation offer after the operator confirms a direction.
- Treating a brainstorm output as an approved design (bypassing the approval gate).

## Reference Files

- **`references/workflows.md`** — Detailed 3-phase workflow with examples and templates
- **`examples/ideation-example.md`** — Complete example with TypeScript/Bun implementation

## Platform Notes

### Claude Code

- Use `AskUserQuestion` for clarification prompts
- Use `Skill` to delegate to research skills
- Use `Bash` with `tasks` CLI for task creation

### Other Platforms

- Delegate research via `spur agent run`
- Delegate tasks via `sp:spur-dev`
- Output format is platform-agnostic markdown

---

## Shipped commands

### `/sp:dev-brainstorm` — interactive solution design

The first shipped scenario-specific command. A thin wrapper (`plugins/sp/commands/dev-brainstorm.md`)
that adds a **grilling discovery interview** before the ideation phase: one question at a time,
always with a recommendation, exploring the codebase before asking the user. Then delegates to
this skill's `dev-brainstorm` operation for structured ideation.

**Operation: `dev-brainstorm`**

Invoked as `Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")`.
Accepts a pre-built decision-tree context from the discovery phase and skips the clarification step
(Phase 1 → Phase 2 transition in the skill's own workflow), going directly to structured ideation.
The discovery interview that produces this context (5-step grilling protocol, question format,
codebase-first rule, stop conditions, depth question budgets, smart positional detection) lives in
[references/grilling-interview.md](references/grilling-interview.md).

**Decision-tree context format** (free-form markdown passed as `--context`):

```
## Decision Tree

### Root: <top-level decision>
- **Resolved:** <chosen answer>
- **Rationale:** <why>

### Branch: <child decision>
- **Resolved:** <chosen answer>
- **Rationale:** <why>
- **Depends on:** <parent decision>

...
```

The skill uses this tree to:
1. **Constrain the option space** — each approach must be compatible with resolved decisions
2. **Generate decision-trace annotations** — each approach lists which decisions it depends on
3. **Calibrate confidence** — decisions resolved from codebase evidence get higher confidence

When `--skip-discovery` is used (no `--context`), the operation falls back to the standard
3-phase workflow with its own lightweight clarification step.

### Candidate commands (not yet shipped)

Remaining scenario-specific candidates from the delivery-doc §7.2 disposition (I05). Each would be
a thin wrapper invoking this skill with a pre-seeded scenario frame. Ship only those that convert
non-deterministic intent into a reliable sequence, not bare forwarders (ADR-016).

| Candidate command | Scenario it specializes for |
|---|---|
| `sp:brainstorm-arch` | Architecture/design-tradeoff exploration (coupling, scaling, blast radius) |
| `sp:brainstorm-fix` | Bug root-cause hypotheses → ranked fix approaches |
| `sp:brainstorm-feature` | Feature-shaping: scope options + AC sketches feeding `sp:spur-dev` |
| `sp:brainstorm-stack` | Library/dependency selection with evidence-backed trade-offs |
| `sp:brainstorm-refactor` | Refactor strategy options for a shallow/over-coupled module |

---

## Wayfinding Escalation (Phase 2)

When the discovery interview (Phase 1 of `/sp:dev-brainstorm`) surfaces that **the destination itself is foggy** — the spec can't be written in one session because too many decisions are unresolved — brainstorm escalates to `sp:wayfinder` instead of proceeding to ideation.

### Scope Check

At the end of Phase 1, before ideation begins, run this scope check:

> **"Can this be spec'd in one session, or is the destination itself still foggy?"**

**Signals that wayfinding is needed:**
- The topic touches ≥3 subsystems or unknown boundaries
- Key decisions depend on research not yet done
- The operator can describe the goal but not the shape of the solution
- Multiple "it depends" answers in the discovery interview
- The operator uses fog language: "I'm not sure yet", "we need to explore", "it depends on what we find"

**Signals that standard ideation suffices:**
- The destination is clear; only the approach is in question
- All key decisions can be made from existing knowledge
- The operator can enumerate the constraints and trade-offs

### Escalation Path

When the scope check indicates a foggy destination, offer the escalation:

> *"This is a multi-session investigation. Want me to chart a wayfinder map so we can work through it one decision at a time?"*

The operator **confirms** before wayfinding begins — never silently escalate. A 30-minute quick-answer need might touch a big domain without requiring a multi-session map.

On confirmation, delegate to `sp:wayfinder` for the "Chart the map" mode. The resolved decision tree from Phase 1 seeds the map's **## Notes** and initial **## Not yet specified** sections.

### `--wayfind` Flag

When `/sp:dev-brainstorm` is invoked with `--wayfind`, the scope check is **skipped** — the operator has pre-approved the escalation. After the discovery interview, proceed directly to `sp:wayfinder` charting without the confirmation prompt.

Use `--wayfind` when:
- The operator already knows this is a multi-session investigation
- A previous session recommended wayfinding
- The topic is explicitly exploratory ("explore the solution space for X")

### Integration with the Design Approval Gate

A wayfinding escalation **replaces** the standard ideation output. The map feature (with its destination, notes, fog, and child tickets) is the artifact. The `needs_design` signal is not emitted — wayfinding defers design until the route to the destination is clear. When the last ticket resolves, the final session hands off to standard `sp:brainstorm` → `sp:spec-decomposition` with a now-clear destination.

---

**Remember:** Ideation ≠ Research. Generate approaches with trade-offs. Delegate verification to `sp:source-driven-development`. Delegate synthesis/research to `spur agent run`. Delegate task creation to `sp:spur-dev`. When the destination itself is foggy, escalate to `sp:wayfinder` — never force a spec that isn't ready.
