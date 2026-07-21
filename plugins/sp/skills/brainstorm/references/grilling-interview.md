---
name: grilling-interview
description: "Phase-1 heuristic discovery interview for /sp:dev-brainstorm — 5-step grilling protocol, question format, codebase-first rule, stop conditions, depth question budgets, and smart positional detection."
see_also:
  - brainstorm
---

# Grilling Interview — Heuristic Discovery Protocol

The discovery interview walks the decision tree **one question at a time**, resolving dependencies
between decisions before generating options. The goal is to surface hidden assumptions and map the
full decision space before ideation begins.

## Protocol

1. **Frame the problem** — restate what we're trying to decide in one sentence. Confirm with the user.
2. **Map the root** — identify the top-level decision (the root of the tree). Ask: what is the single most important choice here?
3. **Walk branches** — for each decision node, in dependency order:
   a. **Explore first** — search the codebase for constraints, existing patterns, prior art. Answer from code when possible.
   b. **Recommend** — provide your recommended answer with reasoning. Never ask a bare question.
   c. **Resolve** — get the user's confirmation or counter. Lock the decision before moving to dependents.
4. **Recurse** — for each resolved decision, ask: what does this unlock? What new decisions does it create? Walk those branches next.
5. **Stop at depth** — `basic`: stop after the root + immediate children. `detailed`: walk 2-3 levels. `comprehensive`: exhaust the tree.

**Question format — every question follows this pattern:**

```
**Decision:** <what needs to be decided, one sentence>

**Recommendation:** <your recommended answer with 2-3 sentences of reasoning>
  - Factor 1: ...
  - Factor 2: ...

**Alternatives considered:** <1-2 alternatives and why they rank lower>
```
**Binding to a structured-input tool:** the question format above describes the *content* of each
question. The *channel* is a structured-input tool call, not rendered markdown. When a
structured-input tool (`AskUserQuestion` on Claude Code, or the platform equivalent) is available,
invoke it with the recommended answer as the pre-selected / recommended option and the alternatives
as the remaining options. Render the markdown block above only as a fallback when no such tool is
available. Option content (question, stakes, recommendation, scored options with pros/cons) follows
the decision-brief SSOT: [spur-dev/references/decision-brief.md](../../spur-dev/references/decision-brief.md).

**Codebase-first rule:** Before asking about any decision that might be constrained by existing code,
search the repo. If the answer is in the code, state it and skip the question. Examples of
codebase-answerable questions: "What database are we already using?", "Does this pattern already
exist in the codebase?", "What's the current auth mechanism?".

**Stop conditions:**
- Depth limit reached per `--depth`
- User signals done ("that's enough", "just give me options now")
- Decision tree is fully resolved (no more branches, or remaining branches don't change the options)
- 15 questions asked (hard cap — surface and offer to continue or proceed to ideation)

## Depth → Question Budget

| Depth | Max questions | Tree levels | Use when |
|-------|--------------|-------------|----------|
| `basic` | 5 | 1 (root + children) | Quick gut-check, familiar domain |
| `detailed` | 10 | 2-3 (resolve dependencies) | Standard design exploration |
| `comprehensive` | 15 | exhaustive | High-stakes decisions, unfamiliar domain |

## Smart Positional Detection

| Input Pattern | Detection | Example |
|---------------|-----------|---------|
| Ends with `.md` | Task file path — extract Background + Requirements as discovery seed | `docs/tasks2/0042_add-email-validation.md` |
| Plain text | Use as the problem statement directly | `Should we use Redis or Postgres for session storage?` |
