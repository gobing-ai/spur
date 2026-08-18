---
schema_version: 1
name: "Spur rule: UI import + class-leak boundary enforcement (warning)"
status: done
template: feature-impl
created_at: 2026-06-23T06:04:57.965Z
updated_at: "2026-08-18T04:42:46.789Z"
feature_id: F7
priority: P2
tags: ["rules", "ui", "boundary"]
---

## 0103. Spur rule: UI import + class-leak boundary enforcement (warning)

### Background

With the component layer in place (Tasks 1-2), enforce that ui.ts is the only UI import seam and that no daisyUI component classes leak outside components/ui/. The rule engine already has the two evaluators needed (proven in config/rules/boundary/dao-boundary.yaml): `forbidden-import` (block third-party UI lib specifiers outside the seam) and `rg` (flag raw daisyUI component className strings). Both rules START at severity warning so the gate never breaks during adoption — the warning->error promotion is Task 4. Precedent for warning severity: require-corresponding-test in test-location.yaml.

### Requirements
- [ ] R1. Create preset directory `config/rules/ui/` with a rule file `ui-import-boundary.yaml` holding both boundary rules.
- [ ] R2. Rule A `ui-import-seam-only` (`forbidden-import`, severity `warning`): forbid importing third-party UI library specifiers (`daisyui`, `@uiw/react-md-editor`, and future UI libs) anywhere under `apps/web/src/**` EXCEPT `apps/web/src/components/ui/**` and `apps/web/src/ui.ts`.
- [ ] R3. Rule B `no-daisyui-class-leak` (`rg`, severity `warning`): flag `className` strings containing daisyUI COMPONENT classes (`btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|select|checkbox|toggle`) outside `components/ui/` — the pattern MUST NOT match layout/utility classes (`flex`, `grid`, `gap-*`, `p-*`, etc.); use word-boundary anchoring to avoid noise.
- [ ] R4. Scope both rules: `include` `apps/web/src/**`; `exclude` `components/ui/**`, `ui.ts`, `**/tests/**`, `**/node_modules/**`.
- [ ] R5. Run `spur rule run --file config/rules/ui/ui-import-boundary.yaml` against the post-Task-0102 tree: the rule MUST fire on the one known, deferred leak (`@uiw/react-md-editor` imported directly in `MarkdownBody.tsx` + `TaskDetail.tsx` — explicitly left for 0103/0104 per 0102's Solution) at severity `warning`, and the default `--fail-on error` gate MUST stay green (exit 0). Do NOT wire into `recommended-pre-check` (that is Task 0104). Do NOT refactor the MDEditor import into the seam here — that wrapping is 0104's promotion work.
- [ ] R6. Gate: `spur rule validate` passes, `bun run lint` green, working tree shows only the new rule file (no `04_DESIGN.md` change — `04` indexes the `spur rule` command surface, not individual presets).
### Acceptance Criteria
```gherkin
Feature: UI import + class-leak boundary enforcement

  Scenario: R2 Importing a third-party UI lib outside the seam is flagged
    Given the ui-import-boundary preset is loaded
    When a file under apps/web/src/ outside components/ui/ imports "daisyui" or "@uiw/react-md-editor"
    Then the ui-import-seam-only rule reports a warning

  Scenario: R2 Importing a UI lib inside the seam is allowed
    Given the ui-import-boundary preset is loaded
    When apps/web/src/components/ui/Button.tsx imports a third-party UI lib
    Then the ui-import-seam-only rule reports no finding

  Scenario: R3 A daisyUI component class outside components/ui is flagged
    Given the ui-import-boundary preset is loaded
    When a .tsx file outside components/ui/ uses className with a daisyUI component class (btn, card, modal, ...)
    Then the no-daisyui-class-leak rule reports a warning

  Scenario: R3 Layout and utility classes never trigger the rule
    Given the ui-import-boundary preset is loaded
    When a .tsx file uses only layout/utility classes (flex, grid, gap-2, p-4)
    Then the no-daisyui-class-leak rule reports no finding

  Scenario: R5 The known MDEditor leak is flagged at warning while the gate stays green
    Given the apps/web tree after the ui.ts seam refactor (Task 0102)
    And @uiw/react-md-editor is still imported directly in MarkdownBody.tsx and TaskDetail.tsx (deferred to 0103/0104)
    When spur rule run evaluates the ui-import-boundary preset at the default fail-on error
    Then ui-import-seam-only reports those imports as warnings and the run exits 0

  Scenario: R1 R6 The preset validates and the gate stays green
    Given the new config/rules/ui/ui-import-boundary.yaml
    When spur rule validate runs and bun run lint runs
    Then both pass and the only changed file is the new rule preset
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design
**Approach.** One new preset file `config/rules/ui/ui-import-boundary.yaml` with two rules, both at
severity `warning` (non-breaking adoption per DD-06; the `warning→error` promotion is Task 0104).
Reuses the two evaluators already proven in `config/rules/boundary/dao-boundary.yaml` — no new
evaluator type — so this is a pure rule-authoring task with zero engine changes.

**Rejected alternatives.**
- *Start at `error`*: would break `bun run lint` mid-adoption; rejected in favor of the
  warning-first ramp (precedent: `require-corresponding-test` in `structure/test-location.yaml`).
- *Single `rg` rule for both concerns*: import-specifier checking is `forbidden-import`'s job
  (AST-aware, no false positives on string matches); splitting keeps each rule's intent and
  evaluator aligned.

**Rule A — `ui-import-seam-only` (`forbidden-import`, warning).** Mirrors `ts-db-only-in-domain`:

```yaml
evaluator:
  type: forbidden-import
  config:
    forbidden:
      - { specifier: "daisyui" }
      - { specifier: "@uiw/react-md-editor" }
    scope:
      include: ["apps/web/src/**/*.ts", "apps/web/src/**/*.tsx"]
      exclude: ["apps/web/src/components/ui/**", "apps/web/src/ui.ts", "**/tests/**", "**/node_modules/**"]
```

**Rule B — `no-daisyui-class-leak` (`rg`, warning).** Component-class allowlist anchored to className
contexts. Word-boundary `\b` prevents matching `card` inside `flashcard` or utility tokens; the
alternation lists only daisyUI *component* classes, never layout/utility (`flex`/`grid`/`gap-`/`p-`):

```yaml
evaluator:
  type: rg
  config:
    pattern: "className=[\"'][^\"']*\\b(btn|card|badge|modal|menu|navbar|drawer|tabs|alert|dropdown|collapse|join|tooltip|loading|select|checkbox|toggle)\\b"
include: ["apps/web/src/**/*.tsx"]
exclude: ["apps/web/src/components/ui/**", "apps/web/src/ui.ts", "**/tests/**", "**/node_modules/**"]
```

**Invariants.**
- `apps/web/src/ui.ts` is the *only* UI import seam; `components/ui/**` is the *only* place
  daisyUI component classes may appear. Both exclusions must stay in lockstep across the two rules.
- Both rules stay `warning` until Task 0104 — promoting here would violate the adoption ramp.
- No `04_DESIGN.md` edit: `04` documents the `spur rule` command surface, not the preset inventory
  (`spur rule list` is the live inventory). Confirmed against `docs/04_DESIGN.md` rule-surface section.
### Plan
- [x] Create `config/rules/ui/` and author `ui-import-boundary.yaml` with both rules (header comment citing the seam invariant + warning-ramp rationale, mirroring `boundary/dao-boundary.yaml`).
- [x] Write Rule A `ui-import-seam-only` (`forbidden-import`, warning) — `daisyui` + `@uiw/react-md-editor` specifiers; scope include `apps/web/src/**`, exclude `components/ui/**` + `ui.ts` + tests + node_modules.
- [x] Write Rule B `no-daisyui-class-leak` (`rg`, warning) — word-boundary component-class alternation anchored to `className=` contexts; same include/exclude scope (`.tsx` only).
- [x] `spur rule validate --file config/rules/ui/ui-import-boundary.yaml` -> clean (2 rules).
- [x] `spur rule run --file config/rules/ui/ui-import-boundary.yaml --json` -> 2 warnings on the known MDEditor leak (MarkdownBody.tsx, TaskDetail.tsx); default fail-on error exits 0, --fail-on warning exits 1 (proves the rule fires). Tree is correct as-is — the leak is the deferred-to-0104 case, not a regex defect.
- [x] `bun run lint` green; `git status` shows only the new rule file + this task file.
- [ ] Commit `feat(rules): add UI import + class-leak boundary preset (warning)` — do NOT touch `recommended-pre-check.yaml` (Task 0104).
### Solution

| File | Range | What / Why |
| ---- | ----- | ---------- |
| `config/rules/ui/ui-import-boundary.yaml` | `1-57` (new) | New rule preset with two warning-severity rules. `ui-import-seam-only` (`forbidden-import`) forbids `daisyui` + `@uiw/react-md-editor` imports under `apps/web/src/**` except the `ui.ts` seam and `components/ui/**`. `no-daisyui-class-leak` (`rg`) flags daisyUI component classes in `className` strings outside `components/ui/**`, word-bounded to the component allowlist so layout/utility classes never match. Both start at `warning` per DD-06 (promotion + pre-check wiring is 0104). |

**Outcome.** `spur rule validate` clean (2 rules). `spur rule run` (default `--fail-on error`) exits 0 with 2 warnings on the one deferred leak — `@uiw/react-md-editor` imported directly in `apps/web/src/modules/task-kanban/MarkdownBody.tsx:1` and `apps/web/src/modules/task-kanban/TaskDetail.tsx:2` — which 0102's Solution explicitly handed to 0103/0104. `--fail-on warning` exits 1, proving the rule fires. `bun run lint` green. No `04_DESIGN.md` change (it indexes the `spur rule` command surface, not the preset inventory). The MDEditor import is intentionally NOT refactored — wrapping it into the seam is 0104's promotion work.

### Testing

**Verdict: PASS** — all 6 requirements MET. Evidence below.

| Req | Status | Evidence |
| --- | ------ | -------- |
| R1 | MET | `config/rules/ui/ui-import-boundary.yaml` created; `spur rule validate` → valid, ruleCount=2 (`no-daisyui-class-leak`, `ui-import-seam-only`). |
| R2 | MET | `ui-import-seam-only` (`forbidden-import`, warning) forbids `daisyui` + `@uiw/react-md-editor` under `apps/web/src/**` except `ui.ts` + `components/ui/**`. Fires on `apps/web/src/modules/task-kanban/MarkdownBody.tsx:1` + `apps/web/src/modules/task-kanban/TaskDetail.tsx:2` (`--fail-on warning` → exit 1). |
| R3 | MET | `no-daisyui-class-leak` (`rg`, warning) probe test: `className="btn btn-primary"` flagged (1 finding); `className="flex grid gap-2 p-4"` not flagged (0 findings). Word-bounded component allowlist excludes layout/utility. |
| R4 | MET | Both rules: `include` `apps/web/src/**`; `exclude` `components/ui/**` + `ui.ts` + `**/tests/**` + `**/node_modules/**`. |
| R5 | MET | `spur rule run` default (`--fail-on error`) exits 0; flags the deferred MDEditor leak at warning severity only (the case 0102 explicitly handed to 0103/0104). No `recommended-pre-check` change. |
| R6 | MET | `spur rule validate` clean; `bun run lint` exit 0; `git status` = new `config/rules/ui/` + this task file only; no `04_DESIGN.md` change (it indexes the command surface, not presets). |

**Checks:** rule validate ✓ · rule run (fail-on error) ✓ exit 0 · rule fires (fail-on warning) ✓ exit 1 · bun run lint ✓ exit 0

### Review


SECU pass over the one changed artifact (`config/rules/ui/ui-import-boundary.yaml`). Scope is a
declarative rule preset — no executable code, no I/O, no secrets surface.

| # | Severity | Dimension | Finding |
| - | -------- | --------- | ------- |
| 1 | P4 (minor / advisory) | Correctness | Rule B's `rg` pattern matches only the **first** `className=` token on a line and only single/double-quote literals — template-literal `className={\`...\`}` or a component-class in a second className on the same line would slip through. Acceptable at the `warning` adoption tier; revisit if 0104's promotion to `error` needs tighter coverage. |
| 2 | P4 (minor / advisory) | Correctness | The component-class allowlist is a fixed alternation; a future daisyUI component class (e.g. `steps`, `stat`) won't be caught until added. Intentional — explicit allowlist beats a broad regex that false-positives on utility classes. |

**Security:** none — no secrets, no shell, no dynamic eval. **Efficiency:** none — two rules, scoped globs. **Usability:** rule `id`s and `description`s are clear and cite the seam invariant + 0104 handoff.

No blockers (P1) or majors (P2). The two P4 items are inherent trade-offs of warning-tier regex matching, documented for 0104.

### History
- 2026-06-26T07:14:59.223Z todo → wip (system)
- 2026-06-26T07:15:03.015Z wip → testing (system)
- 2026-06-26T07:16:11.184Z testing → done (system)
