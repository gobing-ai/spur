---
template: feature-impl
schema_version: 1
name: "Phase 6 Verification — R30-R35 structural tests, full gate, dogfood runs"
description: ""
status: wip
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-01T18:42:39.273Z"
updated_at: "2026-07-01T21:20:47.322Z"
---

## 0173. Phase 6 Verification — R30-R35 structural tests, full gate, dogfood runs

### Background

Phase 6 of the 0167 6-phase decomposition (Plan steps 23-26). Adds the structural test entries that assert artifacts built in Phases 1-5, then runs the full verification gate and dogfood runs. Depends on Phase 5 (task 0167 phase-5 child) completing first — verifies everything. Implements parent task 0167 Plan Phase 6.

Dependency: Phase 5 must complete first (all artifacts in place). This is the terminal phase.

Source: docs/tasks2/0167_*.md Plan Phase 6 + AC1-AC8; docs/design/e2e-workflow-for-system-development.md Structural Invariants (R30-R35).

### Requirements
R1. (parent AC1, design doc Structural Invariants) Add structural test entries R30-R35 to `plugins/sp/tests/skill-structure.test.ts` WITHOUT renumbering the pre-existing R29 invariant:
- **R30**: `dev-idea`, `dev-wrap`, and `dev-wrapall` command docs exist with valid frontmatter and delegate to the correct workflows (`.spur/workflows/idea-pipeline.yaml` / `.spur/workflows/wrapup-pipeline.yaml`).
- **R31**: `plugins/sp/skills/spur-dev/references/gate-checklists.md` exists and is linked from `plugins/sp/skills/spur-dev/SKILL.md`.
- **R32**: `plugins/sp/skills/spur-dev/references/dev-operations.md` includes entries for `idea`, `wrap`, and `wrapall` operations.
- **R33**: `plugins/sp/skills/spur-dev/references/cross-cutting.md` includes sections: `## Auto-Decision Principles`, `## Iron Laws`, `## Design Approval Gate`, `## Learning Log Convention`, `## Session Checkpoint Convention`, `## Pipeline Alignment`.
- **R34**: `.spur/workflows/idea-pipeline.yaml` and `.spur/workflows/wrapup-pipeline.yaml` exist and validate against the state-machine workflow schema (repo-local tests may validate `config/workflows/*` physical source).
- **R35**: `plugins/sp/skills/brainstorm/SKILL.md` includes `## Design Approval Gate` and emits the `needs_design` signal contract.

R2. (parent AC1, AC2) Run the full verification gate: `bun run lint` clean (Biome + per-workspace `tsc --noEmit`), `bun run test` passes (all workspaces + `plugins/sp` tests), `bun run test-cf` passes (server Workers runtime), `bun run build` succeeds across all workspaces. No test skipped, `.skip`'d, or commented out to go green (R12). No new `biome-ignore` suppressions added solely to silence the gate.

R3. (parent AC3, Plan step 25) Dogfood: run `/sp:dev-idea "add a --dry-run flag to dev-wrap"` end-to-end. Verify `idea-pipeline.yaml` executes the full state sequence: discovery -> feature-create -> ac-generate -> feature-check -> system-design -> decompose -> batch-create -> handoff. The pipeline must stop at handoff — no task execution.

R4. (parent AC4, AC5, Plan step 26) Dogfood: run `/sp:dev-wrapall --since 2026-07-01` end-to-end. Verify `wrapup-pipeline.yaml` executes: doc-sync -> learning-capture -> metrics-record -> done. The workflow must not mutate task status; it must append `.spur/memory/learnings.md` and `.spur/memory/wrapup-metrics.jsonl`.

R5. (parent AC6) Verify `--auto` skips only objective gates; design taste decisions and `--merge` branch cleanup still pause. This is validated during the dogfood runs (R3, R4) by observing which gates pause under `--auto`.

R6. (parent AC7) Verify checkpoint files under `.spur/memory/sessions/` are written by the affected workflows and read by `dev-run`/`dev-runall` resume guidance. This is validated during the dogfood runs by inspecting the sessions directory after pipeline runs.
### Acceptance Criteria
**AC-P6.1: R30-R35 structural tests pass**
```gherkin
Feature: Phase 6 Verification

  Scenario: R30-R35 structural invariants pass and R29 is unchanged
    Given the test file plugins/sp/tests/skill-structure.test.ts
    When running `bun test plugins/sp/tests/skill-structure.test.ts`
    Then all tests pass including R30, R31, R32, R33, R34, R35
    And the pre-existing R29 invariant is unchanged and still passes
```

**AC-P6.2: Full verification gate passes**
- Pass: `bun run lint` exits 0 (Biome + per-workspace `tsc --noEmit`).
- Pass: `bun run test` exits 0 (all workspaces + plugins/sp tests).
- Pass: `bun run test-cf` exits 0 (server Workers runtime).
- Pass: `bun run build` exits 0 (all workspaces).
- Pass: no test skipped, `.skip`'d, or commented out to go green.
- Pass: no new `biome-ignore` suppressions added solely to silence the gate.

**AC-P6.3: Dogfood dev-idea end-to-end**
```gherkin
  Scenario: /sp:dev-idea executes the full idea-pipeline
    Given the command /sp:dev-idea "add a --dry-run flag to dev-wrap"
    When running the command with --auto
    Then idea-pipeline.yaml executes: discovery -> feature-create -> ac-generate -> feature-check -> system-design -> decompose -> batch-create -> handoff
    And the pipeline stops at handoff with no task execution
    And a feature is created or selected with AC written
    And a task batch is created via spur task batch-create
```

**AC-P6.4: Dogfood dev-wrapall end-to-end**
```gherkin
  Scenario: /sp:dev-wrapall executes the full wrapup-pipeline
    Given the command /sp:dev-wrapall --since 2026-07-01
    When running the command with --auto
    Then wrapup-pipeline.yaml executes: doc-sync -> learning-capture -> metrics-record -> done
    And task statuses are not mutated
    And .spur/memory/learnings.md is appended
    And .spur/memory/wrapup-metrics.jsonl is appended
```

**AC-P6.5: --auto respects taste and irreversible gates**
- Pass: during dogfood runs, design approval (taste gate) pauses even under `--auto` unless explicit prior approval.
- Pass: during dogfood runs, branch cleanup (irreversible gate) pauses even under `--auto`.

**AC-P6.6: Checkpoints written and read**
- Pass: `.spur/memory/sessions/` contains checkpoint files after pipeline runs.
- Pass: `dev-run`/`dev-runall` resume guidance reads the latest checkpoint.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section group C3 (Structural test coverage) and the design doc's Structural Invariants + Acceptance Trace sections.

**Approach:** Phase 6 adds the structural test entries that assert artifacts built in Phases 1-5, then runs the full verification gate and two dogfood runs. No new production code — only test additions and verification execution.

**Key design decisions (sliced from parent Design C3 + design doc Structural Invariants):**

- **R30-R35 without renumbering R29 (design doc Structural Invariants):** The design doc states "Task 0167 extends `plugins/sp/tests/skill-structure.test.ts` without renumbering existing R29." R30-R35 are appended after R29. Each invariant maps to a specific artifact from Phases 1-5:
  - R30 -> command docs (Phase 2-3)
  - R31 -> gate-checklists.md (Phase 1)
  - R32 -> dev-operations.md (Phase 2-3)
  - R33 -> cross-cutting.md sections (Phase 1-3)
  - R34 -> workflow YAMLs (Phase 2-3)
  - R35 -> brainstorm SKILL.md (Phase 1)

- **Test strategy:** Structural tests verify file existence, frontmatter validity, section presence, and workflow schema validation. They do NOT test runtime behavior — that is the dogfood runs' job. The design doc's validation commands specify: `spur workflow validate .spur/workflows/idea-pipeline.yaml --json` and `... wrapup-pipeline.yaml --json`.

- **Dogfood as acceptance proof (parent AC3-AC6):** The two dogfood runs prove the pipelines work end-to-end. `dev-idea` proves the idea-to-feature flow stops at handoff. `dev-wrapall` proves the wrap-up flow does not mutate task status and writes the memory artifacts. These are the parent task's AC3 and AC4.

- **Acceptance trace (design doc Acceptance Trace):** AC1 -> R30-R35 invariants; AC2 -> workflow validation contract; AC3 -> idea-pipeline contract; AC4 -> wrapup-pipeline contract + memory artifacts; AC5 -> lifecycle contracts; AC6 -> HITL and auto mode; AC7 -> checkpoint contract; AC8 -> path model + command surface + registration invariants.

- **Gate evidence (F4):** This task touches code (tests) and shared infrastructure (workflows). Raw gate tails (`bun run lint`, `bun run test`, `bun run test-cf`, `bun run build`) must be pasted as evidence — not a one-line "all green" summary.

**Impacted surfaces (from parent Plan steps 23-26):**
- Updated: `plugins/sp/tests/skill-structure.test.ts` (R30-R35 entries)
- Verified (not modified): all artifacts from Phases 1-5
- Generated (dogfood): `.spur/memory/learnings.md`, `.spur/memory/wrapup-metrics.jsonl`, `.spur/memory/sessions/` checkpoints
### Plan
Ordered checklist from parent task 0167 Plan Phase 6 (steps 23-26). Each step is sequential within the phase. Phase 5 (task 0172) must complete first. This is the terminal phase.

- [ ] Step 23: Add structural test entries R30-R35 to `plugins/sp/tests/skill-structure.test.ts` without renumbering pre-existing R29 (R1). R30: dev-idea/dev-wrap/dev-wrapall command docs exist + delegate to correct workflows. R31: gate-checklists.md exists + linked from SKILL.md. R32: dev-operations.md includes idea/wrap/wrapall. R33: cross-cutting.md includes 6 required sections. R34: idea-pipeline.yaml + wrapup-pipeline.yaml validate against schema. R35: brainstorm SKILL.md includes Design Approval Gate + needs_design signal. Verify: `bun test plugins/sp/tests/skill-structure.test.ts` passes with R30-R35 + R29 unchanged.
- [ ] Step 24: Run lint + typecheck + tests + build (R2). Verify: `bun run lint` clean, `bun run test` passes, `bun run test-cf` passes, `bun run build` succeeds. No tests skipped/.skip/commented out. No new biome-ignore suppressions.
- [ ] Step 25: Dogfood `/sp:dev-idea "add a --dry-run flag to dev-wrap"` end-to-end (R3). Verify: idea-pipeline.yaml executes discovery -> feature-create -> ac-generate -> feature-check -> system-design -> decompose -> batch-create -> handoff; stops at handoff with no task execution.
- [ ] Step 26: Dogfood `/sp:dev-wrapall --since 2026-07-01` end-to-end (R4). Verify: wrapup-pipeline.yaml executes doc-sync -> learning-capture -> metrics-record -> done; does not mutate task status; appends .spur/memory/learnings.md and .spur/memory/wrapup-metrics.jsonl.
- [ ] Final: verify --auto respects taste/irreversible gates (R5) and checkpoints are written/read (R6) during the dogfood runs. Paste raw gate tails as F4 evidence.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T21:20:47.322Z todo → wip (system)
