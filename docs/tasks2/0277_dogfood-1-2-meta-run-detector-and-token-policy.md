---
template: feature-impl
schema_version: 1
name: "Dogfood @1.2 meta-run detector and token policy"
description: ""
status: done
type: task
profile: standard
feature_id: H4
parent_wbs: null
priority: P1
tags: ["workstream:dogfood", "impl", "dogfood-1.2"]
dependencies: ["0276"]
created_at: "2026-07-17T01:13:59.542Z"
updated_at: "2026-07-28T00:32:12.422Z"
---

## 0277. Dogfood @1.2 meta-run detector and token policy

### Background
**Type:** feature-impl · **Feature:** N · **Package:** dogfood @1.2 Impl B (from 0274)

**Goal:** Harden pipeline-driving detection and add meta-run token policy so dogfooding Spur itself costs less and fails safer.

**Authority:** 0274 W7-W9; 0273 D6, D7, D9.

**Depends on:** 0276 (protocol @1.2 strings/checklist stable).
### Requirements
- [x] R1. Pipeline-driving detector uses word-boundary matchers for --next, dev-run, runall, wrap/wrapall, idea — not leading-space only (W7/D6).
- [x] R2. Unit cases for detector true/false positives (as specified in 0274 tests section).
- [x] R3. Meta-run policy: when pipeline-driving and a derived step is full implement, emit warning; recommend observe-only or step-split (W8/D7).
- [x] R4. Cost segmentation guidance for implement-heavy steps (protocol vs implement work) in skill and/or report-template (W8).
- [x] R5. Document expected --next chain stop-at-testing when provenance missing (W9/D9); do not change lifecycle code in this task.
- [x] R6. Tests green; no regression of 0276 fixtures.
### Acceptance Criteria
```gherkin
@core
Scenario: Detector catches dev-run without leading space
  Given testee string containing dev-run
  When pipeline-driving detection runs without explicit --max-retry
  Then the refuse message is emitted

@core
Scenario: Implement-heavy pipeline dogfood warns
  Given a pipeline-driving testee whose derived steps include full implement
  When Phase 1 completes step derivation
  Then an advisory recommends observe-only or step-split
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. Confirm 0276 done / @1.2 strings present.
2. Rewrite detector + tests.
3. Add implement-step warning + Cost segmentation docs.
4. Gotcha for provenance/--next.
5. Solution change-map; run tests.
### Solution

**File:line citations:**
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:1-78` — detector + PIPELINE_TOKENS.
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:1-124` — 30 tests.
- `plugins/sp/skills/dogfood-testing/SKILL.md:112-118` — Phase 2 implement-heavy advisory.
- `plugins/sp/skills/dogfood-testing/SKILL.md` `## Cost segmentation for implement-heavy steps` — W8 section.
- `plugins/sp/skills/dogfood-testing/SKILL.md` `## \`--next\` chain stop-at-testing` — W9 section.
- `plugins/sp/skills/dogfood-testing/references/report-template.md:129-133` — chained-step cost rule.
- `plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:97-112` — chained-step rows subsection.
- `plugins/sp/commands/dev-dogfood.md` Arguments `--max-retry` row + Behavior section.
### Testing
**Verification:** `/sp-dev-verify 0277 --auto --next --force --focus all --fix all` dogfood re-run 2026-07-17 (standalone path; task already `done` — `--force` re-audit).

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `detect-pipeline-driving.ts:37-76` word-boundary `(?<![\w-])…(?![\w-])`; tokens include `--next`, `dev-run*`, bare `run`/`wrap`/`idea`. Slash form `/sp:dev-run` detected without leading space. |
| R2 | MET | `pipeline-detect.test.ts` — 30 tests: positives, true negatives, false-positive guards, leading-space invariance, PIPELINE_TOKENS pin. `bun test plugins/sp/tests/dogfood-testing/` → 42/42 this run. |
| R3 | MET | `SKILL.md:112-118` Phase 2 implement-heavy advisory; Gotcha 9 (`SKILL.md:235-243`) recommend observe-only or step-split. |
| R4 | MET | `SKILL.md:253-274` Cost segmentation table (driver vs chained-step); `report-template.md:129-133`; `monitor-ledger.md:97-112` chained-step rows. |
| R5 | MET | `SKILL.md:276-302` `--next` chain stop-at-testing when provenance missing; no lifecycle code changed (R5). |
| R6 | MET | `bun test plugins/sp/tests/dogfood-testing/` 42 pass; `bun test plugins/sp` 219 pass; 0276 report-contract fixtures still green. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Detector catches dev-run without leading space | MET | test | `positive: dev-run slash form` + leading-space-invariant — `detectPipelineDriving('/sp:dev-run 0125 --auto')===true`; refuse prose `SKILL.md:72-77` when `--max-retry` omitted |
| Scenario: Implement-heavy pipeline dogfood warns | MET | static-ref | Advisory via Phase 1.2b live CLI (`detect-pipeline-driving.ts --steps`); closed d357faf / reinforced 0278 |

**Design conformance:** `### Design` bare; Solution maps to 0274 W7–W9. Claims DONE: detector helper, tests, meta-run policy prose, cost segmentation, stop-at-testing docs. No silent deviation.

**SECUA (focus=all):** pure detector + docs. No secrets/injection. Lookbehind regex ES2018+ (Bun OK). No blockers/majors. Advisory: detector is unit-tested but agent-invoked by prose (not auto-imported into a CLI gate) — intentional for 0277 protocol layer.

**Coverage:** `detect-pipeline-driving.ts` 100% fn/lines this run.

**Fix pass (`--fix all`):** R/AC all MET. Gate residual: L3 Review lacked populated P1–P4 table (blocks `--next` strict-core) — fixed in dogfood fix-pass (Review rewrite); see Issues in dogfood report.

Verdict: PASS
### Review
**Review scope:** detector helper + tests + dogfood skill/command prose (0277 W7–W9). Re-audited during `/sp-dev-verify 0277 --force` dogfood (2026-07-17). Prior Review was prose-only without a populated P1–P4 table — L3 strict-core failed until this rewrite.

**Functional traceability:** R1–R6 MET (see Testing). AC scenarios MET (detector tests + policy static-ref).

**Priority findings (P1–P4)**

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P1 | — | — | none — no blockers |
| P2 | — | — | none — no majors |
| P3 | usability | `SKILL.md` W8 | **Closed in d357faf / 0278:** Phase 1.2b CLI emits implement-heavy advisory after step derivation (`--steps`). Residual: step-split recipe + self-validate landed in 0278. |
| P3 | architecture | `detect-pipeline-driving.ts` | **Closed in d357faf:** live CLI gate `bun …/detect-pipeline-driving.ts` is Phase 1.0 SSOT (not prose-only). |
| P4 | correctness | `PIPELINE_TOKENS` order | Token order pinned by test for stable diagnostics; matcher is order-independent. |

**SECUA:** PASS — pure string matchers; no I/O; ES lookbehind OK under Bun.

**Architecture:** PASS — pure helper, 100% coverage, zero coupling.

**Residual risk:** low. No lifecycle code changed (R5). Blast radius = dogfood skill prose + one pure function.

**Disposition:** PASS — requirements + AC verified; L3 Review table restored for strict-core.
### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-17T05:12:43.827Z todo → wip (system)
- 2026-07-17T05:13:23.568Z wip → testing (system)
- 2026-07-17T05:13:23.945Z testing → done (system)
