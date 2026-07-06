---
description: Interactive solution design — heuristic discovery interview followed by structured ideation with trade-offs and confidence scoring
argument-hint: "<topic> [--depth <basic|detailed|comprehensive>] [--options <n>] [--agent <name|auto>] [--skip-discovery] [--wayfind] [--task [<feature-id>]] [--feature [<parent-id>]] [--next]"
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
| `--agent <name\|auto>` | Spawn the ideation/research steps under a specific agent via `spur agent run`. Omit (the default) to run them **in the current session** — no subprocess | (in-session) |
| `--skip-discovery` | Skip the grilling interview — go straight to ideation from the topic alone | off |
| `--wayfind` | After discovery, skip the scope-check prompt and escalate directly to `sp:wayfinder` charting. The discovery interview's decision tree seeds the map. **Mutually exclusive with `--task`, `--feature`, and `--skip-discovery`.** | off |
| `--task [<feature-id>]` | After ideation, create a single task file from the recommended approach via `spur task create`. Optionally link to a feature. **Mutually exclusive with `--feature`.** | off |
| `--feature [<parent-id>]` | After ideation, create a **feature** with BDD acceptance criteria derived from the decision trace, then run the `spur feature check` gate. Lands a validated feature ready for `/sp:dev-plan` decomposition. Optionally nest under a parent feature. **Mutually exclusive with `--task`.** | off |
| `--next` | After a clean `feature check`, auto-invoke `/sp:dev-plan --feature <ID>` to decompose the feature into a task batch — no manual hand-off. Requires `--feature` (ignored with `--task`, which already lands its terminal artifact). | off |

## Smart Positional Detection

| Input Pattern | Detection | Example |
|---------------|-----------|---------|
| Ends with `.md` | Task file path — extract Background + Requirements as discovery seed | `docs/tasks2/0042_add-email-validation.md` |
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

### Phase 2 alt: Wayfinding escalation (`--wayfind`)

When `--wayfind` is set, Phase 2 does **not** run standard ideation. Instead, the command runs the
scope check from `sp:brainstorm`'s Wayfinding Escalation section and — since `--wayfind` pre-approves
the escalation — delegates directly to `sp:wayfinder` for charting:

1. **Name the destination** — from the Phase 1 discovery interview's resolved decisions, distill a
   one-line destination statement.
2. **Map the frontier breadth-first** — fan out across the whole space, surfacing open decisions and
   first takeable steps.
3. **Create the map** as a `spur feature` with the five-section description (Destination, Notes,
   Decisions so far, Not yet specified, Out of scope).
4. **Create child tasks** for what's specifiable now, wire blocking edges.
5. **Populate the fog** — everything not yet ticketable goes into **## Not yet specified**.
6. **Stop** — charting is one session's work; do not also resolve tickets.

Without `--wayfind`, the scope check still runs at the end of Phase 1. If the destination looks
foggy, the operator is offered the escalation prompt (see `sp:brainstorm`'s Wayfinding Escalation
section for the exact text). The operator must confirm before wayfinding begins.

`--wayfind` is mutually exclusive with `--task`, `--feature`, and `--skip-discovery`:
- `--task` and `--feature` produce terminal artifacts from standard ideation; wayfinding replaces
  ideation with charting.
- `--skip-discovery` skips the interview that seeds the map's Notes and initial fog — without it,
  charting has no context to work from.

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

### `--feature [<parent-id>]`

When set, after ideation the command turns the brainstorm into a **validated feature with BDD
acceptance criteria** — the front-half entry point. By default it lands a feature and *stops* at the
`feature check` gate; decomposition into tasks is the separate `/sp:dev-plan` step (see below). Add
`--next` to chain straight into decomposition (step 6).

`--task` and `--feature` are **mutually exclusive** — they answer the same question ("what artifact
does this brainstorm become?") at different altitudes. `--task` = one decision → one executable item
(skips feature/AC ceremony on purpose). `--feature` = intent → a structured capability with AC.
Passing both is an error.

1. **Confirm** — surface the recommended approach and the feature name to be created. If multiple
   approaches were generated, the feature is framed around the ⭐ Recommended one.
2. **Create the feature shell** — `spur feature create "<feature-name>" [--parent <parent-id>] --json`.
   The file lands at `docs/features/<ID>_<slug>.md` with `## Goal`, `## Scope`, and a **placeholder**
   `## Acceptance Criteria` Gherkin block (the template stub — not yet real AC).
3. **Fill the feature body** — `spur feature update` has **no `--section`/`--from-file`** verb (unlike
   `spur task update`), so author these by **editing the feature file directly** (Read, then Edit):
   - **`## Goal`** ← the brainstorm Overview, condensed to a single sentence.
   - **`## Scope`** ← In/Out bullets from the resolved decision tree (what each locked decision
     commits to vs. explicitly defers).
   - **`## Acceptance Criteria`** ← BDD scenarios derived from the decision trace (the mapping below).
4. **Gate** — run `spur feature check <ID> --json` and **loop until exit 0**: read each finding, fix
   the specific AC issue, re-run. The check is the only proof the AC is valid; never skip it.
5. **Report** — print the feature ID, file path, and scenario count. Without `--next`, also print the
   next step (`/sp:dev-plan --feature <ID>`) and stop.
6. **`--next` chain** — when `--next` is set and the `feature check` gate is clean, auto-invoke
   `/sp:dev-plan --feature <ID>` to decompose the feature into a CLI-validated task batch (the same
   `--next` convention the execution half uses). On a non-clean gate, stop — never decompose an
   invalid feature.

**Decision-trace → AC-scenario mapping** (the one non-obvious part). Each resolved decision from
Phase 1 becomes one or more Gherkin scenarios:

| Decision-tree element | Becomes |
|-----------------------|---------|
| A **locked decision** (a capability the feature commits to) | A `@core` scenario — the must-ship behavior it enables |
| The decision's **observable outcome** (why it was chosen) | The scenario's `Then` — assert the observable, not the mechanism |
| A decision's **preconditions / constraints** | The scenario's `Given` |
| The **user action** that exercises the decision | The scenario's single `When` (one action per scenario — split if more) |
| An **error path / boundary** surfaced during grilling | An `@edge` scenario (advisory; may defer per DD-06) |
| A **deferred branch** ("out of scope for now") | A `## Scope` **Out** bullet — *not* a scenario |

Number scenarios `R1, R2, …` sequentially, stable forever (the title is the traceability identity
key). Use the Gherkin template at `.spur/templates/bdd/gherkin.md`. Full authoring rules:
[ac-style-guide.md](../skills/spur-dev/references/ac-style-guide.md).

**Why decomposition stays a distinct step** — even under `--next`, `--feature` does not *fold in*
decomposition; it *delegates* to the existing, schema-gated `/sp:dev-plan` step ("feature with AC →
validated task batch" via `task-batch.schema.json` + `spur task batch-create`). The two stay separate
commands so the `batch-create` gate keeps its own checkpoint; `--next` only removes the manual
copy-paste between them. Default (no `--next`) stops at the validated feature for a human to review
before decomposing.

This opens the full front-half chain: vague intent → grilling interview → validated feature with AC
(`--feature`) → `/sp:dev-plan --feature <ID>` decomposition (auto-invoked with `--next`) → executable
task batch.

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
| `/sp:dev-brainstorm docs/tasks2/0042_add-email-validation.md --depth comprehensive` | Deep interview seeded from task context → 3 options |
| `/sp:dev-brainstorm "API auth strategy" --depth basic --options 5` | Quick interview → 5 options |
| `/sp:dev-brainstorm "Microservice boundaries" --skip-discovery` | No interview — straight to ideation |
| `/sp:dev-brainstorm "API auth strategy" --depth detailed --task H2` | Discovery interview → ideation → create task under feature H2 |
| `/sp:dev-brainstorm docs/tasks2/0042_add-email-validation.md --task` | Interview seeded from task → create follow-up task |
| `/sp:dev-brainstorm "User notification system" --feature` | Interview → ideation → create a top-level feature with BDD AC, gated by `feature check` (stops at the feature) |
| `/sp:dev-brainstorm "Audit logging" --depth comprehensive --feature A` | Deep interview → feature nested under parent A, with AC from the decision trace |
| `/sp:dev-brainstorm "Password reset via email" --feature --next` | Interview → feature with AC → gate → auto-invoke `/sp:dev-plan --feature <ID>` (decompose to tasks) |
| `/sp:dev-brainstorm "Microservice boundaries" --wayfind` | Discovery interview → direct escalation to `sp:wayfinder` charting (no scope-check prompt) |
| `/sp:dev-brainstorm "New auth framework" --depth comprehensive --wayfind` | Deep discovery interview → wayfinder map with comprehensive decision tree as seed context |

## Implementation

The command owns Phase 1 (discovery interview) inline. Phase 2 delegates to **sp:brainstorm**'s
`dev-brainstorm` operation, OR to **sp:wayfinder**'s charting mode when `--wayfind` is set or the
operator confirms the scope-check escalation. Phase 3 is the artifact exit — `--task` *or*
`--feature`, never both (and neither when `--wayfind` is active — the map feature IS the artifact).

**Agent override.** `--agent` is an **inline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"). The default
(no flag) runs the ideation/research model calls **in the current session**. An explicit
`--agent <name>` or `--agent auto` spawns them via `spur agent run … --agent <value>` instead.

```
# Phase 2 — Ideation (default)
Skill(skill="sp:brainstorm", args="dev-brainstorm --context <decision-tree> --options <n>")

# Phase 2 alt — Wayfinding escalation (--wayfind or operator-confirmed)
Skill(skill="sp:wayfinder", args="chart --destination <destination> --context <decision-tree>")

# Phase 3a — Task exit (only when --task is set)
spur task create "<approach-name>" --feature <id> --template feature-impl

# Phase 3b — Feature exit (only when --feature is set)
spur feature create "<feature-name>" [--parent <parent-id>] --json
# then Edit the feature file: Goal, Scope, and Acceptance Criteria (BDD from decision trace)
spur feature check <ID> --json   # loop until exit 0
# Phase 3b chain (only when --next is also set): decompose to tasks
# /sp:dev-plan --feature <ID>
```

The `dev-brainstorm` operation on `sp:brainstorm` accepts a pre-built decision-tree context and
skips its own clarification step, going directly to structured ideation.

- **`--task`** — invoke `spur task create` with the recommended approach's details, seeding
  Background from the brainstorm output. Lands a single `todo` task.
- **`--feature`** — invoke `spur feature create`, then **edit the feature file** to author Goal,
  Scope, and BDD Acceptance Criteria (no `--section` verb exists on `feature update`), then loop the
  `spur feature check` gate to exit 0. Without `--next`, report the feature and stop. With `--next`,
  on a clean gate auto-invoke `/sp:dev-plan --feature <ID>` to decompose into a task batch.
- **`--next`** — chains the `--feature` exit into decomposition; ignored without `--feature` (and
  with `--task`, which already lands a terminal artifact).
- Passing both `--task` and `--feature` is an error — surface it and ask which artifact the operator
  wants.
- Passing `--wayfind` with `--task`, `--feature`, or `--skip-discovery` is an error — `--wayfind`
  replaces ideation (and its artifact exits) with charting; `--skip-discovery` would strip the
  context charting needs.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation, `AskUserQuestion` for the interview, and
  `$ARGUMENTS` passthrough work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Run the two-phase protocol
  manually: walk the grilling interview yourself, then invoke `sp:brainstorm`'s ideation phase
  with the collected decision tree.

## See Also

- **sp:brainstorm** — the backing ideation skill (structured options, trade-offs, confidence)
- **sp:wayfinder** — the wayfinding escalation target (multi-session investigation maps)
- **sp:spur-dev** — convert brainstorm output to tasks via `/sp:dev-plan`
- **sp:dev-plan** — the decomposition step `--feature --next` auto-invokes (feature with AC → task batch). Call it directly only when a feature already exists and just needs decomposing; otherwise enter through `dev-brainstorm`.
- **feature-dev.yaml** — the bundled workflow that drives a whole feature end-to-end (brainstorm → plan → execute every task → feature-verify → done)
- **ac-style-guide** — BDD authoring conventions (R-numbering, `@core`/`@edge` tiers, scenario-title stability) the `--feature` exit follows
- **Grilling interview pattern** — the one-question-at-a-time heuristic interview this command's Phase 1 is based on. The pattern: walk the decision tree branch by branch, always provide a recommended answer, explore the codebase before asking the user.
