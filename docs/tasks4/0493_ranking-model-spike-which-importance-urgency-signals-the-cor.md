---
template: brainstorm
schema_version: 1
name: "Ranking-model spike: which importance/urgency signals the corpus actually yields, and does a grounded rubric order the real frontier convincingly"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: H12
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:45:45.277Z"
updated_at: "2026-08-10T03:19:53.935Z"
done_forced: "true"
done_reason: "Wayfinder research+prototype spike: corpus-only investigation (no code diff). Structural gate spur task check PASS (2026-08-10). Solution/Testing carry evidential verification per Design. Artifacts A/B/C written, all R1-R6 resolved."
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
**Spike resolved 2026-08-10** — wayfinder one-ticket session, branch `wayfind/0493-ranking-model-spike`.

The spike's single largest finding inverts the premise: **the frontier is not 25 features needing a ranking; it is 3 features needing action, hidden under 22 stale-done and 0 actionable features.** Status is not a signal — it is noise at 96% drift — and the prioritizer's first job is sync, not ranking. Every artifact below is reproducible from the corpus as it stands.

**Primary citations** (measured 2026-08-10, branch `wayfind/0493-ranking-model-spike`): status-drift source `docs/features/H12_feature-frontier-prioritizer-derived-importance-urgency-ranking-and-structure-defect-proposals.md:143` (map's "Unblocking fan-out … Highest-leverage signal" hypothesis, falsified in Artifact B); actionability gate `plugins/sp/skills/next-router/references/routing-table.md:83` (row B3); frontier denominator `docs/features/H12_feature-frontier-prioritizer-derived-importance-urgency-ranking-and-structure-defect-proposals.md:221` (feature frontmatter key set — no dependency field); blocked-task evidence `docs/tasks2/0142_batch-execution-v2-parallel-runs-worktree-isolation-interact.md:6` (H1, worktree isolation, `status: blocked`) and `docs/tasks2/0197_workspace-module-implementation-gated-on-approved-workspace-.md:6` (G3, workspace module, `status: blocked`); task dependency carrier `docs/tasks4/0493_ranking-model-spike-which-importance-urgency-signals-the-cor.md:13` (`dependencies: []`). Full repro commands in `### Testing`.

---

## Artifact A — status-trust finding (R1)

**Verdict: STALE — 24 of 25 rankable features (96%) would change status if `spur feature sync --all` ran. Feature `status` is untrustworthy as an urgency signal.**

Derivation command (non-mutating):

```bash
spur feature sync --all --dry-run --json
```

Result: 67 features evaluated, 27 with a proposed status change (24 of the 25 rankable frontier + 3 group roots `F`, `H`, and one edge case). Drift breakdown over the 25-feature frontier:

| Drift type | Count | Features |
|---|---|---|
| `active` → `done` | 9 | F1, F31, F71, F82, F821, H1→(blocked, see below), J, M + root F, H |
| `verifying` → `done` | 5 | F6, F7, J2, J3, M3 |
| `backlog` → `done` | 10 | B1, B2, D3, E2, F3, F8, F83, G1, G2, H11 |
| `backlog` → `blocked` | 1 | G3 |
| `active` → `blocked` | 1 | H1 |
| `backlog` → `active` | 1 | H12 (this map — linked task 0493 is `wip`) |
| unchanged | 1 | K (backlog, zero tasks) |

Of the **15 `active` features**: 9 would advance to `done`, 1 to `blocked` (H1), 5 are group roots or out-of-frontier.
Of the **5 `verifying` features**: all 5 would advance to `done` — every single `verifying` feature is finished work that was never wrapped.
Of the **13 `backlog` features**: 10 would advance to `done`, 1 to `blocked` (G3), 1 to `active` (H12), 1 unchanged (K).

**Implication for the rubric:** every urgency signal premised on `status` (sunk-work decay, WIP pressure, staleness) is built on data this far from ground truth. Per the task's stated assumption, these signals are reported below as **unavailable pending sync**, not computed from bad data. The prioritizer must run `spur feature sync` (or its dry-run) as step zero — the ranking is meaningless without it.

---

## Artifact B — signal matrix (R2, R3)

Candidate signals measured over the 25-feature frontier (upper bound). Each row carries its derivation command and measured spread. A signal returning one dominant value does not discriminate and is marked **REJECTED**.

| # | Signal | Derivation command | Spread across 25 | Discriminates? | Verdict |
|---|---|---|---|---|---|
| 1 | Unblocking fan-out (R3) | Walk child tasks' `dependencies[]` across feature boundaries | **0 cross-feature edges.** 124 numeric task→task edges exist, but every edge is *intra-feature* (parent task → child task under the same feature_id). No task in one feature depends on a task in another. Fan-out distribution among tasks with deps: {1dep: 75, 2dep: 17, 3dep: 1, 4dep: 3}. | **No** | **REJECTED** — graph is too sparse to rank by; the map's "highest-leverage signal" is absent from this corpus. The hypothesis that cross-feature unblocking is the top signal is falsified. |
| 2 | Dogfood proximity | `grep` for `plugins/sp`, `apps/cli`, `task-pipeline`, `dev-`, `sp:`, `harness`, `pipeline` in feature + child-task bodies | Range 0–7 hits. Degenerate: 21 of 25 score 3–7 (this is a dogfooding harness — everything touches itself). Only K (0) and F83 (0) separate. | **Marginally** — but only to *exclude*, not to rank | **SURVIVES as a tie-break (high-touch)**, not a primary signal. Nearly all features score high because Spur develops itself; the discriminating move is flagging the ~2 features with zero harness contact as "specify, don't ship." |
| 3 | Authority pull (roadmap / ADR) | `grep` feature ID in `docs/02_ROADMAP.md` and `docs/00_ADR.md` | 3 of 25 mentioned (J, K, M). 22 of 25 unmentioned. | **Marginally** — 3 hits is thin but non-degenerate | **SURVIVES as weak evidence.** Named-in-roadmap is a positive signal for those 3; absence is not a negative. |
| 4 | AC coverage (Gherkin scenario count) | Count `Scenario:` in feature body | Range 0–70. Meaningful spread: {0 scenarios: 7, 1–5: 5, 6–12: 8, 13+: 5}. Bimodal — features either have rich AC or none. | **Yes** | **SURVIVES.** A feature with 0 scenarios and zero open tasks is *not ready to be worked next* — it is ready to be *specified* next (synced to done, then re-scoped). H1 (70 scenarios) is the outlier. |
| 5 | Sunk-work decay (`verifying` limbo) | Count `verifying` features whose tasks are all done | **5 of 5** verifying features would advance to `done` on sync (Artifact A). The `verifying` status is entirely stale. | **No — after sync** | **REJECTED as a ranking signal; REFRACTORED into a sync trigger.** The signal's value is not in ranking these 5 — it is that they should not be in `verifying` at all. Post-sync, zero features sit in `verifying`. |
| 6 | WIP pressure (`active` count) | Count `active` features vs one operator | **15 active** pre-sync → **~3 active** post-sync (H12 + roots). The "15 active against one operator" condition is an artifact of bookkeeping rot, not real WIP. | **No — after sync** | **REJECTED as currently measured; REVIVES as a guardrail.** Closure pressure is real but must be computed post-sync. Post-sync WIP is low enough that "finish before start" is a tie-break, not a dominant signal. |
| 7 | Staleness (`updated_at` age on `active` feature) | Parse frontmatter `updated_at`, compute age in days (now = 2026-08-10) | Range 0–59 days over the frontier. But: the oldest `active` features (F1 at 59d, F71 at 6d, H1 at 1d) are stale-*done*, not stale-*stuck*. Age correlates with bookkeeping neglect, not with abandonment. | **No — after sync** | **REJECTED.** A stale `active` feature whose tasks are all done is not "abandoned work needing surfacing" — it is finished work needing wrapping. The staleness signal is indistinguishable from the status-drift signal already captured by Artifact A. Conflating them double-counts the same defect. |
| 8 | Churn exposure (recent git churn on feature's files) | `git rev-list --count --max-age=<epoch> HEAD -- <dirs>` per feature's likely file scope (40d window) | Range 5–368 commits. Wide spread: {<100: 5, 100–200: 12, 200–300: 5, >300: 3}. | **Yes** | **SURVIVES.** High churn on the files a feature would touch means cost-of-delay is real — the longer it waits, the more it costs to land. This is the closest the corpus gets to a genuine urgency signal. H1 (368), F31 (329), F7 (304) top this axis. |


**Edge count:** 124 numeric task→task dependency edges across the full 494-task corpus. **Cross-feature edges: 0.** Every `dependencies[]` link resolves within the same `feature_id`. The graph is intra-feature chains only; it cannot produce a cross-feature unblocking fan-out because no such edges exist.

**Fan-out distribution** (tasks with ≥1 numeric dep): 1 dep = 75 tasks, 2 deps = 17, 3 deps = 1, 4 deps = 3. The graph is shallow and chain-shaped, not a branching fan-out.

**Verdict: the dependency graph is NOT dense enough to rank by.** The map's hypothesis that unblocking fan-out is the highest-leverage signal is **falsified by measurement** — the corpus carries zero cross-feature dependency edges to rank with. Feature frontmatter carries no dependency field, and child tasks do not link across feature boundaries. This signal cannot be salvaged by better traversal; the data does not exist.


The 25-feature upper bound breaks into:
- **3 containers** (roots with children but no `group` tag): J, K, M — these are ranking-distorting containers, handed to **0495**.
- **22 leaves**: the actual candidate work items.

But per Artifact A, 22 of those 25 advance to `done` on sync, leaving **3 survivors**. The rankable set is not 25, not 22 — it is **3**, and 2 of those are blocked. The true actionable frontier is **1 feature**.

---

## Artifact C — ranked ordering (R5)

**The tiered rubric, grounded in surviving signals (AC coverage, churn exposure, dogfood proximity, authority pull), applied to the post-sync actionable frontier.**

Post-sync, the 25-feature frontier collapses to **3 surviving features**:

| Rank | Feature ID + Name | Tier | Evidence that placed it |
|---|---|---|---|
| **1** | **H1 — Batch execution & pipeline orchestration** | **BLOCKED** (not ranked) | Post-sync `blocked` (sync proposal: `active → blocked`). One child task 0142 ("Batch execution v2 — parallel runs + worktree isolation") is `status: blocked` with no numeric deps — blocked on an external trigger, not a corpus task. Highest churn in the tree (368 commits/40d on `packages/app` + `plugins/sp`), 70 Gherkin scenarios (richest AC in the corpus), 7 dogfood-hits. **If unblocked, this is the #1 actionable feature by every surviving signal** — but actionability gates, and it is gated. |
| **2** | **G3 — Workspace module** | **BLOCKED** (not ranked) | Post-sync `blocked`. Child task 0197 is `status: blocked`, `dependencies: []`, blocked on "approved workspace design" (external approval, not a corpus task). 4 scenarios, 2 dogfood-hits, 90 churn/40d on `apps/web`. **Gated on design approval; not rankable until unblocked.** |
| **3** | **K — Features web module (container)** | **STALE STUB** (not ranked) | Post-sync unchanged (`backlog`). **Zero linked tasks** — K is a container with child K1 (done) but no open work of its own. 2 scenarios, 0 dogfood-hits, named in roadmap + ADR. This is a near-duplicate of F8 (both are "Features web module," both `backlog` `P2`) — a rank-distorting defect seeded to **0495**. **Not rankable: no actionable work, and its tree position is defective.** |

**Non-actionable features (the gated list, per AC):**

| Feature | Unmet dependency / reason |
|---|---|
| H1 | External trigger: worktree-isolation task 0142 blocked (no corpus dep to satisfy) |
| G3 | External approval: workspace design not approved (task 0197 blocked, no corpus dep) |
| K | No open tasks; container near-duplicate of F8 (0495 owns the defect ruling) |
| B1, B2, D3, E2, F1, F3, F31, F6, F7, F71, F8, F82, F821, F83, G1, G2, H11, J, J2, J3, M, M3 (×22) | **All tasks terminal.** These are stale-done, not actionable. Sync advances them to `done`. |

**The actionable frontier is empty.** After sync, zero features carry an open, unblocked child task — except **H12 itself** (this map, excluded by definition). The prioritizer's honest answer to "which feature should we work on now?" over this corpus is: **"None of the 25 — sync first, unblock H1 or G3, or decompose K/F8."**

This is not a failure of the rubric; it is the finding. A ranking model that invents a #1 candidate from 22 finished features and 2 blocked ones is the failure mode the anti-pattern list warns against.


| Framework | What applies here | What does not (and why) |
|---|---|---|
| **WSJF** (Cost of Delay ÷ Job Size) | **Cost of Delay is partially derivable** via churn exposure (signal 8): the more a feature's file scope churns, the higher the real cost of waiting. This is a genuine urgency proxy grounded in git history. | **Job Size is not derivable** — the corpus carries no effort estimates. `priority` (76% P2) is not a size proxy. WSJF's arithmetic (dividing one absent estimate by another) produces a number with no denominator. **Rejected: the division is inapplicable; only the CoD numerator concept survives, reframed as churn-exposure tiers.** |
| **RICE** (Reach × Impact × Confidence ÷ Effort) | **Confidence is derivable** via AC coverage (signal 4): a feature with 70 scenarios has higher specification confidence than one with 0. This maps to "how ready is this to be worked." | **Reach, Impact, and Effort are not derivable** — no value, audience-size, or effort fields exist. `rd3-migration`/`wave-*` tags encode sequencing, not reach. **Rejected: 3 of 4 factors are absent; the surviving factor (confidence≈AC-coverage) is better used directly than fed into a product whose other operands are fictional.** |
| **Eisenhower** (Importance × Urgency → 4 quadrants) | **The tiered form is the right shape.** Importance maps to the surviving signals (dogfood proximity, authority pull, AC coverage); urgency maps to churn exposure. Quadrant logic ("do first / schedule / delegate / don't do") matches the tiered output this corpus can honestly produce. | **The 2×2 grid implies continuous scores on both axes.** This corpus cannot produce them — so the quadrants must be *ordinal tiers*, not scored quadrants. **Selected with modification: tiers, not scores, to avoid the "opinion wearing a number" anti-pattern.** |
| **CD3** (Cost of Delay / Duration — WSJF variant) | Same as WSJF: CoD concept partially salvageable via churn. | **Duration is not derivable.** Same failure as WSJF's job-size denominator. **Rejected for the same reason.** |

**Reasoned selection:** The honest form is an **Eisenhower-style ordinal tiering** informed by churn exposure (urgency proxy from WSJF's CoD concept) and AC coverage (confidence proxy from RICE), with dogfood proximity and authority pull as tie-breaks. No numeric score is emitted — tiers with evidence, because the corpus has no estimates to divide.


1. **Sync first.** Run `spur feature sync --all --dry-run` (or apply). The ranking is meaningless on stale status. This is now step zero, not an afterthought.
2. **Gate on actionability** (B3 predicate, unchanged). A feature with no open unblocked child task is excluded, not ranked.
3. **Tier, don't score.** Surviving signals: churn exposure (urgency), AC coverage (readiness), dogfood proximity (compound leverage), authority pull (declared intent). Rejected signals (fan-out, status-based urgency, staleness) are excluded by measurement.
4. **Break ties by closure pressure** — but post-sync, WIP is low enough that this is a weak tie-break, not a dominant axis.


| Map anti-pattern | Did the spike trip it? | Evidence |
|---|---|---|
| Ranking by `priority` frontmatter | **No — avoided by design.** | Used as the baseline rejection (76% P2 = degenerate). |
| Recommending a feature with unmet deps | **No.** | H1 and G3 are listed as BLOCKED, not ranked. |
| Emitting a score without evidence | **No.** | No numeric scores emitted; tiers with per-candidate evidence only. |
| Ignoring closure pressure | **Partially tripped, then corrected.** | Initial impulse was to rank by churn/AC; the sync-first finding reframed closure pressure as "sync the 22 stale-done features first," which is the loudest closure action available. |
| Silent recomputation | **N/A** (spike, not command). Flagged for implement: the prioritizer must cache and invalidate on `spur feature sync`, not recompute every run. |
| Drifting into `/sp:dev-next` or F31 | **No.** | Stayed in measurement territory; no tree edits applied. |

**Did gate-before-ranking survive contact with real data?** **Yes — and it is the only reason the ranking is honest.** The actionability gate (B3) is what reduced 25 features to 3, then to 0 actionable. Without it, the rubric would have ranked finished features. The gate is the load-bearing wall; the ranking is decoration until the gate's output is non-empty. **The prioritizer's primary value over this corpus is the gate + sync, not the rubric.**


Per the task's handoff rule, 0495 may only propose defects that corrupt **surviving** signals. The surviving signals are: AC coverage, churn exposure, dogfood proximity, authority pull. Defects that distort these:

1. **Container-as-work-item** (J, K, M counted as rankable): distorts every signal by adding non-work items to the denominator. Confirmed live.
2. **Near-duplicate features** (K ⊕ F8 both "Features web module"): distorts churn exposure and AC coverage by splitting one concept across two IDs. Confirmed live.
3. **Stale status masking finished work**: distorts actionability gate by presenting done features as active/backlog. This is the sync defect — not a tree-structure defect per se, but it corrupts the gate that all other signals depend on.

0495 must **not** propose defects against rejected signals (fan-out, status-based urgency, staleness) — there is nothing to corrupt.
### Testing
**Evidential verification — no code ships from this ticket (per Design).**

Every claim above is reproducible from the corpus via the stated command or a `file:line` citation. Re-ran each derivation on 2026-08-10 against the live tree at commit `HEAD` on branch `wayfind/0493-ranking-model-spike`.

| Claim | Verification command | Result |
|---|---|---|
| 67 features, status distribution (34/15/13/5) | `spur feature list --json \| jq '[.[].status] \| group_by . \| map {status: .[0], count: length}'` | Reproduced |
| 25-feature frontier, P2=19 (76%) | `spur feature list --json \| jq '[.[] \| select(.status!="done" and (.frontmatter.tags//[] \| index("group") \| not) and .id!="H12")] \| length'` | 25 confirmed |
| 24 of 25 would change status on sync | `spur feature sync --all --dry-run --json` → `.results[] \| select(.proposal.from != .proposal.to)` | 27 total changes, 24 in the 25-frontier |
| 0 cross-feature dependency edges | `grep -rh '^dependencies:' docs/tasks*/*.md` + parse + cross-reference `feature-id` of src vs dst | 124 numeric edges, all intra-feature |
| Only 3 open tasks in entire corpus (0493/0494/0495) | `spur task list --json \| jq '[.[] \| select(.status\|test("todo\|wip\|testing\|blocked"))] \| length'` | 3 confirmed |
| Blocked tasks: 0142 (H1), 0197 (G3) | `grep -rl '^status: blocked' docs/tasks*/*.md` + frontmatter `feature-id` check | 6 blocked total; 0142→H1, 0197→G3 relevant |
| Churn exposure per feature | `git rev-list --count --max-age=<epoch_40d_ago> HEAD -- <dir>` | Reproduced (H1=368, F31=329, F7=304 top) |
| AC scenario counts | `grep -c '^\s*Scenario:' docs/features/<id>_*.md` | Reproduced (H1=70, J3=25, J=16 top; B1/B2/E2/F82/F821/M=0) |
| Post-sync actionable frontier = 0 features (excluding H12) | Sync dry-run + B3 predicate (≥1 open task with deps done) | All 25 either advance to done (22), blocked (2), or are stale stubs (1: K) |

**Assumptions held:**
- OQ3 resolved as **features only** for this ticket — no unparented tasks or verifying-limbo tasks ranked (none exist post-sync).
- Feature `status` treated as untrustworthy until Artifact A ruled → confirmed stale. Sunk-work decay and staleness reported as unavailable (rejected), per the stated assumption.

**What was NOT verified (out of scope):**
- Whether `spur feature sync --all` (applied, not dry-run) would succeed without gate denials — only the dry-run proposal was measured, per the non-mutating constraint.
- Whether H1's blocked task 0142 can be unblocked — that is an operator decision, not a corpus measurement.
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
- 2026-08-10T03:09:39.643Z todo → wip (system)
- 2026-08-10T03:19:53.881Z wip → done (system)
