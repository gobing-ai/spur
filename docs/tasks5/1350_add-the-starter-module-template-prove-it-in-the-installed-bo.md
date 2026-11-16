---
schema_version: 1
name: Add the starter module template, prove it in the installed Board and document the kit
status: todo
template: feature-impl
created_at: 2026-11-16T19:08:27.315Z
updated_at: "2026-11-16T19:36:32.977Z"
feature_id: A81
priority: P1
tags:
  - board
  - template
  - e2e
  - docs

dependencies: ["1349", "1347"]
estimate_hours: 8
---

## 1350. Add the starter module template, prove it in the installed Board and document the kit

### Background

Implements: R4 — A downstream native module renders host UI kit components with host styling in both themes; R7 — A starter template produces a contract-conforming module that loads in the installed Board; R8 — The authoring guide and help page document the UI kit and template.

Downstream authors currently start from a blank Vite library and re-create the shell in CSS. Design: [board-module-ui-kit](docs/design/board-module-ui-kit.md) §3.4; downstream design §6. Runs after the facade task and the DESIGN.md/composer task.

Rubric: E5 D1 L3 C1 R1 = 11 → own task (template + real-browser E2E proof + docs, one deliverable).


**Refine corrections (2026-11-16)**
- "Reuse apps/web/tests/modules/composed-board-browser.test.ts" → the harness is apps/web/tests/modules/composed-board-browser.heavy.test.ts with fixtures under apps/web/tests/fixtures/composed-board (runs in `test:heavy`) → Design re-pointed.
- "Template path chosen per ADR-130" (open) → frozen to plugins/sp/skills/spur-composer/templates/board-module/, matching the existing skill-template convention (plugins/sp/skills/spur-dev/templates); sp-plugin-standalone scopes only hooks/scripts/lib (config/rules/boundary/sp-plugin-standalone.yaml:22-24), so template React imports do not violate it.
- `bootstrap.modules` declaration contract confirmed at packages/config/src/board-modules.ts:5,111.

### Requirements

- [ ] R1. Ship a starter module template (Vite library config externalizing exactly the board-runtime.json import keys, entry exporting webModule built from ModuleShell/ModuleHeader/ModuleTabs/EmptyState, scoped stylesheet for module-private content) at plugins/sp/skills/spur-composer/templates/board-module/; link it from the spur-composer board-module UI reference and compose/build steps.
- [ ] R2. Build an in-repo fixture from the template outside the web workspace, declare it under bootstrap.modules in a temp project, and prove via real Chromium against the installed-package Board: preflight accepts it, route renders kit header/tabs/empty state, computed styles match the built-in primitives in light and dark themes, and the fixture ships no Tailwind/host CSS. Produce a repeatable artifact (screenshots + JSON report).
- [ ] R3. Update downstream design §6 (specifier, supported components, template location) and docs/help/how_to_customize_project_modules.md; YAML fences still parse in packages/config/tests/board-modules.test.ts.

### Acceptance Criteria

- [ ] AC1 — A downstream native module renders host UI kit components with host styling in both themes
- [ ] AC2 — A starter template produces a contract-conforming module that loads in the installed Board
- [ ] AC3 — The authoring guide and help page document the UI kit and template

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T19:09:16.203Z

- **Closed:** no scaffolding CLI verb — a copied template avoids a new public `spur` surface without demonstrated need.
- **Closed:** template placement is decided in this task against ADR-130 / sp-script-placement (plugin skill asset vs config/templates); either is acceptable if the fixture builds from it.

#### Q&A entry — 2026-11-16T19:35:52.291Z

- **Closed:** no scaffolding CLI verb — a copied template avoids a new public `spur` surface without demonstrated need.
- **Closed:** template path frozen to plugins/sp/skills/spur-composer/templates/board-module/ (skill-template convention; outside sp-plugin-standalone scope).

### Design

Approach: reuse the 0992 composed-board browser proof harness (apps/web/tests/modules/composed-board-browser.heavy.test.ts and fixtures under apps/web/tests/fixtures/composed-board) for the fixture; template is the single source for both the fixture and downstream copies.
Rejected: a scaffolding CLI verb (new public surface without demonstrated need); docs-only template snippets (drift).
Invariants: template externals equal manifest imports keys (assert in test); no host CSS in fixture output; docs link owners.

Frozen: template root plugins/sp/skills/spur-composer/templates/board-module/ with package.json (peer: @gobing-ai/spur), vite.config.ts, src/index.tsx (exports `webModule`), src/module.css. Root typecheck/biome must not compile the template in place: exclude the directory if picked up; the heavy test copies it to a temp dir and builds there.
Assumes from 1349: specifier `@gobing-ai/spur/board/ui`, `uiKitVersion`, types at `@gobing-ai/spur/board/ui`. From 1347: DESIGN.md module-shell section and references/board-module-ui.md to link the template from.
Anti-patterns: no scaffolding CLI verb; no copied host CSS or Tailwind in the template; vite externals must be read from / asserted equal to board-runtime.json `imports` keys.

### Plan

1. Template files + placement decision
2. Fixture build + temp project declaration
3. Browser E2E proof (both themes) + artifact
4. Docs §6 + help page + composer links
5. test:heavy + board-modules config test

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
