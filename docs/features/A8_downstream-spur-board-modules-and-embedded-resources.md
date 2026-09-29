---
schema_version: 1
id: "A8"
name: "Downstream Spur Board modules and embedded resources"
status: active
priority: P2
tags: []
created_at: "2026-09-28T01:13:21.763Z"
updated_at: "2026-09-29T03:06:49.004Z"
---

# A8: Downstream Spur Board modules and embedded resources

## Goal

Let downstream projects extend their installed Spur Board with explicitly configured native React tools and embeddable existing resources, using one project-specific navigation experience without editing the Spur checkout.

## Scope

- In:
  - Embedded project-owned bootstrap.modules declarations with shared metadata and explicit react or iframe type.
  - Prebuilt Vite-compatible native React component contributions, a versioned public UI contract, and the Board's shared browser runtime.
  - URL-backed iframe contributions through one built-in adapter in the same Board navigation; framing limitations and an external-open action are explicit.
  - Validated startup catalogs and restricted same-origin hosting of declared native module assets.
  - Browser composition before registry/router construction, native optional right panels, and full-content iframe presentation with accessible mobile navigation.
  - Installed-package downstream proof, module error containment, project isolation, and authoring documentation/config templates.
- Out:
  - Required server entries, importing downstream backend code, or adding downstream application procedures to Spur's global API contract (the host-owned module catalog is in scope).
  - External manifest files, arbitrary raw TSX compilation at server startup, Module Federation, or an extension marketplace.
  - Launching/reverse-proxying downstream app processes, stripping framing protections, or promising arbitrary external sites can embed.
  - Local HTML-directory iframe hosting, automatic message/data/context synchronization, simultaneous split views, persistent hidden frames, or iframe login workarounds.
  - Live config replacement or module HMR integration; v1 uses server restart and browser reload.
  - Filesystem extension loading for Cloudflare Worker deployment or public CLI noun/verb additions.

## Acceptance Criteria

```gherkin
Feature: Downstream Spur Board modules and embedded resources

  @core
  Scenario: R1 — Existing Board behavior remains with no external modules
    # covers: I1, I2
    Given a project has no bootstrap.modules declarations
    When its installed Spur Board opens
    Then built-in modules retain their navigation and landing behavior

  @core
  Scenario: R2 — An installed Board renders a downstream React contribution
    # covers: I1, I2, I3
    Given a downstream project declares a react module built with Vite outside the Spur checkout
    When the installed Board opens its module route
    Then its component renders and a stateful interaction updates the displayed value
    And its declared CSS and referenced chunks and assets load without rebuilding Spur

  @core
  Scenario: R3 — Native contributions use the Board React runtime
    # covers: I1, I3
    Given the downstream module project has another local React installation
    When its hook-bearing contribution renders in the installed Board
    Then the contribution uses the same React runtime instance as the Board renderer
    And supported host integration does not import private Board source paths

  @core
  Scenario: R4 — React tools and iframe resources share project navigation
    # covers: I1, I2, I6
    Given a project declares a react Catalog module and an iframe Documentation module
    When the user selects each module from the Board sidebar
    Then the selected content appears beside the same navigation
    And declared labels and ordering are respected without changing the built-in landing target

  @core
  Scenario: R5 — Malformed declarations fail before the project server listens
    # covers: I2, I3
    Given module declarations contain a duplicate built-in or retired route id or fields from both rendering types
    When the project server starts
    Then it reports the offending declaration and reason before opening the listener
    And bootstrap options remain supported for valid declarations

  @core
  Scenario: R6 — Disabled modules do not load assets or execute contributions
    # covers: I2, I3
    Given a structurally valid disabled react declaration points to assets that do not exist
    When the project server and Board start
    Then startup succeeds without reading or executing that contribution
    And the disabled module is absent from navigation

  @core
  Scenario: R7 — Module assets remain inside their declared web directory
    # covers: I1, I3
    Given a react module declares its built web directory
    When an asset request attempts traversal or follows a symlink outside that directory
    Then the request is rejected without exposing project files
    And missing JavaScript assets do not return the Board HTML fallback

  @core
  Scenario: R8 — Unsupported or failing contributions leave built-ins usable
    # covers: I1, I3
    Given a configured contribution has an unsupported apiVersion or a failed import or render
    When the user opens that module
    Then its route shows a module-specific diagnostic
    And the user can still navigate to built-in modules

  @core
  Scenario: R9 — External module layouts preserve accessible Board navigation
    # covers: I3, I6
    Given native contributions with and without a right panel and an iframe contribution
    When the user switches among them at desktop and mobile widths
    Then native right panels render only when supplied
    And the iframe fills the available content region without an empty right panel or agent overlay
    And mobile navigation and keyboard focus remain reachable
    And returning to a built-in module restores its saved layout preferences

  @core
  Scenario: R10 — Framed resources retain browser embedding restrictions
    # covers: I5, I6
    Given a configured HTTP or HTTPS resource permits embedding by the Board origin
    When the user opens its iframe module
    Then it appears with an accessible frame title and an action to open the configured URL externally
    And the Board does not remove the resource's framing protections
    And a frame load event alone is not presented as confirmed application readiness

  @core
  Scenario: R11 — Invalid frame URLs are rejected as configuration errors
    # covers: I2, I6
    Given an iframe declaration contains a URL with embedded credentials or a non-HTTP scheme
    When the project configuration is validated
    Then validation reports that declaration without loading the resource

  @core
  Scenario: R12 — Project switching uses each project's own module catalog
    # covers: I1, I2, I6
    Given two downstream projects declare different external modules
    When the user switches project servers
    Then navigation and module assets belong only to the selected project
    And filesystem paths and server-only configuration are absent from the public catalog

  @core
  Scenario: R13 — Module selection changes use the documented restart lifecycle
    # covers: I2, I4
    Given a running project has loaded its module catalog
    When its server restarts with changed module configuration and the browser reloads
    Then the new module selection is used before browser route construction
    And ordinary CLI commands do not execute downstream Board contribution code

  @core
  Scenario: R14 — Downstream authors can follow the published module contract
    # covers: I1, I2, I3, I5, I6
    Given the installed Spur package and authoring guide
    When an author follows the React library and iframe URL examples
    Then the guide specifies public types and exports, supported runtime versions, path semantics, styles, errors, and restart behavior
    And neither example requires a server entry, external manifest, or Spur checkout
    And framing, authentication, and independent child-routing limits are stated for iframe resources

  @core
  Scenario: R15 — The runtime investigation distinguishes listener and router lifecycle
    # covers: I4, I5
    Given the recorded Bun and Hono versions and a runnable lifecycle probe
    When the probe exercises route changes after an initial request
    Then the report records Bun handler replacement, Hono matcher finalization, and fresh-app dispatch replacement outcomes
    And the authoring contract states startup configuration with browser imports before route construction
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0988 | Prove and package the Board shared runtime and downstream authoring contract | done |
| 0989 | Load and serve validated project module catalogs and restricted assets | done |
| 0990 | Render native downstream modules through one Board registry | done |
| 0991 | Embed URL resources in the Board workspace | done |
| 0992 | Validate downstream installs and publish module authoring guidance | done |
<!-- END AUTO-GENERATED -->

## Notes

Source investigation and decision history: docs/plans/2026-09-27-dynamic-board-modules-brainstorm.md. Accepted, unimplemented contract: docs/design/downstream-board-modules.md; ADR-128; root DESIGN.md's downstream Board rules.

Task batch 0988–0992 is specification-ready for dependency-ordered delegation: runtime/distribution proof -> validated catalog/assets -> native registry composition -> iframe workspace; installed-project validation/author guidance depends on both renderer slices. Each task freezes requirements, ownership, interfaces, algorithms, failure/security handling, tests, closed decisions and prerequisite outputs.

The real installed shared-React/browser/type-export proof must pass in 0988 before production loader work. A failed proof returns to design; native contributions are not silently replaced by frames or Module Federation. v1 config/build changes use restart plus browser reload. No required downstream server entry or backend procedure is introduced.

All 15 feature scenarios are linked. Planning checks and 35 ready-checklist rows pass; dependent tasks retain prerequisite-not-done findings until their predecessors finish. No implementation verdict is claimed, and the feature remains unimplemented. Next command: /sp:dev-runall --feature A8 --auto.

## History

- 2026-09-28T23:00:17.202Z backlog → active (system)
- 2026-09-29T01:55:19.967Z active → verifying (system)
- 2026-09-29T01:55:20.467Z verifying → done (system)
- 2026-09-29T03:06:49.004Z done → active (system)

