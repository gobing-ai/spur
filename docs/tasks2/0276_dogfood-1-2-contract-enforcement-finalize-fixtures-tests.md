---
template: feature-impl
schema_version: 1
name: "Dogfood @1.2 contract enforcement (finalize, fixtures, tests)"
description: ""
status: done
type: task
profile: standard
feature_id: H4
parent_wbs: null
priority: P1
tags: ["workstream:dogfood", "impl", "dogfood-1.2"]
dependencies: ["0274"]
created_at: "2026-07-17T01:13:58.102Z"
updated_at: "2026-07-28T00:32:17.832Z"
---

## 0276. Dogfood @1.2 contract enforcement (finalize, fixtures, tests)

### Background
**Type:** feature-impl · **Feature:** N · **Package:** dogfood @1.2 Impl A (from 0274)

**Goal:** Make non-compliant dogfood reports *detectable and rejectable*. Enforce finalize structure, protocol string `sp:dogfood-testing@1.2`, golden fixtures, and automated tests.

**Authority:** docs/tasks2/0274 Solution W1-W6; audit docs/tasks2/0273 findings D1-D5, D10.

**Predecessor:** task 0244 delivered always-on dual artifacts @1.1 — do not regress.
### Requirements
- [x] R1. Bump protocol to sp:dogfood-testing@1.2 in SKILL.md metadata + report-template + monitor-ledger + dev-dogfood prose (W1/D5).
- [x] R2. Expand Phase 4 finalize-or-abort: require summary footer; unique ### 1-6; #### Fixed + #### Unresolved; no complete if checks fail (W2/D1/D3).
- [x] R3. Ledger row count must equal declared executed steps (W3/D4).
- [x] R4. Add pass + fail fixtures under plugins/sp/skills/dogfood-testing/tests/fixtures/ (W4/D2/D10).
- [x] R5. Automated tests validate pass fixture and reject missing-footer fixture (W5/D1/D2).
- [x] R6. Optional validate-report helper used by tests (W6) — inline in test file is OK.
- [x] R7. Preserve dual artifacts, live ledger, anti-fiction cache math, testee-scoped --agent, verdict-grades-testee.
- [x] R8. bun test skill-structure (+ new dogfood tests) green.
### Acceptance Criteria
```gherkin
@core
Scenario: Complete requires footer
  Given a dogfood report missing the Dogfood Summary footer
  When the @1.2 finalize checklist or validator runs
  Then status complete is refused and missing_footer is reported

@core
Scenario: Pass fixture is green
  Given tests/fixtures/report-complete.md
  When the report contract tests run
  Then they pass
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. Version bump strings @1.2.
2. Phase 4 checklist + report-template notes.
3. Ledger cardinality rule.
4. Write fixtures (pass/fail).
5. Tests R22b / fixture assertions.
6. Solution change-map; run tests.
### Solution
Shipped dogfood `sp:dogfood-testing@1.2` contract enforcement (Impl A of 0274: W1–W6). Impl B (W7–W9, pipeline-driving detector + token policy) is task 0277 — out of scope here.

| File | Change |
|---|---|
| `plugins/sp/skills/dogfood-testing/SKILL.md:7-8,124-145` | **W1:** `metadata.version` 1.1→1.2, `protocol: sp:dogfood-testing@1.2` (frontmatter + Phase 1 + Platform Notes). **W2:** Phase 4 finalize-or-abort expanded to 7 checks — structure scrub (unique `### 1.`–`### 6.`; Issues requires `#### Fixed` + `#### Unresolved`; no leftover "run in progress"), ledger cardinality, mandatory footer mirrored at report end, refusal rule (any failed check ⇒ `status: aborted` + failures listed under `#### Unresolved`). **W3:** Phase 3 cardinality sentence (`SKILL.md:120`). |
| `plugins/sp/skills/dogfood-testing/references/report-template.md:16-21,265-285` | **W1:** protocol frontmatter + version line + canonical frontmatter block → @1.2; @1.2 changelog bullets; dash form `sp-dogfood-testing@…` rejected. **W2:** Phase 4 checklist expanded (same 7 checks as SKILL). **W3:** §3 ledger rules + cardinality line. |
| `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:36-40` | **W1:** protocol frontmatter + "Disk SSOT (protocol @1.2)". **W3:** live-ledger rule 5 — data rows == `Steps: N executed`; N/A steps get explicit `Outcome: N/A` rows; mismatch refuses `complete`. |
| `plugins/sp/scripts/dogfood-testing/validate-report.ts:44` | **New (W6).** Pure `validateReport(markdown) → { ok, errors[] }` with stable codes: `missing_footer`, `missing_live_path`, `missing_report_path`, `missing_section:n`, `duplicate_section:n`, `missing_issues_subheads`, `missing_steps_declared`, `ledger_cardinality`, `protocol_string`. Ledger body extracted by deterministic slice (`validate-report.ts:24-37`) — the first draft's `/m` regex lookahead `\s*$` matched every line boundary; caught by the pass-fixture test. |
| `plugins/sp/tests/dogfood-testing/fixtures/report-complete.md:1-82` | **New (W4).** Golden pass fixture: @1.2 frontmatter, six unique headings, both Issues subheads, 2-row ledger matching `Steps: 2 executed`, footer with `[Live:]`/`[Report:]`. |
| `plugins/sp/tests/dogfood-testing/fixtures/report-missing-footer.md:1-75` | **New (W4).** Negative fixture — identical minus the footer block. |
| `plugins/sp/tests/dogfood-testing/report-contract.test.ts:12-119` | **New (W5).** 12 tests: fixture-pass (golden shape + validator clean), fixture-fail-footer (`missing_footer`), protocol-string pins across the three skill files, and 9 validator mutation cases (duplicate/missing section, Issues subheads, cardinality mismatch, missing ledger, undeclared Steps, dash-form/absent protocol, missing `[Live:]`). Validator coverage 100% fn/lines. |

**Preserved (R7):** dual artifacts, live ledger, anti-fiction cache math, testee-scoped `--agent`, verdict-grades-testee — all sections untouched; R22 prose assertions still green.

**Verification:**
- `bun test plugins/sp/tests/dogfood-testing/report-contract.test.ts` → 12 pass / 0 fail (validator 100% coverage).
- `bun test plugins/sp` → 188 pass / 0 fail (was 176; +12 new; R22/R43/R52 unaffected).
- `bunx biome check plugins/sp/skills/dogfood-testing/` → clean.
- `spur rule run --preset recommended-pre-check --fail-on warning` → all 33 rules passed.
### Testing
**Verification:** `/sp-dev-verify 0276 --auto --next --force --focus all --fix all` re-run 2026-07-16 (standalone path — independent re-evidence this turn).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `SKILL.md:7-8` `version: "1.2"` + `protocol: "sp:dogfood-testing@1.2"`; `report-template.md:7,16-21,51` + `monitor-ledger.md:7`; `dogfood-protocol-string` test green. `dev-dogfood.md` has no protocol string (rg) — N/A bump surface. |
| R2 | MET | `SKILL.md:127-148` Phase 4: structure scrub (unique `### 1.`–`### 6.`; Issues `#### Fixed`/`#### Unresolved`); footer mandatory + mirrored; refusal rule blocks `complete` on fail. Mirrored in `report-template.md` Phase 4. |
| R3 | MET | `monitor-ledger.md:36-39` cardinality rule 5; `SKILL.md:118-120`; `report-template.md` §3 + Phase 4 check 3; validator `ledger_cardinality` tests green. |
| R4 | MET | Pass + fail fixtures at `plugins/sp/tests/dogfood-testing/fixtures/{report-complete,report-missing-footer}.md` (monorepo test layout; Solution change-map). |
| R5 | MET | `bun test plugins/sp/tests/dogfood-testing/report-contract.test.ts` → 12 pass / 0 fail this run (`dogfood-fixture-pass` + `dogfood-fixture-fail-footer`). |
| R6 | MET | `plugins/sp/scripts/dogfood-testing/validate-report.ts:44` pure `validateReport`; imported by test file. |
| R7 | MET | Dual artifacts / live ledger / cache% formula / testee-scoped `--agent` / verdict-grades-testee still present (rg + suite); `bun test plugins/sp` 189/189 green (no R22 regression). |
| R8 | MET | `bun test plugins/sp` → 189 pass / 0 fail across 8 files this run; biome clean on new TS. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Complete requires footer | MET | test | `dogfood-fixture-fail-footer` — `validateReport(report-missing-footer.md)` → errors include `missing_footer` (+ live/report paths); Phase 4 refusal `SKILL.md:147-148` |
| Scenario: Pass fixture is green | MET | test | `dogfood-fixture-pass` — `validateReport(report-complete.md)` → `{ok:true, errors:[]}` + golden-shape; 12/12 suite green |

**Design conformance:** task `### Design` bare; implementation follows 0274 W1–W6 (Solution change-map). W6 chose standalone script over inline (both acceptable). Fixtures path under `plugins/sp/tests/` (not skill-local `tests/`) for bun workspace layout — goal-equivalent, documented in Solution. Claims: DONE (W1–W6).

**SECUA (focus=all):** no blockers/majors this re-verify. Prior minor (`/m` regex lookahead ledger truncate) fixed pre-ship at `validate-report.ts:24-37` + regression covered. Advisory: complete-report scope only — documented module header. Pure string checks; no secrets/injection surface.

**Coverage:** `validate-report.ts` 100% functions / 100% lines (bun coverage this run). Fixtures markdown coverage-ignored per bunfig.

**Fix pass (`--fix all`):** nothing to repair — all R/AC MET; no major SECUA findings.

Verdict: PASS
### Review
**Review scope:** 3 edited skill/reference files (SKILL.md, report-template.md, monitor-ledger.md) + 4 new files (validate-report.ts, 2 fixtures, report-contract.test.ts). Reviewed in-session via `/sp:dev-review 0276 --auto` (functional + SECUA + architecture).

**Functional traceability (sp-functional-review):**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `SKILL.md:7-8` (`version: "1.2"`, `protocol: "sp:dogfood-testing@1.2"`); `report-template.md` frontmatter + `report-template.md:16-21` version line + changelog; `monitor-ledger.md` frontmatter + Disk SSOT line. `dev-dogfood.md` carries no protocol string (grep-verified) — nothing to bump; protocol pinned by `dogfood-protocol-string` test |
| R2 | MET | `SKILL.md:131-145` — Phase 4 now 7 checks: structure scrub, cardinality, footer mirrored at report end, refusal rule (aborted + failures listed); mirrored in `report-template.md` Phase 4 |
| R3 | MET | `monitor-ledger.md:36-40` cardinality rule 5; `SKILL.md:120` Phase 3 sentence; `report-template.md` §3 ledger rules |
| R4 | MET | `tests/fixtures/report-complete.md`, `tests/fixtures/report-missing-footer.md` |
| R5 | MET | `tests/report-contract.test.ts` — pass fixture validated clean; missing-footer fixture rejected with `missing_footer`; 12/12 green |
| R6 | MET | `scripts/validate-report.ts:44` — pure `validateReport`, imported by the test file (0274 W6 allows script-or-inline) |
| R7 | MET | R22 prose assertions green in the 188-test suite; dual artifacts / live ledger / anti-fiction math / testee-scoped `--agent` / verdict-grades-testee sections untouched |
| R8 | MET | `bun test plugins/sp` → 188 pass / 0 fail across 8 files |

**AC cross-check:**

| AC | Status | Evidence |
|----|--------|----------|
| Complete requires footer | MET | Fail fixture → `validateReport` returns `missing_footer` (test `dogfood-fixture-fail-footer`); Phase 4 refusal rule in `SKILL.md:144-145` + `report-template.md` |
| Pass fixture is green | MET | `dogfood-fixture-pass` test — validator clean + golden-shape assertions, 12/12 pass |

**SECUA findings (sp-code-verification review mode):**

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | minor (correctness) | First-draft ledger-body regex used a `\s*$` lookahead under `/m` — matched every line boundary, truncating capture at the header row | **Fixed before commit:** deterministic slice in `validate-report.ts:24-37`; caught by the pass-fixture test (red→green) |
| F2 | advisory (usability) | Validator validates the complete-report shape only; aborted/partial reports legitimately fail `missing_footer`/`missing_steps_declared` | Accepted — documented in the module header; partial reports are out of scope for the helper |

No security findings (pure string processing, bounded regexes). No efficiency findings (O(n) scans over a report body).

**Architecture candidates (sp-code-improvement):**

| # | Severity | Signal | Candidate | Disposition |
|---|----------|--------|-----------|-------------|
| C1 | advisory | locality | Validator lives in `scripts/` while fixtures/tests live in `tests/` | Accepted — matches the daily-summary `scripts/` precedent; `tests/fixtures/` is coverage-ignored per bunfig |

No blocker/major findings. Helper has a real body (not shallow), zero coupling (pure function), direct test surface.

**Priority findings (P1–P4):**

| Priority | Location | Finding | Disposition |
|---|---|---|---|
| P1 | — | none — no blockers | n/a |
| P2 | — | none — no majors | n/a |
| P3 | `scripts/validate-report.ts:24-37` (first draft) | `/m` regex `\s*$` lookahead truncated the ledger capture | FIXED — replaced with deterministic slice; regression covered by fixture tests |
| P4 | `scripts/validate-report.ts:1-9` | Complete-report scope only (aborted reports not validatable) | OPEN-accepted — documented in module header |

**Dimension verdicts:** Functional PASS · SECUA PASS (1 minor fixed pre-commit, 1 advisory accepted) · Architecture PASS (1 advisory accepted)
### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-17T02:54:04.467Z todo → wip (system)
- 2026-07-17T02:55:28.428Z wip → testing (system)
- 2026-07-17T04:41:39.119Z testing → done (system)
