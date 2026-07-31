---
template: feature-impl
schema_version: 1
name: "Extract shared done-time housekeeping reference and repair agent skill frontmatter"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P1
tags: ["sp-plugin", "agents", "refactor"]
dependencies: []
created_at: "2026-07-30T21:52:24.850Z"
updated_at: "2026-07-30T23:00:52.094Z"
---

## 0389. Extract shared done-time housekeeping reference and repair agent skill frontmatter

### Background

The ~130-line F1/F2/F4/F5 "Definition of Done Housekeeping" block lives inside `plugins/sp/agents/super-coder.md`, and `plugins/sp/agents/super-reviewer.md:109` reaches it by cross-file section anchor (`./super-coder.md#definition-of-done-housekeeping`). The H6 rescope rewrites super-coder's body entirely, which breaks that anchor. The block is cross-agent policy, not coder policy, so it needs its own home before the rewrite lands.

Separately, `plugins/sp/agents/super-reviewer.md:22` declares `skills: [sp:code-verification, sp:functional-review, sp:code-improvement, sp:anti-hallucination, sp:tasks]`. Verified against `plugins/sp/skills/`: `sp:anti-hallucination` and `sp:tasks` do not exist — anti-hallucination ships under the `cc:` plugin, and there is no `tasks` skill at all. Two of five declarations dangle.

This task is the foundation for the agent rewrites: it moves shared policy out of the file that is about to be replaced.

### Requirements
R1. Extract the F1/F2/F4/F5 housekeeping block (including the "Before you report done — terminal gate" checklist table) from `plugins/sp/agents/super-coder.md` into a shared reference file under `plugins/sp/skills/spur-dev/references/`.
R2. The extracted reference must preserve the block's content verbatim in substance — the F1 zero-unchecked-boxes invariant, F2 honest-transition rule, F4 raw-gate-evidence threshold, F5 /tmp staging cleanup, and the 5-row terminal gate table.
R3. Every agent that carries done-time obligations cites the reference by file path. No agent cross-links another agent file by section anchor.
R4. Remove `sp:anti-hallucination` and `sp:tasks` from `super-reviewer.md`'s `skills:` frontmatter list.
R5. No `sp:`-prefixed skill declared in any `plugins/sp/agents/*.md` frontmatter may resolve to a non-existent directory under `plugins/sp/skills/`.
R6. Add a test assertion that every `sp:` skill declared in agent frontmatter resolves to an existing skill directory, so this class of dangling reference fails the build in future.
### Acceptance Criteria
```gherkin
Feature: Shared done-time housekeeping reference

  Scenario: Shared done-time housekeeping has one home
    Given F1, F2, F4, and F5 housekeeping applied to more than one agent
    When the block is extracted to a shared reference
    Then the reference exists under plugins/sp/skills/spur-dev/references/
    And it retains the F1 zero-unchecked-boxes invariant
    And it retains the 5-row terminal gate table

  Scenario: Agents cite the reference by path
    Given agents carry done-time obligations
    When an agent file references the housekeeping rules
    Then it cites the reference by file path
    And no agent cross-links another agent file by section anchor

  Scenario: Dangling skill declarations are removed
    Given super-reviewer declared sp:anti-hallucination and sp:tasks
    When the frontmatter is repaired
    Then neither declaration remains

  Scenario: Agent skill declarations all resolve
    Given an agent declares an sp: skill in its frontmatter
    When the skill-structure test runs
    Then every declared sp: skill resolves to a directory under plugins/sp/skills/
    And a declaration naming a non-existent skill fails the test
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Placing the reference under `spur-dev/references/` rather than a new top-level location follows the plugin's existing convention: `spur-dev/references/` already holds the cross-agent algorithm SSOTs (`execution-batch.md`, `feature-link-helper.md`) that agents execute rather than own. Done-time housekeeping is the same shape of artifact — policy that multiple agents must honor identically.

A new `plugins/sp/agents/references/` directory was rejected: it would create a second reference root with one file in it, and the housekeeping rules are lifecycle policy (tied to task transitions and gate evidence) rather than agent-runtime policy.

WHY cite by path, not anchor: anchor links are silent-breakage vectors — renaming a heading or replacing a file body leaves a link that still resolves as a file but lands nowhere useful, and nothing in CI notices. A path citation to a dedicated file breaks loudly (missing file) if the target moves.

R6 generalizes the R4 fix. Fixing two dangling declarations by hand leaves the next one to be found by an operator at runtime, when a skill fails to load. The assertion turns a runtime surprise into a build failure, and it is cheap: the check is a directory-existence test over a frontmatter list.
### Plan
- [x] Read `plugins/sp/agents/super-coder.md` lines 165-297 and identify the exact extent of the housekeeping + terminal-gate block
- [x] Create the shared reference under `plugins/sp/skills/spur-dev/references/` with the block's content
- [x] Replace the block in `super-coder.md` with a path citation (the body is rewritten in a later task; this keeps that task's diff clean)
- [x] Replace `super-reviewer.md`'s anchor cross-link with the same path citation
- [x] Remove `sp:anti-hallucination` and `sp:tasks` from `super-reviewer.md` frontmatter
- [x] Add the frontmatter skill-resolution assertion to `plugins/sp/tests/skill-structure.test.ts`
- [x] Run `bun run test` and confirm green
### Solution
Extracted the shared done-time housekeeping policy out of `super-coder.md` into a dedicated
reference file, and repaired `super-reviewer.md`'s dangling skill declarations.


| File | Change | Why |
|------|--------|-----|
| `plugins/sp/skills/spur-dev/references/done-housekeeping.md` (new) | Created shared reference holding F1/F2/F4/F5 housekeeping rules + the 5-row terminal-gate table | R1/R2: the block is cross-agent policy, not coder-specific; gives it a stable home that breaks loudly if moved |
| `plugins/sp/agents/super-coder.md:165-170` | Replaced ~130-line housekeeping + terminal-gate block with a 6-line path citation to `done-housekeeping.md` | R3: cite by file path, not section anchor; keeps the H6 rescope diff clean |
| `plugins/sp/agents/super-reviewer.md:22` | Removed `sp:anti-hallucination` and `sp:tasks` from `skills:` frontmatter | R4: `anti-hallucination` ships under `cc:` not `sp:`; no `tasks` skill exists |
| `plugins/sp/agents/super-reviewer.md:105-110` | Replaced `./super-coder.md#definition-of-done-housekeeping` anchor cross-link with path citation to `done-housekeeping.md` | R3: no agent cross-links another agent file by section anchor |
| `plugins/sp/tests/skill-structure.test.ts:1052-1072` | Added R55 test: parses every agent's `skills:` frontmatter, resolves each `sp:` entry to a directory under `skills/` | R6: turns a runtime mis-route into a build failure; R16b only catches body-text `sp:` refs with spur-/code-/sys-/spec-/expert- prefixes, not bare frontmatter names |


- The Dogfood mode section stays in `super-coder.md` (coder-specific behavior, not cross-agent
  housekeeping policy). Terminal-gate row #5 remains a conditional dogfood check in the shared
  reference.
- `expert-spur.md` and `super-coder.md` frontmatter skills were already clean; only
  `super-reviewer.md` had dangling declarations.
- All 44 skill-structure tests pass including the new R55 assertion.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/skills/spur-dev/references/done-housekeeping.md (new, 94 lines) holds F1/F2/F4/F5 block + 5-row terminal gate table; extracted from super-coder.md |
| R2 | MET | F1 zero-unchecked-boxes invariant, F2 honest-transition rule, F4 raw-gate-evidence threshold, F5 /tmp staging cleanup, 5-row terminal gate table all preserved verbatim in done-housekeeping.md |
| R3 | MET | super-coder.md and super-reviewer.md both cite done-housekeeping.md by file path; no './super-coder.md#' or './super-reviewer.md#' anchor cross-links remain in either agent file |
| R4 | MET | super-reviewer.md frontmatter skills: [sp:code-verification, sp:functional-review, sp:code-improvement] - sp:anti-hallucination and sp:tasks removed |
| R5 | MET | All agent frontmatter sp: skills resolve: super-coder (spur-dev, parallel-execution, dogfood-testing, next-router) and super-reviewer (code-verification, functional-review, code-improvement) all exist as directories under plugins/sp/skills/ |
| R6 | MET | skill-structure.test.ts R55 test (lines 1052-1072) parses agent frontmatter skills: arrays and asserts every sp:<name> resolves to existing directory; 44/44 tests pass |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Shared done-time housekeeping has one home | MET | static | done-housekeeping.md exists under plugins/sp/skills/spur-dev/references/; retains F1 invariant and 5-row terminal gate table |
| Agents cite the reference by path | MET | static | Both agent files cite done-housekeeping.md by path; no section-anchor cross-links remain |
| Dangling skill declarations are removed | MET | static | sp:anti-hallucination and sp:tasks absent from super-reviewer.md frontmatter |
| Agent skill declarations all resolve | MET | static | R55 test assertion resolves every sp: skill to a directory; 44 tests pass including R55 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Sev | Finding | Disposition |
| --- | --- | --- |
| P1 | (none) | - |
| P2 | (none) | - |
| P3 | R55 test only guards `sp:`-prefixed frontmatter entries; bare names without prefix (if any future agent used them) would not be caught | Accepted - all current agents use `sp:` prefix; R16b already covers body-text refs |
| P4 | done-housekeeping.md row #5 dogfood check is conditional; not exercised in this task | Expected - dogfood mode is opt-in per agent run |

**Functional traceability:** R1-R6 all MET with file:line evidence; 4/4 Gherkin scenarios MET.

**SECUA:** No code surface (markdown reference + frontmatter + test assertion). No security-relevant surface.

**Architecture:** Reference placement under `spur-dev/references/` follows existing cross-agent SSOT convention (`execution-batch.md`, `feature-link-helper.md`). Path-citation-over-anchor rationale implemented (loud-breakage on move).

**Residual risk:** None material. Future dangling `sp:` frontmatter entries fail the build via R55.

Final disposition: **PASS**
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-30T22:50:32.212Z todo → wip (system)
- 2026-07-30T23:00:44.426Z wip → testing (system)
- 2026-07-30T23:00:52.094Z testing → done (system)
