---
schema_version: 1
id: "P11"
name: "Decision status readiness surface: maker registration, configuration and proof of work"
status: done
priority: P2
tags: []
created_at: "2026-10-11T23:22:45.710Z"
updated_at: "2026-10-12T02:30:17.138Z"
---

# P11: Decision status readiness surface: maker registration, configuration and proof of work

## Goal

An operator reading `spur decision status` can tell three separate things about every decision and
maker: whether the maker is **registered**, whether it is **configured** (and by which config key),
and whether it has **actually worked** — from recorded evidence, and on request from one live
liveness decision per maker. The report renders as labelled, aligned sections instead of a flat
`key: value` dump, and the machine output gains the same markers additively.

## Scope

- In:
  - A sectioned, aligned human renderer for `spur decision status`: one status header line, a Makers
    table, a Decisions table, then labelled catalog and error lines. No value renders as raw JSON.
  - Per-maker readiness: registration, configuration source (`decisions.maker`,
    `decisions.makers.<id>`, or none), the decision ids the maker effectively serves, and recorded
    evidence.
  - Per-decision rows gain recorded evidence (samples, accepted, last seen) beside the existing
    effective maker, maker source, registration flag, layer and minimum confidence.
  - Recorded evidence comes from the recorded `decision.end` ledger through the existing reliability
    aggregation — the report constructs no maker.
  - `--probe`: one liveness decision (`maker-liveness`) served per distinct registered effective
    maker through the real catalog-resolution, input-validation and fallback seam, reporting the
    outcome, the fallback reason, the served value and the elapsed time. Backend fallbacks do not fail
    the command; caller/catalog faults do. It writes no decision log row and emits no decision event,
    so recorded evidence stays uncontaminated.
  - Additive JSON fields (`makers`, per-decision `evidence`, `probes`); every existing field keeps its
    name and meaning.
  - The owning design satellite (`decision-observability-and-adoption.md` §3.4) and its tradeoffs
    record the new surface in the same commit (T3).
- Out:
  - Changing the `--reliability` report shape, its aggregation, or its `--since` contract.
  - Persisting probe results as events or `decision_logs` rows; reliability thresholds; any
    automatic repair of a failing maker.
  - Maker resolution precedence, catalog layers, and upstream `@gobing-ai/ts-ai-decision`.
  - Board UI changes: the Observability Decisions tab already renders recorded invocations.

## Acceptance Criteria

```gherkin
Feature: Decision status readiness surface: maker registration, configuration and proof of work

  @core
  Scenario: R1 — The readiness report renders as labelled sections instead of a flat key dump
    Given a project with a resolvable decision catalog
    When the operator runs spur decision status
    Then the first line is one status header carrying the decision count, the maker count, the configured default maker and the error state
    And the registered makers render in an aligned table with a header row
    And the served decisions render in an aligned table with a header row
    And catalog layer counts, duplicate ids, overrides and load or config errors render as labelled sections
    And no value renders as raw JSON text

  @core
  Scenario: R2 — Every maker row shows registration, configuration and what it serves
    Given the project config names a default maker and a per-decision maker
    When the operator runs spur decision status
    Then each registered maker renders with its status glyph and its configuration source, naming decisions.maker, decisions.makers.<id> or none
    And each maker renders how many decisions it effectively serves, with the ids listed per decision below
    And a configured maker that is not registered renders as a failing row and stays in the error list

  @core
  Scenario: R3 — Each decision row shows its effective maker, resolution source and catalog facts
    Given served decisions resolving through config-default, config-decision, catalog-decision and catalog-default sources
    When the operator runs spur decision status
    Then each decision row shows its id, type, effective maker, maker source, minimum confidence and catalog layer
    And a decision whose effective maker is not registered renders with a failing status glyph

  @core
  Scenario: R4 — Recorded evidence separates registered and configured from actually working
    Given recorded decision.end rows for some served decisions and none for others
    When the operator runs spur decision status
    Then each decision row and each maker row shows the recorded sample count, the accepted count and the last-seen timestamp, or none when the ledger has no rows for it
    And the report reads recorded rows only and constructs no maker
    And the JSON output keeps every existing field and adds makers, per-decision evidence and probes

  @core
  Scenario: R5 — An opt-in probe proves a maker answers right now
    Given a project whose effective makers are registered
    When the operator runs spur decision status --probe
    Then each distinct registered effective maker is asked the maker-liveness decision once through catalog resolution, input validation and the fallback seam
    And each maker reports whether it answered, the served value, the outcome reason and the elapsed time
    And a maker that falls back or errors is reported as not proven without failing the command
    And the probe writes no decision log row and emits no decision event
    And without --probe no maker is constructed

  @edge
  Scenario: R6 — A probe that cannot reach its maker is reported, not raised
    Given an effective maker whose backend is unreachable
    When the operator runs spur decision status --probe
    Then that maker renders as not proven with the fallback reason it produced
    And every other maker still renders its own outcome
    And the command exits 0 with the readiness report

  @edge
  Scenario: R7 — A missing liveness catalog entry fails loudly before any probe
    Given a served catalog with no maker-liveness entry
    When the operator runs spur decision status --probe
    Then the command reports the missing decision id and exits non-zero
    And no maker is called

  @edge
  Scenario: R8 — Mutually exclusive status flags are refused as a caller mistake
    Given the operator passes --probe together with --reliability
    When the command runs
    Then it reports the conflicting flags and exits non-zero
    And no maker is called
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1169 | Add the maker-liveness catalog decision for probe runs | done |
| 1170 | Map decision readiness facts and recorded evidence onto the status report | done |
| 1171 | Add the opt-in decision maker liveness probe | done |
| 1172 | Render the sectioned decision status readiness report and wire --probe | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-10-12T01:44:34.398Z backlog → active (system)
- 2026-10-12T01:45:49.306Z active → verifying (system)
- 2026-10-12T01:54:57.549Z verifying → done (system)
- 2026-10-12T01:56:54.931Z done → active (system)
- 2026-10-12T01:58:59.295Z active → verifying (system)
- 2026-10-12T02:00:13.994Z verifying → done (system)

