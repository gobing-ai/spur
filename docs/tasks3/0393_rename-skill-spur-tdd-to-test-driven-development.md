---
template: feature-impl
schema_version: 1
name: "Rename skill spur-tdd to test-driven-development"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P2
tags: ["sp-plugin", "skills", "rename"]
dependencies: ["0392"]
created_at: "2026-07-30T21:52:24.885Z"
updated_at: "2026-07-31T03:37:40.004Z"
done_forced: "true"
done_reason: Rename complete (1 dir + 13 files); R6 grep clean; structure test asserts new name; lint clean; 427/427 plugin tests pass. omp timed out; work complete.
---

## 0393. Rename skill spur-tdd to test-driven-development

### Background

`plugins/sp/skills/spur-tdd` carries the `spur` product prefix on what is generic test-driven-development discipline, implying a relationship to the Spur CLI that does not exist.

Name chosen: `test-driven-development`. It matches the sibling family already in the plugin — `doubt-driven-development`, `source-driven-development` — and matches the obra/Superpowers precedent cited in task 0161. The initially proposed `tdd-workflow` was rejected on two grounds: no sibling skill uses a `-workflow` category suffix, and `workflow` is already a `spur` noun (the FSM engine), so the name would overload an existing concept.

Blast radius is 21 referencing files, of which about 11 are live; the rest are historical task records under `docs/tasks2/`.

### Requirements
R1. The directory is renamed from `plugins/sp/skills/spur-tdd` to `plugins/sp/skills/test-driven-development`.
R2. The skill's frontmatter `name` field matches the new directory name.
R3. All live referencing files point at the new name: `plugins/sp/README.md`, `plugins/README.md`, `plugins/sp/skills/code-implementation/SKILL.md` and its `references/implementation-patterns.md`, `plugins/sp/skills/code-testing/SKILL.md` and its `references/unit-testing.md`, `plugins/sp/skills/code-simplification/SKILL.md`, `plugins/sp/skills/reverse-engineering/SKILL.md`, `plugins/sp/skills/spur-dev/SKILL.md`, `docs/05_FEATURES.md`, `docs/features/H1_spur-dev-skill.md`.
R4. `plugins/sp/tests/skill-structure.test.ts:704` is updated to the new name.
R5. `docs/tasks2/*` historical records are left unmodified.
R6. No live reference to `spur-tdd` remains.
R7. The skill's own content is unchanged apart from its name and any self-references.
### Acceptance Criteria
```gherkin
Feature: TDD skill renamed off the spur namespace

  Scenario: The TDD skill is renamed off the spur namespace
    Given the skill directory was plugins/sp/skills/spur-tdd
    When the rename lands
    Then the directory is plugins/sp/skills/test-driven-development
    And the skill frontmatter name field matches the directory

  Scenario: Live references follow the rename
    Given about 11 live files referenced spur-tdd
    When the rename lands
    Then each points at test-driven-development
    And no live reference to spur-tdd remains

  Scenario: Historical records are preserved
    Given docs/tasks2/ contains records naming spur-tdd
    When the rename runs
    Then those files are left unmodified

  Scenario: The structure test passes with the new name
    Given skill-structure.test.ts asserted on the old name
    When the rename lands
    Then the test asserts on test-driven-development
    And bun run test passes

  Scenario: Skill content is otherwise unchanged
    Given the rename is content-neutral
    When the skill body is compared before and after
    Then only the name and self-references differ
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Rename only — no content change — so the diff stays reviewable and any behavioral regression is attributable to the rename rather than to an edit made in passing.

WHY not leave a back-compat alias: skill names are resolved by directory, and an alias directory would either duplicate content (drift risk) or hold a pointer file the loader does not understand. The reference set is small and fully enumerable, so a clean rename is cheaper than a compatibility layer.

This task is independent of the agent rescope and can run in parallel with it. Its only ordering constraint is against the reference-sweep task, since both edit `plugins/sp/README.md`, `plugins/README.md`, `docs/05_FEATURES.md`, and `docs/features/H1_*.md` — running them concurrently would conflict on those four files.
### Plan
- [ ] `git mv plugins/sp/skills/spur-tdd plugins/sp/skills/test-driven-development`
- [ ] Update the frontmatter `name` field and any self-references in SKILL.md
- [ ] Update the ~10 live referencing files
- [ ] Update `skill-structure.test.ts:704`
- [ ] Verify no live `spur-tdd` reference remains outside `docs/tasks2/`
- [ ] Run `bun run test` and confirm green
### Solution
Renamed `plugins/sp/skills/spur-tdd` → `plugins/sp/skills/test-driven-development` and updated all live references.

- `git mv plugins/sp/skills/spur-tdd plugins/sp/skills/test-driven-development` — directory rename (R1).
- `plugins/sp/skills/test-driven-development/SKILL.md:2` — frontmatter `name: spur-tdd` → `name: test-driven-development` (R2).
- Reference updates (13 files): `plugins/README.md`, `plugins/sp/README.md` (tree listings, tables, diagram nodes), `plugins/sp/skills/spur-dev/SKILL.md`, `plugins/sp/skills/code-implementation/SKILL.md` + `references/implementation-patterns.md`, `plugins/sp/skills/code-testing/SKILL.md` + `references/unit-testing.md`, `plugins/sp/skills/code-simplification/SKILL.md`, `plugins/sp/skills/reverse-engineering/SKILL.md`, `plugins/sp/skills/test-driven-development/SKILL.md` (self-refs), `docs/05_FEATURES.md`, `docs/features/H1_spur-dev-skill.md` (AC scenarios), `plugins/sp/tests/skill-structure.test.ts:704`.
- Patterns replaced: `sp:spur-tdd` → `sp:test-driven-development`; `` `spur-tdd` `` → `` `test-driven-development` ``; `spur-tdd/` → `test-driven-development/`; bare `spur-tdd` in diagrams/lists → `test-driven-development`.

Historical records untouched (R5): `docs/tasks2/**`, `docs/tasks3/**`. H6 feature plan/AC lines describing the rename itself preserved (lines 23/53/63/139 — the decision record, not a live reference).
### Testing
**Commands run:**
```
rg -n 'spur-tdd' --glob '!node_modules' --glob '!docs/tasks2/**' --glob '!docs/tasks3/**' --glob '!docs/features/H6_*'   # empty (R6 MET)
bun run lint          # biome clean + 7/7 workspaces typecheck exit 0
cd plugins/sp && bun test   # 427 pass, 0 fail, 2040 assertions
```

**R6 verification:** post-rename grep (excluding historical tasks2/3 and the H6 feature's own rename-plan lines) returns zero matches. No live reference to `spur-tdd` remains.

**Structure test (R4):** `skill-structure.test.ts:704` updated to `'test-driven-development'`; the R9/R55 skill-resolution assertions pass.

**Coverage:** rename task; no implementation logic. Structure test is the coverage instrument.
### Review
Three-dimensional review for the spur-tdd → test-driven-development rename. Rename task; the grep-shaped R6 condition + structure test are the coverage instruments.

**Scope:** 1 directory rename + 13 live reference files + 1 structure-test assertion.

**Functional Verdict: PASS** - all R1–R7 MET; no live reference to `spur-tdd` remains (R6 grep clean); structure test asserts the new name (R4).

**P1–P4 findings**

| Priority | Finding | Location | Remediation |
|----------|---------|----------|-------------|
| P4 | H6 feature doc preserves `spur-tdd` in its Goal/Plan/AC text (lines 23/53/63/139) describing the rename decision. Intentional — this is the decision record, not a live reference. A future reader tracing the rename finds the old name there by design. | `docs/features/H6_*.md` | None — historical accuracy of the decision record |

No P1 (blocker), P2 (major), or P3 (minor) findings. No security findings (rename only). No correctness contradictions — the new name matches the sibling family (`doubt-driven-development`, `source-driven-development`) and avoids the `workflow` overload.

**Architecture Review**

Rename task; no module structure changed beyond the directory move. The new name removes a false product-prefix implication (the skill is generic TDD discipline, unrelated to the `spur` CLI). Name aligns with the `-driven-development` sibling family convention.

No deepening or friction introduced.

**Verdict: PASS** - functional traceability complete (7/7 R MET), SECUA clean (no P1–P3; one P4 advisory, intentional), architecture clean (naming convention aligned). Ready for `done`.
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-31T03:37:37.042Z todo → wip (system)
- 2026-07-31T03:37:38.449Z wip → testing (system)
- 2026-07-31T03:37:39.978Z testing → done (system)
