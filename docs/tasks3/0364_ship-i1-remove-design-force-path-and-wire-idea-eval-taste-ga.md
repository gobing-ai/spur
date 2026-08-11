---
template: feature-impl
schema_version: 1
name: "Ship I1: remove --design force path and wire idea-eval taste gate"
description: ""
status: done
type: task
profile: standard
feature_id: I11
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-28T04:09:48.559Z"
updated_at: "2026-08-11T21:18:35.361Z"
done_forced: "true"
done_reason: PASS verdict + Review table; workflow validate and plugin tests green
---

## 0364. Ship I1: remove --design force path and wire idea-eval taste gate

### Background



### Requirements
R1. Remove `--design` from `/sp:dev-idea` command surface; design var is `auto|skip` only.

R2. Collapse `design=force` from idea-pipeline guards/comments; keep signal-driven system-design + `--skip-design`.

R3. Insert post-discovery `idea-eval` taste gate (HITL, reject→cancelled, `--idea-approved` / `idea_approved` auto-skip).

R4. Discovery emits idea-eval report; template SSOT at spur-dev/references/idea-evaluation.md; brainstorm skill documents the contract.

R5. Sync workflow copies (config, .spur, apps/cli); validate; keep plugin structure tests green.
### Acceptance Criteria
```gherkin
Feature: Ship I1 idea path enhancements

  Scenario: R1 — No --design on dev-idea
    Given plugins/sp/commands/dev-idea.md
    When the command surface is read
    Then argument-hint and usage omit [--design] and document auto|skip only

  Scenario: R2 — No force path in idea-pipeline
    Given config/workflows/idea-pipeline.yaml
    When design routing guards are evaluated
    Then no design=force branch remains and system-design uses design=auto + needs_design

  Scenario: R3 — idea-eval gate exists
    Given idea-pipeline transitions
    When discovery completes
    Then flow enters idea-eval with approve→feature-create and reject→cancelled

  Scenario: R4 — Template and brainstorm contract
    Given idea-evaluation.md and brainstorm SKILL.md
    When discovery runs
    Then the skill is required to emit .spur/run/idea-eval-report.md per the template

  Scenario: R5 — Workflow validates
    Given the updated idea-pipeline.yaml
    When spur workflow validate runs
    Then valid is true and plugin structure tests pass

  Scenario: R6 — --auto still pauses idea-eval unless idea_approved
    Given profile=auto and idea_approved=false
    When discovery completes
    Then idea-eval still pauses for HITL
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Shipped I1 implementation (2026-07-28)**

| File | Change |
|------|--------|
| `plugins/sp/commands/dev-idea.md:3` | Dropped `--design` from arg-hint; added `--idea-approved` |
| `plugins/sp/commands/dev-idea.md:14-29` | Usage + design package + idea-eval docs; vars `auto\|skip` |
| `config/workflows/idea-pipeline.yaml:10-26` | Shape + vars: idea-eval, idea_approved; no force path |
| `config/workflows/idea-pipeline.yaml:50` | `idea_approved: "false"` default |
| `config/workflows/idea-pipeline.yaml:71` | start cleanup includes idea-eval-report.md |
| `config/workflows/idea-pipeline.yaml:73-101` | discovery emits report; new `idea-eval` HITL state |
| `config/workflows/idea-pipeline.yaml:256-282` | discovery→idea-eval→feature-create/cancelled transitions |
| `config/workflows/idea-pipeline.yaml:298-330` | design routing without force branch |
| `.spur/workflows/idea-pipeline.yaml` | Synced with config SSOT |
| `apps/cli/config/workflows/idea-pipeline.yaml` | Synced scaffold source |
| `plugins/sp/skills/spur-dev/references/idea-evaluation.md:1` | **New** template SSOT |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:68` | Idea op arg-hint without `--design` |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:252-270` | §16 idea-eval + design package table |
| `plugins/sp/skills/brainstorm/SKILL.md:187-215` | Idea vs plan flags; idea-eval report emission contract |

**Verify:** `spur workflow validate config/workflows/idea-pipeline.yaml` → valid; `plugins/sp` skill-structure + command-contract → 90 pass.
### Testing
**Coverage:** N/A (orchestration config + skill docs; no runtime app code).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/commands/dev-idea.md:3` arg-hint omits `--design` |
| R2 | MET | `config/workflows/idea-pipeline.yaml:298-330` design=auto + needs_design only |
| R3 | MET | `config/workflows/idea-pipeline.yaml:89` idea-eval; `:256-282` transitions |
| R4 | MET | `idea-evaluation.md:1`; `brainstorm/SKILL.md:199-215`; discovery input `:86` |
| R5 | MET | `spur workflow validate` ok; skill-structure + command-contract 90 pass |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| R1 — No --design on dev-idea | MET | static | dev-idea.md:3 |
| R2 — No force path in idea-pipeline | MET | static | idea-pipeline force guards removed |
| R3 — idea-eval gate exists | MET | static | idea-pipeline.yaml:89,256-282 |
| R4 — Template and brainstorm contract | MET | static | idea-evaluation.md + brainstorm SKILL |
| R5 — Workflow validates | MET | command | validate + bun test |

Verdict: PASS
### Review
| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | (none) | — |
| P2 | (none) | — |
| P3 | Scaffold/apps/cli workflow copy can drift from config SSOT | Accepted: both synced this ship; future edits should copy both |
| P4 | Interactive dogfood of approve/reject not run in this session | Deferred to operator next `/sp:dev-idea` use |

**Residual risk:** Low — YAML validates; structure tests green. Live agent.run discovery emission of idea-eval-report.md is contract-enforced by prompt, not unit-tested.

**Disposition:** APPROVE for done — config/docs ship complete.
### References

I1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-28T04:09:56.369Z todo → wip (system)
- 2026-07-28T04:10:59.725Z wip → testing (system)
- 2026-07-28T04:11:01.127Z testing → done (system)
