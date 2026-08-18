---
template: standard
schema_version: 1
name: "Refuse-gate coverage for mutating --fix modes in dogfood detection"
description: ""
status: done
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-18T19:34:31.804Z"
updated_at: "2026-08-18T04:42:47.574Z"
---

## 0293. Refuse-gate coverage for mutating --fix modes in dogfood detection

### Background
The 2026-07-18 dogfood of `/sp:dev-verify 0280 --auto --next --force --focus all --fix all` (`docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md`, finding P2) showed that a verify leg carrying `--fix all` is a full tree-mutation source: the fix pass wrote 11 dataset files, edited a workflow, and made 2 corpus writes — the `--next` leg contributed nothing to that mutation. The follow-up change (same day) made `isImplementHeavyStep` treat mutating `--fix` modes as implement-heavy, so the W8 **advisory** now fires for such testees — but only when the testee is also pipeline-driving, because `detectImplementHeavy` short-circuits on `detectPipelineDriving`.

#### Residual gap

A testee with a mutating fix mode but **no pipeline token** — e.g. `/sp:dev-verify 0299 --force --fix all` (no `--next`) — currently gets **neither refuse nor advisory** from `evaluateDogfoodGate` (`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts`). The dogfood run then silently defaults to fix mode (`--max-retry 2`): driver `Edit`/`Write` fixes and the testee's own `--fix all` repairs mutate the same tree with no operator acknowledgment — exactly the dual-mutation attribution hazard the Phase 1.0 refuse gate exists to prevent for pipeline-driving testees.

A second, related honesty gap: the refuse message offers `--max-retry 0 (observe-only)` as the non-mutating option, but for a `--fix all` testee observe-only bounds **the driver only** — the testee still mutates the tree. The gate's messaging must not imply otherwise.
### Requirements
- R1 — `evaluateDogfoodGate` refuses (exit 2, refuse semantics unchanged) when the testee carries a mutating fix mode (`--fix all` or `--fix blockers-first`, boundary-guarded exactly as `hasMutatingFixMode` already implements) and `--max-retry` was not passed — with or without a pipeline-driving token. `--fix none` and testees without `--fix` are unaffected.
- R2 — Message honesty for fix-mode testees: when the refusal (or advisory) concerns a mutating `--fix` testee, the message states that `--max-retry 0` bounds the driver only and the testee's own `--fix` pass still mutates the working tree. Exact wording decided in Design; exported as a constant like the existing messages so tests assert the literal string.
- R3 — With `--max-retry` present, a mutating-fix testee emits the implement-heavy (W8) advisory even when no pipeline token is present (adjust `detectImplementHeavy`'s pipeline-driving precondition or add a parallel fix-mode path — Design decides; behavior is what R3 fixes).
- R4 — Contract tests extended in `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts`: (a) `--fix all` without pipeline token, no `--max-retry` → exit 2 + message; (b) `--fix blockers-first` same; (c) `--fix none` → clean proceed; (d) `--focus all` / `--prefix all` never match; (e) `--fix all` with `--max-retry` present → exit 0 + advisory; (f) all pre-existing pipeline-token cases unchanged.
- R5 — Docs updated same-commit (T3): `plugins/sp/commands/dev-dogfood.md` (`--max-retry` row + detection description) and `plugins/sp/skills/dogfood-testing/SKILL.md` (§Repo-mutation warning, §Pipeline-driving word-boundary contract) reflect that mutating `--fix` modes trigger the refuse gate via a boundary-guarded regex, not a new token in `PIPELINE_TOKENS`.
- R6 — Back-compat: `PIPELINE_TOKENS` and all existing word-boundary behavior unchanged; the full pre-existing test suite passes without modification (additions only).
### Acceptance Criteria
#### Scenario: Mutating fix mode without --max-retry is refused

- **Given** testee `/sp:dev-verify 0299 --force --fix all` (no pipeline-driving token)
- **When** the Phase 1.0 gate runs without `--max-retry-present`
- **Then** the CLI exits 2 and prints the fix-mode refuse message (including the driver-only scope of `--max-retry 0`)

#### Scenario: --fix none stays a clean proceed

- **Given** testee `/sp:dev-verify 0299 --fix none`
- **When** the gate runs without `--max-retry-present`
- **Then** the CLI exits 0 with no message

#### Scenario: Acknowledged fix-mode testee still gets the W8 advisory

- **Given** testee `/sp:dev-verify 0299 --force --fix all` and `--max-retry-present`
- **When** the gate runs
- **Then** the CLI exits 0 and prints the implement-heavy advisory

#### Scenario: Existing pipeline-token contract is unchanged

- **Given** the pre-existing pipeline-detect contract tests
- **When** the suite runs after the change
- **Then** every pre-existing case passes unmodified
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan
1. **Design** the message wording (R2) and where the fix-mode check joins the gate flow (extend refuse condition; advisory precondition per R3) — keep `hasMutatingFixMode` the single matcher.
2. **Implement** in `detect-pipeline-driving.ts`: gate condition, exported message constant(s), advisory path.
3. **Test** per R4 in `pipeline-detect.test.ts`; run the full dogfood test file.
4. **Document** same-commit per R5 (`dev-dogfood.md`, `SKILL.md`).
5. **Verify** via `/sp:dev-verify <this-wbs>`; evidence = test run + live CLI invocations for each scenario.
### Solution
Implemented R1–R6 in `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts` + tests + docs.

**Source (`detect-pipeline-driving.ts`)**
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:75` — exported `MUTATING_FIX_REFUSE_MESSAGE` constant (R2 honesty wording: `--max-retry 0` bounds the driver only; testee still mutates).
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:109` — exported `hasMutatingFixMode(step)` boundary-guarded regex (already existed as a private helper for `isImplementHeavyStep`; now surfaced for tests + the Phase 1.0 gate).
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:183` — `GateResult` gained `mutatingFix: boolean` so callers/tests can distinguish the two refuse sources.
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:222` — `evaluateDogfoodGate` pipeline-driving refuse branch (unchanged behavior; now feeds `mutatingFix` into the result).
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:232` — NEW refuse branch: `hasMutatingFixMode(testee) && !maxRetryPresent` → `MUTATING_FIX_REFUSE_MESSAGE` (no pipeline token required; R1).
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:178` — `detectImplementHeavy` no longer short-circuits on `!detectPipelineDriving`: a mutating-`--fix` testee now reports implement-heavy on its own (R3). `isImplementHeavyStep(testee)` already covered this via its `hasMutatingFixMode` branch; the fix was removing the pipeline-driving precondition before checking derived steps.
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:245` — advisory branch unchanged; reached by mutating-fix + maxRetry path via the new `detectImplementHeavy` behavior.
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:326` — CLI usage text updated: exit 2 now covers both refuse sources.
- `PIPELINE_TOKENS` array **unchanged** (R6) — mutating-fix is not a new token; it's a separate matcher.

**Tests (`pipeline-detect.test.ts`)**
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:9` — imported `MUTATING_FIX_REFUSE_MESSAGE`.
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:279` — added `describe('task 0293 — mutating --fix refuse gate (R4 a–f)')` block with 8 tests: (a) `--fix all` refuse; (b) `--fix blockers-first` refuse; (c) `--fix none` clean proceed; (d) `--focus all` / `--prefix all` never match; (e) `--fix all` + `--max-retry` → advisory (R3); (f) pipeline-token cases unchanged (R6) + `PIPELINE_TOKENS` not polluted. Plus `detectImplementHeavy` R3 test and a live-CLI-binary exit-2 test.

**Docs (R5, same-commit T3)**
- `plugins/sp/commands/dev-dogfood.md:35` — `--max-retry` row extended with the second refuse source; both refuse messages printed verbatim.
- `plugins/sp/commands/dev-dogfood.md:65` — detection description now covers (a) pipeline-driving and (b) mutating `--fix`.
- `SKILL.md:54` — `--max-retry` row in the skill arguments table.
- `SKILL.md:59` — repo-mutation warning now lists both independent mutation sources.
- `SKILL.md:81` — Phase 1.0 step 0 updated; prints whichever refuse message the CLI emits.
- `SKILL.md:318` — NEW `## Mutating --fix mode contract` section (placed after the pipeline-driving word-boundary contract). Notes `PIPELINE_TOKENS` unchanged (R5/R6).

**Back-compat (R6)**
- All 41 pre-existing tests in `pipeline-detect.test.ts` pass unmodified.
- Full `plugins/sp/` suite: 252/252 pass.
### Testing
Verified 2026-07-18 by `/sp:dev-verify 0293 --auto --next --force --focus all --fix all` (standalone inline; all evidence re-run fresh this session).

**Verdict: PASS**

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:235-246` refuse branch (`mutatingFix && !maxRetryPresent` → exit 2); live CLI: `--fix all` → exit 2 + msg, `--fix blockers-first` → exit 2, `--fix none` → exit 0 (no pipeline token in any) |
| R2 | MET | `MUTATING_FIX_REFUSE_MESSAGE` exported at `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:75-76`; live stdout matches the literal incl. "the testee still mutates the tree"; tests import + assert the constant (`plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:9`) |
| R3 | MET | `detectImplementHeavy` (`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:178-182`) checks `isImplementHeavyStep(testee)` before the pipeline-driving precondition; live CLI: `--fix all` + `--max-retry-present`, no pipeline token → exit 0 + W8 advisory |
| R4 | MET | `describe('task 0293 — mutating --fix refuse gate (R4 a–f)')` at `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts:280` (8 tests covering a–f); focused run 49 pass / 0 fail / 120 expect() |
| R5 | MET | `dev-dogfood.md` `--max-retry` row + detection description cover both refuse sources with verbatim messages; `SKILL.md` repo-mutation warning, Phase 1.0 step 0, and new §Mutating `--fix` mode contract (notes `PIPELINE_TOKENS` unchanged); same working-tree change set (T3) |
| R6 | MET | `PIPELINE_TOKENS` (`plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts:50-62`) unchanged; test-file diff 84 additions / 0 deletions; full `plugins/sp` suite 252 pass / 0 fail |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Mutating fix mode without --max-retry is refused | MET | command | live gate `--testee "/sp:dev-verify 0299 --force --fix all"` → exit 2 + mutating-fix refuse msg (driver-only scope wording present) |
| Scenario: --fix none stays a clean proceed | MET | command | live gate `--testee "/sp:dev-verify 0299 --fix none"` → exit 0, silent |
| Scenario: Acknowledged fix-mode testee still gets the W8 advisory | MET | command | live gate `--testee "/sp:dev-verify 0299 --force --fix all" --max-retry-present` → exit 0 + implement-heavy advisory |
| Scenario: Existing pipeline-token contract is unchanged | MET | test | `bun test plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` → 49 pass / 0 fail; test-file diff additions-only (84/0); regressions live-checked (`/sp:dev-run 0125 --auto` → exit 2 pipeline msg; `--focus all` / `--prefix all` → exit 0) |

**Design conformance:** `### Design` is an empty placeholder — no claims to classify; design decisions documented in `### Solution` instead (minor process note, non-blocking).

**SECUA (--focus all):** no blocker/major findings. Minor: (1) Solution wording "All 49 pre-existing tests" — pre-change bun count was 41 (17→25 `test()` blocks, +8 added; 49 is the post-change total); (2) empty `### Design` despite Plan step 1. Neither affects the verdict.

**Commands run (fresh this session, all green):**

- `bun test plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts --coverage` → 49 pass / 0 fail, 120 expect(); coverage 100% funcs / 97.66% lines (uncovered 359-362 = `import.meta.main` guard)
- `bun test plugins/sp/tests/dogfood-testing/` → 63 pass / 0 fail, 181 expect()
- `bun test plugins/sp/` → 252 pass / 0 fail, 798 expect()
- `bunx biome check` on both TS files → clean, no fixes
- 7 live gate invocations (AC1, AC1b, AC2, AC3, pipeline regression, `--focus all`, `--prefix all`) — exits and messages exactly as expected

Coverage: 100% functions / 97.66% lines on `detect-pipeline-driving.ts` (sole runtime surface changed; uncovered lines are the direct-execution guard exercised via the CLI-binary spawn test).
### Review
**Reviewed:** 2026-07-18 (SECUA `--focus all` during standalone `/sp:dev-verify 0293 --fix all --next`, dogfood-driven; review author = verifier, not implementer-of-record for this section).

| Prio | Area | Finding | Evidence | Residual / Action |
|---|---|---|---|---|
| P1 | Gate correctness | No blocker findings. Refuse branch, exported message constant, and advisory path verified by 8 contract tests (R4 a–f) and 7 live CLI invocations; boundary guards reject `--focus all` / `--prefix all`. | `detect-pipeline-driving.ts:235-246`, `pipeline-detect.test.ts:280`; live exits 2/0 exactly as contracted | None. |
| P2 | `--next` chain doc completeness | `dev-verify.md` §`--next` documents only the `--strict-core` guard; the live `testing→done` transition also runs the provenance guard and the Review L3 gate (this run was denied twice before satisfying them). Not a 0293 code defect — testee-level doc gap. | `plugins/sp/commands/dev-verify.md:85-94` vs live `GuardDeniedError` messages (provenance, Review L3) | Follow-up doc update filed via dogfood report findings. |
| P3 | Solution accuracy | Solution says "All 49 pre-existing tests pass unmodified"; pre-change bun-reported count was 41 (17→25 `test()` blocks, +8 added) — 49 is the post-change total. R6 substance unaffected (diff 84 additions / 0 deletions; suite green). | `git diff --numstat`; `git show HEAD:pipeline-detect.test.ts` test count | Optional 1-line Solution correction; not blocking. |
| P3 | Empty `### Design` | Plan step 1 deferred wording/flow decisions to Design; decisions were documented in `### Solution` instead and `### Design` stayed a placeholder. | task file `### Design` (comment only) | Process note; acceptable at this scope. |
| P4 | Coverage shape | 100% functions / 97.66% lines on the script; uncovered 359-362 is the `import.meta.main` direct-execution guard, exercised via the CLI-binary spawn test path instead. | focused `bun test --coverage` this session | None. |

**Residual risk:** `hasMutatingFixMode` matches exactly `all|blockers-first`. If a future mutating `--fix` mode is added to `dev-verify`/`dev-review`, the gate will not refuse it until the regex alternation is extended — the matcher is the single place to update (by design, R1).

**Disposition:** APPROVED — R1–R6 all MET with fresh command/test evidence; 4/4 acceptance scenarios covered; `plugins/sp` suite 252/252 green; biome clean. Verdict artifact: PASS.
### References
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts` — gate + `hasMutatingFixMode` (added 2026-07-18, advisory-only scope).
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` — contract tests to extend.
- `plugins/sp/commands/dev-dogfood.md`, `plugins/sp/skills/dogfood-testing/SKILL.md` — doc surfaces (T3 same-commit).
- `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md` — motivating run (finding P2; fix pass was the sole mutation source).
- Task 0277 — original W7/W8 word-boundary detector contract this extends.
- Task 0292 — sibling lifecycle-honesty work (verdict gate); no code overlap.
### History
- 2026-07-18T22:18:40.456Z backlog → todo (system)
- 2026-07-18T22:18:43.826Z todo → wip (system)
- 2026-07-18T22:18:49.289Z wip → testing (system)
- 2026-07-18T22:34:06.849Z testing → done (system)
