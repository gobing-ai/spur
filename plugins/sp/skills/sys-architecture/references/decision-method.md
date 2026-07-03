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

## 4. Apply the deep-module vocabulary

Prefer a design whose modules are **deep**: a narrow interface hiding substantial capability, reused
by callers that do not need to know its internals. Be suspicious of **shallow** modules — thin
wrappers with a wide interface, or boundaries drawn along *temporal phases* ("a step-1 module and a
step-2 module") rather than *capabilities*. A boundary that two callers almost always cross together
is the wrong boundary; relocate or remove it.

Use these seven terms precisely — each has near-synonyms this method deliberately avoids, because a
vaguer word lets an under-designed boundary pass without scrutiny:

| Term | Meaning | Avoid |
|------|---------|-------|
| **Module** | A unit of functionality with one owner and one reason to change. | "piece", "part", "chunk" |
| **Interface** | The surface callers depend on — signatures, types, contracts. Not the implementation. | "API" (too transport-coded), "surface area" |
| **Depth** | Capability hidden ÷ interface size. A deep module does a lot behind a little. | "complexity" (depth is the *ratio*, not raw complexity) |
| **Seam** | A place the design can vary without the caller knowing — the proven joint an adapter sits on. | "layer", "boundary" (see Rejected framings) |
| **Adapter** | A concrete implementation behind a seam. One adapter alone does not prove the seam is real. | "wrapper", "shim" |
| **Leverage** | What a module buys its callers — the work it removes from every call site. | "value", "benefit" |
| **Locality** | How much of a change stays inside one module vs. spilling across many. | "cohesion" (locality is about *change*, not static grouping) |

**The deletion test:** for any proposed module or seam, ask "if I deleted this and inlined its one
caller, would anything get harder?" If no caller would notice, the boundary is not pulling its
weight — either it hides no real complexity, or it has exactly one caller and no second use in
sight. Deletion-test failures are the most common shallow-module smell.

**One adapter = hypothetical seam, two = real.** A seam justified by "we might swap this later" is
speculative until a second adapter actually exists. Building a seam for a hypothetical second
implementation is premature abstraction (R2); building it when the second implementation is already
needed is a real seam. When in doubt, inline the single adapter and extract the seam when the second
caller arrives — extraction is cheap, premature generality is not.

**The interface is the test surface.** A deep module's tests exercise the interface, not the
internals — if a test needs to reach past the interface to assert something, either the interface
is missing a capability it should expose, or the test is coupling to implementation detail that
will make refactors expensive. This is also the fastest depth check available: an interface you
can test completely from outside is doing its job.

### Rejected framings

These near-synonym terms are deliberately **not** used in this method, to keep the vocabulary above
unambiguous:

| Term | Why rejected |
|------|--------------|
| **Component** | Overloaded across UI frameworks and infra tooling — does not distinguish depth from size. |
| **Service** | Implies a network/process boundary; conflates *module* (a code-level unit) with *deployment* (an infra-level unit). A module is not always a service and a service is not always one module. |
| **Boundary** | Too generic — used for module edges, security perimeters, and transaction scopes alike. This method uses **seam** for the specific "place the design can vary" meaning. |

### Design-it-twice (for a genuinely unsettled interface)

When the interface shape itself is the open question — not just which of two known options to
pick, but what the right shape even is — fan out 2–3 radically different interface designs in
parallel via `sp:parallel-execution` (independent subagents, one design each, same problem
statement) rather than iterating on one design serially. Compare the results on **depth**,
**locality**, and **seam placement** — the three axes above that a single linear design pass tends
to anchor on its first idea instead of exploring. Use this only when the interface is the crux of
the decision; for a settled interface with a build-vs-extend question, steps 1–3 above are enough.

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
