---
name: spur-cli-features
description: "spur-cli noun reference: operate `spur feature` as the project's feature CLI — author features with hierarchical IDs (DD-14), write acceptance criteria the validator and decomposition both read, drive the feature lifecycle, move subtrees, and keep traceability honest. The intent-and-AC side of the planning layer that the spine orchestrates against."
see_also:
  - spur-cli
---

# spur feature — the feature CLI

`spur feature` is the CLI for the **feature tree** — the markdown feature files that capture intent
(`Goal` / `Scope`) and acceptance criteria, organized by hierarchical IDs (DD-14). Features are the
*why* and *what-done-looks-like*; tasks (see `spur task`) are the *how*.

This is a **companion reference**, not an orchestrator. It documents *what each verb is* and *how
to author features and AC well*. The end-to-end loop that turns a vague intake into a feature, AC,
and a decomposed task batch lives in **`sp:spur-dev`** — do not reimplement that loop here (R3).
When you need to *drive* planning, reach for `sp:spur-dev`; when you need to know *which verb does
what* or *how to write a scenario*, this skill.

## Verb map

| Verb | Purpose | Key flags |
| ---- | ------- | --------- |
| `create <name>` | Allocate a feature; assigns a hierarchical ID under the create-lock | `--parent <id>` `--folder` `--json` |
| `show <id>` | Print one feature's frontmatter + body | `--folder` `--json` |
| `update <id> [status]` | Lifecycle transition, scalar field set, **or** section replace | `--field <k> --value <v>` `--section <n> --from-file <p>` `--folder` `--json` |
| `advance <id>` | Walk forward along the legal lifecycle path to a target status | `--to <status>` (default `done`) `--folder` `--json` |
| `list` | List features, filtered | `--status <s>` `--priority <p>` `--folder` `--json` |
| `move <id>` | Re-parent a subtree (cascade-rename of descendants) | `--parent <id>` `--dry-run` `--folder` `--json` |
| `refresh` | Rebuild INDEX + each feature `## Tasks` table from task edges (**docs only**; no status change) | `--feature <id>` `--folder` `--json` |
| `check [id]` | Validate one feature / the tree; the 4-layer gate | `--strict` `--folder` `--json` |
| `sync [id]` | Align feature **lifecycle status** with linked task states (real transitions + guards) | `--all` `--dry-run` `--force` `--folder` `--json` |

**`refresh` vs `sync` (do not conflate):**

| Need | Verb |
| ---- | ---- |
| Stale `## Tasks` roster / INDEX after tasks finished or linked | `refresh` |
| Feature frontmatter `status` should follow task statuses | `sync` (preview with `--dry-run`) |

`refresh` never runs lifecycle gates. `sync` never rewrites the Tasks table — run both when you need both.

All verbs accept `--json` and `--folder <path>`.

## Hierarchical IDs (DD-14)

Feature IDs are positional: a top-level feature is a letter (`H`), a child appends one digit per
level (`H1`, `H2`, then `H21`, `H22`). Rules the CLI enforces — you don't restate them, you let
`create` and `check` apply them:

- One digit per level; **≤ 9 children** per parent (the corpus-derived limit `check` flags as L3).
- The parent of an ID is that ID with its **last character dropped** (`H21` → `H2` → `H`).
- `create --parent H2` takes the **next free digit 1–9** under `H2`; allocation is serialized by
  the create-lock so concurrent creates never collide.

```bash
spur feature create "Planning layer" --parent H      # → H<n>
spur feature create "Task CLI" --parent H1            # → H1<n>
```

To restructure, use `move` — never hand-edit an ID. `move <id> --parent <new>` re-parents the
subtree and **cascade-renames** every descendant; omit `--parent` to lift it to a top-level group.

**Before create or restructure (judgment, not CLI):** load
[features/hierarchy-mece.md](features/hierarchy-mece.md) — MECE sibling sets, **sparse cautious
roots**, extend-vs-create decision procedure, merge vs reparent, depth/width limits. `/sp:dev-plan`,
`/sp:dev-idea`, and `/sp:dev-featurechange` must follow that checklist so new work prefers an
existing parent over a new letter.

## Editing a feature: status, fields, and sections

`update` is multi-mode (status, field, and/or section — not all require mutual exclusion, but each
mode needs its own required args).

**Lifecycle transition** (positional status):

```bash
spur feature update H2 active
```

Valid statuses: `backlog → active → verifying → blocked → done → cancelled`. The lifecycle engine
enforces legal transitions; `verifying` is the gate where AC traceability must hold (L4).
**One active goal** at a time is enforced by `check` (a corpus invariant).

**Scalar field set:**

```bash
spur feature update H2 --field priority --value P1
```

`--field` requires `--value`. This sets a single frontmatter scalar (e.g. `priority`).

**Section replace** (file-wins, same contract as `spur task update --section`):

```bash
spur feature update H2 --section "Acceptance Criteria" --from-file /tmp/ac.md
```

`--section` **requires** `--from-file` (exit `2` otherwise). Replaces the whole named section body.
The `## Tasks` block is still rebuilt by `refresh` (files win for that region).

**Advance** (multi-hop forward walk):

```bash
spur feature advance H2              # walk forward until done (default)
spur feature advance H2 --to verifying
```

Walks the legal forward path (`backlog → active → verifying → done`) hop-by-hop until `--to`
(default `done`). No-op when already at the target.

## Acceptance criteria conventions

AC is the contract `check` validates and decomposition maps tasks against. Author scenarios in the
feature's `## Acceptance Criteria` as Gherkin.

### R-numbering

Every scenario carries an `R1, R2, …` prefix in its title:

```gherkin
Scenario: R1 — User can create a task with required fields
Scenario: R2 — Task creation fails gracefully on missing title
```

- **Sequential within a feature** — start at R1 per feature.
- **Stable forever** — never renumber after tasks are created; a new scenario takes the next free
  number. (Tasks reference AC by *scenario title*, normalized — the R-prefix is stripped on match —
  so a renumber silently breaks coverage.)
- **One R-number = one scenario** — never split a requirement across scenarios under one R-number,
  never merge two requirements into one scenario.

### Two tiers (authoring convention)

Tag scenarios `@core` (must ship; maps to a task in decomposition) or `@edge` (advisory error/edge
paths; may be deferred). This is a **planning convention** (DD-06), not a `check` gating feature
today — the validator currently treats all scenarios uniformly — but tagging lets decomposition and
future tiered gating tell them apart. Full rationale: `sp:spur-dev`'s AC style guide.

See [features/acceptance-criteria.md](features/acceptance-criteria.md) for the Gherkin template
and the checklist-vs-Gherkin two-format note.

## Traceability habits

The L4 layer of `check` reads the **task → feature** edges (`feature-id` in task frontmatter) and
the AC coverage map. Habits that keep it green:

- **Create tasks with `--feature <id>`** so the incoming edge exists (`spur task create … --feature H2`).
- **Match a task to AC by scenario title**, not R-number — coverage is computed on normalized
  titles, so keep titles stable even as you renumber-around them.
- **Before `verifying`**, run `spur feature check <id> --json` and clear: orphan scenarios (AC with
  no task), coverage orphans (tasks claiming AC that doesn't exist), and broken edges.
- **Run `refresh` after hand-edits or task status changes** so the `## Tasks` block and tree reflect
  the files (files win). This is **not** `sync` — it does not change feature status.
- **Scope `refresh` to one feature** with `--feature <id>` when only one feature's task links changed
  (INDEX.md is still regenerated for the whole tree): `spur feature refresh --feature H2`.

## Roadmap and priority habits

Use feature hierarchy for user-facing capabilities and roadmap themes; keep technical-module mapping
as prose or notes unless the product surface is developer infrastructure. Priority is a scalar field
(`spur feature update <id> --field priority --value P1`), while status is lifecycle state
(`backlog → active → verifying → blocked → done → cancelled`). Do not conflate the two.

**Structure first:** [features/hierarchy-mece.md](features/hierarchy-mece.md) (MECE roots, when to
extend vs create). **Then priority:** [features/roadmap-priority.md](features/roadmap-priority.md).

For roadmap adjustment, apply the RICE/MoSCoW and strategy guidance from `sp:spur-dev`'s product
planning reference, then apply accepted deterministic changes through `spur feature update`,
`spur feature move`, `spur feature refresh`, and `spur feature check`.

## The gate — `check --json`

```bash
spur feature check H2 --json        # one feature
spur feature check --json           # whole tree
spur feature check --strict --json  # warnings → failures
```

The 4-layer validator (frontmatter, AC syntax, children-limit/structure, L4 traceability) emits its
verdict and findings as JSON. **Query this, don't re-derive it** — the rules live in the CLI, never
restated as prose here. This is what `sp:spur-dev`'s feature-check gate loop runs.

## Status sync - `sync`

`spur feature sync` keeps a feature's **lifecycle status** honest against the states of its linked
tasks — if all tasks are `done`, the feature should advance to `done`; if tasks reopen, the feature
reopens. It computes a proposal (`from → to` with a `reason`) and, unless `--dry-run`, applies it
via real lifecycle transitions (dogfood / one-active-goal / L4 gates may deny a hop).

**Not for roster tables.** A stale `## Tasks` line (e.g. task still listed `todo` after it is `done`)
is fixed with `spur feature refresh`, not `sync`. Use `sync --dry-run` first when you only want to
see the proposed status hop.

```bash
spur feature sync H2 --json                    # one feature
spur feature sync H2 --dry-run --json          # propose only, no write
spur feature sync --all --json                 # every feature with linked tasks
spur feature sync H2 --force                   # apply a reopen proposal without confirmation
spur feature sync H2 --folder docs/custom-tasks --json   # non-default tasks folder
```

- **`[id]`** syncs one feature; **`--all`** syncs every feature with linked tasks. One of the two is
  required - exit `2` if neither is given.
- **`--dry-run`** reports proposed transitions without applying. **`--force`** applies a *reopen*
  proposal (status moving backward) without interactive confirmation.
- **`--json`** single-feature emits `{ proposal, applied, appliedHops[] }`; `--all` emits
  `{ totalFeatures, evaluated, updatedCount, results[] }` where each result is the single-feature
  shape. `proposal` is
  `{ featureId, from, to, reason, requiresConfirm?, gateBlocked?, gateFindings?, hops? }`.
- **Exit codes:** `0` success (including NOOP), `1` error, `2` invalid usage (no id and no `--all`).

## What this skill is NOT

- **Not the planning loop.** Intake → create → AC generation → check-loop → decomposition →
  batch-create is `sp:spur-dev`'s planning half (R3).
- **Not validation logic.** This skill says *run `check`*; the layers it enforces are CLI code.
- **Not tasks.** Task verbs, the WBS lifecycle, and section editing live in **`spur task` (see [tasks.md](tasks.md))**.

## References

| Reference | Covers |
| --------- | ------ |
| [features/verbs.md](features/verbs.md) | Per-verb flag detail, JSON shapes, the 4 check layers |
| [features/acceptance-criteria.md](features/acceptance-criteria.md) | Gherkin template, R-numbering, `@core`/`@edge`, traceability mechanics |
| [features/hierarchy-mece.md](features/hierarchy-mece.md) | MECE roots, create/extend/reparent/merge rules, root gate, depth limits |
| [features/roadmap-priority.md](features/roadmap-priority.md) | Roadmap hierarchy, priority/status conventions, and feature-tree adjustment workflow |

## See also

- **`sp:spur-dev`** — orchestrates these verbs into the planning + execution loop. Use it to
  *drive* planning; use this skill to *look up a verb* or *author AC*.
- **`spur task` (see [tasks.md](tasks.md))** — the companion for `spur task` (WBS lifecycle, section editing, the
  readiness matrix).
