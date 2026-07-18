---
template: standard
schema_version: 1
name: "Refuse-gate coverage for mutating --fix modes in dogfood detection"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-18T19:34:31.804Z"
updated_at: "2026-07-18T19:35:24.074Z"
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

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- `plugins/sp/scripts/dogfood-testing/detect-pipeline-driving.ts` — gate + `hasMutatingFixMode` (added 2026-07-18, advisory-only scope).
- `plugins/sp/tests/dogfood-testing/pipeline-detect.test.ts` — contract tests to extend.
- `plugins/sp/commands/dev-dogfood.md`, `plugins/sp/skills/dogfood-testing/SKILL.md` — doc surfaces (T3 same-commit).
- `docs/dogfood/2026-07-18-sp-dev-verify-0280-dogfood.md` — motivating run (finding P2; fix pass was the sole mutation source).
- Task 0277 — original W7/W8 word-boundary detector contract this extends.
- Task 0292 — sibling lifecycle-honesty work (verdict gate); no code overlap.
### History
