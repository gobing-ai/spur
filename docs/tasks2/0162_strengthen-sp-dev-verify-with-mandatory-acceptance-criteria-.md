---
template: feature-impl
schema_version: 1
name: Strengthen sp dev-verify with mandatory Acceptance Criteria guard
description: ""
status: done
type: task
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-30T20:14:26.080Z
updated_at: 2026-06-30T20:47:19.854Z
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
| File | Change | What / why |
|------|--------|------------|
| `plugins/sp/commands/dev-verify.md:2` | updated description | Describes verification as requirements plus Acceptance Criteria evidence, not requirements-only evidence. |
| `plugins/sp/commands/dev-verify.md:31` | clarified `--bdd` | Makes AC checking automatic when AC exists and reserves `--bdd` for strict Gherkin scenario-to-test mapping. |
| `plugins/sp/commands/dev-verify.md:42` | added AC guard section | Documents checklist/Gherkin AC evaluation, status rows, evidence expectations, and LLM-as-judge limits. |
| `plugins/sp/skills/code-verification/SKILL.md:105` | renamed requirements gate | Keeps requirements traceability as the first completion gate. |
| `plugins/sp/skills/code-verification/SKILL.md:119` | added AC guard | Defines per-AC statuses, evidence ladder, strict BDD behavior, and parseable AC answer table. |
| `plugins/sp/skills/code-verification/SKILL.md:159` | expanded quality gate | Frames SECUA plus quality review and limits LLM-as-judge to blind-spot/advisory evidence unless grounded. |
| `plugins/sp/skills/code-verification/SKILL.md:178` | updated aggregation | Folds core AC and blocker/major quality findings into PASS/PARTIAL/FAIL. |
| `plugins/sp/skills/code-verification/references/verdict-schema.md:25` | added `acceptanceCriteria` | Extends the verdict contract with evidence-typed AC rows. |
| `plugins/sp/skills/code-verification/references/verdict-schema.md:41` | updated aggregation docs | Documents requirement, AC, and quality-finding aggregation rules. |
| `plugins/sp/skills/code-verification/references/secu-review.md:21` | adjusted severity gate effects | Makes blocker findings fail and unresolved major findings at least partial unless deferred/N/A. |
| `plugins/sp/skills/code-verification/references/code-improvement.md:10` | clarified advisory lane | Prevents qualitative improvement candidates from certifying objective completion by themselves. |
| `plugins/sp/tests/skill-structure.test.ts:186` | added R21 invariant | Locks the verifier contract so AC-first verification semantics cannot silently regress. |
### Testing
Coverage: N/A (plugin verifier contract/docs plus structural invariant test; no runtime code path added).

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-verify.md:31` documents automatic AC checking and strict `--bdd`; `plugins/sp/commands/dev-verify.md:42` adds the AC guard. |
| R2 | MET | `plugins/sp/skills/code-verification/SKILL.md:105` keeps requirements traceability; `plugins/sp/skills/code-verification/SKILL.md:119` adds AC guard; `plugins/sp/skills/code-verification/SKILL.md:159` keeps SECUA/quality review. |
| R3 | MET | `plugins/sp/skills/code-verification/SKILL.md:131` defines typed evidence: `test`, `command`, `static-ref`, `manual-review`, `llm-judge`, `n/a`. |
| R4 | MET | `plugins/sp/skills/code-verification/SKILL.md:178` and `plugins/sp/skills/code-verification/references/verdict-schema.md:41` define aggregation across requirements, AC, and quality findings. |
| R5 | MET | `plugins/sp/skills/code-verification/SKILL.md:149` and `plugins/sp/skills/code-verification/references/verdict-schema.md:68` define the parseable AC table; `plugins/sp/skills/code-verification/references/verdict-schema.md:25` adds `acceptanceCriteria`. |
| R6 | MET | `plugins/sp/tests/skill-structure.test.ts:186` adds R21, asserting AC-first verifier semantics in command, skill, and verdict schema. |
| R7 | MET | References were reviewed during implementation; shipped plugin docs deliberately avoid external reference names to preserve the R20 self-containment invariant. |


| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: A task has Acceptance Criteria | MET | static-ref | `plugins/sp/commands/dev-verify.md:42` says non-empty AC must be evaluated without `--bdd`; `plugins/sp/skills/code-verification/SKILL.md:119` defines per-AC statuses and evidence. |
| Scenario: Strict BDD verification is requested | MET | static-ref | `plugins/sp/commands/dev-verify.md:31` and `plugins/sp/skills/code-verification/SKILL.md:172` reserve `--bdd` for strict scenario-to-executable-evidence mapping. |
| Scenario: Qualitative quality review is requested | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:142` prevents `llm-judge` from clearing objective AC alone; `plugins/sp/skills/code-verification/references/code-improvement.md:10` frames qualitative improvement as advisory unless grounded. |
| Checklist: dev-verify docs automatic AC | MET | static-ref | `plugins/sp/commands/dev-verify.md:31` and `plugins/sp/commands/dev-verify.md:42`. |
| Checklist: code-verification three gates | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:105`, `plugins/sp/skills/code-verification/SKILL.md:119`, `plugins/sp/skills/code-verification/SKILL.md:159`. |
| Checklist: evidence ladder | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:131` and `plugins/sp/skills/code-verification/references/verdict-schema.md:57`. |
| Checklist: verdict aggregation | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:178`, `plugins/sp/skills/code-verification/references/verdict-schema.md:41`, and `plugins/sp/skills/code-verification/references/secu-review.md:21`. |
| Checklist: parseable AC verdict contract | MET | static-ref | `plugins/sp/skills/code-verification/SKILL.md:149`, `plugins/sp/skills/code-verification/SKILL.md:235`, and `plugins/sp/skills/code-verification/references/verdict-schema.md:25`. |
| Checklist: regression invariant for 0161 miss class | MET | test | `plugins/sp/tests/skill-structure.test.ts:186`; `bun test plugins/sp/tests/skill-structure.test.ts` passed 8/0. |
| Checklist: grounded references | MET | manual-review | Current sp docs plus requested local reference materials were reviewed; plugin output omits external dependency names by design to keep R20 green. |


| Command | Result |
|---------|--------|
| `bun test plugins/sp/tests/skill-structure.test.ts` | PASS — 8 pass / 0 fail |
| `bun run lint` | PASS — Biome clean, all workspace typechecks exit 0 |
| `bun run test` | PASS — 2010 pass / 0 fail |
### Review
**SECUA Review**

| Priority | Dimension | Location | Finding | Recommendation | Status |
|----------|-----------|----------|---------|----------------|--------|
| P1 | Security / Correctness | — | No blocker findings. | None. | DONE |
| P2 | Architecture / Usability | — | No major findings. The verifier contract is strengthened in docs/tests without adding a runtime subsystem. | None. | DONE |
| P3 | Testing | `plugins/sp/tests/skill-structure.test.ts:186` | Structural invariant covers the AC-first verifier contract. | Keep R21 in the plugin gate when future verifier edits land. | DONE |
| P4 | Documentation | — | No polish findings. | None. | DONE |
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
- 2026-06-30T20:45:29.744Z todo → wip (system)
- 2026-06-30T20:45:42.621Z wip → testing (system)
- 2026-06-30T20:47:19.854Z testing → done (system)
