---
schema_version: 1
id: "N"
name: "sp plugin next-layer UX — dev-next router and dogfood hardening"
status: backlog
priority: P1
tags:
  - wayfinder
  - sp-plugin
  - meta
created_at: "2026-07-17T00:53:58.309Z"
updated_at: "2026-07-17T00:53:58.311Z"
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

- *(map charted — no investigation tickets resolved yet)*

## Not yet specified

- Exact v1 routing table rows for every status × hygiene signal (needs ticket: routing table).
- Skill ownership for the router (`new skill` vs `spur-dev` ops extension vs command-only) — ticketed.
- Whether light gate probes run in parallel or sequential short-circuit order.
- How `dev-next` reports multi-candidate forks (decision-brief UI vs ranked list + stop).
- Dogfood v1.2 concrete AC (which checklist items are hard fails vs findings; target cache% trend).
- Interaction of `dev-next` with `dev-runall` / batch frontiers (feature-level “next unblocked task” vs batch).
- Whether a tiny CLI helper (`spur task next-hint` or similar) is needed for deterministic JSON routing, or pure skill logic over existing `--json` is enough.
- Provenance/`run-link` friction observed in dogfood of `--next` chains — in or out of dogfood workstream vs separate lifecycle fix.
- Plugin version bump / marketplace packaging when shipping the new command.
- Cross-platform notes for non-Claude harnesses (Skill() availability).

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
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0270 | Define /sp:dev-next v1 routing table (status × signals → command) | todo |
| 0271 | Decide skill ownership for dev-next router | todo |
| 0272 | Specify /sp:dev-next CLI surface, flags, and stop conditions | todo |
| 0273 | Audit dogfood-testing@1.1 for contract gaps and token waste | todo |
| 0274 | Lock dogfood hardening v1.2 work package from audit | todo |
<!-- END AUTO-GENERATED -->

## History

- 2026-07-16 — Wayfinder map charted from `/sp:dev-brainstorm --wayfind` discovery interview (decisions locked in ## Notes).
