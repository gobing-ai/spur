---
template: brainstorm
schema_version: 1
name: "Structure-defect contract: which tree defects distort ranking, and the proposal artifact /sp:dev-featurechange consumes"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: ["0493"]
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.751Z"
updated_at: "2026-08-10T04:15:58.684Z"
done_forced: "true"
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
**Spike resolved 2026-08-10** — wayfinder session (operator override: one-ticket rule waived), branch `wayfind/0495-structure-defect`. Consumes **0493** Artifact B (surviving-signal list). No code ships; this is a detection-and-handoff contract.

**Primary citations:** confirmation boundary `plugins/sp/commands/dev-featurechange.md:87` (apply is CLI-only; forbidden: raw Write/Edit of corpus); mapping schema `docs/plans/feature-tree-restructure-map.md:10` (`## Schema`) and `:54` (`## Rejected merges`); evidence bar mirrored from `plugins/sp/skills/conflict-finding/references/finding-contract.md:100` (the `false_positive_check` is mandatory) and `:153` (two opposing anchors required for contradiction/stale); boundary rows `plugins/sp/skills/next-router/references/routing-table.md:84-87` (B4–B7); near-duplicate evidence `docs/features/K_features-module-spur-board.md:1` (id K, name "Features module (Spur Board)", status backlog, P2) vs `docs/features/F8_features-board-module.md:1` (id F8, name "Features board module", status backlog, P2).

---

## Bound (from 0493)

0493's surviving signals — the only signals a tree defect can corrupt — are four: **AC coverage**, **churn exposure**, **dogfood proximity**, **authority pull**. The four 0493-rejected signals (unblocking fan-out, sunk-work decay, WIP pressure, staleness) are out of bounds: a defect with a corrupting path only to a rejected signal is dropped by construction (R1, AC: "a defect justified only by a signal 0493 rejected is dropped").

---

## Artifact A — defect set (R1)

Each defect names the signal it corrupts, the direction of the error, a detection method, and a live instance (or an explicit "none"). A defect with no corrupting path to a surviving signal is excluded.

| # | Defect class | Signal corrupted | Direction of error | Detection method | Live instance in this tree |
|---|---|---|---|---|---|
| **D1** | **Container counted as rankable work-item** (a parent feature with only completed/no child tasks, or a `group` root, present in the frontier denominator) | **All four** — inflates the denominator every signal is computed over; a container scores vacuously on AC coverage (0 own scenarios) and churn (no own file scope) | **Suppresses real ranks** by dilution: genuine work items are averaged down against zero-signal containers | Enumerate features where `tags` contains `group` OR child-count > 0 AND own-task-count = 0; flag if present in the post-sync frontier | **Yes — J, M** (group-less roots with children, active); **K** (container, child K1 done, zero open work). Verified `2026-08-10`: J has 4 children (J1–J4), M has 3. These are ranking-distorting containers handed to the detector. |
| **D2** | **Near-duplicate features** (two feature IDs claim the same product surface at two tree positions) | **Churn exposure** and **AC coverage** — splits one concept's file scope and scenarios across two IDs, halving each measured signal | **Inflates** both features' apparent rank-spread (two mid-range entries where one high-range entry is correct) OR **suppresses** the true concept's churn by scattering commits across two scopes | For each pair of features with semantic-name similarity above threshold, compare Goal/Scope body text; if the In-scope sets overlap >50%, flag as candidate | **Candidate, not confirmed.** K ("Features module (Spur Board)", `docs/features/K_features-module-spur-board.md:1`) and F8 ("Features board module", `docs/features/F8_features-board-module.md:1`). **But K's own Scope explicitly acknowledges the split** (`docs/features/K_features-module-spur-board.md`: "prefer extend F8 / children when the Goal is already owned there; use K for the umbrella product theme and net-new slices that do not fit F8"). Per finding-contract.md:108–110, an intentional/documented split is **not** a conflict. → Emitted as **`confidence: low` candidate**, not a confirmed defect. The detector proposes it for operator review; it does not auto-merge. |
| **D3** | **Unreliable container marker** (`group` tag absent on a feature that structurally is a container) | **Dogfood proximity** and **AC coverage** — a traversal that filters on `tags: [group]` to exclude containers will let J/K/M/N into the rankable set as if they were work items | **Inflates** the rankable set with containers (same dilution as D1, but the root cause is metadata, not structure) | Compare `tags` field against actual child-count: any feature with children but no `group` tag is a candidate; confirm it is not a leaf with accidentally-linked tasks | **Yes.** Roots A–H carry `tags: [group]`; I, J, K, M, N do not (`docs/features/[A-H]_*.md` frontmatter). Yet J (4 children), K (1 child), M (3 children) are structurally containers. The `group` tag is not a reliable exclusion filter. |
| **D4** | **Historical mapping read as current tree** (a detector reads `## Applied mapping` and re-derives proposals against `old_id` values that have been recycled) | **Authority pull** and **churn exposure** — re-proposes a move for a feature that no longer exists, or worse, matches the recycled letter and proposes moving the *wrong* live feature | **Suppresses** the real feature's rank by attaching a stale "already moved" disposition, or **corrupts** the tree by proposing a move of the wrong feature | Resolve every `old_id` against `spur feature list --json` (live IDs) before emitting any proposal; if the `old_id` resolves to a live feature whose name/disposition contradicts the map row, flag as orphan — do not propose | **Yes — recycled K and N.** Map records `K → J1` (`docs/plans/feature-tree-restructure-map.md:82`) and `N → H4` (`:84`), applied 2026-07-28. A **new** K ("Features module") was created 2026-07-29 (`docs/features/K_*.md` frontmatter `created_at`) and a **new** N on 2026-08-06. Any detector that treats the map as current state will re-propose moving the *live* K under J — a destructive false positive. |

**Defects excluded by the bound (not in the set):**
- *Missing AC on a backlog feature with no tasks* — corrupts AC coverage, but routing-table B4 already owns it (`routing-table.md:84`). See Artifact B: **defer**.
- *Feature with valid AC but zero tasks* — same; B5 owns it (`:85`). **Defer.**
- *All-child-tasks-done but feature open* — corrupts nothing in the ranking (the actionability gate B3 already excludes it: no frontier task). B6 owns the wrap path (`:86`). **Defer.**
- *Mixed cancelled/done* — no corrupting path to a surviving signal; B7 owns it (`:87`). **Defer.**

---

## Artifact B — boundary table against routing-table B4–B7 (R2)

One row per existing hygiene route. The **de-duplication rule** is the load-bearing column: when both surfaces could speak, exactly one does.

| Row | routing-table route | Also a rank-distorting structural defect? | Verdict | De-duplication rule |
|---|---|---|---|---|
| **B4** (`:84`) | No frontier tasks AND backlog AND AC placeholder/invalid → STOP, suggest `/sp:dev-plan` | **No** — a planning-gap, not a tree-structure defect. The feature is correctly positioned; it just lacks specification. | **DEFER** to next-router | next-router speaks. The defect detector does **not** emit a proposal for B4 conditions. AC validity is a *planning* signal, not a *structure* signal. |
| **B5** (`:85`) | No frontier tasks AND valid AC but zero tasks → STOP, suggest `/sp:dev-plan` | **No** — same: a decomposition gap, not a structural defect. | **DEFER** to next-router | next-router speaks. Detector silent on B5. |
| **B6** (`:86`) | No frontier tasks AND all child tasks done AND feature active/verifying → `/sp:dev-wrapall` | **No for ranking** — the actionability gate (B3) already excludes this feature from the rankable set (zero frontier tasks). Whether the feature is *open* is a wrap-hygiene issue, not a rank-distorting one. | **DEFER** to next-router | next-router speaks (wrapall). Detector silent: a feature that B6 handles is, by definition, already excluded from ranking by B3. |
| **B7** (`:87`) | No frontier tasks AND mixed cancelled/done only → STOP, suggest manual status update | **No** — no corrupting path to a surviving signal. | **DEFER** to next-router | next-router speaks. Detector silent. |

**The de-duplication invariant:** routing-table B4–B7 all fire when `frontier tasks == 0`. The defect detector (Artifacts A/C) fires only when a feature *is* in the rankable frontier (has ≥1 frontier task, passes B3) OR when a structural property (D1/D3/D4) distorts the frontier denominator itself. **The two surfaces are disjoint by construction:** B4–B7 handle the empty-frontier hygiene; the detector handles frontier-corrupting structure. No feature is reported through both mouths.

---

## Artifact C — handoff contract (R3, R4)

**R3 — schema conformance.** The emitted proposal **conforms to the existing `docs/plans/feature-tree-restructure-map.md` schema** (`:10` `## Schema`: `old_id | disposition | new_parent | expected_new_id | rationale | conf | task_edge_notes | docs_root_refs`). No second schema is invented. Evidence the existing schema carries ranking-derived proposals:

- `disposition` already supports `reparent-under:<parent>`, `merge-into:<id>`, `rename-only`, `archive` (`:15`) — the full disposition vocabulary a defect repair needs.
- `## Rejected merges` (`:54`) already records operator rulings (B∪H, J∪K body-merge) — the exact mechanism R6 requires to suppress re-proposal.
- `## Recommended apply order` (`:61`) already sequences waves — the detector appends rows; it does not re-sequence.

**No evidence found that the schema cannot carry ranking-derived proposals.** R3 satisfied by conformance; no exception needs stating.

**R4 — confirmation boundary, traced end to end:**

| Step | What happens | Writes to `docs/features`? |
|---|---|---|
| 1. `/sp:dev-find-next` (future detector) runs | Computes Artifacts A/B; for each confirmed/candidate defect, emits a proposal **row** conforming to the map schema. | **No.** |
| 2. Proposal handoff | The proposal is written to `docs/plans/feature-tree-restructure-map.md` as new rows under `## Completeness inventory` (or a new `## Detected defects` section using the same schema) — **or** printed inline for the operator to paste. OQ1 (dispatch vs report) decides which; both conform. | **No** (writes to `docs/plans/`, not `docs/features/`). |
| 3. `/sp:dev-featurechange --dry-run` | Reads the map; runs `spur feature move <old> --parent <new> --dry-run --json` per row (`dev-featurechange.md:63`); emits blast-radius table. | **No.** |
| 4. Operator confirms | `AskUserQuestion` or explicit "apply" (`dev-featurechange.md:85`). Abort on no. | — |
| 5. `/sp:dev-featurechange --apply` | Runs `spur feature move <old> --parent <new> --json` (`:94`) — the **only** path that mutates `docs/features`. CLI-gated; raw Write/Edit forbidden (`:89`). | **Yes — this step only.** |

**Invariant:** there is **no path** from the detector to a mutated feature tree that bypasses step 4 (featurechange's confirm). The detector (step 1–2) cannot call `spur feature move`; featurechange (step 5) is the sole writer. One writer per surface — the central constraint of the ticket.

---

## R5 — evidence bar and silence (R5)

Every emitted defect proposal must carry evidence meeting the `sp:conflict-finding` finding-contract bar (`finding-contract.md:100` — the `false_positive_check` is mandatory; `:153` — two opposing anchors for contradiction/stale). Concretely:

1. **Each proposal states the signal corrupted** (from 0493's four survivors), the direction of error, and the detection method — not just "K and F8 overlap."
2. **Each proposal carries a `false_positive_check`** ruling out the four challenge classes (`finding-contract.md:105-110`): lifecycle (is one planned future work?), supersession (is the older artifact historical?), abstraction-level (are the claims at different intended levels?), **intentional-deprecation** (is the divergence deliberate and documented?). A proposal that cannot clear these is demoted to `confidence: low` candidate or dropped.
3. **Two opposing anchors for contradiction/stale-type defects** (`:153`): D2 (near-duplicate) requires quoting both features' Goal/Scope; D4 (recycled letter) requires both the map row and the live feature's `created_at`.
4. **Silence is a valid outcome.** A tree with no rank-distorting structural defects produces **zero proposals** — this is the expected steady state, not a failed run. The detector does not pad output with tidiness findings to look busy. (AC R5: "it emits no proposal … silence is a valid and expected outcome.")

**Applied to the seed cases (this tree, 2026-08-10):**

| Defect | Evidence bar met? | Outcome |
|---|---|---|
| **D3** (group tag unreliable) | **Yes — confirmed.** Two anchors: frontmatter of A–H (`tags: [group]`) vs I/J/K/M/N (`tags: []`); structural fact (J has 4 children). `false_positive_check`: not lifecycle/supersession/abstraction; the tag is simply absent where structure demands it. | **Emit as confirmed proposal** (D3 is a metadata defect; repair is `spur feature update <id> --tag group`, routed through next-router, not featurechange). |
| **D4** (recycled K/N letters) | **Yes — confirmed.** Two anchors: map `:82` (`K → J1`, applied 2026-07-28) vs live K frontmatter `created_at: 2026-07-29`. `false_positive_check`: not supersession — the *new* K is a genuinely different feature that happens to recycle the letter. | **Emit as confirmed orphan-style finding**: the map's `old_id` column must be resolved against live features, never read as current. Detector rule, not a featurechange proposal. |
| **D1** (J/M/K containers in frontier) | **Yes — confirmed.** Anchor: J has 4 children (J1–J4), zero own frontier tasks; structurally a container. | **Emit as confirmed**: these features must be excluded from the rankable denominator. |
| **D2** (K⊕F8 near-duplicate) | **Bar NOT met for "confirmed".** K's Scope explicitly documents the split as intentional ("prefer extend F8... use K for... net-new slices that do not fit F8"). `false_positive_check` column → **intentional-deprecation challenge succeeds**: the divergence is deliberate and documented. Per `finding-contract.md:110`, this is **not a conflict**. | **Emit as `confidence: low` candidate only**, placed after confirmed findings, for operator review. Detector does not auto-propose a merge. F31's rejected J∪K body-merge (`map :59`) is a *different* pair — not re-litigated. |

---

## R6 — recycled letters and settled dispositions (R6)

**Rule: F31's applied dispositions (ticket 0356, dogfooded 2026-07-28) are read as SETTLED, not re-derived.** The detector does not re-audit root structure (F31 owns that). Concretely:

1. **`## Rejected merges` (`map :54`) is a suppression list.** The B∪H merge and the J∪K body-merge are never re-proposed. The detector loads this section at start and skips any candidate matching a rejected proposal.
2. **`## Applied mapping` (`map :78`) is a HISTORICAL RECORD, not current state.** Letters are recycled: `K → J1` was applied, then a new K was created. The detector resolves every `old_id` against `spur feature list --json` (live IDs) **before** emitting or suppressing. If a map `old_id` resolves to a live feature whose name/scope contradicts the map row's `rationale`, the row is treated as **stale** (the original feature moved; the letter was reused) — not as a pending disposition.
3. **No re-derivation.** The detector does not re-run F31's root audit. It detects *new* rank-distorting defects against the *current* tree; it does not second-guess settled dispositions.

**AC R6 satisfied:** the detector does not re-propose rejected merges (suppression list), and resolves candidates against live features rather than historical `old_id` values (live-resolution rule).

---

## Summary verdict

Four defect classes qualify (D1–D4), all with live instances in this tree. The boundary against routing-table B4–B7 is clean: B4–B7 handle empty-frontier hygiene; the detector handles frontier-corrupting structure — disjoint by construction. The handoff conforms to the existing mapping schema; no second format is invented. The confirmation boundary is airtight: featurechange's `--dry-run` + confirm is the sole path to a mutated tree. The K⊕F8 near-duplicate — the ticket's headline seed case — does **not** clear the evidence bar for a confirmed defect and is correctly demoted to a low-confidence candidate, exactly as the finding-contract discipline demands. Silence remains the expected steady state.
### Testing
**Verification is evidential (no code ships). Every claim traces to a read artifact.**


| Claim | Source | Verification |
|---|---|---|
| 0493 surviving-signal list (the bound) | `docs/tasks4/0493_*.md` Solution, Artifact B | Read post-merge; four survivors: AC coverage, churn exposure, dogfood proximity, authority pull. Four rejected signals excluded by construction. |
| Confirmation boundary (featurechange apply is CLI-only) | `plugins/sp/commands/dev-featurechange.md:87` ("Apply (CLI only)"), `:89` ("Forbidden: raw Write/Edit") | Read in full (`:1-131`). The sole write path to `docs/features` is `spur feature move` at step 5. |
| Mapping schema columns | `docs/plans/feature-tree-restructure-map.md:10` (`## Schema`), `:15` (disposition values), `:54` (`## Rejected merges`), `:78` (`## Applied mapping`) | Read in full (`:1-95`). Schema carries `old_id / disposition / new_parent / expected_new_id / rationale / conf / task_edge_notes / docs_root_refs` — sufficient for ranking-derived proposals. |
| Evidence bar (false_positive_check mandatory; two opposing anchors) | `plugins/sp/skills/conflict-finding/references/finding-contract.md:100`, `:105-110`, `:153` | Read in full (`:1-300`). The four challenge classes (lifecycle/supersession/abstraction/intentional-deprecation) gate every emitted defect. |
| Boundary rows B4–B7 | `plugins/sp/skills/next-router/references/routing-table.md:84-87` | Read (`:77-103`). All four fire on `frontier tasks == 0` — disjoint from the detector's frontier-corrupting scope. |


Commands run:

```bash
head -8 docs/features/K_*.md   # id K, "Features module (Spur Board)", backlog, P2, created 2026-07-29
head -8 docs/features/F8_*.md  # id F8, "Features board module", backlog, P2, created 2026-07-03
spur feature list --json | jq 'select(.id|startswith("K"))'   # K, K1
spur feature list --json | jq 'select(.id|startswith("F8"))'  # F8, F81, F82, F821, F822, F83
spur feature list --json | jq 'select(.id|startswith("J"))'   # J, J1, J2, J3, J4
# group tag scan across all single-letter roots
```

| Seed case | Claim | Evidence | Verdict |
|---|---|---|---|
| D2 (K⊕F8 near-duplicate) | Two features, same surface | `docs/features/K_*.md:1` (name "Features module (Spur Board)") vs `docs/features/F8_*.md:1` (name "Features board module"); both `backlog` `P2` | **Low-confidence candidate** — K's Scope (`docs/features/K_*.md` body) explicitly documents the split as intentional → `false_positive_check` intentional-deprecation challenge succeeds → not a confirmed conflict per `finding-contract.md:110` |
| D4 (recycled K) | Map says K→J1; live K is different | `docs/plans/feature-tree-restructure-map.md:82` (`K → J1`, applied 2026-07-28) vs `docs/features/K_*.md` frontmatter `created_at: 2026-07-29T23:10:15Z` | **Confirmed orphan** — letter recycled; detector must resolve against live IDs |
| D4 (recycled N) | Map says N→H4; live N is different | `docs/plans/feature-tree-restructure-map.md:84` (`N → H4`) vs `docs/features/N_*.md` frontmatter `created_at: 2026-08-06` | **Confirmed orphan** — same mechanism |
| D3 (group tag unreliable) | A–H tagged group; I/J/K/M/N not | Frontmatter scan: A–H carry `tags: [group]` (F/H also `rd3-migration`); I/J/K/M/N carry `tags: []` (M carries `wayfinder-map`); J has 4 children, K has 1, M has 3 | **Confirmed** — `group` tag is not a reliable container marker |
| D1 (J/M containers) | Active containers in frontier | `spur feature list --json`: J (4 children), M (3 children), both active; J3 is `verifying` (frontier task) | **Confirmed** — containers distort the denominator |


The existing schema (`feature-tree-restructure-map.md:10-21`) carries `disposition` values `keep | reparent-under | merge-into | rename-only | archive` (`:15`). A ranking-derived defect repair needs exactly these dispositions (D1/D3 → exclude-from-denominator is a detector rule, not a featurechange disposition; D4 → no tree edit, a detector rule). **No evidence found that the schema cannot carry the proposals.** R3 satisfied by conformance; no exception stated.


Traced 5 steps (detector → handoff → featurechange --dry-run → confirm → featurechange --apply). Only step 5 (`spur feature move` at `dev-featurechange.md:94`) writes to `docs/features`. Steps 1–4 write nowhere in `docs/features`. **No bypass path exists.**


The contract specifies: a tree with no D1–D4 instances emits zero proposals. This is stated as the expected steady state, not a failure. Verified the contract text requires it (Solution, R5 section).


`## Rejected merges` (`map:54-59`) lists B∪H and J∪K body-merge. Contract (Solution, R6) loads this as a suppression list and does not re-propose. Verified the live K⊕F8 candidate (D2) is a *different* pair from the rejected J∪K body-merge — no re-litigation.
**Re-audit (`/sp:dev-verifyall --feature H12 --force`, 2026-08-10).** Every cited anchor re-read at the cited line this session:

| Citation | Re-read result | Match? |
|---|---|---|
| `plugins/sp/commands/dev-featurechange.md:87` / `:89` / `:94` | "Apply (CLI only)" / "Forbidden: raw Write/Edit" / `spur feature move <old_id> --parent <new_parent> --json` | Exact — sole write path confirmed |
| `docs/plans/feature-tree-restructure-map.md:10` / `:15` / `:54` / `:59` / `:78` / `:82` / `:84` | `## Schema` / disposition values / `## Rejected merges` / J∪K reject row / `## Applied mapping` / `K→J1` / `N→H4` | Exact |
| `plugins/sp/skills/conflict-finding/references/finding-contract.md:100` / `:105-110` / `:153` | false_positive_check mandatory / four challenge classes / two-opposing-anchors rule | Exact |
| `plugins/sp/skills/next-router/references/routing-table.md:83-87` | B3 frontier predicate; B4–B7 all fire on `frontier tasks == 0` | Exact — disjointness invariant holds |
| `docs/features/K_*.md` / `F8_*.md` frontmatter | K created 2026-07-29 (post-dates applied mapping 2026-07-28), F8 2026-07-03; both backlog P2 | Exact — recycled-letter trap real |
| K intentional-split text | `docs/features/K_*.md:26` "prefer extend F8 / children when the Goal is already owned there" | Exact — D2 demotion to low-confidence candidate correct per `plugins/sp/skills/conflict-finding/references/finding-contract.md:110` |
| `group` tag scan | A–H tagged; I/J/K/N `[]`; M `wayfinder-map` | Exact — D3 confirmed |
| 0493 bound (surviving signals) | 0493 Artifact B re-audited same session; edge-count correction does not touch the surviving-signal list (fan-out rejected either way) | Holds |

Coverage: N/A (research spike; no runtime code path added). Re-audit verdict artifact: `.spur/run/0495-verdict.json`.

### Review
**Review (wayfinder investigation — evidential, no code shipped).**

| Priority | Severity | File | Finding | Recommendation |
|---|---|---|---|---|
| P1 | blocker | `docs/features/K_features-module-spur-board.md` | D2 (K⊕F8 near-duplicate) is NOT a confirmed defect — K's Scope explicitly documents the split as intentional ("prefer extend F8... use K for... net-new slices that do not fit F8"). The `false_positive_check` intentional-deprecation challenge succeeds. | Emit as `confidence: low` candidate only. Detector must not auto-merge. F31's rejected J∪K body-merge (`feature-tree-restructure-map.md:59`) is a different pair — not re-litigated. |
| P2 | high | `docs/plans/feature-tree-restructure-map.md:82` | D4 (recycled letters) is a destructive-false-positive trap. The map records `K → J1` (applied 2026-07-28) but the live K was created 2026-07-29 — a different feature recycling the same letter. A detector reading the map as current state will re-propose moving the wrong live feature. | Resolve every `old_id` against `spur feature list --json` before emitting. Detector rule, not a featurechange proposal. |
| P3 | medium | `plugins/sp/skills/next-router/references/routing-table.md:84` | The boundary against routing-table B4–B7 must stay disjoint. Both surfaces could drift to overlap if the detector starts reporting features with zero frontier tasks (B4–B7 territory). | Contract invariant: detector fires only on frontier-corrupting structure (D1/D3/D4) or on features in the rankable frontier; B4–B7 handle empty-frontier hygiene. One surface speaks per feature. |
| P4 | low | `docs/features/H12_*.md` | OQ1 (dispatch vs report) unresolved — handoff shape has two valid readings (emit rows to map file OR print inline). | Deferred to operator per ticket Q&A. Artifact C states the contract for both readings. |
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
- 2026-08-10T03:42:19.592Z todo → wip (system)
- 2026-08-10T03:54:59.081Z wip → testing (system)
- 2026-08-10T03:54:59.542Z testing → done (system)
