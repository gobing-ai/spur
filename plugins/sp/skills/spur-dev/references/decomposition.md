---
name: decomposition
description: Task decomposition conventions — the task-batch.schema.json contract, template-variant selection, scenario-to-task mapping.
see_also:
  - spur-dev
# Granularity knobs — tune the decomposition standard here (judgment guidance, not
# runtime-enforced). The skill cites these; editing them adjusts the agent's sizing.
granularity:
  min_hours: 2 # never create a subtask smaller than this
  target_min_hours: 2 # healthy task lower bound
  target_max_hours: 8 # reassess (likely two deliverables) above this
  force_decompose_above_hours: 16 # mandatory split regardless of other signals
---

# Decomposition

Turning a feature's acceptance criteria into a validated task batch. The LLM produces JSON;
the CLI validates it against `task-batch.schema.json`; nothing is written until the gate
passes.

## The batch schema

`apps/cli/schemas/task-batch.schema.json` (runtime SSOT: the Zod `taskBatchSchema` in
`@gobing-ai/spur-domain`) defines the JSON shape. **The top level is a JSON ARRAY of task items —
NOT an object with a `tasks` key.** Each item is `.strict()`: any field not in the table below is
rejected, and a single rejected item fails the whole batch (all-or-nothing).

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Task title; used in slug generation. |
| `template` | no | Template variant (`standard`, `feature-impl`, `issue`, `review`, `meta`, `brainstorm`); defaults to `standard` (`feature-impl` when `--feature` is given). |
| `feature_id` | no | Links the task to a feature — the single traceability edge. |
| `parent_wbs` | no | For sub-tasks; references the parent's WBS (quoted 4-digit string, e.g. `"0042"`). |
| `priority` | no | `P0`–`P3`; align with feature priority. |
| `tags` | no | String tags. |
| `background` | no | Pre-filled `## Background` body (the scenario→task mapping note goes here). |
| `requirements` | no | Pre-filled `## Requirements` body. |

> There is **no** generic `sections` field and **no** `dependencies` field in the batch item — the
> Zod schema is strict and rejects both. Use `background`/`requirements` for content, and record
> ordering in `background` prose (the WBS-level `dependencies` frontmatter is set later, not at batch
> create).

## Template-variant selection

The `template` field is the **single variant axis** (TASK_VARIANTS): it selects the section
layout (the `section-matrix.yaml` variant), the scaffold body file
(`config/templates/task/<variant>.md`), and is written to the task's `template:` frontmatter.
Which sections actually appear is **stage-driven** by the matrix (e.g. `Solution` only from `wip`),
not a fixed list — pick the variant by *purpose*, not by a section checklist.

| Variant | When to use |
|---------|-------------|
| `standard` | General-purpose implementation work (the workhorse) |
| `feature-impl` | Implementation tied to a feature; AC pre-seeded, Background from the feature `## Goal` |
| `issue` | Bug/defect — repro in Background, verified Root Cause, then fix |
| `review` | Code-review fix-up — logs the findings as **input** (`#### Review Findings` under Background) and fixes them; `### Review` is the **post-fix** reflection + back-issues |
| `meta` | Process / docs / chore — lightweight Background + Plan |
| `brainstorm` | Minimal idea capture |

Selection on the CLI: `spur task create "<title>" --template <variant>`; in a batch item: the
`template` field. A `--feature` link defaults the variant to `feature-impl`; otherwise `default`.

## Scenario-to-task mapping

For each core scenario in the feature's AC:

1. **Design one task** that implements the scenario end-to-end. This is the common case.
2. **Split into multiple tasks** when the scenario spans subsystems (e.g., auth service +
   UI). Each task names the subsystem it owns.
3. **Record the mapping** in each task's `## Background`: `Implements: R3 — Registered user
   can log in with email and password`.

Edge-case scenarios may map to tasks or be deferred. Record deferrals explicitly:
`Deferred: R7 — Edge case not in this iteration`.

## When to decompose at all

**Every subtask has a cost** — a file to track, a sequential bottleneck, a separate review, a
context switch. The question is never "can I split this?" but "do I *need* to?" Decompose only
when a benefit outweighs that cost:

- The work has genuinely **independent parallel streams** (different agents, simultaneously).
- A part needs a **distinct review/approval gate** that cannot be combined.
- A part has a **materially different risk profile** (one safety-critical, one cosmetic).
- A part needs a **different domain expert** (DB vs UI).

Do **not** decompose when the work fits one agent's head, touches related files in one module,
has a single review gate, or is one deliverable with one rollback boundary. In that case write the
steps in the parent task's **Plan**, not as separate task files.

### Quick rubric

Estimate five signals — **E** effort (hours), **D** independently-reviewable deliverables,
**L** layers/modules, **C** coordination (0 none / 1 moderate / 2 high), **R** risk (0 low / 1 med
/ 2 high). `score = E + D + L + C + R`, with overrides applied in order:

1. **Force decompose** if `R = high` (2).
2. **Force decompose** if `E > force_decompose_above_hours` (frontmatter knob, default 16h).
3. **Force single-task** only if none of the above AND it is one file/module, one deliverable,
   one layer, zero coordination, one rollback boundary.

| score | decision |
|-------|----------|
| 0–2 | keep as one task (write a one-line skip rationale in Plan) |
| 3–4 | decomposition optional — single-task plan allowed with rationale |
| 5+ | decompose into deliverable-based tasks |

## Parent (umbrella) tasks

When a task decomposes into sub-task **files** (each carrying `parent_wbs`), the original becomes a
**parent/umbrella task**: it owns the requirements and the cross-cutting design, but it implements
**nothing itself** — the work lives in its children.

A parent is **not a skeleton task.** The "skeleton task" anti-pattern below targets *sub-tasks* that
punt their content to the parent ("see parent"). A parent that holds the requirements and a roster
of children is the *correct* shape — the inverse direction is fine.

Two rules make a parent verifiable:

1. **The parent's `## Plan` must carry the sub-task roster** — a table mapping each child to the
   parent requirement(s) it covers, with its current status. Write it **immediately after
   `batch-create`** (the same step that lands the children); a parent without a roster cannot be
   checked for completeness by a human. Roster row template:

   | Sub-task | Covers | Title | Status |
   |----------|--------|-------|--------|
   | `[0110](0110_<slug>.md)` | R1, R2 | <child title> | ✅ done / ⏳ todo / 🔶 wip |

   The status column is maintained by hand today (refresh it when a child's status changes). A
   command-driven roster refresh — mirroring `spur feature refresh`'s auto-generated `## Tasks`
   block — is the planned automation; see the deferred roll-up task.

2. **A parent is complete only when every sub-task is `done` (or `cancelled`).** Cross-cutting
   requirements satisfied across multiple children (e.g. "validate + doc-sync") are met *inside*
   each child, not as separate tasks. Do not mark a parent `done` while a child is open, and do not
   leave a parent open once all children are closed.

> **Gate note.** `spur task check` validates *structure*, not roll-up — it does **not** yet flag a
> parent that is `done` with open children, or all-children-done with an open parent. Until that gate
> lands, the roster (rule 1) is the manual completeness check. The enforcement gate is a deferred
> enhancement.

## Decomposition heuristics

- **Deliverable, not phase.** A subtask must be describable in one sentence a non-technical
  person understands ("Add the task-creation endpoint"), never an activity ("investigate X",
  "design Y", "write tests for Z"). If a subtask name contains *investigate / research / design /
  implement (standalone) / testing (standalone)* or a pipeline phase, you are decomposing by
  phase — stop. Design lives in the parent's **Design** section; testing is part of each task.
- **Full lifecycle per task.** Each task owns the *complete* circle for its requirement(s):
  define the issue, give the solution + acceptance criteria, draw the plan, record the review.
  Never carve a single requirement into "design task / build task / test task".
- **Size floor / target (frontmatter knobs).** Never create a subtask smaller than `min_hours`
  (default 2h) — merge it into the adjacent deliverable or make it a Plan step. Aim for
  `target_min_hours`–`target_max_hours` (default 2–8h). If a subtask exceeds `target_max_hours`
  after decomposition, reassess (it is probably two deliverables).
- **Self-contained.** Every task's Background + Requirements must stand alone (a reviewer should
  not need to open the parent). If you cannot write a meaningful Background without referring to
  the parent, it is a Plan step, not a task.
- **Ordering:** tasks with no dependencies come first. Note ordering in each task's `background`
  prose at batch time; set the WBS-level `dependencies` frontmatter after creation if needed.
- **Parallelism:** mark independent tasks with the same priority — the pipeline can fan out.
- **Testing:** every `feature-impl` task produces its own tests. Do **not** create separate
  "write tests" tasks — testing is part of implementation.
- **Review:** complex or cross-cutting tasks get a `review` companion task (template `review`).
  Simple tasks skip it — the pipeline's review step suffices.

## Anti-patterns (do not do these)

| Anti-pattern | Why it's wrong | Instead |
|--------------|----------------|---------|
| **Phase split** (investigate → design → implement → test as 4 tasks) | Fragments one deliverable; the "design" task finishes while the feature isn't built | One task; phases become Plan steps |
| **Skeleton tasks** (empty Background/Requirements, "see parent") | Task files must be self-contained for review | Merge back, or write it as a Plan step |
| **Over-decomposition** (5 tasks each <30 min for one PR) | 5× tracking overhead for no parallelism or review benefit | One task with a Plan checklist |
| **Under-decomposition** (one task spanning 3 subsystems + 20h) | Unreviewable, one giant PR, no fan-out | Split by subsystem/deliverable |

## Stage → sections, and the Design vs Solution split

A task created with a spec (a `--feature` link, or a batch item carrying `background`/
`requirements`) lands at **`todo`** — "ready to execute" (§2.3). A bare capture lands at
**`backlog`** — "still preparing". The Section-Status-Matrix
(`config/tasks/section-matrix.yaml`) decides which sections a task carries at each stage; the
producer renders them with invisible HTML guidance comments. You do **not** hand-build the section
list — `spur task create` / `batch-create` does it from the matrix.

| Stage | Means | Sections present |
|-------|-------|------------------|
| `backlog` | still preparing | Background |
| `todo` | ready to execute — the **HITL review gate** | Background, Acceptance Criteria, Design, Plan (+ Q&A/Requirements optional) |
| `wip` | implementing | + Solution (the change-map starts here) |
| `testing` | verifying | Solution, Testing |
| `done` | shipped | Solution, Testing, Review (gated) |

**Design (written at `todo`, for HITL review) = the decision record — WHAT/WHY:**
the chosen approach + a one-line reason, rejected alternatives, key interface/type **signatures**
(not bodies), and invariants. **Code budget: ≤2 illustrative snippets.** This is what a reviewer
reads to approve the task *before* any code is written.

**Solution (written at `wip`/`testing`) = the change-map — HOW/WHERE:**
a `file:line` table of every touched site, one sentence each; **≤8-line snippets only for
non-obvious logic, never full-function dumps.** `spur task check` requires ≥1 `file:line` citation
once Solution has real content.

> **Avoid the legacy "too much code" failure.** Design shows *shape and decision*, not
> implementation; Solution *points at* the code (file:line), it does not reproduce it. If you find
> yourself pasting whole functions into either section, you are documenting the diff — stop and
> cite the location instead.

## Batch JSON example

The payload is a top-level JSON **array** (no `tasks` wrapper):

```json
[
  {
    "name": "Implement task creation endpoint",
    "template": "feature-impl",
    "feature_id": "A1",
    "priority": "P0",
    "background": "Implements: R1 — User can create a task with required fields"
  },
  {
    "name": "Implement task listing endpoint",
    "template": "feature-impl",
    "feature_id": "A1",
    "priority": "P1",
    "background": "Implements: R2 — User can list tasks filtered by status (runs after the create endpoint)"
  }
]
```

## Common schema violations

| Violation | Fix |
|-----------|-----|
| `name` is empty or missing | Every task must have a name. |
| `template` value not in the enum | Use one of: `default`, `feature-impl`, `issue`, `review`, `meta`. |
| `feature_id` references a non-existent feature | Run `spur feature list --json` to confirm the ID exists. |
| `priority` not `P0`–`P3` | Use the canonical priority scale. |
| Unknown field (e.g. `sections`, `dependencies`, `tasks` wrapper) | The item schema is strict — use only the documented fields; the payload is a bare array. |
| `parent_wbs` as a number (`0042`) | Quote it: `"0042"` — leading-zero numerics fail the 4-digit string schema. |
