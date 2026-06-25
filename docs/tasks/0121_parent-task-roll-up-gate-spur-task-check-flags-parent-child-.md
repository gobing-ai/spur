---
template: feature-impl
schema_version: 1
name: "Parent-task roll-up gate: spur task check flags parent/child status drift"
description: ""
status: todo
type: task
profile: standard
feature_id: H2
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-25T20:30:58.971Z"
updated_at: 2026-06-25T20:32:03.958Z
---

## 0121. Parent-task roll-up gate: spur task check flags parent/child status drift

### Background
Tier 2 of the parent-task decomposition fix (Tier 1 = the doc convention added to decomposition.md
on 2026-06-25). Surfaced when task 0109 was found to have shipped without a sub-task roster, making
its completeness unverifiable: `spur task check` validates a task's *structure* (sections present,
traceability edges resolve) but has **no roll-up awareness** of the parent↔child status relationship.

Today nothing catches the two failure modes of a decomposed parent:
1. a parent marked `done` while one or more children (`parent_wbs` = parent) are still open; or
2. all children `done`/`cancelled` while the parent sits open — finished work that looks unfinished.

The convention is now documented (decomposition.md → "Parent (umbrella) tasks": the roster lives in
the parent's `## Plan`; a parent is complete only when every child is `done`/`cancelled`), but it is
unenforced. This task adds the enforcement gate so the convention is machine-checked, not just prose.

Reference: plugins/sp/skills/spur-dev/references/decomposition.md (Parent umbrella tasks subsection);
the existing structural validator in packages/domain (task check L1–L4); the parent_wbs edge already
resolved by L4 traceability.
### Requirements

- [ ] R1. **Parent/child status roll-up check** in `spur task check`: for any task that has children (one or more tasks whose `parent_wbs` points at it), validate the status relationship — warn (a) when the parent is `done` while a child is not `done`/`cancelled`, and (b) when all children are `done`/`cancelled` while the parent is still open. Severity = **warning** by default (advisory, like the existing AC-coverage L4 check); `--strict` elevates per the established convention.
- [ ] R2. **Roster presence check (advisory):** when a task has children, warn if its `## Plan` does not contain a sub-task roster (the table from decomposition.md). This catches the exact 0109 omission. Keep it a warning — never block on a missing roster.
- [ ] R3. **No false positives on non-parents:** a task with zero children is unaffected; the check is inert unless `parent_wbs` edges point at the task. Reuse the L4 edge resolution already built — do not re-scan the corpus a second time.
- [ ] R4. **ADR for the new gate behavior:** roll-up validation is a new cross-cutting `task check` semantic (it reads sibling/child tasks, not just the task under check). Add a dated ADR entry (or amend the planning-layer ADR-020) defining the roll-up rule and its warning/strict severity, then sync `04_DESIGN §7.1` (the `task check` row) and `AGENTS.md` in the same commit.
- [ ] R5. **Optional follow-on (scope guard — decide, don't silently include):** a command-driven roster *refresh* for parents (mirroring `spur feature refresh`'s auto-generated `## Tasks` block) so the status column stays current without hand-editing. Recommend deferring to its own task unless trivial; this task is the GATE, not the generator.
- [ ] R6. **Validate:** `bun run lint` green; tests cover both roll-up directions (parent-done-child-open, all-children-done-parent-open), the no-children inert case, and the missing-roster warning; verify against 0109 (should warn until 0114 is done) as a real-corpus fixture.

### Acceptance Criteria

```gherkin
Feature: Parent-task roll-up gate: spur task check flags parent/child status drift

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Design
**Chosen approach: extend the existing `task check` L4 traceability layer with a roll-up pass — reuse the already-resolved `parent_wbs` edges; do not add a new scan.** L4 already loads the corpus and resolves `feature_id`/`parent_wbs`/`dependencies` edges; the roll-up check is a derivation over data L4 already has in hand.

**Rule (warning severity; `--strict` elevates):**
```
children(t) = { c : c.parent_wbs == t.wbs }
if children(t) is non-empty:                       # t is a parent/umbrella
    if t.status == done  and any c not in {done, cancelled}  -> WARN "parent done with open child <c>"
    if all c in {done, cancelled} and t.status not in {done, cancelled} -> WARN "all children closed; parent still open"
    if t.## Plan has no sub-task roster table        -> WARN "parent missing sub-task roster (decomposition.md)"
```

**Why warning, not error:** mirrors the existing L4 AC-coverage check (DD-09 warns by default). A parent mid-decomposition is a normal transient state; blocking would fight the workflow. `--strict` is the gate for a release sweep.

**Why no new scan (R3):** the validator already iterates all tasks for L4; collect a `parentWbs -> children[]` index in the same pass and evaluate roll-up from it. O(n) over the corpus already being read.

**Boundary:** this is a CHECK, not a generator. The roster is still authored by hand at batch-create (Tier 1 convention); R5's auto-refresh is explicitly out unless trivial. The check reading a missing roster (R2) is the bridge — it nudges toward the convention without automating it.

**Invariants:** zero behavior change for tasks without children; `--json` output gains roll-up findings under the same findings array shape L4 already emits (no new envelope); exit-code semantics unchanged (warnings don't fail unless `--strict`).

**Key signatures (not bodies):**
```
// within the L4 pass, given the corpus already loaded:
function checkParentRollup(parent: TaskRow, children: TaskRow[]): Finding[];
```
### Plan

- [ ] Implementation step

### Solution

### Testing

### Review

### References

### History
