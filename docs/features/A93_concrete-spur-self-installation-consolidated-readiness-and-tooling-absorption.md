---
schema_version: 1
id: "A93"
name: "Concrete Spur self: installation, consolidated readiness and tooling absorption"
status: done
priority: P2
tags: []
created_at: "2026-11-16T22:57:09.147Z"
updated_at: "2026-11-17T02:18:11.002Z"
---

# A93: Concrete Spur self: installation, consolidated readiness and tooling absorption

## Goal

Give Spur one coherent shipped ownership model for machine setup, consolidated readiness and reusable developer operations, with safe repeatable installation and explicit responsibility boundaries.

## Scope

- In scope: amend ADR-130 first; preserve ADR-051 consent and two-level commands; classify install.sh, spur-dev.ts and every scripts/commands module plus callers/tests/fixtures; consolidate existing noun status and local readiness through shared read-only services; design self install independently of init/migrate; prove safe reruns and failures; absorb suitable build/package operations into builder and reusable noun operations into their owners.
- In scope: source, packed and standalone entry points, package-script rewiring, compatibility/removal criteria, installation provenance, optional dependency policy and Superskill delegation.
- Out of scope: executing implementation tasks in this idea run; actual machine/global installs, publishing/deployments, workflow or IAM edits; new nouns; moving fixture-specific E2E runners into the installed CLI; generic build framework or changing third-party adapters.

## Acceptance Criteria

```gherkin
Feature: Concrete Spur self and tooling ownership

  @core
  Scenario: R1 — Architectural direction precedes script migration
    # covers: I1
    Given ADR-130 currently assigns build and packaging to repository scripts
    When the new ownership direction is recorded before implementation
    Then ADR-130 has a dated amendment preserving the prior decision and ADR-051 consent
    And governance and entry instructions distinguish reusable behavior from irreducible repository inputs

  @core
  Scenario: R2 — Every script has an evidenced migration disposition
    # covers: I2, I6
    Given install.sh, spur-dev.ts and every scripts/commands TypeScript module and companion fixture
    When the migration inventory is checked against the current tree and callers
    Then each file has one destination, rationale, caller list, test location and migration wave
    And retained bootstrap and repository-only exceptions have explicit reasons

  @core
  Scenario: R3 — Self status consolidates existing noun readiness without mutation
    # covers: I3
    Given configured and unconfigured projects with agent and decision status providers
    When self status runs in text and JSON modes
    Then it reports installation, configuration, schema, dependencies, project runtime and available noun summaries with scope and provenance
    And every existing noun status is represented by its shared read-only collector without recursive CLI calls
    And existing JSON fields, path behavior and credential redaction remain compatible
    And no installation, schema creation, server startup or usage refresh occurs

  @core
  Scenario: R4 — Unavailable status providers produce bounded partial results
    # covers: I3
    Given a missing optional dependency or an unreachable provider
    When self status collects readiness
    Then available sections remain present and unavailable sections name their state and remedy
    And collection finishes within the configured finite deadline with no background orphan process
    And aggregate health and command exit behavior follow the documented required versus optional policy

  @core
  Scenario: R5 — Installation has a distinct owner and verified bootstrap
    # covers: I2, I4
    Given a machine without Spur and a local verified release fixture
    When the minimal shell bootstrap acquires the binary and delegates setup to self install
    Then the binary is verified before atomic replacement and a failed verification preserves the prior install
    And machine setup is owned by self install while init scaffolds projects and migrate owns SQL
    And optional tool installation and Superskill plugin delegation follow explicit documented policy

  @core
  Scenario: R6 — Repeated and interrupted installation converges safely
    # covers: I5
    Given isolated homes with fresh, complete, customized and partially failed installations
    When self install runs twice and resumes after a failed setup step
    Then healthy artifacts and user configuration remain unchanged on the second run
    And only missing or explicitly selected setup is retried with no duplicate PATH or plugin entries
    And required failures exit nonzero while optional failures remain visible in a machine-readable step report

  @core
  Scenario: R7 — Builder absorbs coherent reusable build and packaging operations
    # covers: I2, I6
    Given inventory-approved build and packaging scripts and their recorded public-contract scope
    When their implementation moves into app services behind flat builder verbs
    Then source and packed CLI invocations use the same implementation and preserve validation and failure behavior
    And repository inputs are explicit and the first CLI build does not require its own missing generated bundle
    And tests, package callers and compatibility routes follow the owner before old dispatch routes retire

  @core
  Scenario: R8 — Noun-specific tooling and retained repository checks keep one owner
    # covers: I2, I6
    Given evaluation, promotion, contract-check and fixture runner dispositions
    When reusable noun behavior is absorbed and irreducible repository work is retained
    Then noun services have no runtime import from scripts or plugin fixtures
    And retained gates and fixture runners call shared services instead of duplicating domain rules
    And an exhaustive reference check and installed-artifact E2E receipt account for every retired route
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1354 | Absorb CLI and server compilation into builder without a bootstrap cycle | done |
| 1352 | Consolidate read-only self status through shared noun collectors | done |
| 1355 | Absorb safe artifact staging and tarball verification into builder | done |
| 1351 | Certify A93 tooling ownership inventory and migration contract prerequisites | done |
| 1353 | Implement convergent self install and delegate post-bootstrap setup | done |
| 1356 | Centralize workflow promotion evaluation and close the A93 script ownership audit | done |
<!-- END AUTO-GENERATED -->

## Notes

- Design: [Concrete Spur self and tooling absorption](../design/concrete-spur-self.md).
- Working plan: [Concrete Spur self and tooling ownership](../plans/2026-11-16-concrete-spur-self-brainstorm.md).
- ADR-130's 2026-11-16 amendment establishes direction. The exact proposed public surfaces in design §7 require explicit implementation consent; planning --auto does not substitute for it.

## History

- 2026-11-16T23:44:48.692Z backlog → active (system)
- 2026-11-17T02:10:46.953Z active → verifying (system)
- 2026-11-17T02:18:11.002Z verifying → done (system)

