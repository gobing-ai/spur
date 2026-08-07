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
updated_at: "2026-08-07T05:49:28.660Z"
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
- R1 — Detect, over a defined git revision range, that a feature file's `## Not yet specified` section shrank, measured by a rule robust to reflow and rewording rather than raw character count.
- R2 — Detect, over the same range, whether any task carrying that feature's `feature_id` was added.
- R3 — Detect, over the same range, whether that feature's `## Out of scope` section grew — the protocol's second legal exit for removed fog.
- R4 — Fail only when fog shrank AND no task was added for the feature AND `## Out of scope` did not grow; pass in every other combination, so a legitimate scope cut is never a false positive.
- R5 — Define and document the revision range the check evaluates (working tree vs HEAD, staged vs unstaged, or an explicit A..B), and justify the choice against how wayfinder sessions actually commit.
- R6 — Report a violation with the feature id, the removed fog text, and the two remediations (create the graduated tickets, or record the cut in `## Out of scope`) — never a bare assertion failure.
- R7 — Integrate with the existing corpus-check surface and reuse `config/corpus-baseline.json` for accepted exceptions rather than introducing a second exemption mechanism.
- R8 — Handle the no-git and shallow-clone cases by skipping with a clear message rather than failing, so the gate does not break a tarball checkout or a CI shallow fetch.
- R9 — Cover the rule with tests over synthetic feature files across all four rows of the decision table, including the reflow-not-shrinkage case from R1.
### Acceptance Criteria
```gherkin
Feature: 0472 ungraduated wayfinder fog is detected

  Scenario: R4 — deleting fog without ticketing fails the gate
    Given a feature whose Not-yet-specified section loses an item in the range
    And no task carrying that feature id was added in the same range
    And the feature's Out-of-scope section did not grow
    When the fog check runs
    Then it fails naming the feature and the removed fog text
    And it offers both remediations

  Scenario: R4 — graduating fog into tickets passes
    Given a feature whose Not-yet-specified section loses an item in the range
    And at least one task carrying that feature id was added in the same range
    When the fog check runs
    Then it passes

  Scenario: R3 — ruling fog out of scope passes
    Given a feature whose Not-yet-specified section loses an item in the range
    And no task was added for that feature
    And the feature's Out-of-scope section grew in the same range
    When the fog check runs
    Then it passes

  Scenario: R1 — reflowing fog text is not shrinkage
    Given a feature whose Not-yet-specified items are rewrapped or reworded with none removed
    When the fog check runs
    Then it does not report shrinkage

  Scenario: R7 — an accepted violation is baselined like any other corpus finding
    Given a known fog violation recorded in the corpus baseline with a reason and a date
    When the corpus check runs
    Then the gate passes
    And the entry fails the gate once the underlying violation no longer reproduces

  Scenario: R8 — a checkout without git history degrades gracefully
    Given a working copy with no git history available
    When the fog check runs
    Then it skips with an explanatory message rather than failing

  Scenario: R2 — re-parenting an existing ticket counts as graduation
    Given a feature whose Not-yet-specified section loses an item in the range
    And an existing task had its feature id changed to that feature in the same range
    When the fog check runs
    Then it passes

  Scenario: R5 — the evaluated revision range is stated, not implied
    Given the fog check runs
    When it reports its result
    Then the revision range it evaluated is named in the output

  Scenario: R6 — a violation names the fog and both remediations
    Given an ungraduated fog violation
    When the fog check reports it
    Then the output carries the feature id, the removed fog text, and both remediation paths

  Scenario: R9 — the decision table is covered by tests
    Given synthetic feature files exercising each row of the decision table
    When the test suite runs
    Then every row including the reflow case has a passing assertion
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design
**Not yet designed — this section is the implementer's, not the author's.** What follows is the
constraint set the design must satisfy, plus the open questions to resolve first.

#### Open questions to settle before writing code

1. **Revision range (R5) is the load-bearing choice.** A wayfinder session may commit once at the end
   or several times mid-way, and the corpus write happens through `spur task create` / `spur feature
   update` well before any commit. Candidates: uncommitted working tree vs `HEAD` (catches the
   session before it commits, but a mid-session sweep sees fog already deleted and tickets not yet
   created — false positive); `HEAD~1..HEAD` (clean, but only fires after the fact); an explicit
   `--since <ref>`. **Recommendation to evaluate first:** working-tree-vs-HEAD, run only as part of
   `corpus-check`, so the natural fire point is the pre-done gate rather than mid-session. Confirm
   against how the last three wayfinder resolutions actually landed in git before committing to it.
2. **Shrinkage rule (R1).** Raw character or line count breaks on reflow. Candidate: count top-level
   `-` bullets in the section, or diff the set of bullet-leading bold labels (`**Report content.**`),
   which is the shape every existing map uses. Verify against the real `## Not yet specified` blocks
   in `docs/features/` before fixing the rule.
3. **Task-added detection (R2).** `feature_id` frontmatter on new task files is the direct signal.
   Decide whether "added" means a new file in the range or any task whose `feature_id` changed to
   this feature (re-parenting an existing ticket is also a legitimate graduation).

#### Constraints

- **No new exemption mechanism (R7).** Reuse `config/corpus-baseline.json` and its two-sided contract.
- **Must not fire on non-wayfinder features.** Only features that actually carry a `## Not yet
  specified` section participate; every other feature is out of scope by construction.
- **Must degrade, not break (R8).** No git, shallow clone, or a feature file with no history → skip
  with a message.

#### Anti-patterns

- Do **not** implement the `graduated:` frontmatter list — see Background for why it checks the wrong
  half. If a future need makes it genuinely useful, it is additive and independent of this check.
- Do **not** make this a third standalone gate. One corpus gate, one baseline.
- Do **not** fail on fog *growth* or rewording. The check exists for one destructive act.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

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
