---
template: standard
schema_version: 1
name: "Absorb rd3 product management judgment into sp planning"
description: ""
status: todo
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-29T23:46:29.541Z"
updated_at: 2026-06-29T23:47:33.281Z
---

## 0158. Absorb rd3 product management judgment into sp planning

### Background
This task captures a follow-up enhancement to the `sp` plugin's planning layer after reviewing
`rd3:product-management` against current `sp` capabilities.

Conclusion: do not create a new `sp:product-management` core skill, `sp:super-pm` subagent, or
`/sp:prd-*` slash command family now. Current `sp` already covers most product-management workflow
mechanics through:

- `sp:spur-dev` planning half: vague intent to feature, AC generation, decomposition, task batch.
- `sp:spur-features`: feature hierarchy, status, priority, refresh/check.
- `sp:spur-tasks`: task creation, lifecycle, batch-create, check.
- `sp:doc-evolve`: PRD/doc synchronization when canonical docs must change.
- `spur workflow`: repeatable orchestration, if a future PM process becomes mechanical enough to
  deserve workflow YAML.

The useful missing piece is PM judgment: prioritization rubrics, strategy profiles, PRD-shaped
thinking, and roadmap adjustment heuristics. That belongs as a knowledge overlay in existing `sp`
skills, not as another wrapper surface.
### Acceptance Criteria
```gherkin
Feature: Absorb rd3 product-management judgment into existing sp planning

  Scenario: Keep the sp plugin surface lean
    Given current sp already has planning, feature, task, workflow, and doc-evolve skills
    When rd3 product-management content is migrated
    Then no `sp:super-pm` agent is added
    And no `/sp:prd-*` slash command is added
    And no standalone `sp:product-management` skill is added unless a later task proves routing value

  Scenario: Preserve useful product-management judgment
    Given rd3 product-management contains PM-specific heuristics
    When the enhancement is implemented
    Then prioritization rubrics such as RICE and MoSCoW are available from the sp planning path
    And strategy profiles such as simplify, MVP, standard, and mature are documented
    And PRD-shaped output guidance is available without creating a PRD command family

  Scenario: Route deterministic operations through existing Spur surfaces
    Given product planning eventually writes features, tasks, or docs
    When the planning guidance performs concrete work
    Then it delegates feature writes to `spur feature`
    And task writes to `spur task`
    And repeatable orchestration to `spur workflow`
    And canonical documentation updates to `sp:doc-evolve`

  Scenario: Update migration status truthfully
    Given plugins/README.md currently treats product-management as deferred
    When the enhancement lands
    Then the migration map marks `rd3:product-management` as absorbed/partial
    And explains that only PM judgment moved while new PM entrypoints were intentionally rejected for now
```

- [ ] Add PM planning guidance to the existing `sp` planning layer, preferably `plugins/sp/skills/spur-dev/references/product-planning.md`.
- [ ] Link the new guidance from `plugins/sp/skills/spur-dev/SKILL.md`.
- [ ] Add feature hierarchy / roadmap / priority-status guidance to `sp:spur-features` or a focused reference under it.
- [ ] Reuse `sp:doc-evolve` for PRD/doc synchronization guidance instead of adding `/sp:prd-doc`.
- [ ] Do not add `sp:super-pm`.
- [ ] Do not add `/sp:prd-run`, `/sp:prd-doc`, `/sp:prd-adjust`, or `/sp:prd-init`.
- [ ] Update `plugins/README.md` migration map and entity counts/status notes.
- [ ] Verify with `bun test plugins/sp`, `biome check plugins/sp`, and grep for stale `rd3:product-management` routing assumptions.
### Design

Use the "migrate judgment, not surface" design.

Target shape:

- `sp:spur-dev` remains the primary planning orchestrator.
- A new product-planning reference provides PM-specific decision support:
  - intake questions for product intent
  - RICE / MoSCoW prioritization
  - strategy profiles: simplify, MVP, standard, mature
  - when to create a feature vs task
  - when a PRD-style document is useful
  - when to invoke `sp:doc-evolve`
- `sp:spur-features` gains or links guidance for roadmap hierarchy, priority/status conventions,
  and feature-tree adjustments.
- Deterministic actions stay on existing CLI verbs.
- Repeatable multi-step PM orchestration can be expressed later as `spur workflow` YAML, but only
  when the steps become stable enough to justify it.

Rejected for this round:

- `sp:super-pm`: mostly wrapper-on-wrapper over `sp:spur-dev`, `sp:spur-features`, and
  `sp:doc-evolve`.
- `/sp:prd-*`: no deterministic value beyond existing skills/commands yet.
- Full `sp:product-management` standalone skill: premature until PM flows become frequent and
  distinct enough to need separate routing.

### Plan
1. Read `rd3:product-management` and extract only reusable PM judgment. Discard old `rd3:feature-tree`,
   `ftree`, `rd3:tasks`, and rd3 orchestration assumptions.

2. Add `plugins/sp/skills/spur-dev/references/product-planning.md` with:
   - PM intake and clarification prompts
   - prioritization rubric
   - strategy profiles
   - PRD-shaped output guidance
   - handoff rules into `spur feature`, `spur task batch-create`, and `sp:doc-evolve`

3. Update `plugins/sp/skills/spur-dev/SKILL.md` to route PM-shaped planning to the new reference.

4. Update `plugins/sp/skills/spur-features/SKILL.md` or add a focused reference for roadmap,
   hierarchy, priority, and status conventions.

5. Update `plugins/README.md`:
   - mark `rd3:product-management` as absorbed/partial rather than simply deferred
   - document that `sp:super-pm` and `/sp:prd-*` are intentionally not added
   - keep entity counts accurate

6. Verify:
   - `bun test plugins/sp`
   - `biome check plugins/sp`
   - `rg -n "rd3:product-management|ftree|prd-" plugins/sp` and resolve any stale claims
### Solution

### Testing

### Review

### References
- `plugins/README.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/skills/product-management/SKILL.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/prd-run.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/prd-doc.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/prd-adjust.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/commands/prd-init.md`
- `/Users/robin/projects/cc-agents/plugins/rd3/agents/super-pm.md`
- `plugins/sp/skills/spur-dev/SKILL.md`
- `plugins/sp/skills/spur-features/SKILL.md`
- `plugins/sp/skills/doc-evolve/SKILL.md`
- `docs/plans/2026-06-10-rd3-migration-feature-list.md`
- `docs/00_ADR.md` — ADR-016 and ADR-023 constraints.
### History
- 2026-06-29T23:47:33.192Z backlog → todo (system)
