---
template: brainstorm
schema_version: 1
name: "Ranking-model spike: which importance/urgency signals the corpus actually yields, and does a grounded rubric order the real frontier convincingly"
description: ""
status: todo
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.277Z"
updated_at: "2026-08-10T01:00:38.912Z"
---

## 0493. Ranking-model spike: which importance/urgency signals the corpus actually yields, and does a grounded rubric order the real frontier convincingly

### Background
**Type:** `wayfinder:research` + `wayfinder:prototype` · **Map:** H12

The prioritizer needs an ordering signal. The corpus does not obviously carry one.

**Verified terrain (re-verified 2026-08-10 against this tree):**

- 67 features: **34 done, 15 active, 13 backlog, 5 verifying**. Excluding the 8 `group`-tagged roots
  (A–H) and this map itself, **25 non-`done` features** remain — **P0=1, P1=5, P2=19**. So **76% of
  the rankable frontier carries one identical priority value**. The `priority` frontmatter field is
  not an ordering; ranking by it would fake a signal.
- **The 25 is an upper bound, not a settled denominator.** It excludes the 8 `group`-tagged roots
  (A–H), but roots `I, J, K, M, N` carry no `group` tag while `J` and `K` have children — so the
  filter counts containers as rankable work items. Establishing the true rankable set is part of R2,
  and the inconsistent tagging is itself a rank-distorting defect (handed to 0495).
- **Feature frontmatter carries no dependency field.** Verified keys are exactly `schema_version, id,
  name, status, priority, tags, created_at, updated_at`. Only *tasks* carry `dependencies[]`
  (`docs/tasks4/0495_*.md:13`). Unblocking fan-out must therefore be derived by walking child tasks
  across feature boundaries, and whether that graph is dense enough to discriminate is unmeasured.
- `sp:next-router` already defines an actionability filter at **task** level:
  `plugins/sp/skills/next-router/references/routing-table.md:83` (row B3) — *"Frontier = open
  (`backlog`|`todo`|`wip`|`testing`|`blocked`), unblocked (all `dependencies[]` done), prefer
  WBS-ascending"*. Note the ordering it falls back to: **WBS-ascending**, i.e. creation order. The
  filter is reusable; the ordering is precisely the hole this map exists to fill.
- **Status may be stale rather than meaningful.** `spur feature sync` "aligns feature lifecycle status
  with linked [tasks]" and `spur feature refresh` rebuilds `INDEX.md` and the `## Tasks` tables — both
  are manual verbs. So the 5 `verifying` and 15 `active` features may be un-synced bookkeeping, not
  real state. Any urgency claim built on status must first establish whether sync is current, or the
  loudest signal in the model is an artifact.

The map's `### Candidate ranking model` is a hypothesis written to be falsified, not a spec. This
ticket tests it against the real frontier and reports what actually discriminates. A signal matrix
with no ranked output is not a resolution — the operator cannot judge a table of fields, only an
ordering they either agree with or do not.

Prior art (WSJF = cost-of-delay ÷ job-size, RICE, CD3) assumes value/effort estimates this corpus does
not carry. Grounding the rubric in that literature is in scope; importing its arithmetic wholesale is
the failure mode to avoid — a numeric score derived from absent estimates is an opinion wearing a
number.

**Correction (2026-08-10 refine):** the charting session recorded "19 of 24" leaves at P2. The
denominator was a miscount — the true figure is 19 of 25 excluding this map. The 76% conclusion is
unchanged; the count is corrected here and on the map.
### Requirements
- R1 — Establish whether feature status is trustworthy as a signal at all: report whether `spur feature sync` / `refresh` are current, and how many of the 15 `active` / 5 `verifying` features would change status if sync ran. Every downstream urgency claim depends on this and it is currently unmeasured.
- R2 — Produce a signal matrix over the 25 non-`done` features (excluding the 8 `group` roots and this map): for each candidate signal in the map's hypothesis — unblocking fan-out, dogfood proximity, authority pull, AC coverage, sunk-work decay, WIP pressure, staleness, churn exposure — give the derivation command and its measured spread across the frontier. A signal returning one dominant value does not discriminate and must be recorded as rejected with that spread.
- R3 — Measure the cross-feature dependency graph specifically: walk child tasks' `dependencies[]` across feature boundaries and report edge count and fan-out distribution. State whether the graph is dense enough to rank by, since the map's hypothesis names this the highest-leverage signal and feature frontmatter carries no dependency field of its own.
- R4 — Ground the rubric in named prior art (WSJF, RICE, Eisenhower, CD3) and state per framework which parts apply here and which are inapplicable for want of value/effort estimates, so the chosen form is a reasoned selection rather than an invention.
- R5 — Emit an actual ranked ordering of the real actionable frontier with per-candidate evidence, in the tiered form the map proposes, plus the gated (non-actionable) features listed separately with their unmet dependency. This is the artifact the operator reacts to; a rubric without a ranking is not resolvable.
- R6 — Report which of the map's hypothesised anti-patterns the spike itself tripped over, and whether the actionability-gate-before-ranking rule survived contact with real data.
### Acceptance Criteria
```gherkin
Feature: 0493 wayfinder investigation

  Scenario: R1 — status trustworthiness is established before it is used
    Given the feature corpus and the manual spur feature sync verb
    When this ticket is resolved
    Then the task body states whether feature status is currently in sync with linked tasks
    And it reports how many active or verifying features would change status if sync ran
    And any urgency signal built on status is qualified by that finding

  Scenario: R2 — signals are measured, not asserted
    Given the 25 non-done features excluding group roots and this map
    When each of the eight candidate signals is derived
    Then the task body carries a signal-by-feature matrix with the derivation command per signal
    And every signal that fails to discriminate is explicitly rejected with its measured spread

  Scenario: R3 — the dependency graph is measured before it is relied on
    Given feature frontmatter carries no dependency field
    When child-task dependencies are walked across feature boundaries
    Then the task body reports edge count and fan-out distribution
    And it states whether the graph is dense enough to rank by

  Scenario: R4 — the rubric form is a reasoned selection
    Given the prior-art frameworks WSJF, RICE, Eisenhower and CD3
    When the rubric form is chosen
    Then each framework carries a statement of what applies here and what does not
    And any part rejected for want of value or effort estimates says so explicitly

  Scenario: R5 — the deliverable is an ordering the operator can judge
    Given the measured signals and the grounded rubric
    When the spike completes
    Then the task body carries a ranked ordering of the actionable frontier
    And each ranked candidate cites the evidence that placed it
    And non-actionable features are listed separately with their unmet dependency
    And no candidate carries a numeric score derived from estimates the corpus does not hold

  Scenario: R6 — the spike reports its own failures
    Given the anti-pattern list in the map hypothesis
    When the spike completes
    Then the task body names which anti-patterns it tripped over
    And it states whether gate-before-rank survived contact with real data
```
### Q&A
**Closed during charting (2026-08-09) — map `### Decisions so far`:**

- *May this ticket add frontmatter fields to carry value/effort/urgency?* **No.** Substrate decision:
  derive from the corpus as it stands. A missing signal is reported as missing, not added.
- *Does this ticket propose or apply tree changes?* **Neither.** 0495 owns the proposal contract;
  `/sp:dev-featurechange` owns apply.

**Closed during this refine (2026-08-10):**

- *Is the "19 of 24 leaves at P2" premise accurate?* **No — corrected to 19 of 25.** Re-measured; the
  76% conclusion stands. Background updated, map updated.
- *Do features carry dependency edges in frontmatter?* **No.** Verified keys are `schema_version, id,
  name, status, priority, tags, created_at, updated_at`. R3's cross-boundary task walk is therefore
  mandatory, not one option among several.

**Deferred with owner — operator (map `### Open questions`), do not settle inside this ticket:**

- **OQ3 — ranking unit.** Features only, or also unparented tasks and the `verifying` limbo? If the
  operator widens the unit, R2's signal matrix must be re-derived over the wider set. This ticket
  proceeds on **features only** and states that assumption in its Solution.
- **OQ1 — dispatch or report.** Does not affect what this ticket measures; it affects the surface
  0494/implement own. Not blocking.

**Assumption stated for the record:** feature `status` is treated as untrustworthy until Artifact A
rules otherwise. If Artifact A finds status stale, sunk-work decay and staleness are reported as
*unavailable* signals rather than silently computed from bad data.
### Design
**WHAT** — A measurement + prototype spike. Deliverable is three artifacts written into `### Solution`
of this task: a **status-trust finding**, a **signal matrix**, and a **ranked ordering** of the real
frontier with per-candidate evidence. No production code ships from this ticket.

**WHY** — Everything downstream (the rubric in `sp:next-feature`, the defect set in 0495) is written
against whatever this spike finds discriminating. Building the command first and measuring later
inverts the dependency and bakes in signals that do not separate.

**WHERE** — Read-only across: `docs/features/**`, `docs/tasks4/**` (and sibling task folders),
`plugins/sp/skills/next-router/references/routing-table.md`, `docs/02_ROADMAP.md`, `docs/00_ADR.md`,
git history. Writes go **only** to this task's `### Solution` / `### Testing` sections via
`spur task update --section`.

**No new API.** No source file, schema, CLI verb, command, or skill is created or modified by this
ticket. Frozen output artifact shapes instead:

*Artifact A — status-trust finding.* One paragraph plus a table: for each of the 15 `active` and 5
`verifying` features, whether `spur feature sync --dry-run` (or equivalent non-mutating inspection)
would change its status. Concludes trustworthy / stale-with-N-drifts / unknown-and-why.

*Artifact B — signal matrix.* One row per candidate signal, columns:
`signal | derivation command | spread across frontier | discriminates? (yes/no) | verdict`.
Candidate signals are exactly the eight in the map hypothesis: unblocking fan-out, dogfood proximity,
authority pull, AC coverage, sunk-work decay, WIP pressure, staleness, churn exposure. A signal whose
spread is degenerate (one value dominating, as `priority` does at 76%) is marked **rejected** with its
measured spread — rejections are results, not omissions.

*Artifact C — ranked ordering.* The actionable subset of the 25, in tiered order, each row:
`rank | feature id + name | tier | evidence that placed it`. Non-actionable features are listed
separately with the unmet dependency that gated them — gated, never ranked.

**Algorithm (the thing being tested, stated so it can fail):**

1. **Gate on actionability first.** Apply routing-table B3's predicate per feature via its child
   tasks: a feature is actionable iff it has ≥1 open child task whose `dependencies[]` are all `done`.
   Zero actionable children ⇒ excluded from the ranking, reported with reason.
2. **Derive each surviving signal** over the actionable set; discard the degenerate ones (Artifact B).
3. **Place each candidate in a tier**, not a score. Tiers over scores because the corpus has no
   estimates to divide — the moment a number appears, it will be read as measurement.
4. **Break ties by closure pressure**: work that reduces the count of open/`active` features outranks
   work that raises it. 15 active against one operator is the standing condition.

**Anti-patterns — do not implement these:**

- Emitting a numeric score (WSJF/RICE arithmetic) computed from estimates the corpus lacks.
- Ranking a feature whose dependencies are unmet. Actionability gates; it is not a score term.
- Reporting only the signals that worked. A rejected signal with its measured spread is the finding
  that stops the next agent re-testing it.
- Treating feature `status` as ground truth before Artifact A rules on it.
- Using the `priority` field as the ordering.
- Expanding into writing the command or skill — that is graduated fog, not this ticket.

**Handoff to dependents** — **0495** consumes Artifact B's *surviving* signal list: a tree defect
qualifies as rank-distorting only if it corrupts a signal that this ticket found discriminating.
0495 must not invent defects against rejected signals. **0494** runs independently and does not
consume this ticket's output.
### Plan
- [ ] Establish status trust: inspect whether `spur feature sync` / `refresh` are current and how many of the 15 `active` + 5 `verifying` features would change status; write Artifact A (R1)
- [ ] Walk child-task `dependencies[]` across feature boundaries; report edge count and fan-out distribution; rule on whether the graph is dense enough to rank by (R3)
- [ ] Apply the B3 actionability predicate per feature; split the 25 into actionable vs gated, recording the unmet dependency for each gated one (R2)
- [ ] Derive each of the eight candidate signals over the actionable set, recording the derivation command and measured spread; mark degenerate signals rejected; write Artifact B (R2)
- [ ] Read the prior-art frameworks (WSJF, RICE, Eisenhower, CD3) and state per framework which parts apply here and which are inapplicable for want of estimates (R4)
- [ ] Assemble the tiered rubric from the surviving signals and emit the ranked ordering with per-candidate evidence; write Artifact C (R5)
- [ ] Record which hypothesised anti-patterns the spike itself tripped, and whether gate-before-rank survived contact with real data (R6)
- [ ] Write Artifacts A/B/C into `### Solution` and the verification notes into `### Testing` via `spur task update --section`

**Verification intent:** this ticket ships no code, so verification is evidential, not test-based.
Every matrix cell and every rank carries either a reproducible command (re-runnable by the reviewer)
or a repo-relative `file:line`. A rank with prose justification and no command or citation fails R5.
### Solution

<!-- Final synthesized recommendation or output from the brainstorm. -->

### Testing

<!-- Validation performed for claims, links, or feasibility. Use N/A when not applicable. -->

### Review

<!-- Risks, open concerns, and follow-up review notes. -->

### References
- Map: [H12 Feature frontier prioritizer](../features/H12_feature-frontier-prioritizer-derived-importance-urgency-ranking-and-structure-defect-proposals.md) — `### Candidate ranking model` is the hypothesis this ticket falsifies
- `plugins/sp/skills/next-router/references/routing-table.md:83` — row B3, the frontier/actionability predicate and its WBS-ascending fallback ordering
- `plugins/sp/skills/next-router/references/routing-table.md:84-87` — rows B4–B7, existing feature-level hygiene routes (0494 owns the boundary ruling)
- `plugins/sp/skills/next-router/references/routing-table.md:32` — the target-omitted non-route this map exists to close
- `spur feature sync --help` / `spur feature refresh --help` — the manual status-derivation verbs R1 tests
- Dependent ticket: **0495** consumes the surviving-signal list from Artifact B
- Sibling ticket: **0494** reuse inventory — independent, no shared evidence
- `sp:wayfinder` — one ticket per session; record the resolution in the task body, then one line on the map's `### Decisions so far`
### History
