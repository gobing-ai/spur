---
name: decision-method
description: "The architecture decision method for sp:sys-architecture — candidate generation, the tradeoff dimensions, the deep-vs-shallow-module test, and the ADR-or-not gate. Produces a recorded decision with a one-line reason, routed to the owning doc."
see_also:
  - sys-architecture
---

# Architecture Decision Method

The procedure `sp:sys-architecture` runs to turn a design question into a recorded decision. The
output is always **a chosen option + a one-line reason**, routed to its owning doc.

## 1. Frame the decision

State, in one sentence, what is being decided. If you cannot state it in one sentence, the decision
is actually several — split them and decide in dependency order. Read the codebase first: many
"decisions" are already constrained by an existing pattern, dependency, or convention. If the answer
is in the code, state it and stop — do not manufacture options for a settled question.

## 2. Generate 2–3 candidates

Never evaluate a single option (that is rationalization, not a decision) and rarely more than three
(analysis paralysis). For each candidate, name what it commits to and what it defers. Bias toward
options that *extend an existing seam* over options that *introduce a new one*.

## 3. Weigh on the dimensions that matter

Score the candidates on the axes relevant to this decision — not all apply every time:

| Dimension | The question |
|-----------|--------------|
| **Coupling** | What does this bind together that was independent? Can the two sides still evolve apart? |
| **Blast radius** | If this is wrong, how much has to change to undo it? |
| **Reversibility** | Is this a one-way door (hard to reverse) or a two-way door (cheap to revisit)? |
| **Scalability** | Does it hold at the next order of magnitude of load/size/teams, or is there a known cliff? |
| **Cost** | Build/run/maintain cost — including the cost of a new dependency or runtime. |
| **Conformance** | Does it match the codebase's existing conventions, or fork them? |

A one-way door with a large blast radius deserves more deliberation and almost always an ADR; a
two-way door can be decided fast and revisited.

## 4. Apply the deep-vs-shallow-module test

Prefer a design whose modules are **deep**: a narrow interface hiding substantial capability, reused
by callers that do not need to know its internals. Be suspicious of **shallow** modules — thin
wrappers with a wide interface, or boundaries drawn along *temporal phases* ("a step-1 module and a
step-2 module") rather than *capabilities*. A boundary that two callers almost always cross together
is the wrong boundary; relocate or remove it.

## 5. Recommend one, with the one-line reason

Pick the candidate that best fits the weighed dimensions and state the single sentence that justifies
it over the runner-up. The reason is the deliverable — a decision without its reason cannot be
maintained or revisited honestly.

## 6. The ADR-or-not gate

Record a dated **ADR** entry in `docs/00_ADR.md` when the decision is **cross-cutting and hard to
reverse** — any of:

- introduces, swaps, or removes a dependency, transport, runtime, or data store;
- changes a module/package boundary or an auth surface;
- sets a convention other code must follow;
- supersedes or diverges from a prior recorded decision.

Otherwise the decision is **task-local**: write it to the task's `## Design` section via
`spur task update <wbs> --section Design --from-file <tmp>`. When uncertain, prefer recording — a
cheap ADR entry beats an undocumented divergence, and the project conflict rule forbids diverging
from a decision that was never recorded.

## 7. Route to the owning doc (do not restate)

| Output | Home |
|--------|------|
| The decision + its one-line reason | `docs/00_ADR.md` (cross-cutting) or the task's `## Design` (task-local) |
| Mechanism, data flow, invariants, rationale in depth | `docs/03_ARCHITECTURE.md` |
| Concrete command / flag / config / schema shapes | `docs/04_DESIGN.md` |

A fact lives in exactly one doc; the others link to it. If you find yourself writing *how it's built*
or *why* inside `00`, it belongs in `03` — move it and link.

## Handoff

The decision is complete when: one option is chosen with a one-line reason, it is recorded in its
owning doc (ADR or task `## Design`), and `sp:code-implementation` can build it without re-deciding
anything. Hand off to the spine (`sp:spur-dev`) to dispatch implementation.
