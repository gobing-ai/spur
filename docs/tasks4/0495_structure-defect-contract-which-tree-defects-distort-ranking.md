---
template: brainstorm
schema_version: 1
name: "Structure-defect contract: which tree defects distort ranking, and the proposal artifact /sp:dev-featurechange consumes"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: ["0493"]
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.751Z"
updated_at: "2026-08-10T01:00:24.358Z"
---

## 0495. Structure-defect contract: which tree defects distort ranking, and the proposal artifact /sp:dev-featurechange consumes

### Background
**Type:** `wayfinder:research` · **Map:** H12 · **Depends:** 0493

The operator's second ask — *"leverage it to improve the feature tree structure if needed"* — lands on
a surface F31 already owns. The charting decision was **propose, never apply**. This ticket makes that
boundary concrete enough to implement.

**Verified terrain (re-verified 2026-08-10 against this tree):**

- **The apply half is built and dogfooded.** `plugins/sp/commands/dev-featurechange.md` executes
  dispositions from a mapping file: free-digit preflight → `spur feature move <old> --parent <new>
  --dry-run --json` walked in apply order → confirm → apply, with task `feature_id` edges cascading
  (`dev-featurechange.md:47-104`). It explicitly "does not invent hierarchy" (`:12`).
- **The mapping-file schema already exists.** `docs/plans/feature-tree-restructure-map.md` carries
  `## Schema`, `## Completeness inventory (every root A–R)`, `## Rejected merges (do not apply as
  merge-into)`, `## Recommended apply order`, `## Source`, and `## Applied mapping (dogfood
  2026-07-28)`. The handoff artifact must conform, not invent a second schema.
- **F31's root audit (ticket 0356) is settled** — keep 11 roots; reparent K,L→J; N,O→H; P→D; Q,R→F;
  the B∪H merge and the J∪K body-merge were **rejected with reasons**. Re-auditing root structure is
  out of scope; this ticket is about defects that **distort ranking**, a narrower question.

**Three live defects found while verifying the above — these are the seed test cases, not hypotheticals:**

1. **Letters are recycled; the mapping file is not a picture of the current tree.** The applied
   mapping records `K → J1` and `N → H4` (2026-07-28). Yet a **new** `K` ("Features module (Spur
   Board)") was created 2026-07-29 and a **new** `N` on 2026-08-06. Any detector that reads
   `## Applied mapping` as current state will re-propose moves for features that no longer exist and
   mis-identify the live ones. R6 exists because of this.

2. **`K` and `F8` are a live near-duplicate.** `K` — *"Own the Spur Board **Features** product surface
   … Features module UI (tree, detail, lifecycle actions) … without absorbing Planning CLI/corpus
   ownership (root F)"*. `F8` — *"Manage the feature corpus from the Spur Board — a web module
   rendering the docs/features ID tree with status badges, a detail panel … lifecycle transitions"*.
   Both are the Features web module, at two tree positions, both `backlog` `P2`. One body of work
   counted twice is a textbook rank distortion — and note F31 rejected the *J∪K body-merge*, which is
   a different pair, so this is not a re-litigation of a settled call.

3. **The `group` tag is not a reliable container marker.** Roots `A–H` carry `tags: [group]`; roots
   `I, J, K, M, N` do not — yet `J` and `K` have children just as `F` does. Any traversal filtering on
   the `group` tag (as the charting count did) treats containers as rankable work items. A container
   ranked as a work item is a rank distortion produced purely by tree metadata.

- **`routing-table.md:84-87`** (rows B4–B7) already classify feature-level defects — missing AC, zero
  tasks, all-children-done-but-open, mixed cancelled/done. These are hygiene routes with existing
  owners; they are not restructure proposals, and the boundary against them is R2.

The sharp question: **which tree defects actually corrupt a ranking**, as opposed to merely being
untidy? Untidiness that does not move a rank is not this command's business — reporting it is noise
that trains the operator to ignore the output.
### Requirements
- R1 — Define the detection set: which feature-tree structural defects measurably distort a ranking produced by 0493's rubric. Each entry states the defect, the signal it corrupts, and the direction of the error. A defect that does not move a rank is excluded by construction.
- R2 — Draw the line against `routing-table.md:84-87` (rows B4–B7): state per defect class whether it is an existing next-router hygiene route (defer), a ranking-distorting structural defect (own it), or both — and how the command avoids reporting the same feature twice through two mouths.
- R3 — Confirm the handoff artifact conforms to the existing `docs/plans/feature-tree-restructure-map.md` schema (`## Schema`, `## Completeness inventory`, `## Rejected merges`, `## Recommended apply order`) rather than a new format, or state with evidence why that schema cannot carry ranking-derived proposals.
- R4 — Establish the confirmation boundary end to end: what dev-find-next writes (if anything), what it hands over, and where `/sp:dev-featurechange --dry-run` picks it up — such that no path exists from dev-find-next to a mutated feature tree without the operator passing through featurechange's confirm step.
- R5 — Specify the false-positive discipline: what evidence a proposed defect must carry to be emitted at all, mirroring the reproducible-evidence contract in `sp:conflict-finding`'s `finding-contract.md`. State what the command does when it finds nothing — silence is a valid and expected outcome.
- R6 — Rule on whether F31's already-applied dispositions (ticket 0356, dogfooded 2026-07-28) are re-derived on each run or read as settled, so the command does not re-propose merges the operator already rejected.
### Acceptance Criteria
```gherkin
Feature: 0495 wayfinder investigation

  Scenario: R1 — only rank-distorting defects qualify
    Given the surviving-signal list from ticket 0493
    When the detection set is defined
    Then each defect names the signal it corrupts and the direction of the error
    And no defect is included on tidiness grounds alone
    And a defect justified only by a signal 0493 rejected is dropped

  Scenario: R2 — no feature is reported through two mouths
    Given routing-table rows B4 through B7 already route feature-level hygiene
    When each defect class is compared against those rows
    Then every row carries a defer, own, or both verdict
    And a de-duplication rule states which surface speaks when both could

  Scenario: R3 — the proposal reuses the existing mapping schema
    Given docs/plans/feature-tree-restructure-map.md defines the mapping schema
    When the handoff artifact is specified
    Then it conforms to that schema
    Or the task body states with evidence why that schema cannot carry ranking-derived proposals

  Scenario: R4 — no path to a mutated tree bypasses confirmation
    Given the handoff contract between dev-find-next and /sp:dev-featurechange
    When the boundary is traced end to end
    Then every write to docs/features routes through featurechange's dry-run and confirm step
    And dev-find-next itself performs no spur feature move

  Scenario: R5 — silence is a valid outcome
    Given a feature tree with no rank-distorting structural defects
    When the command runs
    Then it emits no proposal
    And every proposal it would emit carries reproducible evidence per the finding-contract pattern

  Scenario: R6 — settled dispositions and recycled letters are handled
    Given F31 ticket 0356 rejected the B-union-H merge and the J-union-K body-merge
    And the applied mapping records K to J1 while a different live K exists
    When the detector runs against the current tree
    Then it does not re-propose those rejected merges
    And it resolves candidates against live features rather than historical old_id values
```
### Q&A
**Closed during charting (2026-08-09) — map `### Decisions so far`:**

- *Does `/sp:dev-find-next` apply tree changes?* **No.** Propose only; `/sp:dev-featurechange` + F31
  own dry-run → confirm → apply. One writer per surface. This is the ticket's central constraint.
- *Does it re-audit root structure?* **No.** F31 ticket 0356 did that. This ticket is bounded to
  defects that distort ranking.

**Closed during this refine (2026-08-10):**

- *Is `docs/plans/feature-tree-restructure-map.md` a picture of the current tree?* **No — it is a
  historical record, and letters are recycled.** `K → J1` and `N → H4` were applied 2026-07-28, then
  a new `K` (2026-07-29) and a new `N` (2026-08-06) were allocated. Detection must resolve against
  live features. Promoted to a Design anti-pattern and R6.
- *Is there a real rank-distorting defect in this tree today, or is the whole detection half
  speculative?* **Real.** `K` ("Features module (Spur Board)") and `F8` ("Features board module")
  are both the Features web module, both `backlog` `P2`, at two tree positions. Seeded into Artifact A.
- *Is the `group` tag a reliable container marker?* **No.** `A–H` carry it; `I, J, K, M, N` do not,
  though `J` and `K` have children. Third seed case.

**Deferred with owner — operator (map `### Open questions`), do not settle inside this ticket:**

- **OQ1 — dispatch or report.** Determines whether the proposal is emitted inline or handed off as a
  file path. Artifact C states the contract for **both** readings rather than guessing.
- **OQ3 — ranking unit.** If the operator widens the unit beyond features, the tree properties that
  can be malformed widen with it. This ticket proceeds on **features only**, matching 0493.

**Assumption stated for the record:** the K/F8 overlap is recorded as a *detected candidate defect*,
not as an accepted disposition. Whether K and F8 actually merge is F31's call through
`/sp:dev-featurechange`, not this ticket's — consistent with the propose-never-apply boundary. This
ticket must not "fix" it in passing.
### Design
**WHAT** — A detection-and-handoff contract. Deliverable is three artifacts in `### Solution`: the
**defect set**, the **boundary table** against routing-table B4–B7, and the **handoff contract**
(what is emitted, in what schema, consumed where). No production code ships from this ticket.

**WHY** — "Improve the tree structure" is unbounded as stated. Bounded by ranking, it becomes
answerable: a defect qualifies only if it measurably moves a rank. Without that bound the command
emits tidiness findings, and an operator who learns to skim the output has lost the ranking too.

**WHERE** — Read-only across `docs/features/**`, `docs/plans/feature-tree-restructure-map.md`,
`plugins/sp/commands/dev-featurechange.md`, `plugins/sp/skills/next-router/references/routing-table.md`,
and `plugins/sp/skills/conflict-finding/references/finding-contract.md`. Writes go **only** to this
task's `### Solution` / `### Testing` sections.

**No new API.** No schema, verb, or command is created or modified. Frozen artifact shapes:

*Artifact A — defect set.* One row per defect class:
`defect | signal it corrupts | direction of error | detection method | seed case`.
The **signal it corrupts must come from 0493's surviving-signal list** — a defect against a signal
0493 rejected does not qualify, by construction. Each row cites a real example from this tree where
one exists; the three verified in Background are the starting set, not the whole set.

*Artifact B — boundary table.* One row per routing-table row B4–B7:
`row | next-router's route | is it also a rank-distorting structural defect? | verdict (defer / own / both) | de-duplication rule`.
The de-duplication rule is the load-bearing column: when both surfaces have something to say about
one feature, exactly one says it.

*Artifact C — handoff contract.* States: what `/sp:dev-find-next` writes (if anything), the emitted
proposal's conformance to the existing mapping-file schema, where `/sp:dev-featurechange --dry-run`
picks it up, and the evidence bar each proposed defect must clear to be emitted at all.

**Detection method — bounded, in this order:**

1. Take 0493's surviving signals. For each, ask what tree property it reads (parentage, child-task
   set, tags, `## Tasks` table freshness).
2. For each such property, name the malformation that corrupts it and the direction of the error
   (inflates rank / suppresses rank / hides the feature entirely).
3. Discard any malformation with no corrupting path to a surviving signal.
4. For each survivor, find a live instance in this tree or state that none exists.

**Anti-patterns — do not implement these:**

- Reading `## Applied mapping` as the current tree. Letters are recycled (Background finding 1);
  resolve against live features, never against historical `old_id` values.
- Re-proposing the B∪H merge or the J∪K body-merge — F31 ticket 0356 rejected both with reasons.
- Emitting tidiness findings with no path to a rank change.
- Inventing a second proposal schema when `docs/plans/feature-tree-restructure-map.md` already
  defines `## Schema` / `## Rejected merges` / `## Recommended apply order`.
- Any `spur feature move` from this command, in this ticket or the graduated implement work.
  Detection proposes; `/sp:dev-featurechange` applies. That is the whole boundary.
- Treating "no defects found" as a failed run. Silence is the expected steady state.

**Handoff from dependency** — consumes **0493** Artifact B (surviving-signal list). If 0493 rejects a
signal, every defect row justified only by that signal is dropped, not rewritten.

**Handoff to dependents** — the graduated implement tickets (currently fog) build the detector to this
contract. `/sp:dev-featurechange` is an existing consumer whose input schema is fixed; this ticket
conforms to it and must not propose changing it.
### Plan
- [ ] Read 0493's Artifact B and take the surviving-signal list as the bound; drop any candidate defect with no corrupting path to a surviving signal (R1)
- [ ] For each surviving signal, name the tree property it reads and the malformation that corrupts it, with the direction of the error; write Artifact A seeded with the three verified live cases (R1)
- [ ] Compare each defect class against routing-table rows B4–B7 and assign defer / own / both, with an explicit de-duplication rule so one feature is never reported twice; write Artifact B (R2)
- [ ] Confirm the emitted proposal conforms to the existing `docs/plans/feature-tree-restructure-map.md` schema, or state with evidence why that schema cannot carry ranking-derived proposals (R3)
- [ ] Trace the confirmation boundary end to end and state what dev-find-next writes, what it hands over, and where `/sp:dev-featurechange --dry-run` picks it up; write Artifact C (R4)
- [ ] Specify the evidence bar per emitted defect against `conflict-finding/references/finding-contract.md`, and state the no-findings behaviour explicitly (R5)
- [ ] Rule on re-derivation vs settled-reading of F31's dispositions, accounting for recycled letters so historical `old_id` values are never matched against live features (R6)
- [ ] Write Artifacts A/B/C into `### Solution` and verification notes into `### Testing` via `spur task update --section`

**Verification intent:** no code ships, so verification is evidential. Every defect row cites the
signal it corrupts and a live instance (or an explicit "none in this tree"); every boundary row cites
its routing-table row. The K/F8 near-duplicate, the recycled-letter trap, and the inconsistent `group`
tagging are the three regression cases the contract must handle — a contract that misses any of them
fails R1.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Map: [H12 Feature frontier prioritizer](../features/H12_feature-frontier-prioritizer-derived-importance-urgency-ranking-and-structure-defect-proposals.md)
- Dependency: **0493** ranking-model spike — Artifact B (surviving-signal list) bounds R1
- `plugins/sp/commands/dev-featurechange.md:12` — "does not invent hierarchy"; `:47-104` — free-digit preflight, dry-run walk, apply order (R4)
- `docs/plans/feature-tree-restructure-map.md` — `## Schema`, `## Rejected merges`, `## Recommended apply order`, `## Applied mapping (dogfood 2026-07-28)` (R3, R6)
- [F31 Feature tree restructure kit](../features/F31_feature-tree-restructure-kit-audit-hierarchy-guide-and-sp-dev-featurechange.md) — owns apply; ticket 0356 owns the settled root dispositions (R6)
- `plugins/sp/skills/spur-cli/references/features/hierarchy-mece.md` — MECE root rules; the hierarchy SSOT any structural claim must agree with
- `plugins/sp/skills/next-router/references/routing-table.md:84-87` — rows B4–B7, existing feature-level hygiene routes (R2)
- `plugins/sp/skills/conflict-finding/references/finding-contract.md` — the reproducible-evidence bar R5 mirrors
- Seed cases in this tree: `K` vs `F8` (near-duplicate), recycled `K`/`N` letters, `group` tag present on A–H but absent on I/J/K/M/N
### History
