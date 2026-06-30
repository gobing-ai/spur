---
name: sys-architecture
description: The architecture competency — make and record system-design decisions before code: module boundaries, data flow, the build-vs-extend call, transport/storage/auth choices, and the tradeoffs (coupling, blast radius, scalability, cost). Produces a decision with a one-line reason and routes it to the right doc (ADR for cross-cutting choices). The deep skill consulted when a task needs its shape decided, not its code written. Use when choosing an approach, weighing a design tradeoff, deciding where a boundary goes, or whether something warrants an ADR. Triggers on "what's the right approach", "design this", "architecture", "should this be an ADR", "module boundary", "where does this belong", "design tradeoff", "build vs extend".
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - technique
  competency: architecture
  openclaw:
    emoji: "📐"
---

# sys-architecture — the architecture competency

Decide and record the *shape* of a change before it is implemented: where boundaries go, how data
flows, what to build vs. extend, and which cross-cutting choices warrant a recorded decision. This is
a deep competency the orchestration spine (`sp:spur-dev`) consults when a task's design is unsettled —
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
generation, the tradeoff dimensions, the deep-vs-shallow-module test, and the ADR-or-not gate.

## The ADR-or-not gate

Record an ADR when the choice is **cross-cutting and hard to reverse**: it changes a module boundary,
introduces or swaps a dependency/transport/store, alters an auth surface, or sets a convention other
code must follow. A task-local, easily-reversed choice stays in the task's `## Design`. When in
doubt, prefer recording — a cheap ADR entry beats an undocumented divergence (the project conflict
rule forbids diverging from an unrecorded decision).

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

---

**Template type**: technique
**Purpose**: Make and record system-design decisions before code — boundaries, data flow, build-vs-extend, tradeoffs, and the ADR-or-not gate — the deep skill consulted when a task needs its shape decided
