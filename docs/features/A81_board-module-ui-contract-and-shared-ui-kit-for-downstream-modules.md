---
schema_version: 1
id: "A81"
name: "Board module UI contract and shared UI kit for downstream modules"
status: backlog
priority: P2
tags: []
created_at: "2026-11-16T19:05:03.386Z"
updated_at: "2026-11-16T19:05:43.601Z"
---

# A81: Board module UI contract and shared UI kit for downstream modules

## Goal

Downstream native Board modules look and behave like built-in Spur modules by construction: one normative module-shell UI contract in root `DESIGN.md` binds built-in and project-owned modules alike, Spur ships the shell primitives it already uses as a reusable Board UI kit that native contributions import through the host runtime (rendering the host's own components and styles rather than imitations), and `sp:spur-composer` guides authors to the contract and a ready starter template so a new module reaches visual parity without hand-rolled look-alike CSS.

## Scope

**In scope**

- A normative "module shell" section in root `DESIGN.md` (header anatomy, inline filters / range presets, append-only tabs, content density, empty / loading / diagnostic states, right-panel use, light/dark tokens) that applies to built-in and downstream native modules; the existing "Downstream Board Modules (proposed)" section is reconciled into it.
- Extracting a small set of shell primitives from the built-in module shells in `apps/web` into a shared Board UI kit, with at least one built-in shell adopting them without behavior change.
- Exposing that kit to native contributions through the existing same-build-graph runtime facade / import-map mechanism as one additive bare specifier, recorded in `board-runtime.json`, with a shipped type-only declaration in the CLI package (no React value import in CLI/plugin standalone surfaces).
- A `sp:spur-composer` board-module UI reference that links (never restates) the contract and the authoring guide, plus a starter template (Vite library config + entry using the kit) the composer's compose/build steps point to.
- Updating the downstream Board modules design satellite §6 authoring guide and the user help page for the kit and template.
- An in-repo fixture native module built from the template that proves the kit renders with host styling in both themes through the installed-package Board path.

**Out of scope**

- Migrating knowledge-kit's `kk-collect`, `kk-daily-ai-voice2` and `kk-itc` modules (separate downstream repository; follow-up there once the kit ships).
- Domain-specific widgets (charts, reader views, run timelines) beyond the generic shell primitives.
- Shipping Tailwind or a token stylesheet for downstream projects to compile themselves.
- Iframe contributions styling (cross-origin documents cannot be styled; unchanged).
- Hot reload, live registry replacement, Cloudflare Worker module loading, or a new contribution API version.
- Restyling built-in modules beyond what adopting the extracted primitives requires.

## Acceptance Criteria

```gherkin
Feature: Board module UI contract and shared UI kit for downstream modules

  @core
  Scenario: R1 — Root DESIGN.md defines one module-shell contract for built-in and downstream modules
    # covers: I1, I5
    Given root DESIGN.md is the UI/UX authority for the Spur Board
    When a module author reads its module-shell section
    Then it specifies the header anatomy, inline filter and range-preset row, append-only tab bar, content density, and empty, loading and diagnostic states
    And it states that the rules bind built-in modules and project-owned native modules alike
    And the former downstream modules section is reconciled into it without contradicting the frame and right-panel rules

  @core
  Scenario: R2 — Built-in shells render through shared shell primitives without visual regression
    # covers: I3
    Given the Board ships shared shell primitives extracted from its built-in module shells
    When at least one built-in module shell is rendered after adopting them
    Then its header, filters and tabs keep their existing layout, behavior and URL state
    And its existing shell tests pass unchanged

  @core
  Scenario: R3 — The installed Board advertises the UI kit as one additive runtime specifier
    # covers: I3
    Given an installed Spur package with a capable Board distribution
    When board-runtime.json is read
    Then its imports map lists the UI kit bare specifier next to the React and React Router specifiers
    And contributionApiVersion remains 1 so existing contributions load unchanged

  @core
  Scenario: R4 — A downstream native module renders host UI kit components with host styling in both themes
    # covers: I3, I1
    Given a downstream native module built outside the Spur checkout imports the UI kit specifier as an external
    When the installed Board opens its route in the light theme and then the dark theme
    Then the kit components render with the same computed styles as the built-in shell primitives
    And the module ships no Tailwind output or copied host stylesheet

  @core
  Scenario: R5 — The UI kit authoring types resolve from the installed package without runtime imports
    # covers: I3
    Given a separately installed downstream fixture depends on the published Spur package
    When it typechecks an entry importing the UI kit components
    Then the kit type declarations resolve from the package exports
    And the CLI and plugin standalone surfaces gain no React value import

  @core
  Scenario: R6 — spur-composer routes authors to the UI contract through a dedicated reference
    # covers: I2, I5
    Given the sp:spur-composer skill's Board module composition step
    When an agent composes a react module
    Then it is directed to a dedicated board-module UI reference that links the DESIGN.md module-shell section and the authoring guide
    And the reference links rather than restates those owners

  @core
  Scenario: R7 — A starter template produces a contract-conforming module that loads in the installed Board
    # covers: I4, I3
    Given the starter template referenced by spur-composer
    When it is copied into a downstream project, built with its Vite library config and declared under bootstrap.modules
    Then the serve preflight accepts it and the module route renders a header, tab bar and empty state from the UI kit
    And its build externalizes exactly the specifiers advertised in board-runtime.json

  @core
  Scenario: R8 — The authoring guide and help page document the UI kit and template
    # covers: I2, I4
    Given the downstream Board modules design satellite and the project-module help page
    When an author follows the authoring guide
    Then it names the UI kit specifier, its supported components and the starter template location
    And its YAML examples still parse against the module declaration schema

  @edge
  Scenario: R9 — A Board without the UI kit fails a kit-dependent module with a contained diagnostic
    # covers: I3
    Given a project Board distribution whose runtime manifest does not advertise the UI kit specifier
    When a native module that imports the kit is opened
    Then the module route shows an actionable diagnostic naming the missing specifier
    And built-in modules remain navigable
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 1350 | Add the starter module template, prove it in the installed Board and document the kit | todo |
| 1349 | Ship the module kit as a Board runtime facade specifier with installed-package types | todo |
| 1347 | Define the Board module-shell UI contract in DESIGN.md and route spur-composer to it | todo |
| 1348 | Extract Board shell primitives into a shared module kit and adopt them in a built-in shell | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
