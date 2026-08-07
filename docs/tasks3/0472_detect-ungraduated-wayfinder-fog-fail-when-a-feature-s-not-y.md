---
template: feature-impl
schema_version: 1
name: "Detect ungraduated wayfinder fog: fail when a feature's Not-yet-specified shrinks without new tickets"
description: ""
status: todo
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-07T05:48:12.113Z"
updated_at: "2026-08-07T22:18:30.391Z"
---

## 0472. Detect ungraduated wayfinder fog: fail when a feature's Not-yet-specified shrinks without new tickets

### Background
**Process-hardening ticket.** Extends feature N from pipeline-class waste to corpus-gate leakage —
the same failure shape (a gate that does not fire) in the planning half rather than the execution half.

#### The obligation that has no enforcement

The wayfinder protocol (`plugins/sp/skills/wayfinder/SKILL.md`, "Work Through the Map" step 6 and the
Resolution-verification checklist) requires that resolving a ticket:

1. graduates any newly-specifiable fog into fresh child tasks, **and**
2. removes that graduated patch from the map's `## Not yet specified`, so it lives only as its ticket.

Both halves are prose. Neither has any machine representation, in the corpus or in a gate.

#### The incident (2026-08-07)

Resolving the consumption-surface ticket on feature E1 performed **half** the obligation: two fog
patches ("Report content", "Delivery") were deleted from `## Not yet specified`, and **zero** tickets
were created. The graduated work then existed nowhere — not as fog, not as a ticket. The map read as
*more* complete than before, because the fog list had shrunk.

It was caught only because a human asked "anything remained?". `spur task check` and
`spur feature check` both passed throughout: they validate a document's **internal** shape, and this
is a **cross-artifact** invariant between a feature's fog section and the existence of child tasks.

**Doing half the obligation is strictly worse than doing neither.** Leaving the fog in place loses
nothing; deleting it without ticketing destroys the only record that the work was ever identified.

#### Why the obvious design is the wrong one

The first-instinct fix is a `graduated: [wbs, ...]` frontmatter list on the resolved task, with
`feature check` verifying each id exists.

**Reject it.** It checks the wrong half. A `graduated:` list you forget to populate fails exactly as
silently as the prose it replaces — it is self-reported, and the incident was precisely a failure to
self-report. It would add schema surface and catch nothing.

#### The design: make the deletion the trigger

Invert it. The detectable event is not "did you list what you created" but **"you removed scope —
where did it go?"**. Fog shrinking is a diff-visible fact that needs no new schema and cannot be
forgotten, because it *is* the destructive act itself.

Rule, evaluated over a revision range:

| `## Not yet specified` | New tasks for that feature | `## Out of scope` grew | Verdict |
| --- | --- | --- | --- |
| unchanged / grew | — | — | pass (nothing was removed) |
| shrank | ≥ 1 added | — | pass (graduated) |
| shrank | none | yes | pass (ruled out of scope — the protocol's other legal exit) |
| shrank | none | no | **fail — ungraduated fog** |

The third row matters: the protocol has two legal ways to remove fog — graduate it into tickets, or
rule it beyond the destination and record it in `## Out of scope`. A check that only knows about the
first would false-positive on every legitimate scope cut, and a gate that cries wolf gets disabled.

#### Prior art in this repo to reuse, not reinvent

- `scripts/commands/corpus-check.ts` — the sweep-and-diff-against-baseline harness, its two-sided
  baseline contract, and its output format. This check should land as part of that command or as a
  sibling sharing its baseline file, not as a third independent gate.
- `config/corpus-baseline.json` — the accepted-exception format (kind/id/code/reason/since), including
  the rule that a stale entry fails the gate so the list cannot rot.
- Constitution **T10** (§5) — the same-commit reconciliation obligation this check would participate in.
### Requirements
- R1 — Detect, over a defined git revision range, that a wayfinder map's fog section shrank, measured by a rule robust to reflow, rewording, and reordering rather than raw character count. The section is `### Not yet specified` nested under `## Notes` — not a top-level heading — and its text varies (`### Not yet specified (fog of war)` vs `### Not yet specified`), so the locator must tolerate a trailing parenthetical.
- R2 — Detect, over the same range, whether any task carrying that feature's `feature_id` was added — counting both a task file new in the range and an existing task re-parented to that feature, since re-parenting is a legitimate graduation.
- R3 — Detect, over the same range, whether that feature's `### Out of scope` section grew — the protocol's second legal exit for removed fog. Same nested-heading treatment as R1.
- R4 — Fail only when fog shrank AND no task was added for the feature AND `### Out of scope` did not grow; pass in every other combination, so a legitimate scope cut is never a false positive.
- R5 — Implement the branch-scoped revision range: default `merge-base(origin/main, HEAD)..HEAD` plus the working tree, with an explicit `--since <ref>` override for manual audits, and skip when HEAD has no divergence from the default branch. Name the evaluated range in the output, including on the skip path. The range is branch-scoped because fog-shrink and ticket-creation are measured to land in **different commits**, so any single-commit or working-tree-vs-HEAD range false-positives.
- R10 — Make wayfinder sessions run on a branch part of the `sp:wayfinder` protocol, since a branch-scoped range only ever fires when the session has a branch boundary. Without this half, the check is inert on linear default-branch work — which is exactly how the incident that motivated it occurred.
- R6 — Report a violation with the feature id, the removed fog text, and the two remediations (create the graduated tickets, or record the cut in `### Out of scope`) — never a bare assertion failure.
- R7 — Integrate as a producer inside the existing `corpus-check` surface, alongside `duplicateIds`, and reuse `config/corpus-baseline.json` and its two-sided contract for accepted exceptions rather than introducing a second exemption mechanism.
- R8 — Handle the no-git, shallow-clone, no-file-history, and no-usable-range cases by skipping with a clear message rather than failing, so the gate does not break a tarball checkout, a CI shallow fetch, or ordinary work on the default branch.
- R9 — Cover the rule with tests over synthetic feature files across all four rows of the decision table including the reflow-not-shrinkage case, and replay one real graduation span from git history to prove the chosen range works against how sessions actually commit.
### Acceptance Criteria
```gherkin
Feature: 0472 ungraduated wayfinder fog is detected

  Scenario: R4 — deleting fog without ticketing fails the gate
    Given a feature whose fog section loses an item in the range
    And no task carrying that feature id was added in the same range
    And the feature's out-of-scope section did not grow
    When the fog check runs
    Then it fails naming the feature and the removed fog text
    And it offers both remediations

  Scenario: R4 — graduating fog into tickets passes
    Given a feature whose fog section loses an item in the range
    And at least one task carrying that feature id was added in the same range
    When the fog check runs
    Then it passes

  Scenario: R3 — ruling fog out of scope passes
    Given a feature whose fog section loses an item in the range
    And no task was added for that feature
    And the feature's out-of-scope section grew in the same range
    When the fog check runs
    Then it passes

  Scenario: R1 — reflowing fog text is not shrinkage
    Given a feature whose fog items are rewrapped, reworded, or reordered with none removed
    When the fog check runs
    Then it does not report shrinkage

  Scenario: R1 — the fog section is found where it actually lives
    Given maps whose fog heading is nested under Notes and spelled with and without a parenthetical
    When the fog check locates the section
    Then it is found in both spellings across every existing map

  Scenario: R7 — an accepted violation is baselined like any other corpus finding
    Given a known fog violation recorded in the corpus baseline with a reason and a date
    When the corpus check runs
    Then the gate passes
    And the entry fails the gate once the underlying violation no longer reproduces

  Scenario: R8 — an unusable range degrades gracefully
    Given a working copy with no git history, a shallow clone, or no divergence from the default branch
    When the fog check runs
    Then it skips with an explanatory message rather than failing

  Scenario: R2 — re-parenting an existing ticket counts as graduation
    Given a feature whose fog section loses an item in the range
    And an existing task had its feature id changed to that feature in the same range
    When the fog check runs
    Then it passes

  Scenario: R5 — the evaluated revision range is stated, not implied
    Given the fog check runs
    When it reports its result
    Then the revision range it evaluated is named in the output
    And the range is named on the skip path too

  Scenario: R5 — the branch-scoped range spans a whole session
    Given a wayfinder session on a branch whose fog edit and ticket creation are separate commits
    When the fog check runs with the default range
    Then both commits fall inside the evaluated range
    And an explicit since override replaces that range when given

  Scenario: R10 — the protocol puts wayfinder sessions on a branch
    Given the wayfinder skill's charting and resolution instructions
    When they are followed
    Then the session runs on a branch rather than directly on the default branch
    And the reason the check depends on that boundary is stated in the skill

  Scenario: R6 — a violation names the fog and both remediations
    Given an ungraduated fog violation
    When the fog check reports it
    Then the output carries the feature id, the removed fog text, and both remediation paths

  Scenario: R9 — the decision table and one real graduation span are covered
    Given synthetic feature files exercising each row of the decision table
    And a replay of a real graduation whose fog edit and ticket creation landed in different commits
    When the test suite runs
    Then every row including the reflow case has a passing assertion
    And the real graduation span passes rather than false-positiving
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *Is the fog section `## Not yet specified`?* **No — `### Not yet specified`, nested under
  `## Notes`.** No feature file has it at `##`. Eight features carry it at `###`, and the heading text
  varies (`### Not yet specified (fog of war)` in M, `### Not yet specified` in E1). Requirements R1
  and R3 and the original Design all said `##`; a parser written to that would have matched nothing.
- *How is shrinkage measured without breaking on reflow (R1)?* The **set of top-level bullet leading
  bold labels** in the fog subsection, which is the shape every existing map uses. Shrinkage = a label
  present at the range start and absent at the end. Character and line counts break on rewrap;
  full-text diffing breaks on rewording. Bullets with no bold label fall back to a normalized first
  sentence.
- *Does re-parenting an existing ticket count as graduation (R2)?* **Yes.** "Added" means
  `feature_id` matches at the range end and either the file did not exist at the range start or its
  `feature_id` differed. Requiring a brand-new file would false-positive on a legitimate re-parent.
- *Where does the check integrate (R7)?* As a producer function beside `duplicateIds()` in
  `scripts/commands/corpus-check.ts:101-141` — the existing precedent for a non-per-file check that
  emits `CorpusError[]` into the shared baseline pipeline, with a script-local code
  (`corpus.duplicate-id`) and no `finding-codes.ts` registration. Code: `corpus.ungraduated-fog`.
- *Why not the `graduated: [wbs, …]` frontmatter list?* It checks the wrong half — it is self-reported,
  and the incident was precisely a failure to self-report. It would add schema surface and catch
  nothing. (Already rejected in Background; restated because it is the first instinct every time.)

- *What revision range does the check evaluate (R5)?* **DECIDED 2026-08-07 by the operator: option
  (a), branch-scoped.** Default `merge-base(origin/main, HEAD)..HEAD` plus the working tree, explicit
  `--since <ref>` for manual audits, skip on an undiverged default branch. Rejected: a time-window
  default for linear-main work (b) — a wrong window produces the false positive that gets the gate
  disabled. **Accepted cost:** the check is inert on the default branch and would not have caught the
  2026-08-07 incident; **R10 (protocol puts wayfinder sessions on a branch) is the compensating half
  and ships with it, not after.** The evidence that forced this choice:

- `ee0771ab` "complete E1 investigation, **graduate implementation tasks**" — 2 features modified,
  **0 tasks added**.
- `c9bc177b` (next) "**graduate E1 wayfinder investigation tasks**" — **8 tasks added**, 0 features.

  The fog edit precedes its tickets by a commit, in both graduation rounds — so `HEAD~1..HEAD`
  false-positives on `ee0771ab`, and working-tree-vs-HEAD false-positives at that same edit, because
  the tickets are not written yet either. Both ranges the original Design proposed are ruled out by
  its own "confirm against how resolutions actually landed" instruction.

**Nothing open. This task is implementable as specified.**

**Ordering.** No `dependencies[]`. **Prefer landing 0473 first** so this consumes `WAYFINDER_MAP_TAG`
instead of sniffing headings — that ticket's R5 now marks all eight maps for exactly this reason. Not
a hard blocker: fall back to locating the nested fog heading, and switch to the marker when it exists.
### Design
**WHAT.** A corpus-check producer that fails when a wayfinder map's fog section shrank without either
graduated tickets or a recorded scope cut.

**WHY.** Doing half the graduation obligation is strictly worse than doing neither: leaving fog in
place loses nothing; deleting it without ticketing destroys the only record the work was identified.
Both halves are prose today, with no machine representation and no gate.

#### Measured 2026-08-07 — three findings, two of which overturn the original design sketch

**1. The map sections are `###` under `## Notes`, not `##`.** No feature file has a top-level
`## Not yet specified`. Eight features carry `### Not yet specified` nested inside `## Notes`
(M, M1, M3, M4, D1, E1, F82, B2), and the heading text varies: M writes
`### Not yet specified (fog of war)`, E1 writes `### Not yet specified`. Requirements and the original
Design both said `##`. Any parser must target the nested heading and tolerate a trailing
parenthetical — or, better, consume the map marker from the sibling ticket and locate the subsection
within `## Notes`.

**2. Fog-shrink and ticket-creation do NOT land in the same commit.** This is the finding that
overturns the range recommendation. The E1 graduation, walked in git:

| Commit | Subject | Features modified | Tasks added |
| --- | --- | --- | --- |
| `6b353fe4` | chart E1 map with 12 tasks | 0 | **12** |
| `ee0771ab` | complete E1 investigation, **graduate implementation tasks** | 2 | **0** |
| `c9bc177b` | add corpus-check gate and **graduate E1 tasks** | 0 | **8** |
| `09a9a9d6` | decisions are not tasks; complete E1 investigation | 2 | **0** |

The fog edit precedes its tickets by a commit, in both graduation rounds. So **any narrow range
false-positives**: `HEAD~1..HEAD` fails on `ee0771ab`; working-tree-vs-HEAD fails at the moment of
that same edit, because the tickets are not written yet either. The original Design's recommendation
(working-tree-vs-HEAD, "confirm against how the last three wayfinder resolutions actually landed") was
the right instinct and the confirmation **falsifies it**.

**3. `corpus-check` already has the exact integration seam.** `duplicateIds()`
(`scripts/commands/corpus-check.ts:101-141`) is a non-per-file producer that emits `CorpusError[]`
into the same baseline pipeline as the per-file `sweep()`, using a script-local code namespace
(`corpus.duplicate-id`) with no `finding-codes.ts` registration. That is precisely this check's shape.

#### The range (R5, R10) — DECIDED 2026-08-07 (operator): branch-scoped

**Default `merge-base(origin/main, HEAD)..HEAD` plus the working tree. Explicit `--since <ref>`
overrides it for manual audits. When HEAD has no divergence from the default branch, SKIP with a
message** — the same graceful degradation R8 mandates for no-git and shallow clones.

Rationale: the range must span a whole wayfinder session, because the session is what spans commits
(finding 2). A branch gives that boundary for free. The rejected alternative was a time window on a
linear main branch, where a wrong guess produces exactly the false positive the decision table exists
to avoid — **and a gate that cries wolf gets disabled**, which costs more than the check buys.

**The accepted cost, stated rather than hidden:** this range is **inert on the default branch**, so it
would not have caught the 2026-08-07 incident, which happened directly on `main`. That is why **R10
is not optional** — the branch-scoped range only ever fires if the protocol puts wayfinder sessions on
a branch. Shipping the detector without the protocol change yields a check that can never fire in the
workflow that produced the bug. Land both halves or neither.

#### The rule (R1–R4) — unchanged from the decision table, with the shrinkage measure fixed

| Fog section | New tasks for that feature | `### Out of scope` grew | Verdict |
| --- | --- | --- | --- |
| unchanged / grew | — | — | pass |
| shrank | ≥ 1 added | — | pass (graduated) |
| shrank | none | yes | pass (ruled out of scope) |
| shrank | none | no | **fail — ungraduated fog** |

**Shrinkage measure (R1):** compare the **set of top-level `-` bullet leading bold labels** in the
fog subsection (`**Report content.**`, `**Delivery.**` — the shape every existing map uses), not
character or line count. Shrinkage = at least one label present at the range start and absent at the
end. Reflow, rewording within a bullet, and reordering are all invisible to this measure, which is
what R1 asks for. A fog bullet with no bold label falls back to its normalized first sentence.

**Task-added (R2):** a task whose frontmatter `feature_id` equals the feature at the range end and
either (a) the file did not exist at the range start, or (b) its `feature_id` differed at the range
start. Re-parenting an existing ticket is a legitimate graduation, so both count.

#### Frozen names

- `ungraduatedFog(cwd, range): Promise<CorpusError[]>` in `scripts/commands/corpus-check.ts`, called
  from `corpusCheck()` alongside `sweep()` and `duplicateIds()`.
- Code: `corpus.ungraduated-fog` — script-local namespace, matching `corpus.duplicate-id`. No
  `finding-codes.ts` entry.
- Baseline identity: `feature:<id>:corpus.ungraduated-fog`, via the existing `key()` at `:45`.

#### Anti-patterns

- Do **not** implement the `graduated: [wbs, …]` frontmatter list. It is self-reported, and the
  incident was precisely a failure to self-report — it would fail as silently as the prose it replaces.
- Do **not** make this a third standalone gate. One corpus gate, one baseline, one output format.
- Do **not** introduce a second exemption mechanism (R7). Reuse `config/corpus-baseline.json` and its
  two-sided contract — a stale entry must keep failing the gate.
- Do **not** fire on fog growth, rewording, or reordering. One destructive act only.
- Do **not** sniff the `### Not yet specified` heading to decide map-ness. The heading text already
  varies; consume the marker instead.
- Do **not** guess a revision window on a linear branch. Skip with a message (see above).

#### Handoff

- **Assumes from the sibling map-marker ticket (0473):** `WAYFINDER_MAP_TAG` and the guarantee that
  **all eight** maps carry it. **Land 0473 first** — that ticket's R5 was rewritten to mark all eight
  precisely so this check can consume the marker rather than sniff headings. Not a hard blocker: if
  this lands first, detect maps by locating `### Not yet specified` under `## Notes` (tolerating the
  parenthetical) and switch to the marker when it exists.
- **Leaves nothing downstream.**

**ADR: no.** One producer function inside an existing gate, one baseline code.
### Plan
- [ ] **0. Baseline.** `bun run corpus-check` green; record the current counts so the R7 integration
      can be shown not to change them. The range is settled (branch-scoped, `### Q&A`) — no spike
      needed.
- [ ] **1. Range resolver (R5).** `merge-base(origin/main, HEAD)..HEAD` plus the working tree;
      `--since <ref>` overrides; no divergence from the default branch ⇒ skip. Test all three paths,
      including that the resolved range is reported on the skip path.
- [ ] **2. Fog-section parser (R1).** Locate `### Not yet specified` **under `## Notes`**, tolerating a
      trailing parenthetical (`(fog of war)`). Extract the set of top-level bullet labels. Test
      against all eight real maps in `docs/features/` — not synthetic files only; the parser must
      cope with both real heading spellings.
- [ ] **3. Shrinkage measure (R1), reflow case first.** Assert that rewrapping, rewording within a
      bullet, and reordering produce **no** shrinkage, and that removing one label does. Writing the
      negative case first is what keeps the measure honest.
- [ ] **4. Task-added detection (R2).** A task whose `feature_id` matches at the range end and that
      either did not exist at the range start or carried a different `feature_id` then. Test both the
      new-file and the re-parented case.
- [ ] **5. Out-of-scope growth (R3).** Same nested-heading treatment as step 2, applied to
      `### Out of scope`.
- [ ] **6. Decision table (R4, R9).** Implement the four-row rule and cover every row with synthetic
      feature files, plus the step-3 reflow case. The third row (scope cut recorded as out-of-scope)
      is the one that prevents the false positive that would get the gate disabled — do not skip it.
- [ ] **7. Graceful degradation (R8).** No git, shallow clone, no history for the feature file, and
      the on-main-no-divergence case all **skip with an explanatory message**, never fail. Test each.
- [ ] **8. Violation report (R6).** Emit the feature id, the removed fog labels, and **both**
      remediations (create the graduated tickets, or record the cut in `### Out of scope`). Assert the
      message contains all three — a bare assertion failure is a defect here, not a style preference.
- [ ] **9. Protocol half (R10) — ships with the detector, not after.** Update
      `plugins/sp/skills/wayfinder/SKILL.md` so charting and resolution run on a branch, and state why
      the fog check depends on that boundary. Without this the detector is inert on the default
      branch and can never fire in the workflow that produced the incident.
- [ ] **10. Integration (R7).** Add `ungraduatedFog()` to `corpusCheck()` beside `sweep()` and
      `duplicateIds()` (`scripts/commands/corpus-check.ts:144-189`), emitting
      `corpus.ungraduated-fog` through the existing `key()` identity. Verify a baselined violation
      passes **and** that a baseline entry whose violation no longer reproduces still fails as stale.
- [ ] **11. Regression against reality.** Replay the E1 range `ee0771ab..c9bc177b`: the fog shrank in
      the first commit and the tickets landed in the second, so a correct implementation **passes**
      over that span and only fails when the span truly contains no graduation. This is the test that
      proves the range choice works on real history rather than on fixtures.
- [ ] **12. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test` green.
      Confirm `corpus-check` counts are unchanged from step 1 except for intended new findings.
- [ ] **13. Record.** `### Solution` gets the `path:line` change map and the settled range with its
      justification; `### Testing` gets the commands, the four-row coverage, and the step-11 replay.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
