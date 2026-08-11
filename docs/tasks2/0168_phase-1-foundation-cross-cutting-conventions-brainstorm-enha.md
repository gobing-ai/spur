---
template: feature-impl
schema_version: 1
name: Phase 1 Foundation — cross-cutting conventions, brainstorm enhancement, gate-checklists
description: ""
status: done
type: task
profile: standard
feature_id: I1
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T18:42:39.267Z
updated_at: "2026-08-11T21:18:35.361Z"
---

## 0168. Phase 1 Foundation — cross-cutting conventions, brainstorm enhancement, gate-checklists

### Background

Phase 1 of the 0167 6-phase decomposition (Plan steps 1-6). Establishes cross-cutting conventions and enhances brainstorm BEFORE any new commands or workflows are built. All downstream phases depend on these conventions. No prior-phase dependency (first phase). Implements parent task 0167 Plan Phase 1.

Dependency: none (first phase). Phase 2 depends on this task completing.

Source: docs/tasks2/0167_*.md Plan Phase 1; docs/design/e2e-workflow-for-system-development.md Implementation Sequence step 1-2.

### Requirements
R1. (parent R8) Add `## Iron Laws` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` with exactly 7 laws: (1) never skip the verification gate; (2) never write to task/feature corpus outside the `spur` CLI; (3) never mark a task done without a PASS verdict; (4) never proceed past a failed gate without explicit operator approval; (5) never suppress gate failures with `--no-verify`/`--force`/`biome-ignore`; (6) never create a standalone PM skill or command; (7) never claim completion without fresh verification evidence.

R2. (parent R3) Add `## Auto-Decision Principles` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` with 7 principles: (1) schema-valid -> auto-approve; (2) gate-passed -> auto-continue; (3) tests-green -> auto-continue; (4) verdict-PASS -> auto-continue; (5) taste-decision -> surface to human; (6) irreversible action -> surface to human; (7) error -> stop. The section must document that `--auto` routes around objective `hitl.confirm` states BEFORE entry — the workflow engine does not auto-dismiss HITL states by itself. Without `--auto`, all gates surface to the human.

R3. (parent R2, R16) Enhance `plugins/sp/skills/brainstorm/SKILL.md` with 6 Superpowers patterns: (1) hard design-summary gate — no downstream command proceeds without a recorded design summary; (2) "nothing is too simple" — every idea gets a design summary even if short (1 paragraph for trivial); (3) spec self-review — check for placeholders (TODO/TBD/???), contradictions, scope creep, ambiguity before handoff; (4) user review gate — operator reviews the written brainstorm doc; (5) incremental design presentation — overview -> approaches -> recommendation, each confirmed; (6) scope decomposition check outputting a `needs_design` boolean signal: multi-subsystem/schema/transport/dependency changes -> `true`; single-module/bug-fix/pattern-following -> `false`; ties lean toward design. With `--auto`, objective gates route around prompts but the design summary is still recorded. This requirement drives the R35 structural test (added in Phase 6, task 0173).

R4. (parent R12) Enrich `plugins/sp/skills/spur-dev/references/product-planning.md` with: (a) elicitation question taxonomy (purpose, scope, constraints, success criteria — expertise-adaptive questioning extracted from rd3:product-management/elicitation.md); (b) per-profile decomposition decision rules (simplify/mvp/standard/mature, extracted from rd3:product-management/decomposition-strategies.md). No standalone PM skill or command is created — the constraint in product-planning.md is respected.

R5. (parent R4) Create `plugins/sp/skills/spur-dev/references/gate-checklists.md` reference with checkbox checklists for 5 gates: feature-check gate, batch-create gate, precheck gate, review gate, verify gate. Each checklist is a `- [ ]` checkbox list of prerequisites an agent verifies before entering the gate. This requirement drives the R31 structural test (added in Phase 6, task 0173).

R6. (parent R13, R14) Add `## Pipeline Alignment` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` containing: (a) a pipeline phase table mapping each pipeline to its lifecycle phase (`idea-pipeline`=ideation, `planning-pipeline`=design, `task-pipeline`=execution, `wrapup-pipeline`=wrap-up, `feature-dev`=umbrella, `basic`=simple); (b) the no-nesting principle — pipelines may delegate via `agent.run` + `spur workflow run` at phase boundaries but must not inline another pipeline's state graph; (c) lifecycle guard respect — no new `*-lifecycle.yaml` workflows; existing `feature-lifecycle.yaml` and `task-lifecycle.yaml` cover all persistent entities; new pipelines respect lifecycle guards via `spur` CLI verbs.
### Acceptance Criteria
**AC-P1.1: Iron Laws section exists**
```gherkin
Feature: Phase 1 Foundation artifacts

  Scenario: Iron Laws section present in cross-cutting.md
    Given the file plugins/sp/skills/spur-dev/references/cross-cutting.md
    When searching for the heading "## Iron Laws"
    Then the heading exists and the section body lists exactly 7 laws
    And each law is a numbered item starting with "NEVER"
```

**AC-P1.2: Auto-Decision Principles section exists**
- Pass: `grep -c '## Auto-Decision Principles' plugins/sp/skills/spur-dev/references/cross-cutting.md` returns 1.
- Pass: the section body lists 7 principles and documents that `--auto` routes around objective `hitl.confirm` states before entry (not auto-dismiss).

**AC-P1.3: Brainstorm skill enhanced with 6 patterns**
```gherkin
  Scenario: brainstorm SKILL.md has Design Approval Gate and needs_design signal
    Given the file plugins/sp/skills/brainstorm/SKILL.md
    When searching for "## Design Approval Gate"
    Then the heading exists
    And the skill documents the needs_design boolean signal contract
    And 6 patterns are documented (hard gate, nothing-too-simple, spec self-review, user review, incremental presentation, scope decomposition check)
```

**AC-P1.4: Product-planning reference enriched**
- Pass: `grep '## Elicitation Question Taxonomy' plugins/sp/skills/spur-dev/references/product-planning.md` returns a match.
- Pass: `grep '## Decomposition Decision Rules' plugins/sp/skills/spur-dev/references/product-planning.md` returns a match.
- Pass: no new PM skill directory or command is created under `plugins/sp/`.

**AC-P1.5: Gate-checklists reference created**
- Pass: `plugins/sp/skills/spur-dev/references/gate-checklists.md` exists.
- Pass: the file contains checkbox lists for all 5 gates (feature-check, batch-create, precheck, review, verify).

**AC-P1.6: Pipeline Alignment section exists**
- Pass: `grep -c '## Pipeline Alignment' plugins/sp/skills/spur-dev/references/cross-cutting.md` returns 1.
- Pass: the section includes a pipeline phase table, the no-nesting principle, and lifecycle guard respect.

**AC-P1.7: No new skills created (ADR-022)**
- Pass: `ls plugins/sp/skills/` shows no new skill directories beyond the pre-existing set.
- Pass: no new `*-lifecycle.yaml` workflows in `config/workflows/`.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section groups A2, A3, A4, C1, and the Pipeline Alignment slice. The design doc `docs/design/e2e-workflow-for-system-development.md` (System Principles, Design Step Routing, HITL and Auto Mode) governs the contracts.

**Approach:** Phase 1 is pure documentation/reference work — no code, no workflow YAMLs, no commands. It establishes the cross-cutting conventions that Phases 2-3 build on and that Phase 6 tests assert. All edits are additions to existing reference files or creation of one new reference file.

**Key design decisions (sliced from parent Design):**

- **Iron Laws (parent C1):** Source pattern is gstack's iron law + Superpowers `verification-before-completion`. The 7 laws are non-negotiable invariants, not guidelines. Placed in `cross-cutting.md` because every competency skill and the spine consume them.

- **Auto-Decision Principles (parent A3):** Source pattern is gstack `autoplan` (6 principles). A 7th ("error -> stop") is added. The critical contract: `--auto` is NOT HITL auto-clicking — workflows must route around objective `hitl.confirm` states before entry. The engine does not auto-dismiss `hitl.confirm`. This is documented in the design doc's HITL and Auto Mode section.

- **Brainstorm 6-pattern enhancement (parent A2):** Source patterns are Superpowers `brainstorming` (hard gate, nothing-too-simple, spec self-review, user review, incremental presentation) and `writing-plans` (scope decomposition check). The `needs_design` signal (parent R16) is the contract bridge between brainstorm and `idea-pipeline.yaml`'s system-design step — it determines whether the heavy `sp:sys-architecture` step runs. Criteria mirror the seam heuristic: multi-subsystem/schema/transport/dependency -> `true`; single-module/bug-fix/pattern-following -> `false`; ties lean design.

- **Product-planning enrichment (parent A2, elicitation):** Source is rd3:product-management. Enriches the existing reference — does NOT create a standalone PM skill (ADR-022, parent R12). Elicitation taxonomy + per-profile decomposition rules are judgment-knowledge in the skill, not runtime config.

- **Gate checklists (parent A4):** Source pattern is gstack pre-gate verification. A new reference file, not a skill. Each checklist is a checkbox list the agent verifies before entering a gate — reduces reliance on the LLM remembering all prerequisites.

- **Pipeline Alignment (parent R13):** Documents the phase-ownership model from the design doc's System Principles (principle 3: pipelines own phases, not entities; principle 4: no nested state machines). The table maps each pipeline to its phase. The no-nesting rule is the structural invariant Phase 3 step 17 validates.

**Impacted surfaces (from parent Plan steps 1-6):**
- `plugins/sp/skills/spur-dev/references/cross-cutting.md` — 3 new sections (Iron Laws, Auto-Decision Principles, Pipeline Alignment)
- `plugins/sp/skills/brainstorm/SKILL.md` — 6-pattern enhancement + Design Approval Gate + needs_design signal
- `plugins/sp/skills/spur-dev/references/product-planning.md` — elicitation taxonomy + decomposition decision rules
- `plugins/sp/skills/spur-dev/references/gate-checklists.md` — new file

**No code changes.** No workflow YAMLs. No command files. No tests (R31/R35 tests are added in Phase 6).
### Plan
Ordered checklist from parent task 0167 Plan Phase 1 (steps 1-6). Each step is sequential within the phase.

- [x] Step 1: Add `## Iron Laws` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` with 7 laws (R1). Verify: `grep '## Iron Laws' plugins/sp/skills/spur-dev/references/cross-cutting.md`.
- [x] Step 2: Add `## Auto-Decision Principles` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` with 7 principles including the irreversible-action pause and the "route around objective HITL before entry" contract (R2). Verify: `grep '## Auto-Decision Principles' plugins/sp/skills/spur-dev/references/cross-cutting.md`.
- [x] Step 3: Enhance `plugins/sp/skills/brainstorm/SKILL.md` with 6 Superpowers patterns (hard gate, nothing-too-simple, spec self-review, user review gate, incremental presentation, scope decomposition check) and the `needs_design` boolean signal output per parent R16 (R3). Verify: `grep '## Design Approval Gate' plugins/sp/skills/brainstorm/SKILL.md` and `grep 'needs_design' plugins/sp/skills/brainstorm/SKILL.md`.
- [x] Step 4: Enrich `plugins/sp/skills/spur-dev/references/product-planning.md` with elicitation question taxonomy + per-profile decomposition decision rules extracted from rd3:product-management (R4). Verify: `grep '## Elicitation Question Taxonomy' plugins/sp/skills/spur-dev/references/product-planning.md` and `grep '## Decomposition Decision Rules' plugins/sp/skills/spur-dev/references/product-planning.md`.
- [x] Step 5: Create `plugins/sp/skills/spur-dev/references/gate-checklists.md` with checkbox checklists for feature-check, batch-create, precheck, review, and verify gates (R5). Verify: file exists and contains 5 gate sections.
- [x] Step 6: Add `## Pipeline Alignment` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (pipeline phase table + no-nesting principle + lifecycle guard respect) (R6). Verify: `grep '## Pipeline Alignment' plugins/sp/skills/spur-dev/references/cross-cutting.md`.
- [x] Final: confirm ADR-022 holds — `ls plugins/sp/skills/` shows no new skill directories; `ls config/workflows/` shows no new `*-lifecycle.yaml`.
### Solution
Phase 1 Foundation implemented. All changes are documentation/reference edits — no code, no workflow YAMLs, no commands, no tests (tests are Phase 6, task 0173).

**Change map:**

- `plugins/sp/skills/spur-dev/references/cross-cutting.md:115` — appended `## Iron Laws` section (7 NEVER laws: skip-gate, CLI-gated writes, PASS-verdict, failed-gate, suppression, PM-skill, fresh-evidence)
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:146` — appended `## Auto-Decision Principles` section (7 principles + `--auto` routing contract: routes around objective `hitl.confirm` before entry, does not auto-dismiss)
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:185` — appended `## Pipeline Alignment` section (pipeline phase table mapping 8 workflows to phases; no-nesting principle; lifecycle guard respect)
- `plugins/sp/skills/brainstorm/SKILL.md:234` — inserted `## Design Approval Gate` section after Workflow Phase 3 (6 patterns, `needs_design` boolean signal contract, auto-mode behavior)
- `plugins/sp/skills/spur-dev/references/product-planning.md:53` — inserted `## Elicitation Question Taxonomy` section (4 dimensions, expertise-adaptive questioning, question form)
- `plugins/sp/skills/spur-dev/references/product-planning.md:138` — inserted `## Decomposition Decision Rules` section (per-profile granularity/edge-cases/count table, decision order, when-to-split-feature smell)
- `plugins/sp/skills/spur-dev/references/gate-checklists.md:11` — new reference file with 5 gate checklists (feature-check, batch-create, precheck, review, verify)

**Rationale:** Phase 1 establishes the cross-cutting conventions that Phases 2-6 build on. Iron Laws and Auto-Decision Principles are sourced from the design doc's HITL/Auto Mode section and parent task R8/R3. The brainstorm `needs_design` signal is the contract bridge to `idea-pipeline.yaml`'s system-design step (Phase 3). Gate checklists reduce reliance on LLM memory for gate prerequisites. No new skills, no new lifecycle YAMLs — ADR-022 holds.
### Testing
**Verification commands and outcomes (all 7 ACs):**

AC-P1.1 (Iron Laws):
- `grep -c '^## Iron Laws' cross-cutting.md` -> 1
- `awk` count of `^[0-9]+\. \*\*NEVER` in section -> 7

AC-P1.2 (Auto-Decision Principles):
- `grep -c '^## Auto-Decision Principles' cross-cutting.md` -> 1
- `awk` count of `^[0-9]+\. \*\*` in section -> 7
- `grep -c 'route around' cross-cutting.md` -> 3 (routing contract documented)
- `grep -c 'auto-dismiss' cross-cutting.md` -> 1 (explicitly states engine does NOT auto-dismiss)

AC-P1.3 (Brainstorm Design Approval Gate):
- `grep -c '^## Design Approval Gate' brainstorm/SKILL.md` -> 1
- `grep -c 'needs_design' brainstorm/SKILL.md` -> 3
- `grep -c '### The six patterns' brainstorm/SKILL.md` -> 1

AC-P1.4 (Product-planning enrichment):
- `grep -c '^## Elicitation Question Taxonomy' product-planning.md` -> 1
- `grep -c '^## Decomposition Decision Rules' product-planning.md` -> 1
- No new PM skill directory or command under `plugins/sp/`

AC-P1.5 (Gate-checklists reference):
- `test -f gate-checklists.md` -> exists
- `grep -cE '^## (feature-check|batch-create|precheck|review|verify) gate'` -> 5

AC-P1.6 (Pipeline Alignment):
- `grep -c '^## Pipeline Alignment' cross-cutting.md` -> 1
- `grep -c 'No-nesting principle'` -> 1
- `grep -c 'Lifecycle guard respect'` -> 1

AC-P1.7 (ADR-022 holds):
- `ls plugins/sp/skills/` -> 18 pre-existing dirs, unchanged (no new skills)
- `ls config/workflows/ | grep lifecycle.yaml` -> only feature-lifecycle.yaml + task-lifecycle.yaml

**Coverage claim:** N/A — Phase 1 is documentation/reference work, no code to cover. R31/R35 structural tests are added in Phase 6 (task 0173).

**Gate status:** All 7 ACs pass. `spur task check 0168` at `wip` -> `pass: true` (only L4 warnings, expected because feature I has placeholder AC).
### Review
| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | — | None | — |
| P4 | brainstorm/SKILL.md | needs_design criteria mirror the design doc verbatim; if the design doc updates, the skill must follow | Accepted — future task could DRY by referencing the design doc |
| P4 | gate-checklists.md | batch-create checklist includes a dry-run validation item for --auto mode, but the CLI has no --dry-run for batch-create (only workflow run) | Accepted as documented — "validate locally against schema" is achievable via ajv |

**Residual risk:** Low. All changes are additive documentation. No code paths affected. No workflow YAMLs touched. No tests touched. Structural invariants R30-R35 are not yet asserted (Phase 6 adds them); until then, drift between these docs and actual pipeline behavior is possible but not blocking.

**Final disposition:** PASS — all 7 ACs verified, ADR-022 holds, no new skills or lifecycle YAMLs created.
### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T20:03:06.573Z todo → wip (system)
- 2026-07-01T20:48:34.664Z wip → testing (system)
- 2026-07-01T20:48:36.188Z testing → done (system)
