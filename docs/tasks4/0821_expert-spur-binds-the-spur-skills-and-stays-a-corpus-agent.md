---
schema_version: 1
name: expert-spur binds the spur-* skills and stays a corpus agent
status: todo
template: feature-impl
created_at: 2026-09-10T22:18:37.285Z
updated_at: "2026-09-10T22:21:33.391Z"
feature_id: I21
priority: P2
tags:
  - plugin
  - agent

dependencies: ["0820"]
ac_numbering: task-local
---

## 0821. expert-spur binds the spur-* skills and stays a corpus agent

### Background

expert-spur today binds only `sp:spur-cli` and covers task, feature, rule and workflow corpus work. The operator wants it to use the new composition and evaluation skills without becoming a coordinator or orchestrator (that stays `sp:super-planner`), and never to use the retiring `spur team`.

Implements:
- R13 — expert-spur is a corpus agent, not a coordinator
- R14 — coordination and evolution loops route to super-planner
- R15 — no spur-* guidance uses spur team
- R16 — existing gates still pass

Ordering: last. It binds and tests the skills from the spur-composer/spur-doctor task.

Rubric: E3 D1 L1 C0 R1 = 6 → own task: the operator's explicit role-boundary constraint is a distinct review gate.

### Requirements

- [ ] R1. `plugins/sp/agents/expert-spur.md` binds `sp:spur-cli`, `sp:spur-composer` and `sp:spur-doctor`, keeps "Never drive the planning/execution lifecycle", and declares no batch driving, recurring loop or coordination dispatch duty.
- [ ] R2. expert-spur, spur-composer and spur-doctor hand recurring evolution loops and multi-agent coordination to `sp:super-planner` or a workflow.
- [ ] R3. expert-spur, spur-composer and spur-doctor forbid `spur team` and `spur agent loop`, and `plugins/sp/skills/spur-cli/references/team.md` carries a retiring banner.
- [ ] R4. The skill-structure tests, the CLI surface parity test and `bun run spur-check` pass, and `superskill agent evaluate plugins/sp/agents/expert-spur.md --json` scores at least the recorded 0.98 baseline.

### Acceptance Criteria

```gherkin
Feature: expert-spur binds the spur-* skills and stays a corpus agent

  Scenario: R1 — expert-spur is a corpus agent, not a coordinator
    Given plugins/sp/agents/expert-spur.md
    When the role-boundary tests run
    Then it binds sp:spur-cli, sp:spur-composer and sp:spur-doctor
    And it keeps "Never drive the planning/execution lifecycle"
    And it declares no batch driving, recurring loop or coordination dispatch duty

  Scenario: R2 — coordination and evolution loops route to super-planner
    Given a request for a recurring evolution loop or multi-agent coordination
    When expert-spur, spur-composer or spur-doctor receives it
    Then the guidance hands it to sp:super-planner or a workflow

  Scenario: R3 — no spur-* guidance uses spur team
    Given expert-spur.md, spur-composer and spur-doctor
    When the tests scan them
    Then each forbids `spur team` and `spur agent loop`
    And the spur-cli team reference carries a retiring banner

  Scenario: R4 — existing gates still pass
    Given the changed plugin and CLI
    When the skill-structure tests, the CLI surface parity test and `bun run spur-check` run
    Then all pass
    And the `superskill agent evaluate` score for expert-spur is not below its recorded baseline
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-10T22:20:18.862Z

- **expert-spur as coordinator: no.** Operator constraint and the R56 split (D8). Batches, recurring loops and coordination belong to `sp:super-planner`.
- **Dispatch surface section: reworded** as a hand-off to `sp:super-planner`, so it no longer reads as a coordination-dispatch duty.
- **R4 baseline:** `superskill agent evaluate plugins/sp/agents/expert-spur.md --json` scored an aggregate of 0.98, grade A, PASS on 2026-09-10.
- **Scope:** no new agent file, command or CLI verb.
- **Decomposition:** the pre-batch-create quiz gate was auto-skipped under `--auto`. The rubric line is in Background.

### Design

**Approach.** Widen expert-spur's skill binding, not its charter (ADR-114; satellite §2):
- The frontmatter becomes `skills: [sp:spur-cli, sp:spur-composer, sp:spur-doctor]`.
- The description gains compose, evaluate and reflect triggers.
- Scope adds composition, evaluation and reflection campaigns, one bounded campaign per dispatch.
- Never adds `spur team`, `spur agent loop`, batch driving, recurring loops and coordination, all of which go to `sp:super-planner` or a workflow.
- The closing "Dispatch surface" section is reworded as a hand-off, so it no longer reads as a dispatch duty.

**Rejected.**
- expert-spur as the evolution coordinator: it breaks the operator's constraint and the R56 four-agent split (`plugins/sp/tests/skill-structure.test.ts:1648`).
- Putting the team ban only in `sp:spur-cli`: misuse happens at the agent and skill layer that picks the verbs.

**Invariants.**
- "Never drive the planning/execution lifecycle" and the `sp:spur-cli` binding stay verbatim (R56).
- The T11 affected-input obligation stays (test at `skill-structure.test.ts:1953`).
- No new agent file, command or CLI verb.

### Plan

1. Edit `plugins/sp/agents/expert-spur.md`: frontmatter skills, description, Scope, a Process step naming composer and doctor, the Never list, the Output Format nouns, and Dispatch surface reworded as a hand-off.
2. Add the retiring banner to `plugins/sp/skills/spur-cli/references/team.md`.
3. Extend the R56 test in `plugins/sp/tests/skill-structure.test.ts` (:1648):
   - the three-skill binding;
   - the lifecycle line is kept;
   - no batch, loop or coordination duty;
   - the super-planner hand-off and the `spur team` / `spur agent loop` bans in expert-spur, composer and doctor;
   - the team.md banner.
4. Run `superskill agent evaluate plugins/sp/agents/expert-spur.md --json`; the aggregate must be at least 0.98.
5. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
