---
template: feature-impl
schema_version: 1
name: "spur feature check --strict reports PASS when a linked AC scenario is known-unsatisfied"
description: ""
status: done
type: task
profile: standard
feature_id: F3
parent_wbs: null
priority: P2
tags: ["cli", "gates", "feature-check", "traceability", "dogfood-followup"]
dependencies: []
created_at: "2026-07-26T23:50:31.191Z"
updated_at: "2026-07-27T05:29:30.088Z"
---

## 0340. spur feature check --strict reports PASS when a linked AC scenario is known-unsatisfied

### Background

From the 2026-07-26 dogfood (`docs/dogfood/2026-07-26-dev-verifyall-dogfood.md`, finding P2).

`spur feature check <id> --strict` validates that every feature AC scenario is **linked** to a task (DD-09 orphan-scenario check) but never asks whether the scenario is **satisfied**. The two diverged visibly on feature R2: the gate returned `R2: PASS` at a point when scenario R10 was documented UNMET in task 0335's own recorded verification, with the remaining work deferred to an unstarted follow-up task. A reader treating `feature check --strict` as "this feature is complete" would have been wrong, and this is the gate most likely to be read that way.

Evidence of satisfaction already exists in the corpus — per-task verdict artifacts (`.spur/run/<wbs>-verdict.json`) and the AC verification tables written into each task's `### Testing` section — so the gate has something to consult; it simply does not.

This needs a design decision before code: whether strict mode should consult verdict artifacts, whether an unsatisfied scenario is an error or a distinct 'linked but unverified' state, and how to treat scenarios whose covering task is still unstarted. Route through `sp:sys-architecture` before implementing.

### Requirements
R1. Decide and record (ADR entry or a `docs/design/` satellite, per the constitution routing) what `--strict` should assert about AC *satisfaction*, distinct from AC *linkage*. Name the evidence source it consults and the failure semantics.

R2. Distinguish at least three states per scenario rather than the current binary: linked-and-verified, linked-but-unverified (covering task not yet passed), and orphaned (no covering task).

R3. Preserve the current linkage check unchanged — this adds a dimension, it does not replace DD-09.

R4. Ensure a feature whose covering tasks are all `todo` cannot report a clean strict PASS as though the AC were met.

R5. Reproduce the R2 case as a regression test: a feature with full scenario→task linkage but a recorded UNMET scenario must not return a clean strict PASS.

R6. Non-goal: changing the non-strict check's behavior, or blocking feature transitions on this new signal without operator opt-in.
### Acceptance Criteria

```gherkin
Feature: spur feature check --strict surfaces AC satisfaction

  # R2 — three-state classification per scenario
  Scenario: Linked-and-verified scenario produces no finding
    Given feature A has AC scenario "alpha"
    And a linked task 0001 is done with a PASS verdict artifact
    And the verdict artifact lists requirement "alpha" as MET
    When spur feature check A --strict runs
    Then no L4 finding references scenario "alpha"

  # R2 — linked-but-unverified
  Scenario: Linked-but-unverified scenario emits an unverified finding
    Given feature A has AC scenario "alpha"
    And a linked task 0001 covers "alpha" but is at status todo
    When spur feature check A --strict runs
    Then an L4 finding names scenario "alpha" as linked-but-unverified
    And the finding is elevated to error under --strict

  # R2 — linked-but-unverified via verdict gap
  Scenario: Done task with no verdict artifact is treated as unverified
    Given feature A has AC scenario "alpha"
    And a linked task 0001 is done but has no .spur/run/0001-verdict.json
    When spur feature check A --strict runs
    Then an L4 finding names scenario "alpha" as linked-but-unverified

  # R2 — linked-but-unverified via UNMET requirement
  Scenario: PASS verdict with an UNMET matching requirement is unverified
    Given feature A has AC scenario "alpha"
    And a linked task 0001 is done with a PASS verdict
    And the verdict artifact lists requirement "alpha" as UNMET
    When spur feature check A --strict runs
    Then an L4 finding names scenario "alpha" as linked-but-unverified

  # R3 — orphan state unchanged (DD-09 preserved)
  Scenario: Orphaned scenario still emits the existing coverage warning, not the new unverified finding
    Given feature A has AC scenario "alpha"
    And no linked task covers "alpha"
    When spur feature check A runs without --strict
    Then the existing L4.uncovered-feature-scenario warning fires
    And no linked-but-unverified finding fires for "alpha"

  # R4 — strict blocks on all-unverified
  Scenario: A feature whose every covering task is todo cannot PASS --strict
    Given feature A has AC scenarios "alpha" and "beta"
    And linked tasks 0001 (todo) and 0002 (todo) cover them
    When spur feature check A --strict runs
    Then the result.pass is false
    And findings name both "alpha" and "beta" as linked-but-unverified

  # R6 — non-strict unchanged
  Scenario: Non-strict check does not block on unverified scenarios
    Given feature A has AC scenario "alpha"
    And a linked task 0001 is at status todo
    When spur feature check A runs without --strict
    Then result.pass remains true
    And the unverified finding is a warning, not an error

  # R5 — regression reproduction (the R2 dogfood case)
  Scenario: R2 regression — full linkage but recorded UNMET must not PASS --strict
    Given feature R2 has AC scenario "R10"
    And task 0335 is done with a PASS verdict
    And the verdict artifact lists requirement "R10" as UNMET
    When spur feature check R2 --strict runs
    Then result.pass is false
    And a finding names scenario "R10" as linked-but-unverified
```
### Q&A

**Q&A (auto-resolved; no operator input needed):**

- **Q: How is a "covering task" identified?** A: Via the existing DD-09 `checkAcCoverage` linkage — a task whose AC scenario title (normalized) matches the feature scenario, regardless of the task's `feature_id`. The new pass reuses the same coverage map; it does not redefine linkage.
- **Q: What if a scenario is covered by multiple tasks?** A: The scenario is `linked-and-verified` if ANY covering task is `done` AND has a matching MET verdict row. `linked-but-unverified` only if ALL covering tasks are unverified.
- **Q: What is the verdict artifact path?** A: `<repoRoot>/.spur/run/<wbs>-verdict.json` (the path `spur task verdict` writes to and `verifyall-aggregate` reads). `runDir` defaults to `<tasksDir parent>/.spur/run`.
- **Q: What if the verdict artifact is missing or malformed?** A: Treated as linked-but-unverified (graceful degradation — the operator's signal is "you haven't proven this," which is accurate).
- **Q: Does this change non-strict `feature check` behavior?** A: No (R6). The new finding is a warning in non-strict mode, consistent with DD-09 orphan warnings, and `pass` is unaffected.
- **Q: Why not propagate a per-scenario UNKNOWN through the verdict aggregate?** A: Rejected — keeps the binary strict PASS/FAIL contract; the operator-visible signal is "strict check failed on unverified scenarios," not a fourth verdict state.
- **Q: Does this block feature transitions (e.g., `feature advance`)?** A: Only if the operator passes `--strict` to the transition (the existing `strict` param in `feature advance`). No new blocking without opt-in.
- **Q: AC-N alias matching — what if the verdict uses scenario titles instead of AC-N ordinals?** A: Both are accepted. A requirement row matches if its `id` equals the normalized scenario title OR equals `AC-<ordinal>` where ordinal is the scenario's 1-based position in the feature AC.
### Design

**Decision (R1):** `--strict` consults per-task verdict artifacts (`.spur/run/<wbs>-verdict.json`) to classify each AC scenario into three states (R2). Evidence source = the same verdict artifacts `spur task verdict` writes and the done-transition guard reads — no new artifact format. Failure semantics: **warning by default, error under `--strict`** (mirrors the existing DD-09 orphan-scenario severity contract; R6 preserves non-strict).

**Three-state classification (R2):**
- **linked-and-verified** — at least one covering task is `done` AND has a verdict artifact with `verdict: PASS` AND the matching requirement row has `status: MET`. Matching is by normalized scenario title → requirement id (same normalization `checkAcCoverage` uses; a requirement `id` equal to the scenario title or its `AC-N` alias counts).
- **linked-but-unverified** — a covering task exists but is not `done`, OR is `done` with no verdict artifact, OR the verdict is PARTIAL/FAIL, OR the matching requirement row is UNMET/PARTIAL/absent.
- **orphaned** — no covering task (existing DD-09 `L4.uncovered-feature-scenario` behavior, unchanged — R3).

**Severity contract:**
- Non-strict: unverified scenarios emit `L4.scenario-unverified` as a **warning** (consistent with DD-09 orphans being warnings). `pass` stays true. (R6)
- `--strict`: unverified findings elevate to **error**, so `pass` becomes false when any linked-but-unverified scenario exists. (R4)
- Orphan findings keep their existing severity (warning, never error) in both modes — R3.

**Implementation surface:**
- `packages/app/src/services/feature-check.ts` — extend `runL4` with a new `checkScenarioSatisfaction` pass that runs after the existing coverage-orphan computation. Needs the repo root (to resolve `.spur/run/`) — derive from `tasksDir` parent (already passed) or accept a new `runDir` option.
- `packages/config/src/finding-codes.ts` — add `L4.scenario-unverified` code + constant.
- `packages/app/src/services/planning-check-base.ts` — `summarizeWithStatus` already honors `severityOverrides`; `--strict` already elevates warnings via the existing path. Verify the new code is treated as warning→error under strict (it is, by default severity policy).

**Invariant:** linkage check (DD-09) is unchanged. The new pass is strictly additive — it runs only when scenarios are linked (orphan path short-circuits first). A scenario is classified at most once: orphan takes precedence over unverified.

**Match detail (requirement row lookup):** A scenario is "MET" when any covering task's verdict artifact has a `requirements[]` entry whose `id` matches the scenario title (normalized) OR matches an `AC-N` alias derived from the scenario's ordinal position in the feature AC, with `status === 'MET'`. This tolerates both naming conventions seen in the corpus (`AC-N` ordinals and title-named requirements).

**Non-goal (R6):** non-strict check behavior unchanged; no feature-transition blocking without operator opt-in (`--strict`).

**Open question resolved:** "How to treat scenarios whose covering task is still unstarted?" → **linked-but-unverified** (the task exists but hasn't passed verification). This is exactly the R2 dogfood case.

**Rejected alternative:** Propagate a fourth `UNKNOWN` state through the gate. Rejected — keeps the binary strict PASS/FAIL contract; unverified is an error under strict, which is the operator-visible signal.
### Plan

**Plan (single-feature, single-pass implementation):**

1. **Add finding code** — `packages/config/src/finding-codes.ts`: add `L4.scenario-unverified` to the `ALL_FINDING_CODES` registry with default severity `warning` and constant `SCENARIO_UNVERIFIED`.
2. **Implement classification** — `packages/app/src/services/feature-check.ts`:
   - Add private `checkScenarioSatisfaction()` method called from `runL4`, after the existing `checkAcCoverage` call.
   - For each linked scenario (those with a covering task — i.e., NOT orphaned), determine if any covering task is `done` AND has a verdict artifact whose matching requirement row is `MET`.
   - Emit `L4.scenario-unverified` warning for each linked-but-unverified scenario.
   - Accept a new `runDir` option (default `<tasksDir parent>/.spur/run`) to locate verdict artifacts; fall back gracefully (missing dir → all linked scenarios are unverified).
3. **Verdict artifact reader** — small helper in feature-check (or shared in planning-check-base if reused later): `readVerdictArtifact(runDir, wbs): VerdictArtifact | null`. Parses `<runDir>/<wbs>-verdict.json`, returns `{verdict, requirements: [{id, status}]}` or `null` on missing/malformed.
4. **CLI plumbing** — `apps/cli/src/commands/feature.ts`: pass `runDir` through to `svc.check()`. Derive default from `tasksDir` parent (the monorepo convention).
5. **Tests** — `packages/app/tests/services/feature-check.test.ts`:
   - One test per R2 state (linked-and-verified clean; linked-but-unverified via todo/done-no-verdict/done-PASS-UNMET/done-FAIL).
   - R3 regression: orphan scenario emits existing `uncovered-feature-scenario`, not the new code.
   - R4: all-unverified → `pass: false` under `--strict`.
   - R6: non-strict preserves `pass: true` with warning-only.
   - R5 dogfood: PASS verdict with UNMET matching row → strict FAIL (the original bug).
6. **Verify** — `bun run lint && bun run typecheck && bun run test` (full monorepo gate). Smoke: `bun run apps/cli/src/index.ts feature check F3 --strict --json` on the current corpus.
7. **Transition to done** — `spur task update 0340 --status testing → done` with provenance override (no pipeline run in `--auto` refine flow).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review
| P | Severity | Finding | Evidence | Action |
|---|----------|---------|----------|--------|
| P1 | HIGH | `checkScenarioSatisfaction` builds a fresh AC block per scenario (`Feature: x\n  Scenario: <title>`) to leverage `checkAcCoverage`. The synthetic body has no Given/When/Then — if `checkAcCoverage` ever validates Gherkin structure this breaks silently. | `packages/app/src/services/feature-check.ts:531` | Verified `checkAcCoverage` only normalizes titles (DD-09), does not parse steps. Safe but fragile; left a comment marking the contract. |
| P2 | MED | Coverage decision used the wrong field (`uncovered` vs `orphans`). First iteration made empty-AC tasks look "covering", producing a false-positive `L4.scenario-unverified` on existing P3 dogfood test. | `feature-check.test.ts:1245` failure → `feature-check.ts:532` | Fixed: now checks `!taskCov.orphans.includes(sc.title)`. Empty-AC tasks no longer falsely cover a scenario. Regression covered by the unchanged P3 dogfood test (45 → 47 pass). |
| P3 | MED | Verdict-requirement match allows AC-N alias OR normalized-title match, but `normalizeTitle` is from `@gobing-ai/spur-domain` — divergent normalization between writer (`task verdict`) and reader (`feature check`) would silently mismatch. | `feature-check.ts:573` | Both call the same exported `normalizeTitle`; no skew. Added `alias: AC-N` indexing (1-based ordinal) so verdict rows keyed either way resolve. |
| P4 | LOW | `runDir` defaults to `dirname(tasksDir)/.spur/run`. If a caller passes a non-standard layout (tasksDir nested deeper), the default misses artifacts. | `feature-check.ts:481` | All current callers (`feature advance`, tests) use `<root>/tasks` so `dirname` resolves to `<root>` correctly. Documented in option JSDoc; no caller fix needed. |


Implementation satisfies R1–R6. Three-state classification (linked-and-verified / linked-but-unverified / orphaned) is consistent with DD-09 orphan detection. Severity contract: non-strict emits `warning` (pass stays `true`); `--strict` elevates to `error` via `severityOverrides` (pass becomes `false`). Orphans remain on the existing uncovered-scenario path and never trigger the new finding.


- R2 linked-and-verified (done + PASS + MET → no finding)
- R2 linked-but-unverified: todo + no verdict → unverified finding
- R2 done task with no verdict artifact → unverified finding
- R2 PASS verdict + UNMET matching requirement → unverified finding
- R3 orphan regression: orphan still emits `L4.uncovered-feature-scenario`, NOT `L4.scenario-unverified`
- R4 strict elevation: todo tasks → `pass === false` under `--strict`, `pass === true` without
- R5 dogfood regression: PASS verdict + UNMET requirement → unverified fires (R2 case still detected)
- Multi-task: any covering task MET-certified → linked-and-verified (no finding)
- Both-tasks-todo: both scenarios linked-but-unverified


- `bun run lint` — clean (538 files, 0 errors)
- `bun run typecheck` (7 workspaces) — exit 0
- `bun run test` — 3692 pass / 0 fail / 11161 expect() calls; coverage gate met
### References

F3

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-27T05:17:03.867Z todo → wip (system)
- 2026-07-27T05:29:29.560Z wip → testing (system)
- 2026-07-27T05:29:30.088Z testing → done (system)
