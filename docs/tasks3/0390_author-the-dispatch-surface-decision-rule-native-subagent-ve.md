---
template: feature-impl
schema_version: 1
name: "Author the dispatch-surface decision rule: native subagent versus spur agent run"
description: ""
status: done
type: task
profile: standard
feature_id: H6
parent_wbs: null
priority: P1
tags: ["sp-plugin", "skills", "strategy"]
dependencies: []
created_at: "2026-07-30T21:52:24.874Z"
updated_at: "2026-07-30T23:38:24.531Z"
---

## 0390. Author the dispatch-surface decision rule: native subagent versus spur agent run

### Background

There is no stated rule for choosing between a native subagent and `spur agent run`, and the guidance that exists is actively wrong. `plugins/sp/skills/parallel-execution/SKILL.md:144` tells Claude Code that "fan-out execution uses `spur agent run <prompt> --agent <name>` for each subagent" — the wrong default on the one platform that provides native subagents.

The two surfaces have genuinely different strengths, so a blanket preference is not enough. Native subagents are cheaper to spawn, share session tooling, and orchestrate better. `spur agent run` is what lets an operator reach a different model or a different coding agent (`--model`, `--agent`), run headless or unattended, and produce a durable auditable run record with a cost ledger.

`spur agent run` also carries a measured reliability tax: under a sandboxed Bash session it fails outright when the external agent writes its own storage outside the sandbox allowlist. Reproduced during H6 intake — `spur agent run "..." --agent omp` died with `SQLiteError: attempt to write a readonly database (SQLITE_READONLY)` from `pi-coding-agent/dist/cli.js:2825`, because omp writes its AgentStorage DB under `/Users/robin/node_modules/`. The same failure took down the idea-pipeline's `discovery` step (exit code 3, 1.5s).

ADR-033 is adjacent but does not answer this: it owns which *model tier* a stage runs on via the stage registry's `model_policy`. Its own rationale independently records that phase-based routing "failed in non-slash-command mode (e.g. subagents)", which is more evidence the surface seam needs an explicit rule.

### Requirements
R1. Create `plugins/sp/skills/parallel-execution/references/dispatch-surface.md` as the SSOT for the surface choice.
R2. State the default: use the native subagent when the host platform provides one.
R3. Enumerate the escalation triggers to `spur agent run` as observable, operator-judgment-free conditions: a different model or coding agent is required; the step must run headless or unattended; a durable auditable run record is required; or workspace/credential isolation is required.
R4. Require the caller to name which trigger applied when it escalates.
R5. Compose with ADR-033 rather than duplicating it — the reference decides only which execution surface carries the work, and defers model-tier selection to the stage registry's `model_policy`.
R6. Record the sandbox reliability tax on `spur agent run` with the reproduced SQLITE_READONLY evidence.
R7. Correct `plugins/sp/skills/parallel-execution/SKILL.md:144` so it instructs native-subagent fan-out on platforms that support it.
R8. All four agents cite the reference.
### Acceptance Criteria
```gherkin
Feature: Dispatch-surface decision rule

  Scenario: Dispatch defaults to the native subagent
    Given a host platform that provides native subagents
    When an agent needs to dispatch work to another agent
    Then it uses the native subagent by default

  Scenario: Escalation triggers to spur agent run are observable
    Given the dispatch-surface reference is in place
    When an agent escalates to spur agent run
    Then it names which trigger applied
    And the trigger is one of different model or agent, headless or unattended step, durable auditable record, or workspace and credential isolation

  Scenario: The dispatch rule composes with ADR-033 instead of duplicating it
    Given ADR-033 owns model-tier selection through the stage registry model_policy
    When the dispatch-surface reference is read
    Then it decides only which execution surface carries the work
    And it defers model tier selection to ADR-033

  Scenario: The contradictory fan-out guidance is corrected
    Given parallel-execution/SKILL.md told Claude Code to fan out via spur agent run
    When the rule lands
    Then that line instructs native subagent fan-out on platforms that support it

  Scenario: The sandbox reliability tax is recorded
    Given spur agent run failed with SQLITE_READONLY under a sandboxed Bash session
    When an agent reads the reference
    Then the failure mode and its cause are documented
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Home is `parallel-execution/references/` because that skill already owns the dispatch disciplines — file-handoffs over pasted context, per-role model selection, never-pre-judge-the-reviewer. Choosing the surface a dispatch travels over is the same competency, and co-locating keeps one skill answering "how do I hand work to another agent" rather than splitting that across two.

A new top-level skill was rejected: the rule is roughly one page, it has no independent trigger phrase an operator would reach for, and a skill that exists only to hold one table is the shallow-module anti-pattern ADR-028 argues against.

WHY trigger-keyed rather than preference-stated: "prefer subagents when possible" is unfalsifiable — an agent can rationalize either surface under it, which is how SKILL.md:144 drifted wrong without anyone noticing. Naming four checkable conditions and requiring the caller to cite one makes the choice auditable after the fact, and makes a wrong choice visible in the transcript.

WHY compose with ADR-033 instead of absorbing it: tier and surface are orthogonal. A cheap-tier step can run in-session on a native subagent, and a capable-tier step can run headless through `spur agent run`. Folding surface choice into `model_policy` would couple two axes that vary independently and would put prompt-layer routing policy into a domain-layer registry.
### Plan
- [x] Draft `dispatch-surface.md` with the default, the four escalation triggers, and the naming requirement
- [x] Add the ADR-033 composition boundary - surface here, tier there
- [x] Record the SQLITE_READONLY sandbox evidence with the reproduction command
- [x] Fix the contradicting line at `parallel-execution/SKILL.md:144`
- [x] Audit the rest of `parallel-execution/` for other `spur agent run` fan-out assumptions (only SKILL.md:144 matched; references clean)
- [x] Add citations from the four agent files (3 of 4 existing agents cite; `super-planner` deferred to 0391)
- [x] Run `bun run test` and confirm green (4082 pass / 0 fail)
### Solution

- **`plugins/sp/skills/parallel-execution/references/dispatch-surface.md`** (NEW) - SSOT for the
  native-subagent-vs-`spur agent run` choice. Holds: the default (native subagent when the host
  provides one); four observable escalation triggers (different model/agent, headless/unattended,
  durable auditable record, workspace/credential isolation); the naming requirement (caller states
  which trigger applied); the ADR-033 composition boundary (surface here, tier there); and the
  SQLITE_READONLY sandbox reliability tax with the reproduced `pi-coding-agent` evidence.
- **`plugins/sp/skills/parallel-execution/SKILL.md:71-74`** - Subagent execution disciplines intro
  now points to `dispatch-surface.md` for the surface choice before listing the four disciplines.
- **`plugins/sp/skills/parallel-execution/SKILL.md:132`** - `dispatch-surface.md` added to the
  References table.
- **`plugins/sp/skills/parallel-execution/SKILL.md:144`** - corrected the contradictory fan-out
  guidance. Was: "fan-out execution uses `spur agent run <prompt> --agent <name>` for each
  subagent." Now: native subagent **by default**; `spur agent run` only on a named trigger in
  `dispatch-surface.md`.
- **`plugins/sp/agents/super-coder.md:117-118`** - citation in Subagent execution disciplines
  (choose surface per the reference, then apply the four disciplines).
- **`plugins/sp/agents/super-reviewer.md:73-76`** - new "Dispatch surface" section citing the
  reference.
- **`plugins/sp/agents/expert-spur.md:113-116`** - new "Dispatch surface" section citing the
  reference.


Trigger-keyed, not preference-stated: "prefer subagents when possible" is unfalsifiable and is how
`SKILL.md:144` drifted wrong. Four checkable triggers + a naming requirement make the choice
auditable after the fact and a wrong choice visible in the transcript. Co-located in
`parallel-execution/references/` because choosing the surface a dispatch travels over is the same
competency as the existing dispatch disciplines (file-handoffs, per-role model, ledgers).


R8 "all four agents cite the reference" is satisfied for the **three** agents that exist today
(`expert-spur`, `super-coder`, `super-reviewer`). The fourth - `super-planner` - is created by task
**0391** (its charter inherits today's `super-coder` body). 0391's charter must cite
`dispatch-surface.md`; recorded here so 0391 picks it up. Not implemented in 0390 because creating
`super-planner` is 0391's scope (scope discipline; 0390 has `dependencies: []`).


- `bun run test` green: **4082 pass / 0 fail** (241 files, 12735 assertions, 33.5s).
- `plugins/sp/tests/skill-structure.test.ts` green: **44 pass / 0 fail**, including R16c
  (relative-markdown-link resolution) which validates every new citation path - the
  `dispatch-surface.md` links from SKILL.md, all three agent files, and the ADR-033 link
  (`../../../../../docs/00_ADR.md`) from the reference.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | dispatch-surface.md:1-101 exists, declares SSOT at line 12 |
| R2 | MET | dispatch-surface.md:23 - native subagent default |
| R3 | MET | dispatch-surface.md:35-40 - four escalation triggers table |
| R4 | MET | dispatch-surface.md:42-46 - naming requirement |
| R5 | MET | dispatch-surface.md:54-66 composes with ADR-033; ADR-033 at docs/00_ADR.md:778-786 owns model_policy |
| R6 | MET | dispatch-surface.md:68-90 - SQLITE_READONLY reproduction with cause and impact |
| R7 | MET | SKILL.md:144 corrected to native-subagent-by-default |
| R8 | MET | 3/3 existing agents cite (super-coder.md:118, super-reviewer.md:76, expert-spur.md:116); 4th agent super-planner deferred to 0391 with Solution documentation |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 |  | — | 4/4 design claims DONE |
| P4 |  | — | no findings - documentation deliverable |
| P4 |  | — | content verified against ADR-033 and requirements |
| P4 |  | — | co-located in parallel-execution/references/, does not duplicate ADR-033 |
| P1 |  | — | feature H6 has incomplete sibling tasks (0391-0396 todo) and L4.scenario-unverified findings |
### References

H6

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-30T23:08:19.562Z todo → wip (system)
- 2026-07-30T23:09:20.447Z wip → testing (system)
- 2026-07-30T23:38:24.531Z testing → done (system)
