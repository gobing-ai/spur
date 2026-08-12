---
schema_version: 1
id: "H12"
name: "Feature frontier prioritizer: derived importance/urgency ranking and structure-defect proposals"
status: done
priority: P2
tags: ["wayfinder-map"]
created_at: "2026-08-10T00:44:30.834Z"
updated_at: "2026-08-12T06:29:33.227Z"
---

# H12: Feature frontier prioritizer: derived importance/urgency ranking and structure-defect proposals

## Goal
Ship `/sp:dev-find-next` + skill `sp:next-feature` — a prompt-first portfolio prioritizer that answers
*"which feature should we work on now?"* by deriving importance and urgency from evidence already in the
corpus, and that emits feature-tree structure defects as a proposal `/sp:dev-featurechange` can consume.

This closes the documented gap in `sp:next-router`: `/sp:dev-next` answers *"what is the next step for
target X"* and explicitly stops with a usage error when the target is omitted
(`plugins/sp/skills/next-router/references/routing-table.md` §0 step 1c, "Non-routes"). Nothing in the
harness answers *"which X"*. With 25 open features and no ordering signal — **19 of them (76%) carry
the same `P2` priority** — the operator re-derives that judgment by hand every session.
## Scope
- In:
  - Wayfinder investigation map under **H12** (sibling of H11, same command+skill shape) until the
    prioritizer is implementable.
  - Ranking model: which importance/urgency signals are **derivable from the corpus as it stands**
    (task-completion ratio, dependency fan-out via child tasks, status age, `verifying` limbo,
    git recency, AC coverage, roadmap phase) and a rubric grounded in established prioritization
    prior art (WSJF / RICE / Eisenhower / CD3) that an LLM can defensibly apply.
  - Reuse inventory: what `sp:next-router`, `spur feature`/`spur task --json`, `spur status`, and
    `sp:conflict-finding` already provide, so the prioritizer **composes** rather than rebuilds
    (notably next-router's frontier-selection algorithm, routing-table §2 B3).
  - Structure-defect half: which feature-tree defects actually distort ranking, and the proposal
    artifact `/sp:dev-featurechange` consumes.
  - Surfaces: `plugins/sp/commands/dev-find-next.md` + `plugins/sp/skills/next-feature/**`,
    mirroring the prompt-first `dev-find-conflict` / `sp:conflict-finding` anatomy.
- Out:
  - **Applying** any feature-tree change. Detection proposes; **F31 / `/sp:dev-featurechange`** owns
    dry-run → confirm → apply. One writer per surface.
  - Adding feature frontmatter fields (`value`, `effort`, `urgency`, feature-level `blocked_by`) or any
    `packages/domain` schema / `spur feature` CLI change. The rubric derives from what exists.
  - Reimplementing `/sp:dev-next`'s within-target routing, or `task-pipeline.yaml`.
  - A web Board view of the ranking (Features module K / F8 territory).
  - Cross-repo packaging via `superskill install` — ships after the sp plugin carries the command.
## Acceptance Criteria
Map-level criteria. The destination is shipped code, so research and prototype tickets alone are not
"feature done" — closure requires `/sp:dev-verifyall --feature H12` reporting `Shippable: PASS`.

```gherkin
Feature: Feature frontier prioritizer

  Scenario: R1 — the command answers which feature, not which step
    Given a project with many open features and no target named
    When the operator runs /sp:dev-find-next
    Then a ranked frontier of candidate features is returned
    And each candidate carries the evidence that placed it at its rank
    And /sp:dev-next remains the surface for advancing an already-chosen target

  Scenario: R2 — ranking derives from the corpus as it stands
    Given the feature corpus carries no value, effort, or urgency fields
    When the prioritizer ranks the frontier
    Then every signal is derived from existing corpus, git, or authority-doc evidence
    And no feature frontmatter field, domain schema, or spur CLI verb was added to support it
    And the priority frontmatter field is not used as the ordering when it fails to discriminate

  Scenario: R3 — unactionable features are gated, not ranked
    Given a feature whose child tasks have unmet dependencies
    When the prioritizer runs
    Then that feature is excluded from the ranked frontier rather than scored
    And the reason it is unactionable is reported

  Scenario: R4 — structure defects are proposed, never applied
    Given the prioritizer detects a tree defect that distorts ranking
    When it emits the finding
    Then the output is a proposal conforming to the restructure mapping-file schema
    And /sp:dev-featurechange remains the only surface that applies it
    And the prioritizer itself performs no spur feature move

  Scenario: R5 — the surface mirrors the established prompt-first pattern
    Given plugins/sp/commands/dev-find-conflict.md and skill sp:conflict-finding as the template
    When the command and skill ship
    Then plugins/sp/commands/dev-find-next.md is a thin wrapper forwarding arguments to its skill
    And the backing skill carries its protocol and references as the SSOT
    And docs/04_DESIGN.md records the command surface in the same commit

  Scenario: R6 — the map closes only on shipped code
    Given every investigation ticket under H12 is done
    When the graduated implement tasks are verified
    Then /sp:dev-verifyall --feature H12 reports Shippable: PASS
    And "### Not yet specified" is empty or its remaining entries are consciously deferred
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0493 | Ranking-model spike: which importance/urgency signals the corpus actually yields, and does a grounded rubric order the real frontier convincingly | done |
| 0494 | Reuse inventory: what next-router, spur CLI --json, and conflict-finding already provide that dev-find-next must compose rather than rebuild | done |
| 0495 | Structure-defect contract: which tree defects distort ranking, and the proposal artifact /sp:dev-featurechange consumes | done |
| 0497 | Ship /sp:dev-find-next + sp:next-feature — prompt-first feature frontier prioritizer | done |
| 0498 | Add --task to /sp:dev-find-next — confirm the ranked winner, then dispatch the planning half to implement-ready tasks | done |
| 0523 | /sp:dev-find-next dogfood findings (2026-08-11) | done |
<!-- END AUTO-GENERATED -->

## Notes
### Destination

Ship `/sp:dev-find-next` + `sp:next-feature` — a prompt-first prioritizer that ranks the open feature
frontier by **derived** importance and urgency, shows its evidence per candidate, and emits tree
structure defects as a proposal `/sp:dev-featurechange` applies.

Charted via `/sp:dev-brainstorm --wayfind` on 2026-08-09.

### The gap this closes

`sp:next-router` is a **within-target** dispatcher: given a WBS or feature ID, which `/sp:dev-*` step
comes next. Its own routing table declares the target-omitted case out of v1 —
`routing-table.md` §0 step 1c: *"Omitted → NOT v1 (see Non-routes); stop with usage"*. So the harness
answers *"what step for X"* and nothing answers *"which X"*.

Measured state of this tree (re-verified 2026-08-10, 67 features): **34 done, 15 active, 13 backlog,
5 verifying**. Excluding the 8 `group`-tagged roots (A–H) and this map, **25 non-`done` features**
remain — P0=1, P1=5, **P2=19 (76%)**. The stored `priority` field is therefore not an ordering — it
is noise. Ranking must be derived.

*Correction:* charting recorded "19 of 24"; the denominator was a miscount. The 76% conclusion is
unchanged. Note also that 25 is an upper bound — roots `I, J, K, M, N` lack the `group` tag though
`J` and `K` have children, so the filter counts containers as work items. Settling the true rankable
set is [0493] R2.

### Candidate ranking model — hypothesis for [0493], not settled design

Written so ticket 0493 has something concrete to falsify. Every line here is a claim to test against
the real frontier, not a specification.

**Actionability is a gate, not a score.** A feature whose child tasks have unmet dependencies cannot
be worked now regardless of value. Filter first, rank second. Ranking a blocked feature to the top is
the loudest possible failure of this command.

**Importance — derivable today:**

| Signal | Derivation | Why it carries value |
|---|---|---|
| Unblocking fan-out | Walk child tasks' `dependencies[]` across feature boundaries | A feature blocking five others is worth more than its own payload. Highest-leverage signal available. |
| Dogfood proximity | Feature touches `plugins/sp/**`, `apps/cli/**`, or the pipeline | Spur develops itself with Spur. Harness improvements compound over every session after they ship. |
| Authority pull | Named in `docs/02_ROADMAP.md` current phase or an ADR | Declared intent, already reasoned about |
| AC coverage | Gherkin scenario count / `spur feature check` cleanliness | A feature with no AC is not ready to be "most valuable next" — it is most valuable to *specify* next |

**Urgency — derivable today:**

| Signal | Derivation | Why it carries urgency |
|---|---|---|
| Sunk-work decay | `verifying` status, or high done-ratio and not closed | Capital sitting idle and rotting. **5 features sit in `verifying` right now and nothing surfaces them.** Likely the loudest urgency signal in this tree. |
| WIP pressure | Count of `active` features vs. one operator | 15 active. Work that *reduces* the active count should outrank work that raises it — finish before you start. |
| Staleness | `updated_at` age on an `active` feature | An active feature untouched for weeks is either abandoned (belongs in backlog) or blocked (belongs surfaced). Either way it is a lie in the tree. |
| Churn exposure | Recent git churn in the files the feature would touch | Cost of delay is real: the longer it waits the more it costs to land |

**Composite.** Prior art (WSJF = cost-of-delay ÷ job-size; RICE; CD3) all assume estimates this corpus
does not carry. Do **not** invent numeric scores and present them as measurement. The honest form is a
**tiered rubric with explicit tie-breaks** — nearer Eisenhower quadrants plus a standing
finish-before-you-start bias — where each candidate shows the evidence that placed it, and the
operator overrides. 0493 tests whether that ordering is one the operator actually agrees with; if it
is not, the rubric is wrong, not the operator.

### Anti-patterns the design must defend against

Mirrors the evidence discipline in `sp:conflict-finding`'s `finding-contract.md`.

- Ranking by the `priority` frontmatter field. It is 19 of 25 identical (76%) — using it fakes a signal.
- Recommending a feature whose dependencies are unmet. Actionability gates.
- Emitting a score without the evidence that produced it. Every rank carries its derivation or it is
  an opinion wearing a number.
- Ignoring closure pressure — recommending a new start into a tree with 15 active and 5 verifying.
- Silent recomputation of the whole tree every run when nothing changed.
- Drifting into `/sp:dev-next`'s job (what step for a chosen target) or F31's job (applying tree edits).

### Skills every session should consult

- `sp:wayfinder` (map protocol; **one ticket per session**)
- `sp:conflict-finding` — the prompt-first command+skill template this mirrors (SKILL.md + 4 references)
- `sp:next-router` + `references/routing-table.md` — the seam, and the frontier algorithm to reuse
- `sp:spur-cli` → `features.md`, `features/hierarchy-mece.md`, `tasks.md`
- `sp:doc-evolve` when the surface lands (T3: `docs/04_DESIGN.md` same commit)

### Standing preferences

- Prompt-first. This is LLM judgment over corpus evidence, not a scoring function in TypeScript.
- Compose, never rebuild — check `sp:next-router` and `spur … --json` before writing new traversal.
- Read-only by default; any mutation routes through an owner surface (`spur feature`, `/sp:dev-featurechange`).
- Refer to features and tickets by ID **and title**, never a bare number.

### Open questions

Operator judgment — never tickets. Resolved in conversation, then moved to *Decisions so far*.

- **OQ1 — Dispatch or report?** Does `/sp:dev-find-next` chain into `/sp:dev-next` / `/sp:dev-plan` on
  the winner (a `--next` flag), or stop at the ranked report and let the operator choose? Blocks the
  command's flag table and the F31 handoff shape.
- **OQ2 — Skill name.** `sp:next-feature` (as proposed) sits one character from `sp:next-router` in
  every listing and both back a `/sp:dev-*` command about "next". Keep it, or pick something like
  `sp:feature-prioritization` / `sp:frontier-ranking`? Cosmetic but permanent.
- **OQ3 — Ranking unit.** Features only, or also unparented tasks and the `verifying` limbo? Widening
  the unit changes the signal set 0493 must inventory.

### Decisions so far

- **Boundary with F31** — `dev-find-next` **proposes** structure defects; `/sp:dev-featurechange` +
  F31 own dry-run → confirm → apply. One writer per surface. (charting, 2026-08-09)
- **Substrate** — derive from the corpus as it stands. No feature frontmatter fields, no
  `packages/domain` schema change, no `spur feature` CLI change in this effort. (charting, 2026-08-09)
- **Seam with `/sp:dev-next`** — dev-next answers "next step for target X"; dev-find-next answers
  "which X". This is next-router's documented target-omitted non-route, not an overlap. (charting)
- **Placement** — H12, sibling of H11 (semantic conflict finder), under H1. Same command+skill shape,
  same root. No new root letter for a command surface. (charting, per F31's hierarchy rule)
- **OQ1/OQ2 disposition** — shipped report-only (no dispatch chain) under the kept name `sp:next-feature`; both open questions remain operator-callable, rename/chain are additive. (0497, 2026-08-10)
- **Branch** — charted on `wayfind/find-next-feature`; the E2 session-forensics map stays uncommitted
  in the tree by operator decision. (charting, 2026-08-09)

**Verified during `--depth ready` refine (2026-08-10)** — premise checks, not ticket resolutions. No
ticket was claimed; these are recorded so the next session does not re-derive them.

- **Feature frontmatter carries no dependency field.** Keys are exactly `schema_version, id, name,
  status, priority, tags, created_at, updated_at`. Cross-feature fan-out *must* be walked through
  child tasks — that is now a requirement in [0493] R3, not one option among several.
- **Letters are recycled; the restructure mapping file is history, not current state.**
  `docs/plans/feature-tree-restructure-map.md` records `K → J1` and `N → H4` (applied 2026-07-28),
  yet a **new** `K` was created 2026-07-29 and a **new** `N` on 2026-08-06. A detector matching
  historical `old_id` values against the live tree will misfire. Seeded into [0495] R6.
- **`K` and `F8` are a live near-duplicate** — both the Features web module, both `backlog` `P2`, at
  two tree positions. This is a real rank-distorting defect in this tree today, so the detection half
  of [0495] is grounded rather than speculative. Distinct from the J∪K body-merge F31 already rejected.
- **The `group` tag is not a reliable container marker** — `A–H` carry it; `I, J, K, M, N` do not,
  though `J` and `K` have children. Any traversal filtering on it ranks containers as work items.
  Third seed case for [0495]; also why [0493]'s 25 is an upper bound.
- **[0493] closed (2026-08-10, `wayfind/0493-ranking-model-spike`).** The spike falsified the
  candidate-ranking model's implicit premise. The "25-feature frontier" is illusory: a dry-run
  `spur feature sync --all` shows 24 of 25 would advance to `done` (96% status drift), leaving only
  H12→active, G3→blocked (0197), H1→blocked (0142) as non-done. The actionable rankable set after
  sync is **empty** — H12's own 3 tasks are the only live work. The honest prioritizer output today is
  "sync first, then rank." Signals that discriminate among an empty set do not exist yet. Decision:
  the `sp:next-feature` command's first action must be a status-sync precondition check, not a
  ranking pass. Structure-defect signals (near-duplicates K/F8, group-tag unreliability) are
  confirmed real and route to 0495. Full artifacts (signal matrix, framework comparison, dependency
  graph, anti-patterns) in `docs/tasks4/0493_*.md` § Solution.

### Not yet specified

Resolved by 0497 (2026-08-10): ~~the `sp:next-feature` file layout~~ (SKILL.md +
references/signal-derivation + ranking-rubric + proposal-contract + handoff-routing, per 0494 R4);
~~the implement tickets~~ (0497 shipped command + skill + README/04_DESIGN entries); ~~output
shape~~ (markdown ranked table; `--json` envelope documented; decision-brief not chosen).

Consciously deferred:

- Ranking caching/persistence — v1 recomputes deterministically each run; no cache to invalidate.
- Composition with `/sp:dev-runall` batch order — unaddressed; revisit after dogfood.
- A dedicated route for `verifying`-limbo features — partially covered by the sync-first block and
  T4 (stale-done) tier; a dedicated route awaits operator need.
- `spur status` surfacing the top candidate — stays command-only in v1.

### Out of scope

- Applying feature-tree changes — F31 / `/sp:dev-featurechange` owns the apply protocol.
- Adding `value` / `effort` / `urgency` / feature-level `blocked_by` frontmatter, and the domain schema,
  CLI, migration, and `corpus-check` fallout that would follow.
- Reimplementing `/sp:dev-next`'s within-target routing or `task-pipeline.yaml`.
- A web Board view of the ranking (K / F8 Features module territory).
- Cross-repo packaging via `superskill install`.
- Re-auditing the feature tree's root structure — F31's 0356 already did that.

### Frontier tickets (feature_id H12)

| WBS | Title | Depends |
| --- | --- | --- |
| 0493 | Ranking-model spike — signals + grounded rubric against the real frontier | — (frontier, primary subject) |
| 0494 | Reuse inventory — what to compose rather than rebuild | — (frontier) |
| 0495 | Structure-defect contract + `/sp:dev-featurechange` handoff | 0493 |
## History
- 2026-08-10T04:38:24.033Z backlog → active (system)
- 2026-08-10T04:38:24.256Z active → verifying (system)
- 2026-08-10T04:40:44.418Z verifying → done (system)
- 2026-08-10T05:32:38.429Z done → active (system)
- 2026-08-10T05:39:51.684Z active → verifying (system)
- 2026-08-10T05:39:52.177Z verifying → done (system)
- 2026-08-12T06:07:39.250Z done → active (system)
- 2026-08-12T06:29:32.925Z active → verifying (system)
- 2026-08-12T06:29:33.227Z verifying → done (system)
