# Handoff routing — featurechange handoff, next-router seam, conditional dispatch

## The seam with `/sp:dev-next` (next-router)

- `/sp:dev-find-next` answers **"which X"**; `/sp:dev-next` answers **"what step for chosen X"**.
- next-router's routing-table §0 step 1c declares the target-omitted case out of v1 — this command
  fills exactly that hole and no more. Never re-implement within-target routing (TABLE A/B).
- When the operator picks a winner from the ranked report, the printed handoff line is:
  `/sp:dev-next <feature-id>`.

## The handoff to `/sp:dev-featurechange` (feature F31)

Defect proposals follow the 0495 Artifact C boundary, traced end to end:

| Step | Actor | Mutates `docs/features`? |
| --- | --- | --- |
| 1. Detect + emit proposal rows | this skill | No |
| 2. Handoff | printed inline in the report (report reading of OQ1) | No |
| 3. `--dry-run` | `/sp:dev-featurechange` | No |
| 4. Confirm | operator | — |
| 5. `--apply` (`spur feature move`) | `/sp:dev-featurechange` only | **Yes — sole writer** |

There is no path from this skill to a mutated tree that bypasses step 4. Proposal rows are printed
inline in the default report; writing them into `docs/plans/feature-tree-restructure-map.md` as new
rows is allowed (that file is the handoff artifact, not corpus) but never required.

## `--task` — confirmed dispatch into the planning half

OQ1 (dispatch vs report) is **resolved** (task 0498): the command dispatches, and the dispatch target
is the **planning half**, not `/sp:dev-next`. The useful follow-on to "which feature should we work on
now?" is a set of implement-ready tasks under that feature, not within-target step routing.

Without `--task`, behaviour is unchanged — print the report and stop.

### Compose, never rebuild

This skill **creates no tasks**. It invokes neither `spur task create` nor `spur task batch-create`,
and it carries no decomposition procedure. Two existing surfaces already own that work, both gated:

| Need | Owner | Gate it enforces |
| --- | --- | --- |
| Feature → task set | `/sp:dev-plan --feature <id>` | `spur feature check`, then `task-batch.schema.json` + atomic `spur task batch-create` |
| Tasks → implement-ready | `/sp:dev-refineall --feature <id> --auto --depth ready` | the implement-ready checklist (`dev-operations.md` §5) |

A decomposer inside this skill would duplicate `sp:spec-decomposition` and bypass the batch-create
schema gate. That is the CLI-gated-corpus-writes non-negotiable, not a style preference.

### Routing — keyed to the tier already assigned

Read the tier from protocol step 4. **Do not re-derive it.** No new classification logic exists here,
so a change to `ranking-rubric.md` cannot desynchronise this table.

**`--task` spans the ranked frontier *and* the gated list.** Only **T1** comes from the ranked
frontier; **T2/T3/T4** are tiers the rubric assigns to *gated* features (`ranking-rubric.md`: T2 is
"fails the gate, but would be T1 if unblocked"; T4 is the gate reason "all tasks terminal"). A
feature with zero tasks is gated at step 2 and tiered **T3** — so restricting `--task` to gate
survivors would make its primary case unreachable. Offer the rank-1 ranked candidate by default;
`--task <feature-id>` may name any tiered feature, gated or not.

| Tier of confirmed target | State | Action |
| --- | --- | --- |
| **T3 — specify first** | valid AC, zero tasks | `/sp:dev-plan --feature <id>` → then `/sp:dev-refineall --feature <id> --auto --depth ready`. **The primary case** — automates `ranking-rubric.md`'s own "decompose T3 candidates". |
| **T3 — specify first** | AC placeholder / invalid | **Stop.** Print `/sp:dev-plan --feature <id>` and the reason. This is next-router row **B4**: plan continuation needs an operator description — never invent idea text. |
| **T1 — work now** | open unblocked tasks exist (B3 passed) | `/sp:dev-refineall --feature <id> --auto --depth ready` **only**. Never decompose — a T1 feature has a live frontier by construction, so a second decomposition manufactures duplicates. |
| **T2 — unblock first** | gated on a blocker | **Refuse.** Name the blocker and its owner. Tasks created under a blocked feature cannot run. |
| **T4 — stale-done** | post-sync status would be `done` | **Refuse.** Route to `/sp:dev-wrapall --feature <id>` or the sync-first block; the work is finished, not startable. |

### The confirmation — interactive by default, auto-accepted under `--auto`

| Rule | Detail |
| --- | --- |
| Default offer | The rank-1 candidate. Without `--auto`, the operator may confirm it, name another candidate from the report, or decline. |
| `--task <feature-id>` | An explicit id becomes the offered target (skips the *default-offer* step). Without `--auto` it still requires confirm; with `--auto` the named id is auto-accepted. |
| `--auto` | **Two effects:** (1) auto-accept the offered target — rank-1 for bare `--task`, or the explicit `--task <feature-id>` — without a HITL pause; (2) forward into the dispatched children (`dev-plan --auto`, `dev-refineall --auto`). Passing `--auto` is operator **pre-consent** to take the ranking's recommendation (streamline path); it does **not** invent a different target, and it does **not** bypass T2/T4 refuse or invalid-AC stop. Without `--task`, `--auto` is a no-op (ranking-only has no HITL). |
| Report the accept | When `--auto` accepts, print a one-line note: `auto-accepted target <id> (tier <Tn>) via --auto` so the transcript records the decision. |
| Refusal | Declining (interactive path only) ends the run at the report. Nothing is written. |

**Why this is not a Principle #5 taste auto-click.** The ranking already produced the recommendation;
`--auto` only skips the *proceed-with-offer* pause. Overriding the ranking (picking a non-offered
candidate) still requires the interactive confirm path. Architecture / design-approval taste gates
inside dispatched children remain governed by their own contracts (`--approve-taste` where applicable).

### What `--task` does not change

The defect half is untouched: still no `spur feature move`, still nothing written under
`docs/features/**`, still `/sp:dev-featurechange` as the sole applier of structure proposals. `--task`
adds one gated path to `docs/tasks*/`, through commands that own their own gates.

## Where outputs go

| Output | Destination |
| --- | --- |
| Ranked frontier + gated list | stdout report (markdown table; `--json` envelope if the flag is passed) |
| Defect proposals | stdout; optionally appended to `docs/plans/feature-tree-restructure-map.md` |
| "Sync first" block | top of report when the dry-run proposes frontier changes |
| Winner handoff | printed `/sp:dev-next <id>` hint — operator runs it |
| `--task` dispatch | after confirm (interactive) or auto-accept (`--auto`): `/sp:dev-plan` and/or `/sp:dev-refineall`, which write `docs/tasks*/` through their own gates |
