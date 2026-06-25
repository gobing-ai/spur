---
name: planning-workflow
description: "Extracted section: the planning half — intake → feature create → AC generation → feature check gate → decomposition → batch-create gate → refine. The full step-by-step procedure for turning a vague description into a validated, decomposed feature."
see_also:
  - spur-dev
  - decomposition
  - ac-style-guide
---

# Planning Workflow

```
vague description
  → intake (clarify scope, constraints — prompt work)
  → spur feature create … ; AC authored/generated (spur agent run, bdd templates)
  → GATE: spur feature check   (BDD validator; loop until clean)
  → decomposition (prompt work) → task-batch JSON
  → GATE: task-batch.schema.json + spur task batch-create (atomic: all-or-nothing)
```

The planning half transforms a description into a validated feature file with acceptance
criteria, then decomposes it into a batch of tasks. Two CLI gates make LLM regressions
unable to corrupt the corpus: `spur feature check` validates the AC, and
`task-batch.schema.json` validates the decomposition shape before `spur task batch-create`
writes anything.

## Step 1: Intake

When given a feature description, clarify before creating:

1. **Scope** — what is in, what is explicitly out. Record both.
2. **Constraints** — existing systems it must work with, performance/security boundaries.
3. **Success criteria** — how will we know it's done? (Feeds AC generation.)

Ask only what is ambiguous. A crisp description needs no Q&A loop — proceed directly to feature
creation.

## Step 2: Feature creation + AC generation

```bash
spur feature create "<name>" [--parent <id>]
```

The feature file lands in `docs/features/<ID>_<slug>.md`. Immediately author the `## Goal`
(single sentence) and `## Scope` (in/out bullets).

Then generate **BDD acceptance criteria** in the `## Acceptance Criteria` section using the
Gherkin template. Conventions:

- **R-numbered scenarios:** each scenario carries an `R1, R2, …` prefix in its title for
  cheap, human-readable traceability. (Coverage matching is by **normalized scenario title** —
  the R-prefix is stripped before matching — so keep the title text stable, not just the number.)
- **Two AC tiers:** core scenarios (the must-pass gate) and edge-case scenarios (advisory
  warnings — the permissive start, per DD-06). Mark edge-case scenarios explicitly.
- **Scenario-title mapping:** the scenario title is the identity key for traceability edges
  to task files — keep them stable and unique.
- Use `spur agent run` with the BDD template (`config/templates/bdd/gherkin.md`) for
  generation, or author directly if the feature is simple.

Full authoring conventions: see [ac-style-guide.md](ac-style-guide.md).

## Step 3: Feature check gate (loop)

```bash
spur feature check <id> --json
```

The BDD validator gate. A non-zero exit means findings:

1. Read each finding from the JSON output.
2. Fix the **specific** AC issue — never restructure unrelated scenarios.
3. Re-run. Loop until exit 0.

This gate catches: malformed Gherkin, missing required scenario elements, traceability gaps.
A skill regression can never corrupt the corpus — worst case is a rejected write with findings
the skill can react to.

## Step 4: Decomposition

With a clean feature, decompose into tasks:

1. Read the feature's scenarios (the AC).
2. For each scenario, design one or more tasks that implement it — each task maps to at
   least one scenario by title.
3. Produce a **task-batch JSON** document conforming to `task-batch.schema.json` — a top-level
   JSON **array** of strict task items (no `tasks` wrapper, only documented fields).

Decomposition heuristics:
- **One task = one atomic unit of work** a single agent can complete.
- **Scenario coverage:** every core scenario maps to ≥1 task; edge-case scenarios may map
  or be deferred.
- **Sub-tasks:** record `parent_wbs` (quoted, e.g. `"0042"`) for sub-tasks; note ordering in
  `background` prose (the item schema has no `dependencies` field).
- **Template variants:** choose `feature-impl` for implementation tasks (pulls Goal →
  Background from the linked feature, per B09).

The batch JSON is the LLM→CLI contract — see [decomposition.md](decomposition.md) for the
full schema and conventions.

## Step 5: Batch-create gate

```bash
spur task batch-create --file <batch.json>
```

Atomic: all-or-nothing. If `task-batch.schema.json` validation fails, **nothing is written**
and findings are returned. The skill reads the findings, fixes the JSON, and retries. Common
failures:

- Missing required fields per the template variant's section matrix.
- Invalid status values (must be lowercase canonical).
- `feature_id` referencing a non-existent feature.
- WBS collisions (already-allocated range).

Loop until the command exits 0 — then the batch is created and each task appears in the
feature's `## Tasks` block on next `spur feature refresh`.

**If you decomposed a parent task into sub-task files** (the children carry `parent_wbs`), write the
**sub-task roster into the parent's `## Plan`** now — in the same step. A parent without a roster
cannot be checked for completeness. See [decomposition.md → Parent (umbrella) tasks](decomposition.md#parent-umbrella-tasks)
for the roster format and the parent-completion rule.

## Step 6: Refine before execute (the spec-completion gate)

`batch-create` lands a task at **`todo`** with its required sections (`Acceptance Criteria`,
`Design`, `Plan`) **scaffolded as guidance comments only** — the batch item carries `background`
and `requirements`, but it has no field for AC/Design/Plan, and `spur task check` gates on section
*presence*, not human content. So a freshly batch-created `todo` task is **structurally ready but
content-incomplete**: it passes `check` while its Design/Plan are still empty placeholders.

Before a task enters the execution half, fill those sections via the **refine** operation
(`/sp:dev-refine <wbs>`): read the task, elicit the missing AC/Design/Plan through targeted Q&A,
and write each via `spur task update <wbs> --section <name> --from-file`. This is the only path
that turns the `todo` HITL-review gate from a formality into a real one — a reviewer approves the
*Design*, not an empty heading.

**Do this just-in-time, per task, immediately before execution** — not in bulk at decomposition
time. Design written against a stale snapshot of the codebase rots; design written right before
`implement` reflects current reality. Refine `0042`, run `0042`; refine `0043`, run `0043`.

**Refine arguments** (defined on the `/sp:dev-refine` entry point, passed through verbatim):

| Argument | Effect |
|----------|--------|
| `--focus <mode>` | Narrows the gap analysis to a subset of domain hints. See the `sp:dev-refine` skill for the full value table (`all`, `requirements`, `background`, `constraints`, `acceptance`, `quick`). Default `all`. |
| `--auto` | Skip interactive Q&A — synthesize improvements from the task content alone. Use for well-scoped tasks where the agent can fill gaps without operator input. |

> **Requirements formatting:** author R-items as a GitHub task-list checkbox — `- [ ] R1. <text>`
> — so progress is trackable in the file. The L3 check accepts the `- [ ] Rn.` / `- Rn.` / `Rn.`
> forms; keep the `Rn.` (period) token so the R-numbering rule recognizes it.
