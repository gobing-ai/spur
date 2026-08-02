---
name: sys-architecture
description: "The architecture competency — decide and record system design before code: module boundaries, data flow, build-vs-extend, transport/storage/auth tradeoffs, ADR routing. Triggers: \"what's the right approach\", \"design this\", \"architecture\", \"should this be an ADR\", \"module boundary\", \"build vs extend\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - technique
  competency: architecture
  operations:
    - survey
  openclaw:
    emoji: "📐"
---

# sys-architecture — the architecture competency

Decide and record the *shape* of a change before it is implemented: where boundaries go, how data
flows, what to build vs. extend, and which cross-cutting choices warrant a recorded decision. This is
a deep competency the spine (`sp:spur-dev`) consults when a task's design is unsettled —
it owns *deciding the shape*, distinct from `sp:code-implementation` which *builds the decided shape*.

The split mirrors the project's own doc map: this skill produces **decisions with one-line reasons**
(which belong in `docs/00_ADR.md`) and **mechanism/rationale** (which belongs in
`docs/03_ARCHITECTURE.md`); it does not write feature code.

## When to use

- **Choose an approach** — two or three viable designs exist; pick one with an explicit tradeoff.
- **Place a boundary** — decide which module/seam/package owns a responsibility.
- **Build vs. extend** — decide whether to add to an existing seam or introduce a new one.
- **ADR judgment** — decide whether a choice is cross-cutting enough to need a recorded ADR entry,
  and draft it.
- **Pre-implementation design** — fill a task's `## Design` section with the decided shape so
  `sp:code-implementation` can execute it.

Do **not** use this skill for:

- **Writing the code** — that is `sp:code-implementation`.
- **Coverage / testing** — that is `sp:code-testing`.
- **Review of already-written code** — that is `sp:code-verification`.
- **Driving the lifecycle / decomposition** — that is the spine, `sp:spur-dev`.

## Behavior

This skill behaves as a **technique**: given a problem and the codebase, it surfaces 2–3 candidate
designs, weighs them on the dimensions that matter (coupling, blast radius, scalability, cost,
reversibility), recommends one with a one-line reason, and routes the result:

- A **cross-cutting decision** (new app/package, transport swap, auth boundary, storage swap, a new
  shared convention) → a dated **ADR** entry in `docs/00_ADR.md`, with mechanism detail in
  `docs/03_ARCHITECTURE.md`.
- A **task-local design** → the task's `## Design` section (written via `spur task update`).

Full procedure: **[references/decision-method.md](references/decision-method.md)** — candidate
generation, the tradeoff dimensions, the deep-module vocabulary (module/interface/depth/seam/adapter/
leverage/locality, the deletion test, design-it-twice), and the ADR-or-not gate.

## The ADR-or-not gate

Record an ADR when the choice is **cross-cutting and hard to reverse**: it changes a module boundary,
introduces or swaps a dependency/transport/store, alters an auth surface, or sets a convention other
code must follow. A task-local, easily-reversed choice stays in the task's `## Design`. When in
doubt, prefer recording — a cheap ADR entry beats an undocumented divergence (the project conflict
rule forbids diverging from an unrecorded decision).

## Survey operation — architecture upkeep

A standing **upkeep audit**, distinct from the per-decision design flow above: scan the whole
codebase (or a named module tree) for **shallow modules and deepening opportunities**, and surface
them as candidates for the planning half. This is a *generator*, not a fixer — it never refactors;
it produces a ranked candidate report an operator can turn into a task.

**Not `/sp:dev-review`.** `/sp:dev-review` is a per-task DIFF review (a WBS, forward, findings written
to the task's `## Review`, backed by `sp:code-verification`). The survey has no WBS and no diff — it
audits the standing codebase and feeds the planning half. Folding it into `dev-review` would overload
that verb and pollute `code-verification` with a codebase scanner; it earns its own operation here.

**Method (reuse, do not restate).** The survey applies the deep-module vocabulary already defined in
[references/decision-method.md](references/decision-method.md) — module / interface / depth / seam /
adapter / leverage / locality, and the **deletion test** — to flag shallow modules, pass-through
wrappers, and leaky seams. The full procedure and the MARKDOWN candidate-report template live in
[references/upkeep-survey.md](references/upkeep-survey.md).

**Output: a MARKDOWN candidate report, never HTML.** Each candidate names the files, the problem
(which depth/seam smell), the proposed deepening, a before/after in prose, and a recommendation
strength — as markdown an operator can read and paste, never a rendered HTML report.

**Route: candidate → grilling-to-design.** The operator picks a candidate; it enters the existing
grilling-to-design flow (the planning half — `/sp:dev-idea` / `/sp:dev-plan`) as a generated idea,
where it is stress-tested and shaped into a task. The survey stops at surfacing candidates; it never
auto-refactors — upkeep framing, not a refactor bot.

## Arguments

When invoked via `/sp:dev-arch`, the command forwards `survey $ARGUMENTS` to this skill:

| Argument | Description | Default |
|----------|-------------|---------|
| `[<module-path>]` | Module path to scope the architecture survey. | omitted (whole repo) |
| `--scope <all\|path>` | Limit the survey to a path or expand to the whole repo. | all |
| `--json` | Emit structured JSON instead of the MARKDOWN candidate report. | off |

`--agent <inline|auto|name>` is consumed by the `dev-arch` wrapper (execution-surface selection) and is not forwarded as a survey argument.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "One option is obviously right — no need to compare." | Evaluating a single option is rationalization, not a decision. Weigh at least two; the second reveals the first's cost. |
| "Add a layer now for future flexibility." | A layer with one implementation is a shallow module that adds indirection, not depth. Add the seam when a second case is real. |
| "We'll refactor the shortcut later." | "Later" rarely comes; the shortcut becomes load-bearing. Decide the boundary now, or record the debt explicitly. |
| "This decision is small — skip the ADR." | Cross-cutting choices (a new package, a transport swap, an auth boundary) are exactly what the ADR captures. Small-looking seams calcify. |
| "More abstraction is more robust." | Depth is interface-simplicity over capability, not layer count. The deletion test: if removing the module simplifies the system, it was shallow. |

## Red Flags

- A design presented with exactly one option and no alternative considered.
- A new module/layer whose interface is as complex as what it wraps (a pass-through).
- A cross-cutting decision made with no ADR entry and no recorded reason.
- Abstraction justified only by hypothetical future requirements.
- A boundary that fails the deletion test — the system is simpler without it.

## Gotchas

1. **Decide, then hand off.** This skill ends at a recorded decision + a filled `## Design`; the
   spine dispatches `sp:code-implementation` to build it. Do not write feature code here.
2. **One-line reason is mandatory.** A decision without its reason is not a decision — `docs/00_ADR.md`
   exists precisely to carry the *why*.
3. **Prefer extending a seam over adding one.** A new boundary is justified only when it removes real
   complexity or gives a second concrete caller/adapter.
4. **Route to the owning doc.** Decision + reason → `00`; mechanism/rationale in depth → `03`;
   command/config/schema shapes → `04`. Do not restate a fact across docs.

## See also

- **`sp:spur-dev`** — the spine that consults this competency when a task's design is unsettled.
- **`sp:code-implementation`** — builds the shape this skill decides.
- **`docs/00_ADR.md` / `docs/03_ARCHITECTURE.md`** — the homes for the decisions and rationale this
  skill produces.

## Platform Notes

### Claude Code

Invoke directly via `Skill(skill="sp:sys-architecture", args="<question>")`, or as the design step of
planning. Use the `spur` CLI via the Bash tool to write a task's `## Design`; edit `docs/00_ADR.md`
directly for ADR entries.

### Codex / OpenClaw / OpenCode / Antigravity

Invoke this skill directly for design judgment; write decisions to the owning docs and task sections.
The skill is the SSOT for the method; the result lives in the docs it routes to.
