---
schema_version: 1
id: "E93"
name: "History capability detection for commands subagents and skills"
status: active
priority: P1
tags: []
created_at: "2026-09-30T20:10:43.892Z"
updated_at: "2026-10-03T20:26:18.189Z"
---

# E93: History capability detection for commands subagents and skills

## Goal

Make Histories reliably identify commands, subagents, and ordinary skills across coding-agent conversations, preserving who invoked them, how they were observed, and their original identity after Superskill conversion.

## Scope

- In:
  - Review all registered history source routes and document verified detection signatures and extraction limits.
  - Deliver source-specific detection for the current full-fidelity sources: claude, codex, pi, omp, agy, grok.
  - Recognize structured user invocations, native skill loads, verified skill-file reads, and model delegation.
  - Distinguish command/subagent/skill identity from user/model invoker and requested/loaded/delegated evidence.
  - Resolve Superskill-converted identity through verifiable origin metadata or manifest identity; retain unresolved identity honestly.
  - Extend the reusable importer, consume its released contract, and update existing Histories counts and breakdowns.
  - Prevent duplicate representations and false positives; validate historical replay on isolated databases.
- Out:
  - New public CLI nouns or verbs.
  - New importer implementation in Spur or hand-maintained Superskill adapters.
  - Expanding full-fidelity support for currently deferred sources without separate evidence and scope.
  - Reconstructing missing historical evidence, guessing converted identity from naming prefixes, or treating a user request as executed delegation.
  - Changing token allocation, raw conversation files, or running a destructive live-data reimport during planning.

## Acceptance Criteria

```gherkin
Feature: History capability detection for commands subagents and skills

  @core
  Scenario: R1 — Explicit user commands retain command identity
    # covers: I1, I2, I6, I7
    Given a verified source fixture with a structured user invocation of "/sp:dev-run"
    When the conversation is imported
    Then one command event identifies "sp:dev-run" and the user invoker
    And its source record and requested evidence are retained
    And a later observed load does not imply execution from the request alone

  @core
  Scenario: R2 — Model delegation identifies subagents separately from user requests
    # covers: I1, I3, I6, I7
    Given a user request naming a subagent and an assistant delegation call with a distinct call identity
    When the conversation is imported
    Then the request retains user intent without claiming delegation
    And the delegation identifies the subagent and model invoker
    And child-session identity is retained only when provided by the source

  @core
  Scenario: R3 — Ordinary skill loads include explicit and implicit use
    # covers: I1, I4, I6, I8
    Given verified fixtures with an explicit user skill wrapper and an assistant skill-loading tool call
    And Codex full-body wrappers and pi skill-file reads are represented
    When the conversations are imported
    Then both explicit and implicit ordinary skill use is recorded with its actual invoker and evidence
    And failed load attempts are distinguishable from successful loads

  @core
  Scenario: R4 — Converted capabilities preserve verifiable origin kinds
    # covers: I2, I3, I4, I5, I6
    Given command and subagent adapters represented as skills with verifiable Superskill origin identities
    And another adapter has no trustworthy origin identity
    When their invocations are imported
    Then the verified adapters retain command and subagent kinds independently of their skill representation
    And the unverified adapter retains unresolved origin without a guessed kind
    And skill-based subagent emulation does not claim a native child process

  @core
  Scenario: R5 — Duplicate representations collapse without losing repeated invocations
    # covers: I1, I6
    Given one invocation represented by correlated user syntax, an injected wrapper, and a load call
    And a second invocation of the same capability has a distinct call or source-record identity
    When the same conversation is imported twice
    Then one logical invocation remains for each distinct invocation identity
    And request and observed action evidence stay distinguishable
    And the second import does not add duplicate events

  @core
  Scenario: R6 — Quoted examples and unrelated tool reads produce no invocation
    # covers: I1, I6, I7, I8
    Given fixtures containing quoted command examples, skill catalogs, tool-output wrappers, and unrelated file reads
    When their conversations are imported
    Then none is counted as a capability invocation
    And opaque shell expressions are never executed to infer skill loading

  @core
  Scenario: R7 — Source coverage distinguishes verified extraction from unavailable evidence
    # covers: I1, I6
    Given the registry includes current full-fidelity sources and deferred sources
    When the detection coverage is inspected
    Then each delivered source has positive and negative fixtures for its verified signatures
    And deferred or unverified capability extraction is identified explicitly
    And unavailable evidence is not presented as a verified zero

  @core
  Scenario: R8 — Histories breakdowns preserve capability semantics across read paths
    # covers: I1, I2, I3, I4, I5
    Given imported command, subagent, and skill events with request and observed-action evidence
    When existing Histories breakdowns are requested for the same range and source
    Then capability kind and user or model invoker remain independently identifiable
    And fresh materialized results equal the supported raw fallback results
    And requests are not counted as successful loads
    And existing token totals and tool attribution remain unchanged

  @core
  Scenario: R9 — Historical reprocessing upgrades safely and remains repeatable
    # covers: I1, I6
    Given an isolated copy of an existing history database and source fixtures
    When the new importer contract is adopted and its documented dry-run and replay procedure is exercised
    Then schema and importer versions are recorded and old rows retain honest unknown fields until rebuilt
    And changed event semantics invalidate relevant incremental checkpoints and rollup versions
    And replay twice produces identical capability counts
    And the original database and source histories remain untouched
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1028 | Identify history capabilities across native and converted agent formats | todo |
| 1029 | Expose classified capability usage through existing Histories breakdowns | testing |
| 1030 | Verify safe historical capability replay and stable Histories results | todo |
<!-- END AUTO-GENERATED -->

## Notes

Planning run: idea-fab66c82-1761-4bf7-8124-143f1f9222b1.
The operator accepted the discovery direction and system design, then explicitly required proper per-agent history formats and authorized necessary upstream enhancement in /Users/robin/xprojects/ts-libs.
Design: [History capability detection contract](../design/history-capability-detection.md), including section 4.6 per-agent envelopes, content blocks, tool argument/result shapes and nested literal call limits.
Discovery record: [History capability detection review](../plans/2026-09-30-history-capability-detection-brainstorm.md).
The I7 user-input ambiguity is resolved as request intent; observed model delegation requires tool evidence.
Task batch 1028, 1029, 1030 is created through the task CLI, with dependency ordering and planning readiness evidence. Downstream execution waits for predecessors and verified upstream package availability.
Planning stops at handoff. No production implementation, upstream release or live-data reimport has run.

## History

- 2026-10-03T20:26:18.189Z backlog → active (system)

