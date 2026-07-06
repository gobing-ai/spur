---
name: upkeep-survey
description: "The architecture-upkeep survey procedure for sp:sys-architecture — scan a codebase (or module tree) for shallow modules and deepening opportunities using the deep-module vocabulary, and emit a MARKDOWN candidate report that feeds the planning half. Surfaces candidates; never auto-refactors."
see_also:
  - sys-architecture
---

# Architecture-Upkeep Survey

A whole-codebase (or named-module-tree) audit that surfaces **deepening opportunities** — places where
a shallow module, a pass-through wrapper, or a leaky seam could be made deeper, simpler at the
interface, or better-located. It is the standing-upkeep counterpart to the per-decision design method
in [decision-method.md](decision-method.md): same vocabulary, different trigger. It **generates
candidates for the planning half**; it never edits code.

## Scope

- **Whole codebase** (default) or a **named module tree** (`apps/cli`, `packages/domain`, …).
- Prefer a bounded tree per run — a survey that flags fifty things helps no one. Rank hard, present few.

## Method — reuse the deep-module vocabulary

Apply the vocabulary and tests defined in [decision-method.md](decision-method.md) §4 (do not restate
them here): **module / interface / depth / seam / adapter / leverage / locality**, and the **deletion
test**. Scan for the smells that vocabulary names:

| Smell | What to look for |
|---|---|
| **Shallow module** | Interface nearly as large as the implementation it hides — little capability per unit of interface. |
| **Pass-through wrapper** | A module whose methods just forward to another with no added value — fails the deletion test. |
| **Leaky seam** | A boundary that exposes its internals; callers reach past the interface into implementation. |
| **Misplaced locality** | Logic that lives far from the data/state it operates on, forcing round-trips. |
| **Repeated adapter** | The same glue written at many call sites instead of behind one seam. |

For each candidate, run the **deletion test**: "if I deleted this module and inlined it, does the
system get simpler?" A yes is the strongest signal it is shallow.

## Output — a MARKDOWN candidate report (never HTML)

Emit markdown the operator can read and paste. One block per candidate, ranked strongest-first:

```markdown
## Architecture-upkeep candidates — <scope> (<date>)

### C1 — <short title>   [strength: strong | moderate | speculative]
- **Files:** `path/a.ts`, `path/b.ts`
- **Problem:** <which smell; the deletion-test result in one line>
- **Proposed deepening:** <the restructuring — the deeper module / merged seam / relocated logic>
- **Before → after (prose):** <today's shape> → <the proposed shape>, and why the interface shrinks
- **Recommendation:** <do it now / schedule / leave — with the one-line reason>

### C2 — …
```

- **Markdown only.** Never emit an HTML report; the corpus and the operator read markdown.
- **Strength label is mandatory** so the operator can triage; a survey with no ranking is noise.
- **Before/after in prose**, not a diff — the survey proposes shape, it does not write the change.

## Route — candidate → grilling-to-design

The survey ends at the report. The operator picks a candidate and routes it into the **planning half**
as a generated idea:

- `/sp:dev-idea` — turn the candidate into a feature + task batch (when it is a larger restructuring).
- `/sp:dev-plan` — plan it directly (when it is a single, well-scoped deepening).

The chosen candidate is then **grilled** through the normal design flow (2–3 approaches, tradeoffs,
approval gate) before any code is written. The survey never auto-refactors — it only surfaces the
candidate and hands it to planning.

## Upkeep framing (the one rule)

Surface candidates; **never** auto-refactor. The value is the ranked shortlist of where the
architecture could deepen, presented for a human decision — not an autonomous rewrite. A survey that
changes code has overstepped its role.
