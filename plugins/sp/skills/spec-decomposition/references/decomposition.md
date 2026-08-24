---
name: decomposition
description: Task decomposition conventions — the task-batch.schema.json contract, template-variant selection, scenario-to-task mapping.
see_also:
  - spec-decomposition
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

## Granularity — two dimensions

The frontmatter `granularity` knobs (`min_hours`, `target_min_hours`, `target_max_hours`,
`force_decompose_above_hours`) bound a task's *size in hours*. They are the **second** dimension
of sizing, not the only one. The **first** dimension is **cohesion**: work that edits the same
files, or that requires the same review context to judge, is one task — *even when the hour
estimate would justify splitting*.

### Cohesion decides legitimacy; hours bound size

Apply the two in order:

1. **Cohesion first — is the split legitimate at all?** If the candidate children would edit the
   same file surface, or need to be read together to be reviewed, they are one task. Splitting
   cohesive work multiplies the fixed per-task ceremony (precheck, implement, test, review,
   approve, verify, record, done — plus a verdict artifact with full requirement and AC tables,
   plus gate remediation at each transition) without reducing risk: the reviewer still reads one
   diff, just across more files. **Ceremony cost is per-task**, which is why this rule exists and
   why its rationale is written here rather than re-litigated at each decomposition.
2. **Hours second — is the resulting cohesive task too large?** Only after cohesion says a split is
   legitimate do the hour knobs bound how large that single cohesive task may get. Above
   `force_decompose_above_hours`, the size guard overrides cohesion: split even if the children
   share a review context, because at that size the review itself becomes the risk.

Without the second clause, cohesion reads as "never split" — the opposite failure. The knobs are
the escape hatch; cohesion is the default.

### Worked example: H8's own first decomposition

Feature H8 ("sp command surface coherence") decomposed into five tasks, each 3–8h — fully inside
`target_min_hours`/`target_max_hours`. The operator rejected it as over-split, correctly: three of
the five (0399, 0401, 0402) all edited `dev-operations.md` and the `plugins/sp/commands/*.md`
surface, so the split created contention over one file surface and tripled the pipeline ceremony
for a diff a reviewer reads once. The merge (5 → 4, with 0402 absorbed into 0401) removed two full
sets of precheck/implement/test/review/approve/verify/record/done cycles over content the reviewer
was always going to read as one diff.

The hour knobs alone permitted the five-task split; cohesion is what flagged it. A numeric proxy
(`max_files_shared` or similar) would have been wrong often enough to be ignored — two tasks
touching one shared config file may be genuinely independent, and two tasks touching disjoint
files may share a review context entirely. Cohesion is a judgment about coupling, and it is stated
as prose for that reason.

### Second occurrence: E1's first charting (2026-08-06)

The same failure recurred through `sp:wayfinder`, which authors tickets without going through this
skill. A wayfinder map for feature E1 was charted with 8 investigation tickets where 4 were right —
four of the six merged pairs would have read the *same transcript files* to answer. Worse, the
discovery ticket covered only the four secondary agents while claude and codex, the operator's
primaries, were split into a separate ticket blocked downstream — so the ETL contract would have
been decided on evidence from the peripheral sources.

Two lessons, both now fixed rather than restated:

1. **Cohesion applies to investigation tickets, not just implementation tasks.** Two questions
   answered by one body of evidence are one ticket, exactly as two changes to one file surface are
   one task.
2. **The rule was unreachable from the surface that failed.** It lived only here, cited only by this
   skill and the spur-dev planning path — while wayfinder, issue-finding, brainstorm, and
   dogfood-testing all author tasks through other routes. The shared statement now lives in
   [`../../spur-dev/references/cross-cutting.md`](../../spur-dev/references/cross-cutting.md)
   § Task sizing, which every command and skill already cites; this file keeps the full treatment
   and the knobs. **Do not delete the cross-cutting section as duplication** — that reachability is
   the fix.

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
| `design` | **default yes** | Pre-filled `### Design` (WHAT/WHY). **Author by default** on plan/decompose. Omit only under operator `--skip-design` (refine fills later). |
| `plan` | recommended | Pre-filled `### Plan` checklist when known at create. |
| `acceptance_criteria` | recommended | Pre-filled `### Acceptance Criteria` when scenarios are known. |

> There is **no** generic `sections` field and **no** `dependencies` field in the batch item — the
> Zod schema is strict and rejects both. Use `background`/`requirements`/`design`/`plan`/
> `acceptance_criteria` for content, and record ordering in `background` prose (the WBS-level
> `dependencies` frontmatter is set later, not at batch create).

### Section bodies are markdown — format them as markdown

Every body field is written into the task file verbatim and rendered by the Board's markdown
preview. **A body is not a plain-text blob**: consecutive lines with no list marker collapse into a
single run-on paragraph on render, even though they look like separate items in the JSON source.

**`requirements` — always author R-items as a GitHub task-list checkbox, one per line:**

```json
"requirements": "- [ ] R1. <text>\n- [ ] R2. <text>\n- [ ] R3. <text>"
```

`R1. <text>\nR2. <text>` (no marker) is the trap. `spur task check` **accepts** it — the L3
R-numbering rule matches the bare `Rn.` token — so nothing fails, and the defect only surfaces later
as an unreadable paragraph in Board preview. Do not rely on `check` to catch this. Keep the `Rn.`
(period) token inside the marker so R-numbering still resolves; see the canonical rule in
`sp:spur-dev` → `references/planning-workflow.md`.

Applies to the other body fields too: `plan` as an ordered list (`1. …\n2. …`), `acceptance_criteria`
as a fenced ```` ```gherkin ```` block, and any enumeration inside `background` or `design` as a
`- ` list.

### Design at create (default) vs `--skip-design`

**Default (no `--skip-design` on `/sp:dev-plan` / `/sp:dev-idea`):** every batch item for
`standard` / `feature-impl` (and any variant that carries Design at `todo`) **must** include a
non-empty `design` field — chosen approach + one-line reason, rejected alternatives, invariants,
key signatures (not code dumps). This is the capable-first cost path: lock the box once at create.

**`--skip-design`:** leave `design` empty (scaffold only). Refine is the **fallback** that fills
blank Design before implement (`/sp:dev-refine` / `dev-refineall`).

## Template-variant selection

The `template` field is the **single variant axis** (TASK_VARIANTS): it selects the section
layout (the `section-matrix.yaml` variant), the scaffold body file
(`.spur/tasks/templates/<variant>.md`), and is written to the task's `template:` frontmatter.
Which sections actually appear is **status-driven** by the runtime matrix — query
`spur task sections <wbs> list --json` rather than assuming a fixed list — pick the variant by
*purpose*, not by a section checklist.

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

**Run "Default to NOT decomposing" (below) first.** If the parent scores 0–2, there is no mapping to
do — write the steps in the parent's `## Plan` and stop. This section only applies once decomposition
has already been justified.

Scenario count is **not** task count. A feature with 7 scenarios does not imply 7 tasks; scenarios
describe observable behavior, tasks describe units of work, and one unit of work routinely delivers
several behaviors. Walk the scenarios and sort them into groups, then emit one task per group:

1. **Merge** scenarios that one task delivers — same file surface, same subsystem, or unreadable
   apart in review. This is the **most common outcome** and the one agents skip. Two scenarios
   describing two behaviors of one change are one task.
2. **One task** when a scenario is a unit of work on its own.
3. **Split into multiple tasks** only when a single scenario spans subsystems (e.g. auth service +
   UI) and each part clears the rubric independently. Each task names the subsystem it owns.
4. **Record the mapping** in each task's `## Background`, listing every scenario it covers:
   `Implements: R2 — …; R3 — Registered user can log in with email and password`.

**Merging never costs AC coverage.** `checkAcCoverage` matches by normalized scenario title across
each linked task's AC block, so one task carrying R2 and R3 in its `### Acceptance Criteria` covers
both — there is no orphan warning and no reason to split 1:1 to satisfy the gate. Splitting to keep
the coverage check quiet is the single most common cause of an over-decomposed batch.

### Two R-namespaces — do not mix them in one scenario list

A task's `### Requirements` are numbered **task-locally** (R1, R2, … within that task). A feature's AC
scenarios are numbered in the **feature's** namespace. Both appear in a task's
`### Acceptance Criteria`, and conflating them is how AC silently drifts from Requirements.

The rule:

- **Scenarios covering the task's own requirements carry the task-local R-prefix** —
  `Scenario: R3 — <observable outcome>`. Tasks declaring `ac_numbering: task-local` in frontmatter
  get these cross-checked by `spur task check` (`L3.ac-requirement-coverage`): a requirement with no
  scenario, or a scenario citing a requirement that does not exist, is reported.
- **Scenarios carried verbatim from the feature (for DD-09 traceability) carry NO R-prefix** — copy
  the title text only. `normalizeTitle` (`packages/domain/src/bdd/coverage.ts:58`) strips `R\d+`
  before matching, so the prefix is invisible to feature coverage anyway; dropping it keeps the
  feature's number from being read as a task requirement id. Verified empirically: removing the
  prefix from a carried scenario left the feature's orphan count unchanged.

**Legacy tasks are exempt.** Most existing tasks predate this and copied feature AC wholesale,
carrying the feature's numbers. The coverage check is opt-in precisely so they emit nothing —
absent `ac_numbering`, only DD-09 applies. Opting an old task in is a pure prefix renumber; it cannot
break traceability. New tasks get `ac_numbering: task-local` from the templates automatically;
`spur task update <wbs> --ac-numbering task-local` opts in an existing one.

Edge-case scenarios may map to tasks, merge into a sibling, or be deferred. Record deferrals
explicitly: `Deferred: R7 — Edge case not in this iteration`.

## Default to NOT decomposing

**The default outcome of decomposition is "keep it as one task."** Splitting is the exception you
must justify, not the baseline. This is the single most important rule on this page, and the one
most often skipped when an agent moves fast: the agent reaches the decomposition step, sees a list
of requirements or findings, and emits one child per item by reflex — producing many small tasks
that the rubric would have rejected as Plan steps.

**Every subtask has a real cost** — a file to track, a sequential bottleneck, a separate review,
a context switch, a rollback boundary. Five subtasks at 1h each cost more total overhead than one
task at 5h, with no parallelism or review benefit gained. So before producing any batch JSON:

1. **Score the parent first.** Run the rubric (below) on the *whole* unit of work. If it lands at
   0–2, the answer is **keep as one task** — stop, write the implementation steps in the parent's
   `## Plan`, and do not call `batch-create` at all.
2. **Only if the parent scores 5+ (or a force-decompose override fires)** does decomposition even
   enter the conversation. Then score each *candidate* child — any candidate that scores 0–2 on
   its own is a Plan step, not a task; merge it into a sibling.
3. **"I can describe N pieces" is not a decomposition trigger.** A finding list, a requirement
   list, or a bullet list is a *Plan checklist*, not a task list. Pieces become tasks only when
   they clear the rubric independently (independent streams / distinct review gate / different
   risk / different expert).

The failure mode this section exists to prevent: a parent carrying 6 findings becomes 6 child
tasks, several of which were <2h doc edits that belonged in the parent's Plan. When in doubt,
**don't decompose** — the operator can always ask for a split after seeing the Plan.

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

### Quick rubric (required artifact — record it before writing any batch JSON)

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

**Record the assessment.** Before `batch-create`, the rubric assessment MUST be written down — for
the parent (and, if decomposing, each child candidate). This is the enforcement step that stops
reflexive over-decomposition: if you cannot show the score, you have not justified the split. Two
acceptable homes for the assessment:

- **In the parent's `## Plan`** (for the keep-as-one decision): a one-line skip rationale naming
  the score, e.g. *"Rubric: E1 D1 L1 C0 R0 = 3 → kept whole; steps below."*
- **In each child's `background`** (when decomposing): a trailing line naming the score and the
  trigger that cleared it, e.g. *"Rubric: E2 D1 L1 C1 R2 = 7 → decompose (force: R=high)."*

A batch produced without a recorded assessment is incomplete — re-score before submitting to
`batch-create`.

## Parent (umbrella) tasks

When a task decomposes into sub-task **files** (each carrying `parent_wbs`), the original becomes a
**parent/umbrella task**: it owns the requirements and the cross-cutting design, but it implements
**nothing itself** — the work lives in its children.

A parent is **not a skeleton task.** The "skeleton task" anti-pattern below targets *sub-tasks* that
punt their content to the parent ("see parent"). A parent that holds the requirements and a roster
of children is the *correct* shape — the inverse direction is fine.

Two rules make a parent verifiable:

1. **The parent's `## Plan` must carry the sub-task roster** — a table mapping each child to the
   parent requirement(s) it covers, with its current status AND its blast radius. Write it
   **immediately after `batch-create`** (the same step that lands the children); a parent without a
   roster cannot be checked for completeness by a human. Roster row template:

   | Sub-task | Covers | Surface | Title | Status |
   |----------|--------|---------|-------|--------|
   | `0110_<slug>.md` | R1, R2 | docs | <child title> | done / todo / wip |

   The **Surface** column is the blast-radius signal for sequencing: `docs` (skill/command markdown,
   no executable), `code` (app/package TS, has tests), or `infra` (DB schema/migration, workflow
   YAML, CI/CD, `.github/`). When deciding execution order across children of the same priority,
   **run `infra` first** (highest risk, load-bearing, hardest to revert), then `code`, then `docs`
   — riskiest-first surfaces the hard problems while context is fresh and lets the cheap fixes
   absorb any rework. A roster with only a Status column hides this and leads to priority-only
   ordering that buries the infra change among doc edits.

   The status column is generated by `spur task refresh-roster` (task 0123) — invoked
   automatically by `spur task batch-create` for each distinct `parent_wbs` after the
   atomic create lands (task 0178 F1). Re-run `spur task refresh-roster <parent-wbs>`
   manually to re-emit the block after a child status change outside `batch-create`.

2. **A parent is complete only when every sub-task is `done` (or `cancelled`).** Cross-cutting
   requirements satisfied across multiple children (e.g. "validate + doc-sync") are met *inside*
   each child, not as separate tasks. Do not mark a parent `done` while a child is open, and do not
   leave a parent open once all children are closed.

> **Gate note.** `spur task check` validates *structure*; parent/child roll-up is
> enforced by the L4 roll-up gate (`packages/app/src/services/task-check.ts:426`
> `runL4Rollup`, task 0121) which warns on parent/child status drift and missing
> roster. The roster itself is auto-generated by `spur task batch-create` (task
> 0178 F1) — the operator never hand-writes it.

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
- **Record rejected split-alternatives (scope-creep guard).** When a requirement is split across
  tasks (e.g. an R1/R2 split, or a finding that *could* have been its own task but was merged into
  a sibling), record the alternative you rejected and why — in the parent's `## Plan` (for the
  merge decision) or the child's `## Design` (for an R1/R2 split). This is what stops a 4h task
  becoming a 2-day task: the moment you write "rejected: pidfile approach — another file artifact
  to manage, stale on crash; the DB column is the natural home," the scope is bounded and the next
  agent (or you, later) won't re-litigate it. A split without a recorded rejected-alternative is
  incomplete — you have not shown the split was necessary, only that it was possible.

## Vertical slices (the slicing-direction axis)

The rubric above decides **whether** to split; this section decides **which direction** to cut once
you do. Every task in a batch must be a thin **vertical slice** through all the layers a scenario
touches (schema / API / UI / tests, as applicable) — independently demoable or verifiable on its
own. A vertical slice proves the feature works end-to-end at a small scale; a horizontal layer-task
proves nothing until every sibling layer-task also lands.

**Horizontal layer-tasks are a named anti-pattern** — see the table below (`all-schema` /
`all-API` / `all-UI` task split). The tell: task names read like layer inventories ("Add the users
table", "Build the users API", "Build the users UI") instead of capability inventories ("User can
register with email").

**Wrong vs right, worked:**

- **Wrong (horizontal):** Task 1 — add `users`/`sessions` tables. Task 2 — add
  `POST /login`/`POST /register` endpoints. Task 3 — build the login/register UI. Nothing is
  demoable until all three land; task 2 blocks on task 1, task 3 blocks on task 2 — a strict
  chain with no parallelism, and a reviewer can't verify task 1 in isolation (a schema with no
  caller proves nothing).
- **Right (vertical):** Task 1 — user can register with email (schema column + endpoint + form,
  thin but complete). Task 2 — user can log in with email (same three layers, reusing task 1's
  schema). Each task is independently demoable (`curl` the endpoint, or click through the form)
  and independently reviewable; task 2 only depends on task 1's schema, not its UI.

**Prefactoring comes first.** "Make the change easy, then make the easy change" — when a vertical
slice is blocked by an awkward existing shape (a function that needs splitting, a type that needs
widening, a module boundary that needs to move), that refactor is its own task, ordered **before**
the slices that depend on it, and it changes no behavior. Do not fold prefactoring into the first
feature slice — a task that both reshapes existing code and adds a new capability is fighting two
review lenses at once (§Anti-patterns: this is a variant of under-decomposition when the refactor
is large enough to warrant its own review).

## Pre-batch-create HITL checkpoint (quiz gate)

Before calling `spur task batch-create`, present the proposed breakdown to the operator as a
numbered list and get it reviewed — a batch is atomic and hard to unwind piecemeal once children
exist, so this is the cheapest point to catch a granularity or ordering mistake.

**Present:**

```
1. <title> — blocked by: none — covers: R1 (user can register with email)
2. <title> — blocked by: #1 — covers: R2 (user can log in with email)
3. <title> — blocked by: none — covers: R3 (user can reset password)
```

Present the quiz as a decision brief — recommended breakdown + the trade-off of each alternative
slicing, with an explicit recommendation — per the SSOT
[spur-dev/references/decision-brief.md](../../spur-dev/references/decision-brief.md).

**Quiz the operator on:**
- **Granularity** — does any task look like a horizontal layer-task, a phase-split, or a
  <2h fragment that belongs in a Plan step instead?
- **Dependency correctness** — is the `blocked-by` chain minimal (no task waits on a sibling it
  doesn't actually need), and does it match the vertical-slice ordering (schema-owning slice
  before the slices that reuse it)?

Proceed to `batch-create` only after the operator confirms, or after they request adjustments and
you re-present the revised list. **Skip this checkpoint under `--auto`** (the profile that already
waives interactive HITL gates elsewhere in the pipeline) — record in the batch's parent Plan that
the quiz was auto-skipped, same as any other `--auto`-waived gate.

## Anti-patterns (do not do these)

| Anti-pattern | Why it's wrong | Instead |
|--------------|----------------|---------|
| **Phase split** (investigate → design → implement → test as 4 tasks) | Fragments one deliverable; the "design" task finishes while the feature isn't built | One task; phases become Plan steps |
| **Skeleton tasks** (empty Background/Requirements, "see parent") | Task files must be self-contained for review | Merge back, or write it as a Plan step |
| **Over-decomposition** (5 tasks each <30 min for one PR) | 5× tracking overhead for no parallelism or review benefit | One task with a Plan checklist |
| **Under-decomposition** (one task spanning 3 subsystems + 20h) | Unreviewable, one giant PR, no fan-out | Split by subsystem/deliverable |
| **Horizontal layer-task** (all-schema task, all-API task, all-UI task) | Nothing is demoable until every sibling layer lands; blocks in a strict chain with no parallelism | Cut vertical slices — one capability through all its layers, thin but complete |

### Worked example — the "list reflex" (the most common over-decomposition)

A review/findings task arrives carrying 6 findings. The reflex move is to emit one child task per
finding → 6 tasks. But several findings are typically <2h doc edits or one-line fixes that the
rubric scores at 0–2 on their own. Those are **Plan steps**, not tasks.

**Bad (reflex):** parent + 6 children, three of which were 30-min edits → 6 files, 6 reviews, 6
rollback boundaries, for work that fit one focused session.

**Better:** score each finding. Merge the <2h ones into the parent's `## Plan` as a checklist;
spawn children only for the findings that clear the rubric independently (distinct module + real
effort + own review boundary). A 6-finding parent often becomes parent + 2–3 children, not 6.

The tell that you're reflex-decomposing: your child names are *"F1 — …", "F2 — …", "F3 — …"* —
one per list item, sized by the list, not by the work. Re-score before submitting the batch.

### Worked example — the phase split

*"Add an Antigravity adapter"* decomposed as: 1) investigate the CLI, 2) design the abstraction,
3) implement the adapter, 4) integrate config switching, 5) add tests. Five tasks — but #1 is an
activity (not a deliverable), #2 belongs in the task's `## Design` section, #4 and #5 are part of
#3, and the whole thing is one deliverable one agent completes in a session. Correct: **one task**,
with research/design/implement/integrate/test as `## Plan` steps.

## Stage → sections, and the Design vs Solution split

A task created with a spec (a `--feature` link, or a batch item carrying `background`/
`requirements`) lands at **`todo`** — "ready to execute" (§2.3). A bare capture lands at
**`backlog`** — "still preparing". The runtime section matrix decides which sections a task
carries at each status; the producer renders them with invisible HTML guidance comments. You do
**not** hand-build the section list — `spur task create` / `batch-create` does it from the matrix.

**Query the runtime contract — never restate a status-to-section table (F92 0593 R2).**
`spur task sections <wbs> list --json` returns the matrix required/optional/forbidden sections
per status; `spur task check <wbs> --json` returns what the gate requires at the current status.
Both replace any static "sections present at stage X" projection. The section *content* guidance
below (Design = the decision record, Solution = the change-map) is prose ownership, not a
section-layout authority.

**Design (written at `todo`, for HITL review) = the decision record — WHAT/WHY:**
the chosen approach + a one-line reason, rejected alternatives, key interface/type **signatures**
(not bodies), and invariants. **Code budget: ≤2 illustrative snippets.** This is what a reviewer
reads to approve the task *before* any code is written.

> **Task `### Design` ≠ the feature design satellite.** This per-task section is code-level and narrow.
> The feature's cross-cutting design record is the **satellite** `docs/design/<slug>.md`, authored once
> per feature in the planning half (planning-workflow §Step 5.5), indexed from `04_DESIGN.md §0`. The
> two coexist: the satellite frames the area; each task's `### Design` records that task's local decision.

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
    "background": "Implements: R1 — User can create a task with required fields",
    "requirements": "- [ ] R1. Accept a title and an optional description on POST /tasks.\n- [ ] R2. Reject an empty title with a 400 and a reason.\n- [ ] R3. Allocate the task file through the CLI-gated write path.",
    "design": "Approach: POST /tasks via existing TaskService.create.\nRejected: ad-hoc SQL in handler.\nInvariants: CLI-gated corpus writes only.",
    "plan": "1. Contract\n2. Handler\n3. Tests",
    "acceptance_criteria": "Scenario: create succeeds\n  Given a valid title\n  When POST /tasks\n  Then a task file is allocated"
  },
  {
    "name": "Implement task listing endpoint",
    "template": "feature-impl",
    "feature_id": "A1",
    "priority": "P1",
    "background": "Implements: R2 — User can list tasks filtered by status (runs after the create endpoint)",
    "design": "Approach: GET /tasks with status filter on TaskService.list.\nRejected: client-side full scan only.\nInvariants: reuses list DTO from contracts.",
    "plan": "1. Filter param\n2. Handler\n3. Tests"
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
| `requirements` items written as bare `R1.` lines | Prefix each with `- [ ] ` — bare lines pass `check` but render as one paragraph in Board preview. See "Section bodies are markdown" above. |
