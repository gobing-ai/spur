---
schema_version: 1
id: "O"
name: "sp plugin token-efficient reliable execution architecture"
status: backlog
priority: P2
tags: []
created_at: "2026-07-18T17:24:53.258Z"
updated_at: "2026-07-18T19:26:51.455Z"
---

# O: sp plugin token-efficient reliable execution architecture

## Goal
Define a reviewable and verifiable target architecture, evidence model, and migration backlog that make the `sp` plugin more token-efficient and easier to operate while preserving reliable delivery on cheaper models.
## Scope
**In**

- Baseline the current plugin surface, prompt/context footprint, workflow duplication, token telemetry, and delivery evidence.
- Verify Claude Code/Anthropic and Codex/OpenAI cache semantics from official sources.
- Specify stage contracts, layered context envelopes, stage-level model policies, objective escalation, and adapter ownership.
- Preserve and enhance `dev-next` as the golden-path router over canonical stages.
- Specify a hybrid qualification corpus and a dogfood campaign layer over atomic `sp:dogfood-testing@1.2` runs.
- Design workflow simplification, provider telemetry correlation, shadow qualification, compatibility, rollback, and implementation-task graduation.
- Create detailed investigation/specification tasks only; stop before enhancement.

**Out**

- See **Out of scope** above.
## Acceptance Criteria
```gherkin
Feature: sp plugin token-efficient reliable execution architecture

  @core
  Scenario: R1 — Current plugin baseline is decision-ready
    Given the current commands, skills, agents, workflows, hooks, evals, and historical dogfood evidence
    When the baseline investigation is resolved
    Then every material token, duplication, routing, and reliability claim is tied to reproducible evidence

  @core
  Scenario: R2 — Provider cache semantics are verified for Claude and Codex
    Given official provider and product documentation
    When cache behavior and telemetry are specified
    Then the design distinguishes provider-metered facts from Spur estimates and records versioned citations

  @edge
  Scenario: Baseline remains usable when provider telemetry is absent
    Given a run or platform does not expose cache-read, cache-create, or stage-level usage
    When the baseline is recorded
    Then the missing dimension is explicit rather than inferred
    And the portable leading indicators remain comparable across Claude Code and Codex
    And the dataset preserves the raw observation needed for later reinterpretation

  @core
  Scenario: R3 — Stage registry contract is implementation-ready
    Given the lifecycle and competency surfaces
    When the canonical stage model is specified
    Then commands, workflows, dev-next, model policy, context, gates, and outputs can reference the same typed stage identity

  @core
  Scenario: R4 — Golden path preserves dev-next intent
    Given the current command surface and compatibility requirements
    When the simplified operator surface is specified
    Then dev-next remains the primary one-dispatch router and compatibility wrappers contain no duplicated domain logic

  @core
  Scenario: R5 — Layered context envelopes are cache-stable and safe
    Given a canonical stage and task state
    When its context envelope is assembled repeatedly without source changes
    Then stable layers remain identical and dynamic layers are minimal, explicit, and invalidated by content state

  @core
  Scenario: R6 — Adaptive model routing escalates objectively
    Given eligible cheap and fallback executor profiles
    When a stage starts, fails a gate, times out, or emits insufficient evidence
    Then routing follows explicit eligibility, risk, retry, override, and escalation rules without relying on model self-confidence

  @core
  Scenario: R7 — Qualification corpus detects quality regression
    Given historical and adversarial fixtures
    When a model-stage candidate is evaluated
    Then deterministic gates, behavioral disciplines, verified outcome, token totals, retries, and escalations are comparable to baseline

  @core
  Scenario: R8 — Dogfood campaigns aggregate atomic runs honestly
    Given isolated dogfood reports for a declared campaign matrix
    When the campaign is aggregated
    Then incomparable, invalid, or unmetered evidence is labeled or rejected and atomic report contracts remain unchanged

  @core
  Scenario: R9 — Workflow simplification preserves lifecycle gates
    Given current project and seeded workflows
    When they are mapped to canonical stages
    Then duplicate orchestration is removed without nesting pipelines, bypassing lifecycle guards, or losing resumability and HITL semantics

  @core
  Scenario: R10 — Shadow migration is reversible
    Given current and candidate stage bindings
    When a stage is qualified and cut over
    Then before-after evidence, compatibility behavior, rollback conditions, and ownership are explicit

  @core
  Scenario: R11 — Dependency wiring has a CLI-safe contract
    Given wayfinder and decomposition tasks need blocking edges
    When dependencies are authored or changed
    Then a validated CLI path writes dependencies without direct task-frontmatter edits

  @core
  Scenario: R12 — Final synthesis produces an executable redesign package
    Given all prerequisite investigation artifacts
    When the synthesis ticket resolves
    Then reviewers receive the target architecture, decision log, metrics, risks, migration waves, and dependency-ordered implementation backlog

  @edge
  Scenario: R13 — Charting performs no enhancement
    Given this wayfinder session creates the map and tickets
    When the session ends
    Then no plugin implementation file or workflow behavior has been modified

  @core
  Scenario: R14 — Workflows are orchestrated through spur workflow
    Given the target architecture composes lifecycle stages into workflows
    When workflow execution is designed or implemented
    Then `spur workflow` remains the driver and canonical orchestration boundary
    And any driver enhancement, workflow enhancement, or new workflow preserves resumability, HITL gates, auditability, and stage-contract alignment
    And plugin commands, skills, campaigns, and adapters do not create a competing workflow runner

  @core
  Scenario: R15 — Spur CLI is the default execution capacity
    Given implementation or qualification needs scripts, subprocesses, corpus mutation, or operational automation
    When an execution path is selected
    Then the path uses the supported `spur` CLI surface where one exists
    And `plugins/sp/scripts` is used only with explicit approval recorded in the task or rollout decision
    And any required CLI gap is first captured as a CLI/driver enhancement task rather than bypassed silently
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0280 | Baseline plugins/sp stages, context, token evidence, and duplication | done |
| 0281 | Verify Claude and Codex prompt-cache and usage telemetry semantics | todo |
| 0282 | Specify the canonical stage-contract registry | todo |
| 0283 | Design the golden-path command surface around dev-next | todo |
| 0284 | Specify cache-stable layered context envelopes and invalidation | todo |
| 0285 | Specify stage-level adaptive model routing and bounded escalation | todo |
| 0286 | Design the hybrid behavioral qualification corpus and quality gates | todo |
| 0287 | Design declarative dogfood campaigns over atomic runs | todo |
| 0288 | Map and simplify .spur workflows onto canonical stages | todo |
| 0289 | Specify shadow qualification, compatibility, cutover, and rollback | todo |
| 0290 | Specify CLI-safe feature sections and task dependency mutation | todo |
| 0291 | Synthesize the target architecture and implementation backlog | todo |
<!-- END AUTO-GENERATED -->

## Notes
**Domain context**

- Actual plugin source is `plugins/sp`; there is no `plugins/cc` directory. Claude Code slash commands and Codex `$sp-dev-*` skills/adapters are platform surfaces over the same plugin corpus.
- Current surface: 28 command definitions, 25 skills, 3 specialist agents, and 9 project workflows. Several command wrappers are 200–300 lines despite the documented three-tier rule that commands should contain no domain logic.
- `plugins/sp/commands/dev-next.md` and `sp:next-router` are retained as the primary low-burden entry point. The router keeps its one-primary-dispatch budget; it must not become a second pipeline FSM or an unbounded self-loop.
- Existing executor support already includes named `{agent, model?}` profiles and `agent.default-by-phase`, but routing is inferred from command text and is too coarse for stage-specific qualification or fallback.
- Existing behavioral eval infrastructure has deterministic and live tiers but only one scenario (`code-verification/premature-done`), which is insufficient for cheaper-model parity claims.
- Existing token evidence is split: dogfood provides portable `chars/4` trend estimates; imported provider history can contain usage/cache fields; current analytics folds cache-read/create tokens into total input and does not correlate usage to workflow stage and verified verdict.
- Prior art: feature `N` delivered `dev-next` v1 and dogfood protocol `sp:dogfood-testing@1.2`; task `0139` documented why cache optimization without per-step measurement was unverifiable. This map extends rather than reopens those finished decisions.

**Locked discovery decisions (2026-07-18)**

1. Destination is an implementation-ready redesign package, not direct enhancement in the charting session.
2. Cache evidence uses a dual contract: provider-reported cache telemetry is authoritative where available; dogfood estimates remain the portable leading indicator.
3. Primary optimization metric is price-neutral: minimize fresh/uncached input tokens per verified PASS. Total input+output tokens must not increase; cache hit, retries, escalation, and latency are diagnostics.
4. Reliability policy is cheap-first outcome equivalence with bounded escalation. Existing deterministic gates and PASS-only completion remain non-negotiable.
5. Public UX becomes a golden-path core plus thin compatibility wrappers. `dev-next` remains the primary status-aware front door.
6. The canonical reusable unit is a declarative stage contract: typed inputs/outputs, reasoning skill, deterministic gates, mutation class, model eligibility/fallback, and cache/context contract.
7. Context is packaged as a stable layered envelope: plugin core, stage contract, compact project/task snapshot, required references, then dynamic input/results; captured state is reused until invalidated.
8. Model routing is policy-constrained adaptive routing: static eligibility and minimum capability, objective risk signals for starting tier, machine-observable escalation triggers, explicit override preserved.
9. `dev-dogfood` remains the atomic single-testee runner. Comparative experiments use a declarative campaign layer that aggregates isolated runs without weakening `sp:dogfood-testing@1.2`.
10. Rollout is shadow-first and stage-by-stage, with per-stage qualification and rollback; no big-bang replacement.
11. First live qualification covers Claude Code and Codex. Other supported platforms receive structural adapter/manifest validation until later live expansion.
12. Qualification corpus is hybrid: representative historical Spur work plus synthetic adversarial cases, deterministic fixtures always-on and sampled live campaigns.

**Skills and evidence every resolution session should consult**

- `sp:wayfinder` for one-ticket-per-session map discipline.
- `sp:spur-cli` for all feature/task corpus writes and gates.
- `sp:dogfood-testing` plus `references/monitor-ledger.md` and `report-template.md` for atomic run evidence.
- `sp:indexed-context` for read reuse, token-ledger capabilities, and cross-platform degradation.
- `sp:spur-dev`, `sp:next-router`, `sp:code-verification`, and `.spur/workflows/*.yaml` for current lifecycle ownership and hard gates.
- Official provider documentation must be cited for cache semantics; unmetered estimates must be labeled as estimates.

**Ticket sequencing (non-enforcing until the CLI dependency-write gap is resolved)**

- Wave 0 evidence: baseline inventory, provider cache semantics, and dependency-write gap.
- Wave 1 contracts: stage registry, golden-path surface, context envelopes, adaptive routing, qualification corpus, campaign design, and workflow simplification.
- Wave 2 convergence: shadow migration plan and target-architecture synthesis.
- Task titles and their Plan sections carry logical prerequisites. The current CLI cannot write `dependencies[]`; no direct frontmatter edit is permitted.

**Execution governance (verified before implementation kickoff)**

13. Workflow orchestration is driver-owned by `spur workflow`. Existing workflows may be enhanced and new workflows may be added, but they must execute through the `spur workflow` command/driver and align to the canonical stage contracts. Plugin commands, skills, campaign logic, and adapters must not introduce a competing workflow runner.
14. `spur` CLI is the default execution-capacity surface for scripts, subprocesses, corpus mutation, orchestration, and operational automation. If a supported `spur` command is missing, the first response is to specify/enhance the CLI or workflow driver. `plugins/sp/scripts` is an exception-only path requiring explicit approval recorded in the owning task or rollout decision.
15. Implementation kickoff is gated on each affected task documenting its `spur workflow` driver path and `spur` CLI invocation surface, or explicitly recording the approved exception and reason.
## History
