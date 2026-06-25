---
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
argument-hint: "<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--skip-discovery] [--task [<feature-id>]]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Brainstorm

Interactive solution design combining a heuristic discovery interview (grilling) with structured
ideation (`sp:brainstorm`). Walk the decision tree one question at a time, each with a recommended
answer, then generate solution options with trade-offs and confidence scoring.

The discovery phase is based on the grilling pattern: **one question at a time, always with a
recommendation, exploring the codebase before asking the user.** This surfaces hidden assumptions
and maps the full decision space before ideation begins — the opposite of a one-shot "give me
options" dump.

## When to use

- Exploring solution approaches before committing to one
- Stress-testing a design idea — the grilling interview surfaces hidden assumptions
- Need trade-off analysis between competing options with confidence scoring
- Pre-planning: generate options that feed directly into `/sp:dev-plan`

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `topic` | Problem description, question, or path to a task file (required, positional) | (required) |
| `--depth <basic\|detailed\|comprehensive>` | How deep to walk the decision tree. `basic` = 1 level (surface trade-offs), `detailed` = 2-3 levels (resolve dependencies), `comprehensive` = exhaustive (every branch) | `detailed` |
| `--options <n>` | Number of solution approaches to generate (2-8) | 3 |
| `--skip-discovery` | Skip the grilling interview — go straight to ideation from the topic alone | off |
| `--task [<feature-id>]` | After ideation, create a task file from the recommended approach via `spur task create`. Optionally link to a feature. | off |

## Smart Positional Detection

| Input Pattern | Detection | Example |
|---------------|-----------|---------|
| Ends with `.md` | Task file path — extract Background + Requirements as discovery seed | `docs/tasks/0042.md` |
| Plain text | Use as the problem statement directly | `Should we use Redis or Postgres for session storage?` |

## Behavior

Two-phase protocol. Phase 1 is inline (the command owns the heuristic interview); Phase 2 delegates
to `sp:brainstorm`.

### Phase 1: Discovery (Grilling Interview)

The discovery interview walks the decision tree **one question at a time**, resolving dependencies
between decisions before generating options. The goal is to surface hidden assumptions and map the
full decision space before ideation begins.

**Protocol:**

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

**Codebase-first rule:** Before asking about any decision that might be constrained by existing code,
search the repo. If the answer is in the code, state it and skip the question. Examples of
codebase-answerable questions: "What database are we already using?", "Does this pattern already
exist in the codebase?", "What's the current auth mechanism?".

**Stop conditions:**
- Depth limit reached per `--depth`
- User signals done ("that's enough", "just give me options now")
- Decision tree is fully resolved (no more branches, or remaining branches don't change the options)
- 15 questions asked (hard cap — surface and offer to continue or proceed to ideation)

### Phase 2: Ideation (sp:brainstorm)

The resolved decision tree from Phase 1 is passed as context to `sp:brainstorm`'s `dev-brainstorm`
operation, which generates `--options` solution approaches. Each approach includes:

- **Description** — 2-3 sentences explaining the approach
- **Trade-offs** — explicit pros/cons tied to the decisions made in Phase 1
- **Implementation notes** — key technical considerations
- **Confidence** — HIGH/MEDIUM/LOW with source citations
- **Decision trace** — which Phase 1 decisions each approach depends on

Output is written to `docs/plans/YYYY-MM-DD-<topic-slug>-brainstorm.md`.

### `--task [<feature-id>]`

When set, after ideation the command creates a task file from the **recommended approach**,
turning brainstorm output directly into executable work:

1. **Confirm** — surface the recommended approach to the user. If multiple approaches were generated, confirm which one to taskify (default: the ⭐ Recommended).
2. **Create** — `spur task create "<approach-name>" --feature <id> --template feature-impl` (omits `--feature` if no feature-id given). The task is seeded with:
   - **Background** ← the brainstorm Overview + the chosen approach's Description + decision-trace context
   - **Requirements** ← the approach's Implementation Notes, converted to R-item checkboxes
   - **Plan** ← the brainstorm's Next Steps, converted to an ordered checklist
3. **Report** — print the new task WBS and file path. The task lands at `todo`, ready for `/sp:dev-refine`.

This closes the brainstorm → plan → execute loop: the brainstorm finds the approach, `--task`
creates the work item, and `/sp:dev-refine --next` picks it up from there.

### `--skip-discovery`

When set, Phase 1 is skipped entirely. The topic is passed directly to `sp:brainstorm` for
one-shot ideation. Use when:

- The problem is already well-understood
- You want a quick options dump without the interview
- You're iterating on a previous brainstorm session

## Depth → Question Budget

| Depth | Max questions | Tree levels | Use when |
|-------|--------------|-------------|----------|
| `basic` | 5 | 1 (root + children) | Quick gut-check, familiar domain |
| `detailed` | 10 | 2-3 (resolve dependencies) | Standard design exploration |
| `comprehensive` | 15 | exhaustive | High-stakes decisions, unfamiliar domain |

## Examples

| Command | Effect |
|---------|--------|
| `/sp:dev-brainstorm "Should we use Redis or Postgres for session storage?"` | Detailed discovery interview → 3 options with trade-offs |
| `/sp:dev-brainstorm docs/tasks/0042.md --depth comprehensive` | Deep interview seeded from task context → 3 options |
| `/sp:dev-brainstorm "API auth strategy" --depth basic --options 5` | Quick interview → 5 options |
| `/sp:dev-brainstorm "Microservice boundaries" --skip-discovery` | No interview — straight to ideation |
| `/sp:dev-brainstorm "API auth strategy" --depth detailed --task H2` | Discovery interview → ideation → create task under feature H2 |
| `/sp:dev-brainstorm docs/tasks/0042.md --task` | Interview seeded from task → create follow-up task |

## Implementation

The command owns Phase 1 (discovery interview) inline. Phase 2 delegates to **sp:brainstorm**'s
`dev-brainstorm` operation. Phase 3 (`--task`) invokes `spur task create` directly:

```
# Phase 2 — Ideation
Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")

# Phase 3 — Task creation (only when --task is set)
spur task create "<approach-name>" --feature <id> --template feature-impl
```

The `dev-brainstorm` operation on `sp:brainstorm` accepts a pre-built decision-tree context and
skips its own clarification step, going directly to structured ideation. When `--task` is set,
the command then invokes `spur task create` with the recommended approach's details, seeding
Background from the brainstorm output.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation, `AskUserQuestion` for the interview, and
  `$ARGUMENTS` passthrough work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Run the two-phase protocol
  manually: walk the grilling interview yourself, then invoke `sp:brainstorm`'s ideation phase
  with the collected decision tree.

## See Also

- **sp:brainstorm** — the backing ideation skill (structured options, trade-offs, confidence)
- **sp:spur-dev** — convert brainstorm output to tasks via `/sp:dev-plan`
- **sp:dev-plan** — intake → feature create → AC generation → decomposition
- **Grilling interview pattern** — the one-question-at-a-time heuristic interview this command's Phase 1 is based on. The pattern: walk the decision tree branch by branch, always provide a recommended answer, explore the codebase before asking the user.
