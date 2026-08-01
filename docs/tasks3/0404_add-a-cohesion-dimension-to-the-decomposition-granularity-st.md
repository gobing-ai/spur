---
template: feature-impl
schema_version: 1
name: "Add a cohesion dimension to the decomposition granularity standard"
description: ""
status: todo
type: task
profile: standard
feature_id: H8
parent_wbs: null
priority: P1
tags: ["sp-plugin", "skills", "process"]
dependencies: []
created_at: "2026-08-01T05:20:37.436Z"
updated_at: "2026-08-01T05:26:37.978Z"
---

## 0404. Add a cohesion dimension to the decomposition granularity standard

### Background

H8's own first decomposition is the evidence. It produced five tasks, each 3-8h and therefore fully compliant with the granularity knobs in `plugins/sp/skills/spec-decomposition/references/decomposition.md` (`min_hours: 2`, `target_min_hours: 2`, `target_max_hours: 8`, `force_decompose_above_hours: 16`). The operator rejected it as over-split, and was right: three of the five edited the same files (`dev-operations.md` and the `plugins/sp/commands/*.md` surface), so the split created contention over one file surface and tripled the ceremony for a diff a reviewer reads once.

The standard measures task size in hours and is silent on the fixed per-task overhead: precheck, implement, test, review, approve, verify, record, done, plus a verdict artifact with full requirement and AC tables, plus gate remediation at each transition. Feature H6 spent roughly 20 hours on six small tasks with much of it going to that toll rather than to the work.

The fix is a second dimension, not a change to the hour bounds — hours remain a useful upper guard.

### Requirements
R1. Add an explicit cohesion rule to the granularity guidance: work that edits the same files, or that requires the same review context to judge, is one task even when the hour estimate would justify splitting.
R2. Name the reason in the reference itself — ceremony cost is per-task, so splitting cohesive work multiplies overhead without reducing risk. A standard whose rationale is unwritten gets re-litigated.
R3. State the precedence between the two dimensions: cohesion decides whether a split is legitimate at all; the hour knobs then bound how large a single cohesive task may get before `force_decompose_above_hours` applies regardless.
R4. Give at least one worked example of a split that satisfies the hour bounds but violates cohesion, so the rule is applicable rather than abstract. H8's original five-task split is the natural candidate and is already documented.
R5. Update the `spec-decomposition` SKILL.md sizing guidance so it cites the cohesion rule alongside the hour knobs. The skill currently says "Size by the standard, not by feel" and points only at the hour bounds.
R6. Do not change the existing hour values. They were not the defect and changing them would confound this fix with a separate judgment.
R7. Scope note: this task is process guidance for the sp skills, not command-surface work. It lives in H8 because H8's planning produced the evidence and the fix is a single reference file; creating a separate feature for one doc change would itself be the ceremony this task exists to reduce.
### Acceptance Criteria
```gherkin
Feature: cohesion in the decomposition standard

  Scenario: The cohesion rule is stated in the granularity guidance
    Given the decomposition reference
    When the granularity guidance is read
    Then it states that work editing the same files or sharing a review context is one task
    And it states that this holds even when the hour estimate would justify splitting

  Scenario: The rationale is written down
    Given the cohesion rule
    When its justification is read
    Then it names per-task ceremony cost as the reason

  Scenario: Precedence between the dimensions is unambiguous
    Given both the cohesion rule and the hour knobs
    When a decomposer applies them to one feature
    Then the reference states which decides legitimacy of a split
    And which bounds the size of a single cohesive task

  Scenario: A worked example makes the rule applicable
    Given the cohesion rule
    When an example is sought
    Then the reference shows a split that met the hour bounds but violated cohesion

  Scenario: The skill cites the new dimension
    Given spec-decomposition SKILL.md sizing guidance
    When it is read
    Then it cites the cohesion rule alongside the hour knobs

  Scenario: The hour values are unchanged
    Given the granularity knobs
    When the diff is reviewed
    Then min_hours, target_min_hours, target_max_hours and force_decompose_above_hours are unmodified
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
#### Shape of the change

Two edits, both small:

1. `plugins/sp/skills/spec-decomposition/references/decomposition.md` — the granularity knobs are
   YAML frontmatter with a comment noting they are "judgment guidance, not runtime-enforced". The
   cohesion rule is prose, not a knob: it has no numeric value and cannot be expressed as an hour
   bound. Add it as a short subsection adjacent to the knobs so the two are read together, and leave
   the frontmatter untouched (R6).
2. `plugins/sp/skills/spec-decomposition/SKILL.md` — the sizing bullet currently reads "Size by the
   standard, not by feel" and points only at the hour knobs. It gains a second clause pointing at
   cohesion.

#### Why prose rather than a knob

Every instinct here says "add `max_files_shared` or similar and make it checkable". Resist it. The
signal is *whether two tasks would be reviewed together*, which is a judgment about coupling, not a
file count — two tasks touching one shared config file may be genuinely independent, and two tasks
touching disjoint files may share a review context entirely. A numeric proxy would be wrong often
enough to be ignored, and an ignored rule is worse than a prose one that gets read.

#### The worked example is the payload

R4's example does more work than the rule statement. Use H8's original split concretely: five tasks,
each 3-8h and therefore inside `target_min_hours`/`target_max_hours`, where 0399/0401/0402 all edited
`dev-operations.md` and the `plugins/sp/commands/*.md` surface. Show the merge that resulted (5 → 4)
and name what it saved: two full sets of pipeline ceremony over a diff a reviewer reads once.

An abstract rule with a concrete counterexample is applicable; an abstract rule alone gets
re-litigated at the next decomposition.

#### Precedence wording

State it as an order of application, not a priority ranking: cohesion first decides *whether the
split is legitimate*; the hour knobs then decide *whether the resulting task is too large*, with
`force_decompose_above_hours` overriding cohesion when a single cohesive task grows past it. That
last clause matters — without it the rule reads as "never split", which is the opposite failure.
### Plan
- [ ] Re-read the granularity knobs and the SKILL.md sizing section.
- [ ] Draft the cohesion rule, its rationale, and the precedence statement.
- [ ] Write the worked example from H8's original five-task split (0399/0401/0402 contending over the same files).
- [ ] Update SKILL.md to cite both dimensions.
- [ ] Confirm via `git diff` that no hour value changed.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

H8

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
