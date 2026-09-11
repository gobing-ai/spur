---
schema_version: 1
id: "I21"
name: "Spur artifact composition and evolution: spur-composer, spur-doctor, expert-spur and workflow layers"
status: backlog
priority: P2
tags: []
created_at: "2026-09-10T21:40:11.646Z"
updated_at: "2026-09-10T23:48:16.123Z"
---

# I21: Spur artifact composition and evolution: spur-composer, spur-doctor, expert-spur and workflow layers

## Goal

Give agents in any Spur-adopting project the capability to pick, compose, tune, evaluate and evolve
spur artifacts (tasks, features, rules, workflows, agent specs) from evidence, without widening any
agent's charter. `spur workflow list` shows every registered workflow folder under a truthful layer:
the installed package as **shared**, the project's `.spur/workflows` as **project** (always listed,
even when empty or missing), plus any extra registered folders. Two new cross-noun skills carry the
competency: `sp:spur-composer` (catalog selection, composition, per-project tuning, and the
ephemeral → project → shared promotion ladder) and `sp:spur-doctor` (evidence-based evaluation and
LLM-history reflection through `sp:history-anatomy` findings, yielding evolution proposals).
`sp:expert-spur` loads them to run bounded corpus campaigns. It never becomes a coordinator or
orchestrator (that stays `sp:super-planner`) and never uses `spur team`, which is retiring.
The composer and doctor pair also carries the workflow composition budgets (ADR-115). Shared
workflows stay within hard caps on shell programs, shell guards and `agent.run` inputs. Model steps
stay few and leave checked results, and doctor judges step duration, idle gaps and cache hits from
trace evidence.

## Scope

- In:
  - `spur workflow list` layer model: **shared** (installed package), **project** (`<cwd>/.spur/workflows`, always listed), registered extra folders; one layer vocabulary for `workflow list` and the workflow resolver; the `--json` layer ids (operator-consented surface change, idea-eval 2026-09-10)
  - New skills `plugins/sp/skills/spur-composer/` and `plugins/sp/skills/spur-doctor/`, covering task, feature, rule, workflow, agent spec and history
  - Shared workflow catalog (intent → workflow selection) and the find-existing-workflow fix
  - Rule composition and `spur rule trace`-driven tuning; workflow composition ladder (ephemeral → project → shared)
  - History reflection: each `sp:history-anatomy` finding class routes to one action class
  - `plugins/sp/agents/expert-spur.md` charter: loads spur-cli, spur-composer and spur-doctor; `spur team` ban; non-orchestrator boundary
  - `sp:spur-cli` references the above touches (workflows, rules, agent, message, team banner) and tests pinning role boundaries, catalog parity and layer listing
  - Workflow composition budgets (ADR-115):
    - error-level caps and a `level` field in `spur workflow validate` (an observable-output change; operator consent requested 2026-09-10)
    - a `spur-check` shared-workflow composition gate and `pipeline-budgets` coverage
    - behavior-preserving extraction of the shared workflows over the caps, each change under recorded consent
    - the doctor step profile as a plugin script
- Out:
  - Any coordinator or orchestrator role for expert-spur, and recurring self-evolution loops (owned by `sp:super-planner` or a workflow)
  - Using or extending `spur team`; retiring the `team` noun itself
  - Behavior changes to shared `config/workflows/*.yaml` without per-change operator consent
  - Agent and message runtime changes owned by B1, G4 and D6
  - Other CLI surface changes not named at design-approval
  - Composition findings that block `workflow run`, `run --dry-run` or `continue`
  - Merging or splitting model steps in shared workflows; doctor proposes those from step-profile evidence

## Acceptance Criteria

```gherkin
Feature: Spur artifact composition and evolution: spur-composer, spur-doctor, expert-spur and workflow layers

  @core
  Scenario: R1 — workflow list labels the installed package folder as the shared layer
    Given the installed spur package ships its workflows under config/workflows
    When `spur workflow list --json` runs in any project
    Then the layer whose path is the package workflows folder has id "shared"
    And no layer with id "project" points at a folder outside the project

  @core
  Scenario: R2 — workflow list always includes the project layer
    Given a project with no `.spur/workflows` folder
    When `spur workflow list --json` and `spur workflow list` run
    Then both list a layer with id "project" and path `<cwd>/.spur/workflows`
    And no workflow entry is attributed to that layer

  @core
  Scenario: R3 — registered extra workflow folders are listed as their own layer
    Given `workflows.paths` in the project or global config registers an extra folder
    When `spur workflow list --json` runs
    Then that folder appears as its own layer with its absolute path
    And its workflows are listed with that layer as their source
    And a registered path equal to the shared or project folder is not listed twice

  @core
  Scenario: R4 — list and resolution share one layer vocabulary
    Given a workflow name present in both the project and the shared layer
    When `spur workflow list --json` and `spur workflow show <name> --json` run
    Then both surfaces name layers with the same ids
    And name resolution picks the project copy

  @core
  Scenario: R5 — sp:spur-composer composes and tunes every spur noun
    Given plugins/sp/skills/spur-composer/SKILL.md
    When the plugin structure tests run
    Then the skill validates and covers selection, composition and tuning for tasks, features, rules, workflows and agent specs
    And it links to sp:spur-cli references instead of restating verb or flag catalogs

  @core
  Scenario: R6 — sp:spur-doctor evaluates spur artifacts from CLI evidence
    Given plugins/sp/skills/spur-doctor/SKILL.md
    When the plugin structure tests run
    Then the skill validates and names an evidence source for each covered noun
    And its description says it diagnoses spur artifacts, not runtime environments like `spur agent doctor`

  @core
  Scenario: R7 — spur-doctor reflects over history through history-anatomy findings
    Given a sp:history-anatomy report
    When spur-doctor runs a reflection
    Then every finding class maps to exactly one action class: task, rule candidate, workflow optimization, doc or learning, or no-op
    And spur-doctor never re-interprets raw history records

  @core
  Scenario: R8 — spur-doctor proposes and spur-composer applies
    Given an evolution proposal from spur-doctor
    When the operator accepts it
    Then spur-composer applies it through `spur` CLI verbs
    And spur-doctor itself performs no task, feature, rule or workflow write

  @core
  Scenario: R9 — every shared workflow has a catalog intent
    Given the shared workflow catalog used for intent-to-workflow selection
    When the catalog parity check runs
    Then every workflow in config/workflows has exactly one catalog entry with an intent
    And a shared workflow without an entry fails the check

  @core
  Scenario: R10 — find-existing-workflow searches every listed layer
    Given the find-existing-workflow procedure
    When it enumerates candidate workflows
    Then it reads `spur workflow list --json` across all layers instead of globbing `.spur/workflows`

  @core
  Scenario: R11 — the composition ladder gates every promotion
    Given a composed workflow
    When it moves from ephemeral to project to shared
    Then each step passes `spur workflow validate` and a dry run before use
    And the shared step writes config/workflows only after recorded operator consent

  @core
  Scenario: R12 — rule tuning is driven by rule trace evidence
    Given the rule tuning procedure
    When a rule is tuned for a project
    Then the procedure starts from `spur rule trace --json` evidence
    And it ends with `spur rule validate` and a re-run on the affected inputs

  @core
  Scenario: R13 — expert-spur is a corpus agent, not a coordinator
    Given plugins/sp/agents/expert-spur.md
    When the role-boundary tests run
    Then it binds sp:spur-cli, sp:spur-composer and sp:spur-doctor
    And it keeps "Never drive the planning/execution lifecycle"
    And it declares no batch driving, recurring loop or coordination dispatch duty

  @core
  Scenario: R14 — coordination and evolution loops route to super-planner
    Given a request for a recurring evolution loop or multi-agent coordination
    When expert-spur, spur-composer or spur-doctor receives it
    Then the guidance hands it to sp:super-planner or a workflow

  @core
  Scenario: R15 — no spur-* guidance uses spur team
    Given expert-spur.md, spur-composer and spur-doctor
    When the tests scan them
    Then each forbids `spur team` and `spur agent loop`
    And the spur-cli team reference carries a retiring banner

  @core
  Scenario: R16 — existing gates still pass
    Given the changed plugin and CLI
    When the skill-structure tests, the CLI surface parity test and `bun run spur-check` run
    Then all pass
    And the `superskill agent evaluate` score for expert-spur is not below its recorded baseline

  @core
  Scenario: R17 — composition caps are error-level validate findings
    Given a workflow with an 11-command shell action, a 6-command shell guard and a 1001-character slash-led agent.run input
    When `spur workflow validate <file> --json` runs
    Then each is reported with level "error" and the command exits 1
    And a workflow with only warn-level findings exits 0

  @core
  Scenario: R18 — composition findings never block a run
    Given a workflow with an error-level composition finding
    When `spur workflow run`, `spur workflow run --dry-run` and `spur workflow continue` process it
    Then none of them computes or reports composition findings
    And each behaves as it does for a definition with no findings

  @core
  Scenario: R19 — the shared-workflow composition gate fails on error-level findings
    Given a definition in config/workflows with an error-level composition finding
    When `bun run spur-check` runs
    Then the composition gate fails and names the workflow, state and action
    And warn-level findings do not fail it
    And the gate passes on the shipped config/workflows

  @core
  Scenario: R20 — every shared workflow with a model query has a pipeline budget
    Given config/pipeline-budgets.json and the definitions in config/workflows
    When the pipeline budget gate runs
    Then every definition with at least one model query has a budget entry
    And a definition without one fails the gate by name

  @core
  Scenario: R21 — task-pipeline stays within the composition budgets
    Given config/workflows/task-pipeline.yaml
    When `spur workflow validate --json` runs on it
    Then it reports no error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And the proof-chain suite passes and the `run --dry-run` graph is unchanged

  @core
  Scenario: R22 — idea and wrap-up pipelines stay within the composition budgets
    Given config/workflows/idea-pipeline.yaml and config/workflows/wrapup-pipeline.yaml
    When `spur workflow validate --json` runs on each
    Then neither reports an error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And their workflow tests pass and their `run --dry-run` graphs are unchanged

  @core
  Scenario: R23 — feature-dev, pr-review, wayfinder, docs and basic stay within the composition budgets
    Given feature-dev.yaml, pr-review.yaml, wayfinder-resolution.yaml, docs-pipeline.yaml and basic.yaml in config/workflows
    When `spur workflow validate --json` runs on each
    Then none reports an error-level composition finding
    And every agent.run action declares expectFile or requireDiff
    And their workflow tests pass and their `run --dry-run` graphs are unchanged

  @core
  Scenario: R24 — spur-doctor judges workflows by composition findings and step profiles
    Given completed runs of a workflow and its `spur workflow validate --json` output
    When spur-doctor evaluates the workflow
    Then the step profile reports per node the run count, p50 and max duration, p50 idle gap, session mode and cacheHit p50 with coverage
    And cache evidence is unknown, not zero, when the executor reports no usage
    And each composition finding and each flagged cache-window budget becomes a workflow-optimization proposal

  @core
  Scenario: R25 — spur-composer composes to the composition budgets
    Given the workflow-fit-and-tuning reference and plugins/sp/skills/spur-composer/SKILL.md
    When the plugin structure tests run
    Then the reference teaches the consolidation and cache-window rules
    And spur-composer applies them with the ADR-115 budgets when it composes or tunes a workflow
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0819 | Workflow list and name resolution share the project, registered and shared layers | todo |
| 0820 | spur-composer and spur-doctor skills compose, evaluate and evolve spur artifacts | todo |
| 0821 | expert-spur binds the spur-* skills and stays a corpus agent | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
