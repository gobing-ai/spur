---
template: feature-impl
schema_version: 1
name: "Strengthen sp dev-verify with mandatory Acceptance Criteria guard"
description: ""
status: todo
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-30T20:14:26.080Z"
updated_at: 2026-06-30T20:14:26.082Z
---

## 0162. Strengthen sp dev-verify with mandatory Acceptance Criteria guard

### Background

Task **0161** split `plugins/sp` into a thin `sp:spur-dev` orchestration spine plus competency
skills. A follow-up review found issues that `/sp:dev-verify 0161 --auto` should have caught but
did not: stale migrated references, retired skill names, and plugin self-containment drift. The
current verifier is useful, but its blocking model is too narrow:

- Requirements traceability is first-class.
- SECUA review is first-class.
- Acceptance Criteria mapping exists only behind the optional `--bdd` lens.
- Quality review can identify concerns, but it does not force evidence-typed AC coverage.

This task strengthens `plugins/sp/commands/dev-verify.md` and
`plugins/sp/skills/code-verification/` so verification treats task Acceptance Criteria as a
first-class gate whenever they exist.

Out of scope: the remaining live full-pipeline binding proof for 0161. That should be a separate,
small probe task after this verifier enhancement lands, so pipeline-binding failures are not
confused with verifier-enhancement implementation failures.

### Acceptance Criteria

```gherkin
Feature: dev-verify treats Acceptance Criteria as a blocking verification surface

  Scenario: A task has Acceptance Criteria
    Given a task file contains a non-empty "### Acceptance Criteria" section
    When /sp:dev-verify verifies the task
    Then each AC item is evaluated with a MET, PARTIAL, UNMET, or N/A status
    And each non-N/A AC item cites evidence
    And unmet core AC contributes to the final verdict

  Scenario: Strict BDD verification is requested
    Given a task Acceptance Criteria section contains Gherkin scenarios
    When /sp:dev-verify is run with --bdd
    Then each scenario is mapped to executable or explicitly missing test evidence
    And missing executable coverage is reported as a blocking or partial condition according to severity

  Scenario: Qualitative quality review is requested
    Given the verifier performs SECUA or architecture-quality review
    When it uses LLM-as-judge reasoning
    Then judge output is advisory unless tied to concrete requirement, AC, security, or correctness evidence
    And actionable findings include file references, severity, and verification feasibility
```

- [ ] `plugins/sp/commands/dev-verify.md` documents that AC checking is automatic when AC exists;
      `--bdd` is clarified as the strict executable-scenario lens, not the switch that enables AC
      checking.
- [ ] `plugins/sp/skills/code-verification/SKILL.md` defines a three-gate verification model:
      Requirements traceability, Acceptance Criteria guard, and SECUA/quality review.
- [ ] The verifier instructions define an evidence ladder for each requirement and AC item:
      deterministic evidence, static source evidence, reviewer evidence, LLM-as-judge evidence, or
      explicit N/A with justification.
- [ ] The verdict aggregation rules are explicit: any UNMET core requirement or core AC fails the
      task; any PARTIAL core requirement or core AC produces PARTIAL; P1/blocker quality findings
      fail; major quality findings produce at least PARTIAL; minor/advisory findings do not block.
- [ ] The answer/verdict contract includes a dedicated Acceptance Criteria table or section that
      can be consumed by `spur task verdict` / `spur task record` without regex-over-prose guessing.
- [ ] A regression test or structural invariant proves the verifier contract would catch the 0161
      miss class: stale `rd3` references, retired split-skill names, broken `see_also` references,
      or vendor-reference leakage inside shipped `plugins/sp` files.
- [ ] References are grounded against local exemplars before implementation: current
      `plugins/sp/skills/code-verification`, `plugins/sp/commands/dev-verify.md`,
      `~/projects/cc-agents/plugins/rd3/` verification/review materials, `vendors/Superpowers`
      review guidance, and `vendors/gstack` review/checklist material.

### Design

Implement this as a verifier-contract hardening task, not as a new runtime subsystem unless the
current verdict pipeline cannot express the needed output.

Recommended model:

1. **Requirements Traceability Gate**
   - Keep the existing requirements table.
   - Each requirement remains `MET`, `PARTIAL`, `UNMET`, or `N/A`.
   - Evidence must cite file paths, commands, tests, or explicit review rationale.

2. **Acceptance Criteria Guard**
   - If `### Acceptance Criteria` exists and is non-empty, AC evaluation is mandatory.
   - Parse/checklist AC and Gherkin AC both count.
   - `--bdd` means stricter scenario-to-test mapping for Gherkin; it must not be the only AC path.
   - AC evidence types:
     - `test`: automated test or invariant test;
     - `command`: CLI/gate command output;
     - `static-ref`: file/line or doc/source contract evidence;
     - `manual-review`: human/reviewer reasoning with cited evidence;
     - `llm-judge`: qualitative assessment, advisory unless the AC is inherently qualitative;
     - `n/a`: explicitly justified non-applicability.

3. **SECUA plus Quality Review Gate**
   - Preserve SECUA.
   - Add architecture-quality or "enhancement candidate" review only as an evidence-producing lens.
   - LLM-as-judge can surface findings and blind spots, but cannot alone certify objective AC.
   - Every actionable quality finding carries severity and verification feasibility.

4. **Aggregation**
   - `FAIL`: any UNMET core requirement, UNMET core AC, or P1/blocker correctness/security finding.
   - `PARTIAL`: any PARTIAL core requirement/AC or unresolved major finding.
   - `PASS`: all core requirements and AC are MET or justified N/A; only minor/advisory findings
     may remain.

The implementation should prefer prompt/contract and deterministic invariant changes first. Only
touch CLI/task-verdict code if the current answer/verdict schema cannot represent AC evidence
cleanly enough for `task record`.

### Plan

- [ ] Audit current `dev-verify.md`, `code-verification/SKILL.md`, and
      `code-verification/references/{verdict-schema,secu-review,code-improvement}.md`.
- [ ] Compare against the relevant reference material:
      `~/projects/cc-agents/plugins/rd3/commands/dev-verify.md`,
      `~/projects/cc-agents/plugins/rd3/skills/code-verification`,
      `~/projects/cc-agents/plugins/rd3/skills/code-review-common`,
      `vendors/Superpowers/skills/requesting-code-review/SKILL.md`,
      `vendors/Superpowers/skills/receiving-code-review/SKILL.md`,
      `vendors/gstack/review/SKILL.md`, and `vendors/gstack/review/checklist.md`.
- [ ] Update `/sp:dev-verify` command docs to make AC guard automatic and clarify `--bdd`.
- [ ] Update `sp:code-verification` instructions and references with the three-gate model,
      evidence ladder, LLM-as-judge limits, and verdict aggregation.
- [ ] Update verdict/answer schema docs so AC evidence has a stable parseable surface.
- [ ] Add or extend plugin tests so the 0161 miss class is caught automatically.
- [ ] Run focused plugin tests, then the normal repo verification gate as needed.
- [ ] Dogfood `/sp:dev-verify 0161 --auto` or this task itself and record whether the enhanced
      verifier now surfaces the stale-reference/self-containment class correctly.

### Solution


### Testing


### Review


### References

- `plugins/sp/commands/dev-verify.md`
- `plugins/sp/skills/code-verification/SKILL.md`
- `plugins/sp/skills/code-verification/references/verdict-schema.md`
- `plugins/sp/skills/code-verification/references/secu-review.md`
- `plugins/sp/skills/code-verification/references/code-improvement.md`
- `plugins/sp/tests/skill-structure.test.ts`
- `docs/tasks2/0161_split-sp-spur-dev-at-the-lifecycle-half-seam-into-planning-s.md`
- `docs/features/H1_spur-dev-skill.md`
- `~/projects/cc-agents/plugins/rd3/commands/dev-verify.md`
- `~/projects/cc-agents/plugins/rd3/skills/code-verification`
- `~/projects/cc-agents/plugins/rd3/skills/code-review-common`
- `vendors/Superpowers/skills/requesting-code-review/SKILL.md`
- `vendors/Superpowers/skills/receiving-code-review/SKILL.md`
- `vendors/gstack/review/SKILL.md`
- `vendors/gstack/review/checklist.md`

### History

- 2026-06-30T20:14:26.082Z created (system)
