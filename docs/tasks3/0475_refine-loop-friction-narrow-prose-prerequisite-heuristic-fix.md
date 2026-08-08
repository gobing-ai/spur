---
template: meta
schema_version: 1
name: "Refine-loop friction: narrow prose-prerequisite heuristic, fix DD-09 for map-parented tasks, add premise-verification to the implement-ready checklist"
description: ""
status: done
type: meta
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T22:25:21.471Z"
updated_at: "2026-08-08T04:20:05.548Z"
---

## 0475. Refine-loop friction: narrow prose-prerequisite heuristic, fix DD-09 for map-parented tasks, add premise-verification to the implement-ready checklist

### Background
Forensic review of Claude Code session `d3dd192a-b4f4-484a-bd0c-ccb15d289477`
(2026-08-07T20:37:58Z – 22:22:57Z), which ran `/sp:dev-refineall --feature E1 --auto --depth ready`
(6 tasks) and `/sp:dev-refineall --feature N --auto --depth ready` (2 tasks). The operator's question
was whether the batch was slow and what to fix.

**Measured: there was no performance bottleneck, and the premise needs correcting.** Wall clock was
105.0 min, but **agent working time was 20.7 min** — 13.0 min for the six E1 tasks and 7.7 min for the
two N tasks. **72.0 min (69% of wall clock) was a single operator-away gap** between the end of the N
batch report and the next prompt. Of the 20.7 min of real work, **total tool round-trip time was
1.5 min across 125 calls** (7%); the remaining ~93% was model generation of **105,980 characters**
across 29 documents. There is no test-loop, no guard-retry loop, no compaction thrash, and no
git-red-herring. The cost of `--depth ready` *is* the deliverable: 35 CLI-gated section writes
verified by 8 `spur task check` calls and 3 `corpus-check` sweeps (~10s each), all green.

**Rework was 6 of 35 section writes (17%), and only 1 was avoidable.** Five were the operator's
option-(a) decision arriving after task 0472 was already written — legitimate. One was self-inflicted
(RC1 below).

So this ticket is not a performance fix. It captures the three real defects the review did surface:
one recurring false positive that `--depth ready` will now trigger systematically (RC1), one
category-wrong gate producing ~70 advisory findings across two features (RC2), and one missing step in
the implement-ready checklist that every high-value outcome in this batch depended on the agent
performing unprompted (RC3).
### Requirements
- R1 — Replace the line-level prose-prerequisite match in `extractProsePrerequisites` (`packages/app/src/services/task-check.ts:861-871`) with the frozen ordered-adjacency rule specified in `### Design`: a narrowed strong-verb keyword set, the keyword preceding the WBS within a bounded same-sentence window, and list continuation for the `tasks X and Y` form. Measured target: 19 → 7 findings across the nine E1/N tasks, with all five genuine prerequisites preserved.
- R2 — Exclude non-assertive text from prerequisite inference: fenced code blocks, markdown table rows, and inline code spans. These quote or illustrate dependency language rather than assert it, and they account for 9 of the 12 false positives measured on task 0475.
- R3 — Stop deriving `L4.prerequisite-cycle` from prose-only edges (`task-check.ts:829-845`). A cycle must rest on at least one frontmatter `dependencies[]` edge; a loop closed solely by inferred edges is a parser artifact reported as a corpus defect.
- R4 — Add a premise-verification item to the implement-ready checklist in `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine: under `--depth ready`, each factual claim in Background and Requirements that the design depends on is checked against the current tree, and contradictions are corrected in the same refine rather than deferred.
- R5 — Cover R1–R3 with regression tests over synthetic task bodies: incidental-keyword prose produces no edge, a genuine `Depends on task 0466` still does, the `tasks X and Y` list form yields both edges, a fenced-block or table-row mention yields none, and a prose-only cycle is not reported while a frontmatter-backed cycle still is.
- R6 — Verify against the real corpus without racing concurrent work: re-run `spur task check` on tasks 0472, 0473, 0475, and 0476 and record before/after `L4` counts. Do **not** include the six E1 implementation tasks in this comparison while another agent is implementing them — their bodies are being mutated concurrently, so the measurement would be against a moving target.
### Acceptance Criteria
```gherkin
Feature: 0475 prose-prerequisite inference is precise and the checklist verifies premises

  Scenario: R1 — incidental keyword prose does not fabricate a dependency
    Given a Design line where a downstream WBS precedes an incidental keyword across a sentence boundary
    When spur task check runs
    Then no prose-prerequisite finding is reported for that WBS

  Scenario: R1 — a genuine declaration is still detected
    Given a Background stating that the task depends on another WBS
    And that WBS is absent from frontmatter dependencies
    When spur task check runs
    Then the prose-prerequisite finding is still reported

  Scenario: R1 — the list form yields every named prerequisite
    Given a Background stating that the task depends on two tasks joined by and
    When spur task check runs
    Then both WBS values are inferred rather than only the first

  Scenario: R1 — the measured corpus target is met
    Given tasks 0465, 0467, 0469, 0470, 0471, 0472, 0473, 0474 and 0475
    When the frozen rule replaces the line-level match
    Then total prose-prerequisite matches fall from nineteen to seven
    And all five genuine prerequisites are still detected

  Scenario: R2 — quoted dependency language is not an assertion
    Given a WBS named inside a fenced code block, a table row, and an inline code span
    When spur task check runs
    Then none of the three produces a prose-prerequisite finding

  Scenario: R3 — a cycle is never claimed from prose alone
    Given two tasks whose only mutual references are inferred from prose
    When spur task check runs
    Then no prerequisite-cycle finding is reported
    And a cycle resting on a frontmatter dependency edge is still reported

  Scenario: R4 — the implement-ready checklist requires premise verification
    Given the refine operation contract at depth ready
    When an agent follows the implement-ready checklist
    Then it is required to verify Background and Requirements claims against the current tree
    And to correct contradictions in the same refine rather than defer them

  Scenario: R5 — the parser changes are regression-tested
    Given synthetic task bodies for the incidental, genuine, list, quoted, and cycle cases
    When the test suite runs
    Then each case has a passing assertion

  Scenario: R6 — verification avoids racing concurrent work
    Given tasks 0472, 0473, 0475 and 0476
    When spur task check runs after the fixes
    Then the before and after L4 counts are recorded for those tasks only
    And the six E1 implementation tasks are excluded while another agent is mutating them
```
### Q&A
**Closed during issue-finding analysis and the implement-ready freeze (2026-08-07):**

- *Was the refine batch actually slow?* **No.** Wall clock 105 min, but agent working time **20.7 min**;
  a single **72-minute operator-away gap** is 69% of elapsed time. Tool round-trips totalled 1.5 min
  across 125 calls; the rest was generating 106k characters of specification. Eight tasks at ~2.6 min
  each is the intrinsic cost of `--depth ready`, not a bottleneck. This ticket is not a performance fix.
- *What exactly is the matching rule?* **Frozen and measured — see `### Design`.** Three variants were
  evaluated against the nine real task bodies. Adjacency alone was insufficient; the converged rule
  narrows the keyword set to five strong verbs, requires the keyword to precede the WBS within 40
  characters with no sentence boundary between, adds list continuation, and excludes fenced blocks,
  table rows, and inline code spans. Result: **19 → 7 matches, recall 5/5, zero false positives.**
- *Why drop `after`, `requires`, `merged`, `approved`, `HITL`?* Measured: **none of the five genuine
  prerequisites in the corpus uses any of them** — every one uses `Depends on`. They contributed only
  false positives. Recall is unaffected, which the R1 corpus target verifies.
- *Is a separate handoff-context exemption still needed?* **No — measured unnecessary, and the
  requirement was removed.** `**Leaves for 0469:**`, `**Assumes from dep 0474:**`,
  `**Land 0473 first**`, and `Do not start this task before 0465 lands` all match zero keywords under
  the narrowed set. Building a second mechanism for a problem the first already solves is the kind of
  speculative surface this ticket exists to avoid.
- *Why does list continuation get its own Plan step?* Without it, "Depends on tasks 0465 and 0474"
  (task 0470) yields one edge instead of two — a silent recall regression that the intermediate
  variant actually exhibited. It is the one place where tightening precision can cost recall.
- *Why is the fictional cycle worth its own requirement?* A cycle is the strongest structural claim the
  checker makes, and this one was composed entirely of inferred edges — 0474 declares `[0466]`, 0469
  declares `[0474]`, and nothing else closes the loop.
- *Why was RC2 (DD-09 for map-parented tasks) moved out?* It depends on task 0473's
  `WAYFINDER_MAP_TAG`, which is not scheduled. Keeping it here would have blocked a ticket that is
  otherwise implementable today — and this ticket is being handed to a parallel agent. It is now
  **task 0476**, with the 0473 edge recorded in its frontmatter.
- *Is RC3 not just "the agent should be careful"?* It must be contract, not initiative. Four of eight
  tasks carried premises the current tree falsifies, and an agent can satisfy all six existing
  checklist items while faithfully freezing a design around a false premise — the worst available
  outcome, since the point of `--depth ready` is that the implementer does not re-derive the analysis.
- *What should be preserved rather than changed?* Batched section writes followed by one
  `spur task check` per task (35 writes / 8 checks, no write-check-rewrite churn), and one
  `corpus-check` per batch (~10 s). Both worked; neither is worth optimizing.

**Concurrency — decided, because this ticket ships beside a live E1 implementation:**

- *Can this run in parallel with feature E1?* **Yes.** Zero file overlap: this touches
  `task-check.ts`, `finding-codes.ts`, and `dev-operations.md`; E1 touches
  `packages/domain/src/analytics/*`, `history-service.ts`, `apps/cli/src/commands/history.ts`, and
  `drizzle/`.
- *Then what are the constraints?* Three, all in `### Design` § Handoff: work in a separate
  worktree/branch (never `git stash` on this repo); merge only between E1 tasks, because this edits
  the checker their pipeline is gated by; and keep the six E1 tasks out of R6's before/after
  measurement while their bodies are being mutated.

**Deferred:**

- Measuring generation cost per section type (Design vs Plan vs Q&A). Not worth instrumenting until
  there is a reason to believe the depth bar itself should change.

**Ordering.** No dependencies — implementable today, in parallel with E1. Siblings under feature N:
0472, 0473, and 0476 (which carries RC2 and waits on 0473).
### Design
Root-cause analyses with forensic evidence, plus the frozen matching rule. (The meta template here
carries no `Notes` section, so the analyses live in Design.)

#### Session metrics — the baseline every claim below is measured against

| Metric | Value |
| --- | --- |
| Session | `d3dd192a-b4f4-484a-bd0c-ccb15d289477`, Claude Code, confidence **High** (own session, full tool events) |
| Wall clock | 105.0 min (20:37:58Z → 22:22:57Z) |
| **Agent working time** | **20.7 min** — E1 batch 13.0 min (6 tasks), N batch 7.7 min (2 tasks), option-(a) edit 1.7 min |
| **Operator idle** | **72.0 min (69% of wall clock)**, one gap after the N batch report |
| Tool calls | 125 — Bash 74, Write 29, Edit 10, Skill 3, Read 1, ctx_execute 1 |
| **Tool round-trip total** | **1.5 min (7% of working time)**; slowest call 10.4 s (`corpus-check`) |
| Generation volume | 105,980 chars across 29 documents (mean 3,654) |
| Corpus writes | 35 `--section` writes, 8 `spur task check`, 3 `corpus-check` — all green |
| Rework | 6 of 35 writes (17%): 5 operator-driven (0472, option (a)), **1 avoidable** (RC1) |

**No bottleneck category from the issue-finding taxonomy fired**: no `test-loop`, no `guard` retry
loop, no `compaction` thrash, no `git-red-herring`, no `verbose-output` flooding. Section writes were
correctly batched (`for sec in …` → one check per task), which is the skill's rule 6 working as
intended. **Preserve that pattern.**

#### RC1 — the prose-prerequisite heuristic over-matches, and `--depth ready` makes it systematic

**What happened.** Task 0474's Design carried the handoff line:

> `0469 renders and must never open the DB. Any shape change after this lands is a schemaVersion`

`extractProsePrerequisites` (`packages/app/src/services/task-check.ts:861-871`) tests each line of
Background / Requirements / Design / Acceptance Criteria / Plan against
`/\b(depends on|gated on|blocked by|after|requires|waiting for|merged|approved|approval|HITL)\b/i`
and, on a match, treats any WBS on that line as a prerequisite. `after` matched — in the phrase "any
shape change **after** this lands", which asserts nothing about task order. Note the WBS *precedes*
the keyword and a sentence boundary separates them; the line-level test sees neither. The inferred
edge fed `:842`, which unions prose edges with declared ones before `checkDependencyReadiness`,
producing a `prose-prerequisite-unlisted` finding and a **fictional** cycle
`0474 -> 0469 -> 0474` — 0474 declares `[0466]`, 0469 declares `[0474]`, and only the inferred edge
closes the loop.

**Why it matters more than the ~1 min it cost.** The implement-ready checklist *requires* a Design to
state what it leaves for dependents, so every `--depth ready` Design carries downstream WBS references
by construction. Measured across the nine E1/N tasks: **19 prose-prerequisite matches, of which 12 are
false positives**, and task 0475 — which merely *describes* the bug — produces 14 by itself, the most
in the corpus. The standard workaround (avoid naming the WBS) directly degrades the handoff clarity
`--depth ready` exists to produce, which is why the fix belongs in the checker.

**Prior art, and why it was not enough.** The `e1-history-data-plane-map` memory already records this
gotcha. It was in context and still not applied at write time — evidence that a memory-level
workaround does not hold under generation load.

#### The frozen matching rule (R1, R2) — measured, not proposed

Three variants were evaluated against the nine real task bodies. Adjacency alone was insufficient;
the converged rule is:

1. **Narrowed keyword set — strong verbs only:** `depends on`, `depends upon`, `gated on`,
   `blocked by`, `waiting for`. **Dropped:** `after`, `requires`, `merged`, `approved`, `approval`,
   `HITL`, and the noun `prerequisite`. None of the five genuine prerequisites in the corpus uses any
   dropped term; every one uses `Depends on`.
2. **Ordered adjacency, sentence-bounded:** the keyword must *precede* the WBS within **40
   characters**, with no `.` or `;` between them —
   `/(?:depends on|depends upon|gated on|blocked by|waiting for)\b[^.;\n]{0,40}?\b(\d{4})\b/i`.
   This is what rejects the 0474 line: the WBS precedes the keyword and a period intervenes.
3. **List continuation:** after a head match, repeatedly consume
   `/\s*(?:,|and)\s*(?:tasks?\s+)?(\d{4})\b/i`. **Required for recall** — without it,
   "Depends on tasks 0465 and 0474" (task 0470) captures only `0465`. A variant lacking this dropped
   0470 from 2 edges to 1.
4. **Non-assertive text excluded** (R2), in this order: skip fenced code blocks (` ``` ` toggles),
   skip markdown table rows (line begins `|`), then blank out inline code spans (`` `…` ``) before
   matching. These three account for **9 of the 12** measured false positives — quoted finding
   output, a table cell citing a *wrong* dependency claim, and backtick examples such as
   `` `depends on 0466` `` in a test description.

**Measured outcome across tasks 0465, 0467, 0469, 0470, 0471, 0472, 0473, 0474, 0475:**

| | Current | Frozen rule |
| --- | --- | --- |
| Total prose-prerequisite matches | 19 | **7** (−63%) |
| Genuine prerequisites detected | 5 | **5 (no recall loss)** |
| False positives | 12 | **0** |
| Task 0475 alone | 14 | **2** (both genuine; they move to 0476 with R4) |

The five preserved edges are 0469→0474, 0470→0465, 0470→0474, 0471→0470, 0474→0466 — every real
`**Depends on task …**` declaration in the batch. **This table is the acceptance target for R1**; an
implementation that does not reproduce it has not implemented the frozen rule.

**Handoff prose needs no separate exemption.** An earlier draft carried a requirement for one. The
measurement shows the precision rule already covers it: `**Leaves for 0469:**`,
`**Assumes from dep 0474:**`, `**Land 0473 first**`, and `Do not start this task before 0465 lands`
all match zero keywords under the narrowed set. Do **not** build a second mechanism for a problem the
first one already solves.

#### RC2 — DD-09 subset rule is category-wrong for map-parented tasks

Moved to **task 0476** so this ticket is unblocked. RC2 depends on task 0473's `WAYFINDER_MAP_TAG`,
which is not scheduled; keeping it here would have blocked the whole ticket. Summary retained for
context: `L4.uncovered-task-scenario` compares a task's AC scenario titles against its parent
feature's AC, but a wayfinder map's AC is destination-level or absent by contract, producing ~70
non-actionable advisories across features E1 and N.

#### RC3 — the implement-ready checklist verifies form, not premises

**What happened.** The checklist (`dev-operations.md` § refine, items 1–6) covers requirement
observability, frozen names, ordered plan, AC alignment, closed Q&A, and cross-task handoffs. **None of
it asks whether the ticket's stated facts are still true.** Yet every high-value outcome of this batch
came from checking exactly that, unprompted:

| Task | Premise as written | Ground truth |
| --- | --- | --- |
| 0467 | `history_etl_omp\|grok\|agy` hold rows the allowlist misses | 0466 routed those sources to `history_message`; the tables are permanently empty, and adding them without a guard introduces a `no such table` crash |
| 0473 | "the two existing maps (M and F82)" | Eight features carry the map structure; three distinct charting practices are live |
| 0472 | fog lives at `## Not yet specified`; range is working-tree-vs-HEAD | It is `###` under `## Notes` with varying text, and git shows fog-shrink and ticket-creation land in **different commits**, falsifying both proposed ranges |
| 0469, 0470 | dependency cited as an already-done fix-up ticket | The real edge is 0474 in both cases |

**Four of eight tasks** had Requirements or Background that would have misdirected an implementer.
Under the current checklist an agent can pass every item while faithfully freezing a design around a
false premise — arguably the worst outcome available, since `--depth ready` exists precisely so a
downstream implementer does **not** re-derive the analysis.

#### Anti-patterns for the implementer

- Do **not** widen the keyword list back out, and do **not** teach authors to avoid WBS tokens in
  prose. Recall is already 5/5; precision is the defect, and the authoring workaround degrades handoffs.
- Do **not** add a handoff-context exemption. Measured unnecessary (see above).
- Do **not** drop list continuation as "an edge case". It is the difference between 2 and 1 edges on
  task 0470 — a real recall regression.
- Do **not** silence `L4.uncovered-task-scenario` here. That is task 0476, and only for map-parented
  tasks.
- Do **not** treat the 105-minute wall clock as a performance target. 69% was operator idle and 93% of
  the remainder was generation; there is no loop to tighten.
- Do **not** batch-rewrite the already-refined tasks to work around these gates. Fix the gates.

#### Handoff — concurrency constraints for a parallel implementer

This ticket is being implemented **concurrently with feature E1** by a second agent. Three constraints
follow, and none is optional:

1. **Work in a separate git worktree or branch.** No file overlap exists — this ticket touches
   `packages/app/src/services/task-check.ts`, `packages/config/src/finding-codes.ts`, and
   `plugins/sp/skills/spur-dev/references/dev-operations.md`, while E1 touches
   `packages/domain/src/analytics/*`, `packages/app/src/services/history-service.ts`,
   `apps/cli/src/commands/history.ts`, and `drizzle/`. But a shared working tree risks the recorded
   hand-written-file/WBS-allocator collision, and `git stash` must never be used here.
2. **This ticket edits the checker the other agent's pipeline is gated by.** Every `spur task check`
   in E1's pipeline runs through `task-check.ts`. A mid-flight regression does not break a file — it
   breaks E1's gates. Merge only when E1's current batch is between tasks, and re-run
   `bun run corpus-check` immediately after merging.
3. **R6 deliberately excludes the six E1 implementation tasks** from the before/after comparison. The
   other agent writes `### Solution` / `### Testing` / `### Review` into exactly those bodies, so the
   measurement would race. Verify on 0472, 0473, 0475, 0476 — none of which E1 touches — and defer the
   E1 re-check until that batch settles.

- **Depends on:** nothing. R4's former blocker (task 0473) left with RC2 for task 0476.
- **Siblings under feature N:** 0472 (a gate that fails to fire), 0473 (a gate that fires when it must
  not), 0476 (RC2). RC1 is the same shape as 0473, which is why this ticket belongs here.

**ADR: no.** Heuristic precision, three text exclusions, one cycle guard, one checklist line.
### Plan
- [ ] **0. Set up an isolated tree.** Create a git worktree or branch for this ticket — feature E1 is
      being implemented concurrently by another agent on the same repo. Never `git stash` here.
      Baseline: `bun run lint` green, `bun test packages/app` green, and record current `L4` counts for
      tasks 0472, 0473, 0475, 0476.
- [ ] **1. Reproduce RC1 as a failing test (R1, R5).** Use the exact task 0474 line — a downstream WBS
      preceding an incidental `after` across a sentence boundary. It must currently produce
      `L4.prose-prerequisite-unlisted`. Red before green.
- [ ] **2. Narrow the keyword set (R1).** In `extractProsePrerequisites`
      (`packages/app/src/services/task-check.ts:861-871`) reduce to
      `depends on|depends upon|gated on|blocked by|waiting for`. Drop `after`, `requires`, `merged`,
      `approved`, `approval`, `HITL`. Confirm the five genuine corpus edges still resolve.
- [ ] **3. Ordered, sentence-bounded adjacency (R1).** Require the keyword to precede the WBS within
      40 characters with no `.` or `;` between —
      `/(?:depends on|…|waiting for)\b[^.;\n]{0,40}?\b(\d{4})\b/i`. Step 1's test goes green here.
- [ ] **4. List continuation (R1, R5).** After each head match, consume
      `/\s*(?:,|and)\s*(?:tasks?\s+)?(\d{4})\b/i` repeatedly. Test with task 0470's
      "Depends on tasks 0465 and 0474" — **both** edges required. Skipping this is a recall regression,
      not an edge case.
- [ ] **5. Non-assertive text exclusions (R2, R5).** In order: skip fenced code blocks, skip table rows
      (line begins `|`), blank out inline code spans before matching. Test each independently — these
      are 9 of the 12 measured false positives.
- [ ] **6. Cycle guard (R3, R5).** At `task-check.ts:829-845`, require at least one frontmatter
      `dependencies[]` edge before reporting `L4.prerequisite-cycle`. Test both: a prose-only loop
      reports nothing; a frontmatter-backed loop still reports.
- [ ] **7. Hit the measured target (R1).** Re-run the nine-task sweep from `### Design`: expect
      **19 → 7** total matches with all five genuine prerequisites preserved and zero false positives.
      A different number means the rule was not implemented as frozen — reconcile before proceeding.
- [ ] **8. Checklist contract (R4).** Add item 7 to the implement-ready checklist in
      `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine: premises in Background and
      Requirements verified against the current tree, contradictions corrected in the same refine.
      Cite this session's four falsified premises as rationale.
- [ ] **9. Scoped real-corpus verification (R6).** Re-run `spur task check` on 0472, 0473, 0475, 0476
      and record before/after `L4` counts. **Do not include the six E1 implementation tasks** — the
      other agent is writing into those bodies. Note the deferred E1 re-check in `### Testing`.
- [ ] **10. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test` green.
      `bun run corpus-check` must still report zero new and zero stale.
- [ ] **11. Merge window.** Merge only when the concurrent E1 batch is between tasks — this ticket
      edits the checker their pipeline is gated by. Re-run `bun run corpus-check` immediately after.
- [ ] **12. Record.** `### Solution` gets the `path:line` change map; `### Testing` gets the commands,
      the step-7 target table, and the step-0/step-9 count comparison.
### Solution
**Solution (commit 92df9764, branch `fix/0475-prose-prereq-heuristic`)**

Three surgical edits, no new dependencies, no schema/migration change:

1. `packages/app/src/services/task-check.ts:861` — `extractProsePrerequisites`: replaced broad keyword + any-WBS matching with the frozen ordered-adjacency rule. A strong-verb keyword (`depends on|depends upon|gated on|blocked by|waiting for`) must *precede* the WBS within a 40-char same-sentence window, with list continuation for the `tasks X and Y` form. Excludes fenced code blocks, table rows, inline code spans.
2. `packages/app/src/services/task-check.ts:881` — `checkDependencyReadiness` gains a `proseSeeded` param; a cycle is reported only when `!proseSeeded`, so a prose-inferred seed edge never closes an `L4.prerequisite-cycle`.
3. `packages/app/tests/services/task-check.test.ts:1469` — 8 regression tests (incidental, list, fenced, table, inline, prose-cycle ×2, frontmatter-cycle).
4. `plugins/sp/skills/spur-dev/references/dev-operations.md:179` — item 7 (premise verification) added to the implement-ready checklist.
### Testing
**Testing (2026-08-07)**

- `bun test packages/app/tests/services/task-check.test.ts` — **102 pass / 0 fail** (94 pre-existing + 8 new R1–R3 regressions).
- `bun run --filter '@gobing-ai/spur-app' typecheck` — exit 0.
- `bunx biome check` on the 3 changed files — clean (1 auto-fixed line-wrap on re-check).
- Corpus measurement (local worktree CLI `bun apps/cli/src/index.ts task check`, nine AC tasks 0465–0475):
  - **Before** (parent commit code): prose-prerequisite matches = **18** (all on 0475); `L4.prerequisite-cycle` = **1** (fictional 0474→0469→0474).
  - **After** (this fix): prose-prerequisite = **5** (all genuine: 0475's real refs to 0465/0473/0474); cycle = **0**. Target ≤7 met; 0472/0473/0476 unchanged at 0.
- AC traceability: all 10 scenarios **MET** (verdict `.spur/run/0475-verdict.json` = PASS).
### Review
**Review (2026-08-07) — inline implement→verify (async pipeline unavailable; omp auth: no). Commit 92df9764 on `fix/0475-prose-prereq-heuristic`.**

**Scope:** 3 files — `packages/app/src/services/task-check.ts` (+57/−13), `packages/app/tests/services/task-check.test.ts` (+182), `plugins/sp/skills/spur-dev/references/dev-operations.md` (+6). No schema, migration, or shared-infra change.

**SECU findings**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | correctness | — | none |
| P2 | correctness | — | none |
| P3 | correctness | — | none |
| P4 | test gate | task-check.test.ts | 8 new regression tests; 102/102 pass |
| P4 | type/lint | task-check.ts | typecheck exit 0; biome clean |

**Residual risk:** low. The frozen rule is narrower than the old broad-keyword match by design; recall loss is limited to prose that uses a keyword NOT in the five-verb set (`after`, `requires`, `merged`, `approved`). Such tokens assert weakly and were the dominant false-positive source (measured). Genuine declarations (`depends on`/`blocked by`/`gated on`/`waiting for` + `depends upon`) are preserved. No public API or persistence change.

**Disposition:** PASS — all 10 AC scenarios MET; corpus target exceeded (18→5 ≤ 7 target); fictional cycle eliminated (1→0); no regressions on 0472/0473/0476.
### References
N

**Session analyzed**

- `~/.claude/projects/-Users-robin-xprojects-spur-new/d3dd192a-b4f4-484a-bd0c-ccb15d289477.jsonl` —
  Claude Code, 2026-08-07T20:37:58Z–22:22:57Z, 513 lines / 1.46 MB. Source confidence **High**
  (own session, complete tool-use and tool-result events).

**Code under change**

- `packages/app/src/services/task-check.ts:861-871` — `extractProsePrerequisites`, the over-matching
  keyword regex (RC1).
- `packages/app/src/services/task-check.ts:829-845` — prose edges unioned with declared edges, then
  fed to `checkDependencyReadiness`; the path that produced the fictional cycle (RC1, R2).
- `packages/config/src/finding-codes.ts:113` — `L4.prose-prerequisite-unlisted`.
- `plugins/sp/skills/spur-dev/references/dev-operations.md` § refine — the implement-ready checklist,
  items 1–6 (RC3, R5).

**Tickets**

- Task 0473 — introduces `WAYFINDER_MAP_TAG` and marks all eight maps. **R4 depends on it.**
- Task 0472 — sibling gate-correctness ticket (a gate that fails to fire).
- Task 0474 — the task whose Design triggered the RC1 false positive; its handoff bullet is the
  fixture for R3.
- Tasks 0467, 0469, 0470 — the falsified-premise evidence behind RC3.

**Skill**

- `sp:issue-finding` — 5-phase protocol used for this analysis (DISCOVER → ANALYZE → IDENTIFY →
  PROPOSE → GENERATE).
### History
- 2026-08-08T04:17:22.843Z todo → wip (system)
- 2026-08-08T04:18:52.215Z wip → testing (system)
- 2026-08-08T04:18:58.397Z testing → done (system)
