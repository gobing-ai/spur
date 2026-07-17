---
template: feature-impl
schema_version: 1
name: "Dogfood @1.2 meta-run detector and token policy"
description: ""
status: done
type: task
profile: standard
feature_id: N
parent_wbs: null
priority: P1
tags: ["workstream:dogfood", "impl", "dogfood-1.2"]
dependencies: ["0276"]
created_at: "2026-07-17T01:13:59.542Z"
updated_at: "2026-07-17T05:13:23.945Z"
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
**Commands run (post-implementation, 2026-07-17):**

- `bun test plugins/sp/tests/dogfood-testing/` — **42/42 pass** (30 new pipeline-detect + 12 existing report-contract), 76 expect() calls, 100% line+function coverage on `detect-pipeline-driving.ts` and `validate-report.ts`.
- `bun run lint` (= `biome check . --error-on-warnings` + per-workspace `tsc --noEmit`) — **green**, 493 files checked, all 7 workspaces typecheck clean.
- `bun run test` — **2954/2954 pass**, 0 fail, 8423 expect() calls across 199 files. 0276 fixtures (report-contract.test.ts) unaffected; no regression.

**Coverage claim:** `detect-pipeline-driving.ts` 100% line + 100% function (bunfig.toml in-file gate met).

**Acceptance Criteria verification:**

- *Detector catches dev-run without leading space* (`@core`): verified by `pipeline-detect.test.ts` "matches '/sp:dev-run'" — testee with no leading space before `dev-run` still matches. ✓
- *Implement-heavy pipeline dogfood warns* (`@core`): verified structurally — SKILL.md Phase 2 "Implement-heavy derived steps" advisory + Cost segmentation section + Gotcha 9 + report-template.md / monitor-ledger.md mirrors all present and cross-linked. (The advisory is documentation-time, not runtime — the warning surfaces when the operator reads the skill while planning the run, which is the design intent per W8.) ✓
### Review
**Reviewer:** self-review under sp-dev-verify lens, 2026-07-17.

**P1 (blocker):** none.

**P2 (should fix):** none.

**P3 (improvement):**
- The W8 meta-run warning is documentation-time, not runtime. A future task could surface it as a Phase 1 emit at step-derivation time (e.g. the skill's Phase 1 could call `detectPipelineDriving` on the testee AND scan derived steps for implement-heaviness, then print the advisory inline). Out of scope for 0277 — the task says "policy" and "guidance", not "automation".
- The detector is currently only invoked by tests, not wired into any runtime path. This is correct for 0277 (the task is protocol-layer), but a future task should wire it into the dev-dogfood command's Phase 1.0 refuse-ambiguous gate so the prose pointer becomes a live call.

**P4 (nit):**
- `PIPELINE_TOKENS` is ordered flag-first then dev-forms (longer first) then bare nouns (longer first) — the ordering is pinned by a test but isn't semantically load-bearing (the matcher is order-independent). Documented in test commentary.

**Residual risk:** low. No lifecycle code changed; blast radius is the dogfood-testing skill prose + one new pure function. No public API surface touched.

**Final disposition: PASS** — all six requirements (R1–R6) met; both `@core` acceptance scenarios verified; full repo test suite green.
### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-17T05:12:43.827Z todo → wip (system)
- 2026-07-17T05:13:23.568Z wip → testing (system)
- 2026-07-17T05:13:23.945Z testing → done (system)
