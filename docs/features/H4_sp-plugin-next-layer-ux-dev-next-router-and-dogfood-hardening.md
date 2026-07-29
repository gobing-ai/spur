---
schema_version: 1
id: "H4"
name: "sp plugin next-layer UX — dev-next router and dogfood hardening"
status: verifying
priority: P1
tags:
  - wayfinder
  - sp-plugin
  - meta
created_at: "2026-07-17T00:53:58.309Z"
updated_at: "2026-07-28T00:31:34.481Z"
---

# N: sp plugin next-layer UX — dev-next router and dogfood hardening

## Destination

Operators stop hand-picking the next `/sp:dev-*` command: `/sp:dev-next` inspects a task (or the next frontier task under a feature), dispatches the single best existing command, and on clean success chains along existing lifecycle/`--next` edges — while dogfood (`/sp:dev-dogfood` + `sp:dogfood-testing`) is hardened so meta-runs against Spur itself reliably honor the dual-artifact protocol with lower token waste.

## Notes

**Domain context**

- Plugin surface: `plugins/sp/` (commands thin wrappers; logic in skills). Canonical index: `plugins/sp/README.md`.
- Spine: `sp:spur-dev` owns planning + execution pipelines; **do not invent a second FSM** for `dev-next`.
- Existing linear chain: `dev-refine --next` → `dev-run --auto --next` (implement) → `dev-verify --auto --next`. See `plugins/sp/commands/dev-run.md` § `--next` chain and prior art task `0119`.
- Full pipeline already exists: `/sp:dev-run` → `task-pipeline.yaml`. `dev-next` is a **status→command router**, not a pipeline reimplementation.
- Dogfood backbone: `plugins/sp/skills/dogfood-testing/` protocol `sp:dogfood-testing@1.1` — Plan → Execute+fix → Monitor → Report; dual paths live + `docs/dogfood/`; finalize-or-abort non-skippable.
- Recent dogfood evidence: `docs/dogfood/2026-07-16-sp-dev-refine-0269-dogfood.md` (~26% cache, ~48k tokens estimate, provenance guard friction on testing→done, doc drift findings).
- Related finished feature: `I` (sp plugin hands-off ready) — idea/wrap/auto; this map is the *next* UX layer (router + meta quality).

**Skills every session should consult**

- `sp:wayfinder` — map discipline (one ticket per session when resolving)
- `sp:spur-cli` — task/feature verbs, `--json`
- `sp:spur-dev` / `plugins/sp/skills/spur-dev/references/dev-operations.md` — command contracts
- `sp:dogfood-testing` + `references/{report-template,monitor-ledger}.md` — dogfood workstream
- `plugins/sp/README.md` — command index; update same-commit when shipping `dev-next`

**Standing preferences (from discovery interview 2026-07-16)**

1. One map, two workstreams (`dev-next` + dogfood); not two orphan features, not one mega-ship.
2. `dev-next` = **status-router + dispatcher** over existing commands.
3. Auto-advance: chain on clean success; stop on HITL, failed guards, multi-candidate ambiguity. Support `--dry-run` and `--once`.
4. Signals: corpus status first (`spur task|feature show|list --json`); light gates only when needed (`task check`, unit/coverage, lint/type, `rule run`). No freeform chat-history routing in v1.
5. Identity: **task WBS primary**; optional feature ID → pick next frontier task then route.
6. Dogfood success metric: **contract compliance + token efficiency** (not golden suite first, not report UX first).
7. Adjacent ideas (status dashboard, golden dogfood suite, recovery polish, command matrix doc) stay **fog** until early tickets clear.

## Decisions so far

- [0270 Define /sp:dev-next v1 routing table](../tasks2/0270_define-sp-dev-next-v1-routing-table-status-signals-command.md) — Table-driven router: TABLE A (task status), TABLE B (feature frontier + rollup), TABLE C (sequential light-gate short-circuit); one dispatch per invocation; chains only via existing refine/run/verify `--next`; multi-candidate = HITL stop.
- [0271 Decide skill ownership for dev-next router](../tasks2/0271_decide-skill-ownership-for-dev-next-router.md) — **Option A:** new skill `sp:next-router` + thin `commands/dev-next.md`; routing SSOT in `skills/next-router/references/routing-table.md`; not folded into spur-dev (dogfood-style outside ops map).
- [0272 Specify /sp:dev-next CLI surface, flags, and stop conditions](../tasks2/0272_specify-sp-dev-next-cli-surface-flags-and-stop-conditions.md) — Paste-ready command contract: flags `--dry-run|--once|--auto|--agent|--full`; exact U*/P* messages; `--once` strips child `--next`; naming collision documented; Skill(`sp:next-router`).
- Graduated: [0275 Ship /sp:dev-next command and sp:next-router skill](../tasks2/0275_ship-sp-dev-next-command-and-sp-next-router-skill.md) — implementation task (deps 0270–0272); not resolved this session.
- [0273 Audit dogfood-testing@1.1 for contract gaps and token waste](../tasks2/0273_audit-dogfood-testing-1-1-for-contract-gaps-and-token-waste.md) — MUST checklist M1–M20; 0269 report fails footer (D1) and structure (D3); R22 prose-only (D2); implement-step token blowup T1; findings D1–D10 for 0274.
- [0274 Lock dogfood hardening v1.2 work package from audit](../tasks2/0274_lock-dogfood-hardening-v1-2-work-package-from-audit.md) — Ship `@1.2` = W1–W9 (D1–D7+D9); DoD + fixtures/tests; defer D8/CI suite/meters/auto-fix/provenance code; graduate **0276** (contract) → **0277** (meta-run policy).

## Not yet specified

- Interaction of `dev-next` with `dev-runall` / batch frontiers (opt-in batch vs single frontier task — product flag?).
- Whether a tiny CLI helper (`spur task next-hint` or similar) is needed (deferred; pure skill + existing `--json` is v1).
- Lifecycle provenance fix for `--next`→done (out of dogfood code; documented only in 0277/W9).
- Plugin version bump / marketplace packaging when shipping `dev-next` / dogfood @1.2.
- Cross-platform notes for non-Claude harnesses — partially specified; polish at ship time.
- Multi-command golden dogfood CI suite (deferred from @1.2).

## Out of scope

- Replacing `task-pipeline.yaml` or inventing a parallel execution FSM inside `dev-next`.
- Recommend-only-only product (locked against; dispatcher is the contract).
- Unbounded auto-run until feature done without step budget / gate stops.
- Using conversation transcript as a primary routing signal in v1.
- Golden dogfood CI suite as the first dogfood deliverable (fog until protocol/token hardening lands).
- Standalone PM product outside the `sp` plugin.
- Force-push, lifecycle bypass (`--no-lifecycle` for operator convenience), or silent gate skips.
- Rewriting finished feature `I` (hands-off ready) — only extend beyond it.

## Goal

*(Product Goal after wayfinding completes — same as Destination until graduated to a shippable AC feature.)*

Operators get a single status-aware entry command (`/sp:dev-next`) plus a reliable, cheaper dogfood meta-tool for hardening Spur itself.

## Scope

- In: chart and resolve the investigation map for `/sp:dev-next` (command + skill + routing table + docs) and dogfood hardening (protocol compliance + token efficiency); produce implementation-ready specs and then implementation tasks.
- Out: see **## Out of scope** above.

## Acceptance Criteria
```gherkin
Feature: sp plugin next-layer UX — wayfinder map N

  @core
  Scenario: Map has a concrete destination and two workstreams
    Given feature N exists as the wayfinder map
    When an operator reads ## Destination and ## Notes
    Then the destination is one concrete sentence
    And the two workstreams are dev-next router and dogfood hardening
    And standing preferences from the discovery interview are recorded

  @core
  Scenario: Frontier investigation tickets are sharp and dependency-wired
    Given the initial child tasks under feature N
    When an operator lists todo tasks for feature N
    Then each ticket states a single answerable question or deliverable
    And blocking edges are recorded where one ticket depends on another
    And fog items live only under ## Not yet specified (not as vague tickets)

  @edge
  Scenario: No ticket is resolved during charting session
    Given this map was just charted
    When the charting session ends
    Then all investigation tickets remain todo (none claimed wip/done in the charting session)

  @core
  Scenario: Complete requires footer
    Given a dogfood report missing the Dogfood Summary footer
    When the @1.2 finalize checklist or validator runs
    Then status complete is refused and missing_footer is reported

  @core
  Scenario: Pass fixture is green
    Given tests/fixtures/report-complete.md
    When the report contract tests run
    Then they pass

  @core
  Scenario: Detector catches dev-run without leading space
    Given testee string containing dev-run
    When pipeline-driving detection runs without explicit --max-retry
    Then the refuse message is emitted

  @core
  Scenario: Implement-heavy pipeline dogfood warns
    Given a pipeline-driving testee whose derived steps include full implement
    When Phase 1 completes step derivation
    Then an advisory recommends observe-only or step-split

  @core
  Scenario: Done refuses prose-only Review
    Given a task at status testing whose Review has no populated P1-P4 table
    When transition to done is requested without lifecycle bypass
    Then the transition is denied citing Review or strict-core

  @core
  Scenario: Done allows valid Review + provenance
    Given a task at testing with populated P1-P4 Review and a pipeline run-link
    When transition to done is requested
    Then the transition succeeds

  @core
  Scenario: Finalize aborts on invalid report shape
    Given a dogfood report missing mandatory sections or Dogfood Summary footer
    When Phase 4 finalize runs the validator
    Then status complete is refused and errors are listed under Unresolved

  @core
  Scenario: Implement-heavy advisory links to step-split recipe
    Given the dogfood skill documents the implement-heavy advisory
    When an operator follows the step-split link
    Then a worked recipe shows at least two separate dogfood invocations

  @core
  Scenario: Chained cost row is honest
    Given a dogfood run with a chained implement step without a visible token meter
    When Cost and ledger are finalized
    Then the chained row uses ~unknown and a P3 finding is present

  @core
  Scenario: Super-coder still drives the pipeline for ready tasks
    Given a frozen batch with a ready todo task
    When super-coder runs the batch
    Then ready tasks use task-pipeline.yaml and not a dev-next loop as the happy path

  @core
  Scenario: Preflight skips unmet dependencies
    Given a todo task with a non-done dependency
    When super-coder preflights before pipeline launch
    Then no workflow run starts for that WBS and the batch report records the skip

  @core
  Scenario: One-shot recovery after FAIL
    Given a batch task ends non-PASS
    When recovery is enabled
    Then next-router is consulted at most once for that WBS

  @core
  Scenario: Boundary is explicit in agent docs
    Given super-coder.md and execution-batch.md after task 0279
    When an operator reads the orchestrator boundary
    Then batch orchestration and status-routing are complementary
    And deep-merge via looping dev-next is forbidden

  @edge
  Scenario: Multi-candidate router stop is not auto-picked
    Given recovery or preflight would yield more than one candidate hop
    When super-coder handles that case
    Then it stops with a HITL style message and does not silent-pick under --auto

  @core
  Scenario: dev-verify --next documents all three done-gate layers honestly (R1)
    Given plugins/sp/commands/dev-verify.md at the fix commit
    When an operator reads the §--next chain section
    Then all three gate layers and their remediations are documented

  @core
  Scenario: dev-run --next on a backlog-seeded task has a defined outcome (R2)
    Given a backlog task
    When /sp:dev-run runs with --auto --next
    Then the chain promotes backlog to todo or names the exact remediation

  @core
  Scenario: UNKNOWN verdict artifacts carry an actionable remediation (R3)
    Given an UNKNOWN or zero-row verdict artifact
    When testing to done is attempted
    Then the denial names the source and /sp:dev-verify remediation

  @edge
  Scenario: empty Design placeholder surfaces a warning (R4)
    Given a standard task with an empty or placeholder-only Design section
    When spur task check runs
    Then an L4 warning names Design

  @core
  Scenario: pipeline agent.run stall has a written root cause (R5)
    Given the recorded pipeline stall runs
    When the timeboxed investigation completes
    Then the task records an evidence-backed hypothesis and a bounded follow-up

  @edge
  Scenario: protocol and corpus hygiene items are closed (R6, R7)
    Given the dogfood protocol and related task corpus
    When task 0294 completes
    Then the protocol decisions, counts, and verdict artifact are consistent
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0270 | Define /sp:dev-next v1 routing table (status × signals → command) | done |
| 0271 | Decide skill ownership for dev-next router | done |
| 0272 | Specify /sp:dev-next CLI surface, flags, and stop conditions | done |
| 0273 | Audit dogfood-testing@1.1 for contract gaps and token waste | done |
| 0274 | Lock dogfood hardening v1.2 work package from audit | done |
| 0275 | Ship /sp:dev-next command and sp:next-router skill | done |
| 0276 | Dogfood @1.2 contract enforcement (finalize, fixtures, tests) | done |
| 0277 | Dogfood @1.2 meta-run detector and token policy | done |
| 0278 | Dogfood residual hardening from 0277 dogfood reports (done-gate, cost, self-validate) | done |
| 0279 | Wire next-router into super-coder (preflight + one-shot recovery) | done |
| 0294 | Fix consolidated open findings from 2026-07-18 dogfood runs (0280/0292/0293) | done |
| 0341 | dev-verify/verifyall: no 'not started' verdict cell, and duplicate follow-up task creation | done |
<!-- END AUTO-GENERATED -->

## History

- 2026-07-16 — Wayfinder map charted from `/sp:dev-brainstorm --wayfind` discovery interview (decisions locked in ## Notes).
- 2026-07-25T19:33:14.555Z backlog → active (system)
- 2026-07-25T19:33:14.782Z active → verifying (system)
- 2026-07-28T00:31:34.481Z moved N → H4 (system)
