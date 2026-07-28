# Design — `/sp:dev-plan` design-doc generation (design by default / `--skip-design`)

Owning task: [`0124`](../tasks/0124_add-design-auto-design-doc-generation-to-sp-dev-plan-plannin.md).
Surface index row: [`04_DESIGN.md §0`](../04_DESIGN.md). Feature: `F` (Planning).

**2026-07-28 contract update:** aligned with `/sp:dev-idea` — **no `--design` force flag**.
Design package is **on by default**; sole opt-out is **`--skip-design`**. Seam-heuristic ties
lean **design** (was: lean skip under `--auto`).

## Problem

The Spur planning half (`/sp:dev-plan` → `sp:spur-dev`, `references/planning-workflow.md`) runs
intake → `spur feature create` → AC → `spur feature check` gate → decomposition →
`spur task batch-create` → refine. **No step authors a design satellite or updates the
`04_DESIGN.md` index.** A feature can be planned and decomposed with zero design artifact, even
though the constitution treats `docs/design/<slug>.md` as a first-class derived doc (§4.5) gated by
sync trigger T9. The five pre-existing satellites were all hand-authored outside the flow — design
was a disconnected, easily-skipped side activity.

## Decision

Add a conditional **Step 5.5: Design doc** to the planning half, between batch-create (Step 5) and
refine (Step 6), controlled by the unified design package on `/sp:dev-plan`.

**Why `dev-plan`, not `dev-refine`** — design satellites are *feature-level* (one per surface area,
indexed by area in `04 §0`). `dev-refine` runs per-WBS task and owns each task's narrow in-file
`### Design` section; placing satellite generation there would fire N times for N sibling tasks → N
competing writes to one satellite. `dev-plan` runs once per feature — the natural home.

**Why skill-prose, not a CLI verb** — `04`'s index is a hand-curated derived doc (§4.5 rule 4 /
§6.5), unlike `05` which is tool-written. A `spur feature design` verb would re-render a hand-curated
index — a larger surface change requiring an ADR + `04` update for no idempotency gain the §4.5
contract doesn't already provide. The skill writes the satellite + index directly via Write/Edit.

**Why generate-and-report, not confirm-and-write** — `--auto` *means* "agent, you decide"; pausing for
confirmation on a positive decision defeats the flag's purpose. The operator reviews the satellite
after the fact.

## Behavior — the flag contract

| Flags | Action |
|-------|--------|
| (default) / `--auto` | **Seam heuristic** for feature satellite (ties lean **design**). **Always** author per-task `### Design` in the batch. Report either way; no confirmation pause. |
| `--skip-design` | **Skip** satellite **and** omit per-task `design` fields (scaffold only; refine fills later). Sole design opt-out. |

There is **no** `--design` force flag (removed 2026-07-28; same contract as `/sp:dev-idea`).

### The seam heuristic

Author the satellite **iff** the feature introduces an ADR-worthy boundary change — a seam another
engineer must reason about:

- a **new command**, or a new flag that changes a command's contract;
- a **new module / package / service** (`apps/*`, `packages/*`, an app-layer service);
- a **new schema** — DB table/migration, Zod config key, DTO/contract shape;
- a **new transport / boundary** — oRPC seam, auth boundary, job-queue/EventBus topic.

Internal-to-one-module work, bug fixes, docs/chores, and boundary-preserving refactors **skip**.
**When in doubt, lean design.** Use `--skip-design` only when the operator wants no satellite and
blank task Design.

## Mechanism — authoring (detail-first, then index: §4.5 rule 5 / T9)

1. **Satellite first.** Write/update `docs/design/<slug>.md`. `<slug>` is the stable grep anchor
   (§4.5 rule 2), derived from the feature name (kebab-case), reused verbatim on re-runs. Content:
   chosen approach + one-line reason, rejected alternatives, key interface/type **signatures** (not
   bodies), invariants, surface touched. New satellites use the bare-`<slug>.md` convention.
2. **Index second.** Add/update the satellite's row in `04_DESIGN.md §0` (`| Satellite | Area |
   Status |`) — pointer + one-line area + status only; never restate the body (§6.0 rule 2).

## Idempotency

`/sp:dev-plan` is re-runnable for one feature. If the satellite exists: **update in
place** — merge new content into existing sections, refresh `updated_at`, leave the `04` row alone
(or adjust only its status). Never overwrite the whole file, create a second satellite, or add a
duplicate index row. Invariant (§4.5 rule 1): exactly one `04 §0` row per satellite; every satellite
reachable from exactly one row.

## Scope

**In:** `plugins/sp/commands/dev-plan.md` (flags + truth table); `planning-workflow.md` (Step 5.5 +
diagram); `SKILL.md` (`planning_steps`, diagram, routing row); `decomposition.md` (task-Design vs
satellite disambiguation note); alignment with idea-path design package.

**Out:** a `spur` CLI verb (rejected above); changes to `dev-refine`'s per-task `### Design` section;
the corpus-migration / board slice; any `app`/`domain`/`cli` TypeScript.

## Consequences

> **Idempotency verified (2026-06-25).** A second `/sp:dev-plan` design pass on feature `F`
> reused this slug, took the update-in-place path (Edit, not Write), and produced no duplicate
> satellite and no duplicate `04 §0` row — confirming AC2. This note *is* that re-run's merge.

- Design is a pipeline step with **default-on** package behavior; opt-out is explicit
  (`--skip-design`).
- The `04` index gains entries authored by the skill; the hand-curated contract (§4.5 rule 4) is
  preserved because the skill follows the same detail-first ordering a human would.
- Seam heuristic is judgment, not a gate — false negatives are recoverable by re-running plan
  without `--skip-design` after clarifying ADR-worthiness; false positives produce a reviewable
  (deletable) satellite.

## References

- `docs/99_PROJECT_CONSTITUTION.md` §4.5 (index + satellite), §5 T9 (sync order), §6.5 (`04` is a
  hand-maintained derived doc).
- `plugins/sp/skills/spur-dev/references/planning-workflow.md` Step 5.5 (SSOT procedure).
- `/sp:dev-idea` design package (same `--skip-design`-only contract).
