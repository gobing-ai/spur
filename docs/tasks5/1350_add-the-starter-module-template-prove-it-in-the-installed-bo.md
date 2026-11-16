---
schema_version: 1
name: Add the starter module template, prove it in the installed Board and document the kit
status: done
template: feature-impl
created_at: 2026-11-16T19:08:27.315Z
updated_at: "2026-11-16T20:13:18.344Z"
feature_id: A81
priority: P1
tags:
  - board
  - template
  - e2e
  - docs

dependencies: ["1349", "1347"]
estimate_hours: 8
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Ship a starter module template (Vite library config externalizing exactly the board-runtime.json import keys, entry exporting webModule built from ModuleShell/ModuleHeader/ModuleTabs/EmptyState, scoped stylesheet for module-private content) at plugins/sp/skills/spur-composer/templates/board-module/; link it from the spur-composer board-module UI reference and compose/build steps.
- [x] R2. Build an in-repo fixture from the template outside the web workspace, declare it under bootstrap.modules in a temp project, and prove via real Chromium against the installed-package Board: preflight accepts it, route renders kit header/tabs/empty state, computed styles match the built-in primitives in light and dark themes, and the fixture ships no Tailwind/host CSS. Produce a repeatable artifact (screenshots + JSON report).
- [x] R3. Update downstream design §6 (specifier, supported components, template location) and docs/help/how_to_customize_project_modules.md; YAML fences still parse in packages/config/tests/board-modules.test.ts.

### Acceptance Criteria

- [x] AC1 — A downstream native module renders host UI kit components with host styling in both themes
- [x] AC2 — A starter template produces a contract-conforming module that loads in the installed Board
- [x] AC3 — The authoring guide and help page document the UI kit and template

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

| File | Change |
| --- | --- |
| `plugins/sp/skills/spur-composer/templates/board-module/src/index.tsx:1-59` | The starter entry: exports `webModule` (`apiVersion: 1`) and renders `ModuleShell` → `ModuleHeader` (icon, title, subtitle, tabs) → `ModuleTabs` → panel, with an `EmptyState` view and a module marker (`data-starter-module`). Everything is imported from `@gobing-ai/spur/board/ui`; nothing is restyled or copied. |
| `plugins/sp/skills/spur-composer/templates/board-module/src/module.css:1-12` | Module-private, class-scoped styles only — the comment states the rule (no global reset, no host stylesheet copy, theme values from host tokens). |
| `plugins/sp/skills/spur-composer/templates/board-module/vite.config.ts:1-55` | Library build that reads the installed `web/board-runtime.json` (walking up from the project and from `vite`) and externalizes exactly its `imports` keys, so the list cannot drift from the host's promise; `fileName: entry.js` + `cssFileName: style` match the declaration example. |
| `plugins/sp/skills/spur-composer/templates/board-module/{package.json,tsconfig.json,module.yaml,README.md}` | Peer deps (`@gobing-ai/spur`, react), a bundler-mode tsconfig for the consumer's own typecheck, the paste-ready `bootstrap.modules` declaration, and a four-row README pointing at the three owners. |
| `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts:1-305` | The repeatable proof: packs the CLI tarball and installs it into a temp copy of the template, builds it with Vite, asserts the emitted externals are a subset of the advertised specifiers (and include the kit) with no host CSS, serves the **installed package's** Board distribution with a catalog declaring the module, then drives real Chromium: kit header/tabs/empty state render, and header/title/tablist computed styles are identical to the built-in Observability shell in both themes (plus a cross-theme difference, so tokens really resolve). Writes 4 screenshots + `report.json`. |
| `docs/reports/artifacts/module-kit-proof/{report.json,module-light.png,module-dark.png,builtin-light.png,builtin-dark.png}` | The committed artifact: measured computed styles per theme for module and built-in, the external specifier list, kit version, browser version and screenshot paths. |
| `packages/config/tests/board-modules.test.ts:250-266` | The template's `module.yaml` is parsed by the shipped config schema and cleared by `validateBoardModuleDeclarations` against the host inventory — the same validation the serve preflight runs. |
| `docs/design/downstream-board-modules.md:194-215,222-228` | §6.2 gains "The shell comes from the host" (specifier, the supported component list, links to DESIGN.md and the satellite, template location); §6.3's externals list now includes `@gobing-ai/spur/board/ui` with "read it from the manifest". |
| `docs/help/how_to_customize_project_modules.md:227-253` | New §3.7: template location, kit specifier and component list, authoring types, build rule, and the three doc owners; §4 now prefers kit components over re-implementing a pattern. |
| `plugins/sp/skills/spur-composer/references/board-module-ui.md:29-33`, `SKILL.md:128` | The reference links the template (`../templates/board-module/README.md`) instead of naming a path, and the `build` row points at the template through the reference. |
| `biome.json:21-22` | Two generated trees are excluded from formatting/lint: the emitted declaration mirror (`apps/cli/board/kit`) and the generated proof artifacts (`docs/reports/artifacts`). |

Verification: `spur task gate 1350 light` PASS (12 checks); `bun test tests/modules/module-kit-template-browser.heavy.test.ts` 4 pass (Chromium 149, both themes, artifact written); `bun test packages/config/tests/board-modules.test.ts` 17 pass; `bun test plugins/sp/tests/skill-structure.test.ts` 99 pass (link integrity for the new template link).

Preflight split: the declaration half is proven by the config test through the real schema + cross-declaration rules (what the serve preflight runs); the browser half runs against the installed package's Board distribution served through the shipped catalog/asset path. The full `spur self serve` preflight on a temp project is not driven from the browser test.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — ship a starter module template (Vite library config externalizing exactly the board-runtime.json import keys, an entry exporting `webModule` built from ModuleShell/ModuleHeader/ModuleTabs/EmptyState, a scoped stylesheet) at `plugins/sp/skills/spur-composer/templates/board-module/`, linked from the composer UI reference and its compose/build steps | MET | `plugins/sp/skills/spur-composer/templates/board-module/src/index.tsx:1-59` (entry + `webModule` + kit-only shell), `src/module.css:1-12` (scoped styles), `vite.config.ts:1-55` (externals read from the installed `web/board-runtime.json`), `module.yaml:1-15`; links: `plugins/sp/skills/spur-composer/references/board-module-ui.md:29-33` and `SKILL.md:128`; the build assertion `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts:196-214` proves the emitted externals are a subset of the advertised specifiers and include `@gobing-ai/spur/board/ui` |
| R2 — an in-repo fixture built from the template outside the web workspace, declared under `bootstrap.modules` in a temp project, proven via real Chromium against the installed-package Board: preflight accepts it, the route renders kit header/tabs/empty state, computed styles match the built-in primitives in light and dark, no Tailwind/host CSS, and a repeatable artifact | MET | `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts:100-160` (packs the CLI tarball, copies the template to a temp dir outside the checkout, `bun install`, Vite build), `:165-260` (serves the installed package's `web/` distribution with the module declared and its assets under `/modules/kit-demo/*`), `:216-273` (route renders the header title, both tabs and the empty state; identical computed header/title/tablist styles vs `[data-observability-shell]` in light AND dark, plus a cross-theme difference), `:275-297` (screenshots + `report.json`); CSS evidence at `:204-214` (no `:root`, no `@theme`, no `--color-base`, < 2 KB); declaration evidence `packages/config/tests/board-modules.test.ts:250-266` (real schema + `validateBoardModuleDeclarations`); `command` — `bun test tests/modules/module-kit-template-browser.heavy.test.ts` 4 pass, artifact at `docs/reports/artifacts/module-kit-proof/report.json` |
| R3 — update downstream design §6 (specifier, supported components, template location) and the help page; YAML fences still parse | MET | `docs/design/downstream-board-modules.md:194-215` ("The shell comes from the host": specifier, component list, owners, template) and `:222-228` (externals list includes the kit specifier, read from the manifest); `docs/help/how_to_customize_project_modules.md:227-253` (§3.7 template + kit + types + build, linking the three owners) and the §4 preference line; `test` — `bun test packages/config/tests/board-modules.test.ts` 17 pass, whose existing rule parses every YAML fence in both docs |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A downstream native module renders host UI kit components with host styling in both themes | MET | test | `apps/web/tests/modules/module-kit-template-browser.heavy.test.ts:216-273` — real Chromium 149 over the installed Board; identical computed styles vs the built-in shell per theme, different across themes; screenshots `docs/reports/artifacts/module-kit-proof/module-{light,dark}.png` |
| AC2 — A starter template produces a contract-conforming module that loads in the installed Board | MET | test | same file `:165-260` (declared module loads through the shipped catalog path and renders) + `packages/config/tests/board-modules.test.ts:250-266` (declaration clears the schema and the cross-declaration rules) |
| AC3 — The authoring guide and help page document the UI kit and template | MET | test | `packages/config/tests/board-modules.test.ts:191-249` re-parses both documents' YAML fences; the new prose is at `downstream-board-modules.md:194-228` and `how_to_customize_project_modules.md:227-253` |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Functional + SECUA focus: PASS. All three requirements and all three acceptance criteria carry direct evidence — the template (`plugins/sp/skills/spur-composer/templates/board-module/`, 5 files + README + declaration), the installed-package Chromium proof with its committed artifact (`apps/web/tests/modules/module-kit-template-browser.heavy.test.ts`, 4 pass; `docs/reports/artifacts/module-kit-proof/`), the declaration gate through the real schema (`packages/config/tests/board-modules.test.ts:250-266`), and the docs/links (`downstream-board-modules.md:194-228`, `how_to_customize_project_modules.md:227-253`, composer reference + SKILL.md build row). Gate evidence: light gate PASS on 12 checks; `bun test plugins/sp/tests/skill-structure.test.ts` 99 pass (link integrity for the new template link).

The screenshots confirm the visual claim directly: the module renders with the Board's own header, active-tab accent and empty state, inside the installed Board's sidebar.

Findings (advisory, none blocking):

- **P4** — the browser proof serves the installed Board distribution through the test harness's static server; the serve preflight's declaration half is covered by the config test, but a full `spur self serve` start is not exercised.
- **P4** — the committed `report.json` is written by the test, so `docs/reports/artifacts` is excluded from biome formatting.
- **P4** — the template's dependency ranges are deliberately loose (`*`); the heavy test pins the versions actually proven.

Residual risk: the browser proof is a `test:heavy` case, so it runs at the feature's integrated full gate rather than per task; I ran it directly here (4 pass) so the claim is not untested. Disposition: PASS, no follow-up filed.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T20:12:17.881Z todo → wip (system)
- 2026-11-16T20:13:17.071Z wip → testing (system)
- 2026-11-16T20:13:18.340Z testing → done (system)

