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
  → design doc (conditional: --design always / --auto agent-decides) → docs/design/<slug>.md + 04 index
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
  generation, or author directly if the feature is simple. **Thread `--agent` through** when the
  command forwarded one — see [cross-cutting.md → Honor `--agent`](cross-cutting.md).

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

**Default: do not decompose.** A clean feature does not automatically become many tasks. The
default outcome is one task whose `## Plan` carries the implementation steps; splitting is the
exception you justify with the rubric. See [decomposition.md → Default to NOT
decomposing](decomposition.md) — read it before this step.

1. **Score the feature with the rubric first.** Compute E/D/L/C/R for the *whole* feature. Record
   the assessment (this is a required artifact, not optional):
   - **Score 0–2 → keep as one task.** Stop. Author one task (Background + Requirements from the
     feature, the implementation steps as its `## Plan`). Do NOT call `batch-create`. You're done
     with decomposition.
   - **Score 3–4 → decomposition optional.** Prefer one task with a rationale unless a clear
     deliverable boundary justifies a split.
   - **Score 5+, or a force-decompose override fires → decompose.** Continue to step 2.
2. **Only now design the split** — by deliverable boundary, never by phase or by list-item. Read
   the feature's scenarios (the AC); each resulting task maps to ≥1 scenario by title.
3. **Score each candidate child.** Any candidate that scores 0–2 on its own is a `## Plan` step of
   a sibling, not a task — merge it. This is the check that stops a 6-item finding list becoming 6
   tiny tasks.
4. Produce a **task-batch JSON** document conforming to `task-batch.schema.json` — a top-level
   JSON **array** of strict task items (no `tasks` wrapper, only documented fields).

Decomposition heuristics (apply only after deciding to decompose):
- **One task = one atomic unit of work** a single agent can complete (target 2–8h; never <2h).
- **Scenario coverage:** every core scenario maps to ≥1 task; edge-case scenarios may map
  or be deferred.
- **Sub-tasks:** record `parent_wbs` (quoted, e.g. `"0042"`) for sub-tasks; note ordering in
  `background` prose (the item schema has no `dependencies` field).
- **Template variants:** choose `feature-impl` for implementation tasks (pulls Goal →
  Background from the linked feature, per B09).
- **Record the rubric score** in each child's `background` (a trailing line, e.g.
  *"Rubric: E2 D1 L1 C1 R2 = 7 → decompose (force: R=high)."*) — the assessment artifact the
  gate below checks for.

The batch JSON is the LLM→CLI contract — see [decomposition.md](decomposition.md) for the
full schema and conventions.

## Step 5: Batch-create gate

**Pre-check (soundness, before the CLI gate).** Re-read each item in the batch JSON against the
rubric before submitting. Specifically:

- Would this item score 0–2 on its own? → it is a Plan step; merge it into a sibling or back into
  the parent. Do not submit it as a task.
- Is the batch one-item-per-list-entry (one finding → one task, one scenario → one task)? → you
  are reflex-decomposing. Re-score and merge.
- Does each item carry its rubric-score line in `background`? → if not, the assessment is missing;
  score it before submitting.

Only then run the CLI gate:

```bash
spur task batch-create --file <batch.json>
```

Atomic: all-or-nothing. If `task-batch.schema.json` validation fails, **nothing is written**
and findings are returned. The schema validates shape only (it cannot reject over-decomposition —
that is the pre-check's job above). Common shape failures:

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

## Step 5.5: Design doc (conditional)

A feature's **design satellite** (`docs/design/<slug>.md`) is the cross-cutting design record for the
area — the decision record a reviewer reads, indexed from `docs/04_DESIGN.md §0`. The planning half
authors it here, after the batch lands, when the feature warrants one. This is **per feature**, not
per task: a task's in-file `### Design` section (code-level, written at refine — Step 6) is a separate,
narrower artifact and does not replace the satellite.

**Decision — does this run at all?** Driven by the `/sp:dev-plan` flags:

| Flags | Action |
|-------|--------|
| `--design` (± `--auto`) | **Always** author/update the satellite. `--design` wins; `--auto` ignored. |
| `--auto` (no `--design`) | **Decide from intake.** Author **iff** a cross-cutting seam is detected; else skip. |
| neither | **Skip.** No satellite, no `04` change — Step 6 follows directly. |

**The seam heuristic (the `--auto` decision).** A design doc is warranted when the feature introduces
an **ADR-worthy** change — anything that shifts a boundary another engineer must reason about:

- a **new command** or a new flag that changes a command's contract,
- a **new module / package / service** (a new `apps/*` or `packages/*`, a new app-layer service),
- a **new schema** — a DB table/migration, a Zod config key, a DTO/contract shape,
- a **new transport / boundary** — an oRPC seam, an auth boundary, a job-queue or EventBus topic.

If the work is internal to one module, a bug fix, a doc/chore, or a refactor with no boundary change,
**skip** — note the skip in the report. When in doubt under `--auto`, lean skip; the operator can
re-run with explicit `--design`.

**Authoring (skill-prose — no CLI verb).** The `04` index is a hand-curated derived doc
(constitution §4.5 rule 4 / §6.5), so write it directly, in the fixed **detail-first then index**
order (§4.5 rule 5 / sync trigger **T9**):

1. **Satellite first.** Write/update `docs/design/<slug>.md`. `<slug>` is the stable grep anchor —
   derive it from the feature name (kebab-case), and **reuse the existing slug** on re-runs. Capture
   the chosen approach + one-line reason, rejected alternatives, key interface/type **signatures**
   (not bodies), invariants, and the surface it touches. Do **not** restate the satellite file format
   here — follow the shape of existing satellites (`docs/design/server-side-adjustment-design.md`,
   `workflow-observability.md`).
2. **Index second.** Add or update the satellite's row in `docs/04_DESIGN.md §0` (the `| Satellite |
   Area | Status |` table) — pointer + one-line area + status only, never a restatement of the body.

**Idempotency (re-runnable).** `/sp:dev-plan … --design` may run many times for one feature. If the
satellite already exists: **update in place** — merge new design content into its sections, refresh
its `updated_at`, and leave its existing `04` index row alone (or adjust only its status). **Never**
overwrite the whole file, create a second satellite, or add a duplicate index row. The invariant
(§4.5 rule 1): exactly one `04 §0` row per satellite, every satellite reachable from exactly one row.

**Report (no confirmation pause).** Under `--auto`, generation is autonomous — when the heuristic
fires, author the doc and **report** the chosen slug and a one-line rationale ("authored
`docs/design/<slug>.md` — new `spur <noun>` command + config key"); when it does not fire, report the
skip and why. Do not pause to ask; the operator reviews the satellite afterward.

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

**Check the variant before you write.** Which sections a task carries is decided by its `template:`
frontmatter against `config/tasks/section-matrix.yaml` — NOT a fixed list. Before authoring any
section, run `spur task check <wbs> --json` and read `requiredSections` / the L2 findings: they tell
you exactly what this variant allows at the current status. The default `standard` variant wants
`Acceptance Criteria` + `Design` + `Plan` at `todo`, but other variants differ — e.g. the `review`
variant puts findings under `### Background` (`#### Review Findings`) and the fix checklist in
`### Plan`, and does **not** use `### Requirements`/`### Acceptance Criteria`. Authoring a section
that isn't in the variant's allowed list produces an L2 "not allowed in this variant/status" warning
and an off-variant task. Write only what the matrix permits; route findings/checklists into the
sections the variant actually defines.

**Avoid creating off-variant sections in the first place.** There is no section-delete verb —
intentionally none (the CLI surface stays minimal). Writing an empty body via
`spur task update <wbs> --section <name> --from-file <empty-file>` currently leaves a **bare
heading**, not a removal. So once an off-variant section exists, it cannot be cleanly dropped from
the skill — the prevention (check the variant before writing, above) is the only reliable path. If
you must correct an off-variant section, overwrite its body with a single line pointing at the
correct section (e.g. *"See `### Plan` for the fix checklist."*) rather than leaving it empty.

**Do this just-in-time, per task, immediately before execution** — not in bulk at decomposition
time. Design written against a stale snapshot of the codebase rots; design written right before
`implement` reflects current reality. Refine `0042`, run `0042`; refine `0043`, run `0043`.

**Refine arguments** (defined on the `/sp:dev-refine` entry point, passed through verbatim):

| Argument | Effect |
|----------|--------|
| `--focus <mode>` | Narrows the gap analysis to a subset of domain hints. See the `sp:dev-refine` skill for the full value table (`all`, `requirements`, `background`, `constraints`, `acceptance`, `quick`). Default `all`. |
| `--auto` | Skip interactive Q&A — synthesize improvements from the task content alone. Use for well-scoped tasks where the agent can fill gaps without operator input. |

**Pre-synthesis skip gate (under `--auto`).** Before synthesizing, run `spur task check <wbs> --json`. When the check exits 0 (PASS) and the target sections show no L3 warnings, emit a structured SKIP instead of calling the synthesis agent:

```
SKIP — sections already meet L3: sections-considered=[Background, Requirements, Plan], reason="spur task check PASS, all target sections at L3"
```

This is the expected outcome for a task that is already well-specified. Under `--auto`, a SKIP is not an error — it means no gap was found. The operator can verify by reading the check output or the task file directly. Synthesis is only invoked when a real gap exists.

> **Requirements formatting:** author R-items as a GitHub task-list checkbox — `- [ ] R1. <text>`
> — so progress is trackable in the file. The L3 check accepts the `- [ ] Rn.` / `- Rn.` / `Rn.`
> forms; keep the `Rn.` (period) token so the R-numbering rule recognizes it.
