---
schema_version: 1
name: "Dev/plan responsibility split — sp:spur-dev = execution, sp:spur-plan = planning"
status: done
template: feature-impl
created_at: 2026-06-24T03:52:29.296Z
updated_at: 2026-06-25T05:26:20.721Z
feature_id: H2
parent_wbs: "0109"
priority: P1
tags: ["sp-plugin", "skills", "refactor"]
---

## 0112. Dev/plan responsibility split — sp:spur-dev = execution, sp:spur-plan = planning

### Background

Covers 0109 R4. sp:spur-dev still carries a `## Planning half` (SKILL.md line 40: feature create/decompose/AC) even though the decided split is sp:spur-plan=planning (steps 3-6) / sp:spur-dev=execution (steps 7-12). Operator decision: KEEP existing names — move the planning content out of sp:spur-dev into sp:spur-plan, sharpen sp:spur-dev to execution only (implement/unit/run/refine + pipeline driving). No new skill names. Update both skills' 'Key distinction' blocks for an unambiguous boundary; ADR amendment clarifying ADR-023.

### Requirements

- [ ] R1. Remove the `## Planning half` from sp:spur-dev/SKILL.md; ensure sp:spur-plan owns the full planning narrative (intake/feature/AC/decompose/batch-create handoff).
- [ ] R2. Sharpen sp:spur-dev to EXECUTION only; update the Key-distinction blocks in both skills.
- [ ] R3. No new skill names; no command repoint needed beyond what sub-task 1 covers.
- [ ] R4. lint green; ADR-026/ADR-023 amendment recorded; 04_DESIGN/05_FEATURES synced.

### Acceptance Criteria
```gherkin
Feature: Split sp:spur-dev planning half into sp:spur-plan

  Scenario: Planning content removed from sp:spur-dev
    Given sp:spur-dev/SKILL.md
    When the split is complete
    Then the "## Planning half" section no longer exists
    And all planning procedures (intake, feature create, AC generation, decomposition, batch-create) are owned by sp:spur-plan

  Scenario: sp:spur-dev is execution-only
    Given sp:spur-dev/SKILL.md after the split
    When an agent reads the skill
    Then only execution-half content is present (implement, unit, run, refine, pipeline driving)
    And the "Key distinction" block clearly marks sp:spur-dev = execution (steps 7-12)

  Scenario: sp:spur-plan owns full planning narrative
    Given sp:spur-plan/SKILL.md
    When an agent reads the skill
    Then it covers the complete planning pipeline (phasing → feature-ID → design-doc → approval → handoff to sp:spur-dev)
    And no planning content is duplicated in sp:spur-dev

  Scenario: No new skill names
    Given the split implementation
    When the skill registry is checked
    Then no new skill names are introduced
    And existing command delegations continue to work unchanged
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Chosen approach:** Remove the `## Planning half` section from sp:spur-dev/SKILL.md and replace it with a short pointer. sp:spur-plan already describes itself as the front-half planning pipeline — no new content needed there, just verify coverage.

**Key boundary:** sp:spur-plan = steps 3-6 (phasing, feature-ID derivation, design doc, approval); sp:spur-dev = steps 7-12 (feature create, decompose, task pipeline execution). The handoff seam is the drafted feature list produced by sp:spur-plan.

**Files touched:** sp:spur-dev/SKILL.md (remove ~137 lines), sp:spur-plan/SKILL.md (verify, sharpen key distinction), 04_DESIGN.md (sync), 05_FEATURES.md (sync).
### Plan
- [ ] Remove `## Planning half` (lines 40-177) from `sp:spur-dev/SKILL.md`; replace with a short pointer to `sp:spur-plan`
- [ ] Verify `sp:spur-plan/SKILL.md` covers the full planning pipeline (intake → feature-create → AC → check → decompose → batch-create → handoff)
- [ ] Update `## Key distinction` blocks in both skills: sp:spur-plan = steps 3-6, sp:spur-dev = steps 7-12
- [ ] Sync `docs/04_DESIGN.md` and `docs/05_FEATURES.md` — update skill boundary descriptions
- [ ] Verify: `bun run lint` passes; no orphaned cross-references
### Solution

| File:line | What / Why |
|-----------|-------------|
| `plugins/sp/skills/spur-dev/SKILL.md:3` | Updated description: execution-only, planning → sp:spur-plan. R1/R2. |
| `plugins/sp/skills/spur-dev/SKILL.md:11-22` | Removed planning halves + pipeline_steps entries; kept execution-only metadata. R1. |
| `plugins/sp/skills/spur-dev/SKILL.md:28-38` | Replaced "two-halves future split" intro with "split done" + pointer to sp:spur-plan. R1/R2. |
| `plugins/sp/skills/spur-dev/SKILL.md:40-48` | Replaced 138-line `## Planning half` (intake→feature-create→AC→check→decompose→batch-create→refine) with short pointer to sp:spur-plan. R1. |
| `plugins/sp/skills/spur-plan/SKILL.md:53` | Updated Key distinction: sp:spur-dev = execution only (task selection, pipeline run, implement, refine, verify, record). R2. |

### Testing

| Req | Status | Evidence |
|-----|--------|----------|
| R1: Remove Planning half from sp:spur-dev | **MET** | `spur-dev/SKILL.md:40-48` — 138-line Planning half replaced with short pointer to sp:spur-plan |
| R2: Sharpen sp:spur-dev to execution only | **MET** | Description, intro, metadata, and key distinction updated in both skills |
| R3: No new skill names | **MET** | Only existing skills modified; sp:spur-plan existed pre-split |
| R4: lint green + docs synced | **MET** | `bun run lint` + typecheck clean; no stale references in 04/05 docs |

Coverage: 99.07% lines, 99.54% funcs.

**Verdict: PASS** — all 4 requirements MET.

### History
- 2026-06-25T05:24:05.956Z todo → wip (system)
- 2026-06-25T05:26:09.438Z wip → testing (system)
- 2026-06-25T05:26:20.721Z testing → done (system)
