---
template: feature-impl
schema_version: 1
name: "Align config/rules catalog docs with shipped preset composition"
description: ""
status: done
type: task
profile: standard
feature_id: C1
parent_wbs: null
priority: P2
tags: ["rules", "docs"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-12T06:36:42.338Z"
updated_at: "2026-08-12T07:38:57.494Z"
---

## 0524. Align config/rules catalog docs with shipped preset composition

### Background
Closure audit of Feature C (Rules, 2026-08-11): the shipped functional surface satisfies its
existing contract (verified live: `spur rule` run/validate/list/trace, ts-rule-engine integration,
rule-run persistence, local catalog resolution). The only demonstrated gap is **catalog
documentation drift**. This task implements Feature C1 R1–R6.

**Rubric:** E1 D1 L1 C0 R0 = 3 → kept whole; doc-only alignment; zero CLI or rule-behavior change.

**Premise verification (2026-08-12, this refine):**

| Claim | Live evidence |
| --- | --- |
| `recommended-pre-check` extends six categories | `config/rules/recommended-pre-check.yaml` `extends: [typescript, structure, boundary, surface, ui, strict]` |
| README preset table omits `ui` + `strict` | `config/rules/README.md` Presets row lists only `typescript, structure, boundary, surface` |
| README categories omit `migration` + `ui` | Categories table has 6 rows; live dirs include `migration/` and `ui/` (plus the six listed) |
| `rg-migration` preset + `migration/rg-dialect` are shipped | Files exist; `spur rule list --json` reports local category `migration` with `rg-dialect.yaml`; preset file `config/rules/rg-migration.yaml` extends `migration` |
| README "Not absorbed" still lists those helpers as absent | Two bullets under "Not absorbed (Spur-irrelevant)" |
| `strict-check` header claims strict is **not** in pre-check | Header says "kept OUT of … recommended-pre-check" and "Not part of recommended-pre-check" — false since 79186391 |
| `recommended-pre-check` header omits strict/ui in prose | Comment lists TypeScript/structure/DB/CLI/UI but does not name `strict` among extends |
| Commits that landed the composition | `79186391` (strict into pre-check), `bc267cc8` (ui into pre-check) |

**Out of this task's premises (do not expand):** layered `rule list` still surfaces a global
`~/.config/spur/rules` layer alongside local — README's "no global fallback" wording is a separate
accuracy question, not C1 R1–R6.
### Requirements
- **R1 — Preset table matches composition.** Update `config/rules/README.md` Presets table so
  `recommended-pre-check` Extends lists exactly: `typescript`, `structure`, `boundary`, `surface`,
  `ui`, `strict` (order may match the YAML `extends` array).
- **R2 — Category table includes live categories.** Add rows for live local categories `migration`
  and `ui` (dirs `migration/`, `ui/`) with accurate one-line purposes. Do not invent categories that
  exist only on the global layer (`ts-*` prefixes).
- **R3 — Transitional helpers documented as live.** Reconcile README "Not absorbed (Spur-irrelevant)"
  so neither the shipped `rg-migration` **preset** nor the `migration/rg-dialect` **rule** is
  described as absent / not absorbed. Keep truly absent items (e.g. `typescript/esm-build-conventions`
  if still accurate). Prefer pointing operators at the live preset/category rather than deleting
  all mention without a home.
- **R4 — `strict-check` header matches role.** Rewrite `config/rules/strict-check.yaml` header so it
  no longer claims strict is outside recommended-pre-check. State: strict is included in
  `recommended-pre-check` (since 79186391); `strict-check` remains the **explicit single-category
  cherry-pick** surface (`spur rule run --preset strict-check` or single `--rule`).
- **R5 — `recommended-pre-check` header lists full extends.** Rewrite
  `config/rules/recommended-pre-check.yaml` header comment so it names **all** extended categories,
  including `strict` and `ui` (not only typescript/structure/boundary/surface prose).
- **R6 — Docs-only verify.** After edits: `spur rule list --json` presets/categories and
  `spur rule list --preset recommended-pre-check --json` resolved rules match the corrected docs;
  `git diff` is limited to the three intended files; **no** CLI verb/flag, rule YAML **body** (rules
  under category dirs), preset `extends` arrays, or engine behavior changed.

**Out of scope / non-goals:**
- Changing any preset `extends:` array or rule severity/body under `config/rules/**/` categories
- Removing or renaming the `strict-check` or `rg-migration` presets
- Editing `~/.config/spur/rules` or ts-libs catalogs
- CLI surface changes (`spur rule …` verbs/flags)
- Broader README claims (e.g. global-layer resolution wording) outside R1–R5
### Acceptance Criteria
```gherkin
Feature: Rule catalog docs

  Scenario: R1 — recommended-pre-check table matches its composition
    Given the shipped recommended-pre-check preset
    When an operator reads the preset table
    Then it lists typescript, structure, boundary, surface, ui, and strict

  Scenario: R2 — category table includes the live categories
    Given the shipped rule catalog
    When an operator reads the category table
    Then it includes migration and ui

  Scenario: R3 — shipped transitional helpers are documented as live
    Given the rg-migration preset and migration/rg-dialect rule are shipped
    When an operator reads the Not absorbed section
    Then neither helper is described as absent

  Scenario: R4 — strict-check header describes its current role
    Given strict is part of recommended-pre-check
    When an operator reads the strict-check header
    Then it describes strict-check as the explicit single-rule cherry-pick surface

  Scenario: R5 — recommended-pre-check header lists strict
    Given recommended-pre-check extends strict
    When an operator reads its header
    Then strict is named among its extends

  Scenario: R6 — documentation-only change preserves rule behavior
    Given the corrected catalog documentation
    When the rule inventory and recommended-pre-check resolution are inspected
    Then their presets, categories, and resolved rules match the documentation
    And no CLI surface, rule body, preset composition, or engine behavior changed
```
### Q&A
**Q: Why not change `recommended-pre-check` extends back to four categories to match the old README?**

A: That would shrink the default gate (remove strict + ui). Composition was intentionally expanded
in 79186391 and bc267cc8. Docs follow the YAML, not the reverse.

**Q: Why keep the `strict-check` preset if strict is already in pre-check?**

A: Operators still need a cherry-pick surface for "only strict rules" without typescript/structure/
boundary/surface/ui. R4 documents that role; it does not delete the preset.

**Q: Should README claim zero global-layer resolution?**

A: Out of scope. Live `rule list --json` uses layered mode (local + global). C1 R1–R6 do not own
that claim; do not expand this task to rewrite the intro.

**Q: Is `rg-migration` a category or a preset?**

A: **Preset** file `config/rules/rg-migration.yaml` with `extends: [migration]`. The **rule** is
`migration/rg-dialect.yaml`. R3 must not describe either as absent; category `migration` is R2.
### Design
**WHAT:** Correct the catalog's self-description so README + two preset **headers** match the shipped
composition operators already run.

**WHY:** Operators decide gate membership from `config/rules/README.md` and header comments. Today
those surfaces omit `ui`+`strict` from recommended-pre-check, omit live `migration`/`ui` categories,
present shipped rg-migration helpers as "not absorbed," and contradict the YAML with
"strict is not part of pre-check."

**WHERE (only these files — frozen paths):**

| Path | Edit kind |
| --- | --- |
| `config/rules/README.md` | Categories table, Presets table, "Not absorbed" section; optional Presets row for `rg-migration` so R3 has a live home |
| `config/rules/strict-check.yaml` | **Header comments only** — keep `name`, `description`, `extends: [strict]` unchanged |
| `config/rules/recommended-pre-check.yaml` | **Header comments only** — keep `name` and `extends` array byte-identical |

**CHOSEN:** Doc-only / comment-only edits. No schema, no TypeScript, no new flags.

**REJECTED:**
- Removing `strict`/`ui` from `recommended-pre-check` extends (changes default gate; needs operator consent; 79186391/bc267cc8 deliberately added them)
- Deleting `strict-check` or `rg-migration` presets (public CLI surfaces)
- Touching global-layer `~/.config/spur/rules` headers
- "Fixing" layered resolution prose in README intro (out of C1 R1–R6)

**Frozen surface — no new API:** no new CLI verbs, flags, rule ids, preset names, or category
directories. Implementer only rewrites markdown/comments.

**Concrete edit targets (implement without inventing):**

1. **README Presets table — `recommended-pre-check` row (R1)**  
   Extends cell → `` `typescript`, `structure`, `boundary`, `surface`, `ui`, `strict` ``  
   (mirror YAML order).

2. **README Categories table (R2)** — append (or insert alphabetically if the table is sorted; current
   table is not strictly alpha — append after existing rows is fine):

   | Category | Dir | Purpose |
   | --- | --- | --- |
   | `migration` | `migration/` | Transitional helpers for the regex → `rg` evaluator move (`rg-dialect`) |
   | `ui` | `ui/` | Web UI seam boundaries (import seam, daisyUI class leak) |

3. **README "Not absorbed" (R3)**  
   - **Remove** bullets that claim `migration/rg-dialect` and `migration/rg-migration` are not absorbed.  
   - **Keep** `typescript/esm-build-conventions` if still accurate (ts-libs publish/dist only).  
   - **Add** (recommended) a Presets-table row for `rg-migration`: When = on-demand migration;
     Extends = `migration`. That gives the removed bullets a live documentation home.

4. **`strict-check.yaml` header (R4)** — replace the false "OUT of recommended-pre-check" /
   "Not part of recommended-pre-check" claims with wording equivalent to:

   ```text
   Strict-check preset — explicit cherry-pick of the `strict/` category only.
   The same category is already included in recommended-pre-check (extends: …, strict)
   since 79186391; use this preset when you want ONLY strict rules, not the full pre-check set.
   Run: spur rule run --preset strict-check
   Or cherry-pick: spur rule run --rule <id>
   ```

   Keep YAML keys (`name`, `description`, `extends`) unchanged.

5. **`recommended-pre-check.yaml` header (R5)** — rewrite the top comment so the prose lists all
   six extends including `ui` and `strict`, e.g. "extends typescript, structure, boundary, surface,
   ui, and strict." Keep the `extends:` array exactly as shipped.

**Anti-patterns (do not implement):**
- Editing any `extends:` list or rule body under `typescript/`, `structure/`, `boundary/`, `surface/`,
  `ui/`, `strict/`, `quality/`, `migration/`
- "Fixing" rule severities or reordering rules to match a narrative
- Touching `recommended-post-check.yaml` unless a typo is introduced by accident (leave alone)
- Expanding scope to global-layer docs or `docs/04_DESIGN.md` spur-rule sections
- Leaving checkbox Requirements unchecked after implement (flip R1–R6 to `[x]` in Solution/Testing
  flow — implement owns Solution)

**Invariants:**
- `git diff --name-only` ⊆ the three paths above
- `spur rule list --preset recommended-pre-check --json` rule set before/after is identical
  (hash of sorted rule ids)
- Feature C1 AC scenario titles unchanged (already mirrored in this task's AC)

**Handoff:** no task dependencies. Feature C1 owns the AC titles. Implementer owns the three files;
`Solution` / `Testing` / `Review` remain pipeline-owned.
### Plan
- [x] **P1 (premise re-check):** Re-read `config/rules/README.md`, `recommended-pre-check.yaml`,
      `strict-check.yaml`, and `ls config/rules/{migration,ui}`; confirm extends still include
      ui+strict and that rg-migration + rg-dialect files still exist (R6 baseline).
- [x] **P2 (R5):** Rewrite `recommended-pre-check.yaml` **header comments only** so all six extends
      (including `strict` and `ui`) are named; do not touch the `extends:` array.
- [x] **P3 (R4):** Rewrite `strict-check.yaml` header + description text only — strict is in
      recommended-pre-check; this preset is the single-category cherry-pick; leave `name` /
      `extends: [strict]` keys.
- [x] **P4 (R1+R2+R3):** Edit `config/rules/README.md` — Presets row for recommended-pre-check;
      Categories rows for `migration` + `ui`; fix "Not absorbed"; added `rg-migration` preset row +
      Transitional helpers section.
- [x] **P5 (R6 verify):**  
      - `rule list --json` — categories include `migration`, `ui`;
        presets still include recommended-pre-check / strict-check / rg-migration  
      - `rule list --preset recommended-pre-check --json` — sorted rule-id set hash
        `6afc2bc8721274851ce215080b745b1090696df757631a86030bf378f6685bff` (43 rules)  
      - `git diff --name-only` on config/rules = three intended files only  
      - Manual README read-back against R1–R5 scenarios
- [x] **P6 (gates):** `spur task check 0524 --json` clean after Plan flip; intentional git status.
### Solution
Doc-only alignment of the config/rules catalog with the shipped preset composition. No CLI, rule-body, or preset-`extends` change.

- `config/rules/README.md`
  - Categories table: added `migration` (config/rules/README.md:18 — `migration/`, transitional helpers for the regex → `rg` evaluator move, `rg-dialect`) and `ui` (config/rules/README.md:19 — `ui/`, web UI seam boundaries: import seam, daisyUI class leak). No invented `ts-*` categories.
  - Presets table (R1): `recommended-pre-check` Extends now lists exactly `typescript`, `structure`, `boundary`, `surface`, `ui`, `strict` (config/rules/README.md:25, mirroring the YAML `extends` array order). `strict-check` row reworded to single-category cherry-pick (config/rules/README.md:27); added live `rg-migration` row (config/rules/README.md:28 — on-demand, Extends `migration`).
  - New "Transitional helpers" section (R3): `migration/rg-dialect` and the `rg-migration` preset are documented as shipped/live with the run command and explicitly excluded from standing gates (config/rules/README.md:38-43). Removed both false "not absorbed" bullets; kept `typescript/esm-build-conventions` (config/rules/README.md:45-48 — still genuinely absent from `typescript/`).
- `config/rules/recommended-pre-check.yaml` (R5, header comments only; `extends` array byte-identical): prose now names all six extended categories incl. `ui` (bc267cc8) and `strict` (79186391) (config/rules/recommended-pre-check.yaml:4-6).
- `config/rules/strict-check.yaml` (R4, header + description text only; `name`/`description` key shape and `extends: [strict]` unchanged): removed "kept OUT of recommended-pre-check" / "Not part of recommended-pre-check" claims; now states strict is included in recommended-pre-check since 79186391 and the preset is the explicit single-category cherry-pick (`spur rule run --preset strict-check` or `--rule <id>`) (config/rules/strict-check.yaml:1-4).

R6 evidence: `spur rule list --preset recommended-pre-check --json` sorted rule-id hash unchanged (`6afc2bc8721274851ce215080b745b1090696df757631a86030bf378f6685bff`) before/after; live categories include `migration` + `ui`; presets include `rg-migration`; `git diff --name-only` limited to the three catalog files plus the pre-existing task-file edits.
### Testing
**Force re-verify (2026-08-12) — `/sp:dev-verify 0524 --auto --force --fix all --focus all`**

- Verdict: PASS
- Coverage: N/A (documentation-only change; no runtime code path added)
- Fix-pass hygiene: Plan checkboxes flipped to `[x]` (cleared `L3.unchecked-checklist`). Artifacts: `.spur/run/0524-verdict.json`, `.spur/run/0524-verify-answer.txt`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `config/rules/README.md:25` Presets row `recommended-pre-check` Extends = `typescript`, `structure`, `boundary`, `surface`, `ui`, `strict` (mirrors YAML order). `config/rules/recommended-pre-check.yaml` `extends` array unchanged (git diff comment-only). |
| R2 | MET | `config/rules/README.md:18-19` Categories rows for `migration` and `ui` with grounded purpose lines. Live: `spur rule list --json` categories include local `migration` and `ui` (plus global `ts-*`, not added to README). |
| R3 | MET | `config/rules/README.md:38-43` Transitional helpers documents `migration/rg-dialect` + `rg-migration` preset as shipped/live; Not absorbed (`:45-48`) only keeps `typescript/esm-build-conventions` (absent from `typescript/`). Neither helper described as not absorbed. |
| R4 | MET | `config/rules/strict-check.yaml:1-7` header + `:12-16` description: strict included in recommended-pre-check since 79186391; preset is single-category cherry-pick (`spur rule run --preset strict-check` / `--rule`). No "OUT of" / "Not part of recommended-pre-check" claim remains. `extends: [strict]` unchanged. |
| R5 | MET | `config/rules/recommended-pre-check.yaml:4-6` header names all six extends including `ui` and `strict`. `extends:` array byte-identical to HEAD (non-comment body diff empty). |
| R6 | MET | This run: `bun run apps/cli/src/index.ts rule list --preset recommended-pre-check --json \| jq -r '.rules[].id' \| sort \| sha256sum` → `6afc2bc8721274851ce215080b745b1090696df757631a86030bf378f6685bff` (43 rules). `git diff --name-only HEAD -- config/rules/` = README + recommended-pre-check.yaml + strict-check.yaml only. No CLI/engine/rule-body changes. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R1 — recommended-pre-check table matches its composition | MET | static-ref | `config/rules/README.md:25` lists typescript, structure, boundary, surface, ui, and strict |
| Scenario: R2 — category table includes the live categories | MET | static-ref | `config/rules/README.md:18-19` includes migration and ui; confirmed in live `rule list --json` |
| Scenario: R3 — shipped transitional helpers are documented as live | MET | static-ref | Transitional helpers section + Not absorbed no longer treats rg-migration / rg-dialect as absent (`config/rules/README.md:38-48`) |
| Scenario: R4 — strict-check header describes its current role | MET | static-ref | `config/rules/strict-check.yaml:1-7` cherry-pick wording; inclusion in recommended-pre-check stated |
| Scenario: R5 — recommended-pre-check header lists strict | MET | static-ref | `config/rules/recommended-pre-check.yaml:4-6` names strict (and ui) among extends |
| Scenario: R6 — documentation-only change preserves rule behavior | MET | command | Preset resolve hash `6afc2bc8…` / 43 rules; three-file config/rules diff; extends arrays unchanged |

**Design conformance**

| Claim | Status | Evidence |
| --- | --- | --- |
| README tables + Not absorbed / transitional home | DONE | `config/rules/README.md` |
| recommended-pre-check header only; extends identical | DONE | comment-only diff |
| strict-check header; cherry-pick role | DONE | header |
| strict-check `description` value | CHANGED | Design WHERE said keep description; R4 false claim lived in description — Solution disclosed edit; goal-equivalent |

**SECUA (focus=all)**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings. Residual: README intro global-layer wording out of scope (Q&A). |

**Gates this run**

- `task check 0524` → pass after Plan hygiene
- `feature check C1` → pass: true, status done, findings: []
- C1 linked tasks: all terminal (0524 done)
### Review
**Verdict: PASS** (3-dimensional review of 0524's diff: functional traceability R1–R6, SECUA, architecture)

**Scope reviewed:** `git diff` on `config/rules/README.md`, `config/rules/recommended-pre-check.yaml`, `config/rules/strict-check.yaml` (HEAD vs working tree); live inventory via `bun apps/cli/src/index.ts rule list [--preset recommended-pre-check] --json`; `git diff --name-only` scope check; `spur task check 0524 --json`.

| Severity | Dimension | Finding | Disposition |
| --- | --- | --- | --- |
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | — | None | — |
| P4 | Functional | Solution's hash claim (`6afc2bc8…`) is reproducible only with the raw-jq pipeline (`jq -r '.rules[].id' \| sort \| sha256sum`); the task's P5 verify verb uses quoted jq (`jq '.rules[].id'`) which yields `75a9a485…`. Invariance itself holds under both pipelines (extends arrays byte-identical, no rule bodies touched), so this is an evidence-reproducibility nit, not a correctness failure. | Accept; recommend recording the exact pipeline next to the hash in future tasks |
| P4 | Functional | `strict-check.yaml` `description` value was edited (removed "Not part of recommended-pre-check.") although the Design WHERE table says keep `description` unchanged. The false claim R4 requires removing lives inside the description itself, so the edit is required by AC R4 (observable contract) and is disclosed in Solution ("header + description text only"). `name`, key shape, and `extends: [strict]` untouched. | Accept — justified deviation, disclosed |
| P4 | Architecture | README intro still claims resolution "with no fallback to a global install", but live `rule list --json` reports `mode: layered` with global layer `~/.config/spur/rules`. | Known, explicitly out of scope per task premises (Q&A: "layered resolution wording is a separate accuracy question"); residual risk for a future task, not a C1 R1–R6 defect |

**Traceability (R1–R6 vs implementation):**

- **R1 — PASS.** README Presets table `recommended-pre-check` Extends = `typescript`, `structure`, `boundary`, `surface`, `ui`, `strict` (config/rules/README.md:25), mirroring the shipped YAML `extends` array order byte-for-byte (verified `git diff`: comment-only changes to the preset file).
- **R2 — PASS.** Categories table includes `migration` (config/rules/README.md:18) and `ui` (config/rules/README.md:19). Both live: `spur rule list --json` categories = boundary, migration, quality, strict, structure, surface, typescript, ui (+ global-layer `ts-*`). Purpose lines grounded: `migration/rg-dialect.yaml` description matches the regex→`rg` evaluator transition; `ui/ui-import-boundary.yaml` restricts imports to the `ui.ts` seam (daisyui referenced 6×). No invented `ts-*` categories added.
- **R3 — PASS.** "Not absorbed" section no longer lists `rg-migration`/`rg-dialect`; new "Transitional helpers" section (config/rules/README.md:38-41) documents both as shipped/live with the run command and their exclusion from standing gates (verified: `rg-dialect` count in `recommended-pre-check` resolution = 0; `recommended-post-check` extends `quality` only). `typescript/esm-build-conventions` kept and confirmed genuinely absent from `typescript/` dir.
- **R4 — PASS.** `strict-check.yaml` header + description no longer claim strict is outside `recommended-pre-check`; both state inclusion since 79186391 and the single-category cherry-pick role (`spur rule run --preset strict-check` / `--rule <id>`).
- **R5 — PASS.** `recommended-pre-check.yaml` header names all six extends including `ui` (bc267cc8) and `strict` (79186391); `extends:` array byte-identical (git diff shows no YAML-key/array changes).
- **R6 — PASS.** Re-ran `bun apps/cli/src/index.ts rule list --preset recommended-pre-check --json | jq -r '.rules[].id' | sort | sha256sum` → `6afc2bc8721274851ce215080b745b1090696df757631a86030bf378f6685bff` (43 rules), matching the Solution's claimed hash exactly. Diff proves extends arrays and rule bodies untouched. `git diff --name-only` = the three catalog files + task-corpus bookkeeping (0524/0525 task files: pipeline Solution/status edits, not implementation). Live presets include `recommended-pre-check`, `strict-check`, `rg-migration`; `spur task check 0524 --json` → `pass: true`. No CLI surface, preset composition, rule body, or engine behavior changed.

**SECUA:** Doc/comment-only change — no rule severity, evaluator, body, or `extends` mutation; no secrets, no new code paths, no security surface touched. Clean.

**Residual risk:** Low. The only outstanding accuracy item (global-layer fallback wording) is scoped out by the task itself and tracked as a P4 note above.
### References
- Feature C1 — Rule surface contract and catalog integrity (AC scenario titles R1–R6)
- Parent group C — Rules
- `config/rules/recommended-pre-check.yaml` — shipped extends (SSOT for R1/R5)
- `config/rules/strict-check.yaml` — cherry-pick preset (R4)
- `config/rules/rg-migration.yaml` + `config/rules/migration/rg-dialect.yaml` — live transitional helpers (R2/R3)
- `config/rules/ui/` — live UI category (R2)
- Commits: `79186391` (strict → pre-check), `bc267cc8` (ui → pre-check)
- Verify verbs: `spur rule list --json`, `spur rule list --preset recommended-pre-check --json`
### History
- 2026-08-12T07:30:28.254Z todo → wip (system)
- 2026-08-12T07:36:46.209Z wip → testing (system)
- 2026-08-12T07:36:46.753Z testing → done (system)
