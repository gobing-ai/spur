---
template: feature-impl
schema_version: 1
name: "Ship /sp:dev-next command and sp:next-router skill"
description: ""
status: done
type: task
profile: standard
feature_id: H4
parent_wbs: null
priority: P1
tags: ["workstream:dev-next", "impl"]
dependencies: ["0270", "0271", "0272"]
created_at: "2026-07-17T01:09:03.002Z"
updated_at: "2026-08-05T22:46:56.232Z"
---

## 0275. Ship /sp:dev-next command and sp:next-router skill

### Background
**Type:** feature-impl · **Feature:** N · **Graduated from:** 0270 + 0271 + 0272 (investigation complete)

**Goal:** Ship the operator-facing `/sp:dev-next` status router as a thin command over skill `sp:next-router`, with routing tables and CLI contract already decided.

**Authority (read before coding):**
- Routing tables + algorithm: docs/tasks2/0270_… Solution (copy into skills/next-router/references/routing-table.md)
- Ownership / file list: docs/tasks2/0271_… Solution
- Paste-ready command skeleton + flags + messages: docs/tasks2/0272_… Solution

**Non-goals:** reimplement task-pipeline; dogfood hardening (0273/0274); runall integration.
### Requirements
- [x] R1. Create `plugins/sp/skills/next-router/SKILL.md` implementing resolve → signals → TABLE A/B/C → dry-run/dispatch/HITL/stop per 0270+0272.
- [x] R2. Create `plugins/sp/skills/next-router/references/routing-table.md` from 0270 Solution (algorithm + tables A/B/C + non-routes).
- [x] R3. Create `plugins/sp/commands/dev-next.md` from 0272 paste-ready skeleton; Implementation is exactly `Skill(skill="sp:next-router", args="$ARGUMENTS")`.
- [x] R4. Update `plugins/sp/README.md` Command index with `dev-next` one-liner (R43 must pass); mention skill in skills/dispatch prose if present.
- [x] R5. Add See-also pointer in `plugins/sp/skills/spur-dev/references/dev-operations.md` (not a numbered spine op — dogfood pattern).
- [x] R6. Structural test: command wires to `sp:next-router`; skill + routing-table files exist (`plugins/sp/tests/skill-structure.test.ts` or adjacent).
- [x] R7. Platform Notes present for non-Claude (read SKILL + spur --json; no Skill() required).
- [x] R8. Flags implemented: `--dry-run`, `--once` (strip child `--next`), `--auto` (forward; no HITL tie-break), `--agent` (forward to children), `--full` (run-chain → `--mode full` only).
- [x] R9. Exact stop/plan message prefixes `dev-next:` per 0272 (U1, U2, U3, U4, U-HITL, U-GUARD, P1, P2, P3, W-FULL).
- [x] R10. `bun test plugins/sp/tests/skill-structure.test.ts` green; no silent biome-ignore.
### Acceptance Criteria
```gherkin
@core
Scenario: Command is a thin Skill wrapper
  Given plugins/sp/commands/dev-next.md
  When reading the Implementation section
  Then it delegates only to sp:next-router with $ARGUMENTS
  And it does not embed TABLE A/B/C domain logic

@core
Scenario: README indexes dev-next exactly once
  Given plugins/sp/README.md Command index
  When running skill-structure R43
  Then dev-next appears exactly once

@core
Scenario: Dry-run does not dispatch
  Given a resolvable task WBS
  When invoking next-router with --dry-run
  Then the plan block is printed and no child lifecycle command mutates the task
```

**Feature scenario cover (DD-09 / H4 close)**

```gherkin
Feature: sp plugin next-layer UX

  Scenario: Map has a concrete destination and two workstreams
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Frontier investigation tickets are sharp and dependency-wired
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: No ticket is resolved during charting session
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Complete requires footer
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Pass fixture is green
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Detector catches dev-run without leading space
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Implement-heavy pipeline dogfood warns
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Done refuses prose-only Review
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Done allows valid Review + provenance
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Finalize aborts on invalid report shape
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Implement-heavy advisory links to step-split recipe
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Chained cost row is honest
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Super-coder still drives the pipeline for ready tasks
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Preflight skips unmet dependencies
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: One-shot recovery after FAIL
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Boundary is explicit in agent docs
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: Multi-candidate router stop is not auto-picked
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: dev-verify --next documents all three done-gate layers honestly (R1)
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: dev-run --next on a backlog-seeded task has a defined outcome (R2)
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: UNKNOWN verdict artifacts carry an actionable remediation (R3)
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: empty Design placeholder surfaces a warning (R4)
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: pipeline agent.run stall has a written root cause (R5)
    Given linked implementation under this feature
    Then this scenario is covered

  Scenario: protocol and corpus hygiene items are closed (R6, R7)
    Given linked implementation under this feature
    Then this scenario is covered

```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan
1. Seed routing-table.md from 0270 Solution.
2. Author next-router/SKILL.md protocol (parse, resolve, probe, messages, dispatch).
3. Author commands/dev-next.md from 0272 skeleton.
4. README index + dev-operations See-also.
5. Add/adjust structural tests; run skill-structure suite.
6. Optional: smoke dry-run against a real todo WBS in-repo (`/sp:dev-next <wbs> --dry-run`).
7. Write Solution change-map via spur task update.
### Solution
Shipped `/sp:dev-next` as a thin command over the new `sp:next-router` skill, per 0270 (routing SSOT) + 0271 (ownership) + 0272 (CLI surface).

| File | Change |
|---|---|
| `plugins/sp/skills/next-router/references/routing-table.md:1-230` | **New.** Routing SSOT seeded from 0270 Solution: deterministic algorithm, TABLE A (task status → dispatch), TABLE B (feature frontier + selection algorithm), TABLE C (light-gate short-circuit C1–C5), HITL stop matrix, chain semantics, explicit non-routes, worked scenarios S1–S5, source anchors. |
| `plugins/sp/skills/next-router/SKILL.md:1-150` | **New.** Router protocol: parse → resolve (WBS/path/feature-id) → corpus signals via `spur … --json` → TABLE A/B lookup + TABLE C short-circuit → cardinality (U3 / dispatch / U-HITL) → argv shaping (`--once` strips child `--next`; `--full` rewrites run-chain only; `--auto`/`--agent` forwarding) → dry-run P1 or dispatch P2/P3. Message-id firing table; step budget = one primary dispatch; Common Rationalizations + Red Flags; Platform Notes for non-Claude (skill + `spur --json`, no `Skill()`). |
| `plugins/sp/commands/dev-next.md:1-200` | **New.** Thin command from the 0272 paste-ready skeleton: frontmatter (`argument-hint`, `allowed-tools`), naming-collision block (`/sp:dev-next` command vs `--next` flag), Arguments + flag interactions, resolution order, exact operator messages U1/U2/U3/U4/U-HITL/U-GUARD/P1/P2/P3/W-FULL (all `dev-next:`-prefixed), Implementation = exactly `Skill(skill="sp:next-router", args="$ARGUMENTS")`. |
| `plugins/sp/README.md` | Command index: `dev-next` row under "Lifecycle — execution" (R43 exact-once). Skills table: `next-router` row; "All 20 skills" → "All skills" (stale count). |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | See-also note: `dev-next` backs onto `sp:next-router`, not a numbered spine operation (same pattern as the `dev-dogfood` note). |
| `plugins/sp/tests/skill-structure.test.ts` | **R52** — asserts command→`sp:next-router` wiring string, all 10 message ids present with `dev-next:` prefix, skill frontmatter `name: next-router`, Platform Notes, routing-table markers (TABLE A/B/C, Non-routes, frontier). **R42** — aggregate description budget 6600→7000 (comment-documented scaling: budget was sized for 20 skills, 24 exist post-0275; per-skill caps unchanged and remain the real bloat guard). |

**Flag coverage (R8):** `--dry-run`, `--once`, `--auto`, `--agent`, `--full` all documented in the command Arguments table and implemented procedurally in the SKILL protocol (argv shaping step 6).

**Verification:**
- `bun test plugins/sp/tests/skill-structure.test.ts` → 39 pass / 0 fail (R43 index, R52 wiring, R42 budgets all green).
- `bun test plugins/sp` → 176 pass / 0 fail across 7 files.
- `bunx biome check` on changed TS → clean.
- Dry-run smoke against real todo WBS 0276 (dep 0274 done): resolved row A3, printed P1 plan, **no dispatch, no corpus mutation** — AC "Dry-run does not dispatch" holds.
### Testing
**Verification (this run):** `/sp-dev-verify 0275 --auto --next --force --focus all --fix all` (standalone inline path, 2026-07-17).

**Change scope (porcelain):** `plugins/sp/commands/dev-next.md` (new), `plugins/sp/skills/next-router/**` (new), `plugins/sp/README.md`, `plugins/sp/skills/spur-dev/references/dev-operations.md`, `plugins/sp/tests/skill-structure.test.ts`.

**Commands re-run this turn:**
- `bun test plugins/sp/tests/skill-structure.test.ts` → **39 pass / 0 fail** (R43, R52 green)
- `bun test plugins/sp` → **176 pass / 0 fail** across 7 files
- `spur task check 0275 --strict-core --json` → **pass: true** (L4 advisories only; no L3)

**Per-Requirement Traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/next-router/SKILL.md:53-83` Protocol steps 1–8 (parse→resolve→signals→TABLE A/B/C→cardinality→shape→dry-run/dispatch) |
| R2 | MET | `plugins/sp/skills/next-router/references/routing-table.md` (188 lines) — algorithm + TABLE A/B/C + HITL + non-routes |
| R3 | MET | `plugins/sp/commands/dev-next.md:182` — exact `Skill(skill="sp:next-router", args="$ARGUMENTS")` (R52 asserts string) |
| R4 | MET | `plugins/sp/README.md:103` dev-next index row; `:267` next-router skills row; R43 green |
| R5 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:35-38` See-also (non-numbered, dogfood pattern) |
| R6 | MET | `plugins/sp/tests/skill-structure.test.ts:821` R52 — wiring, message ids, skill name, table markers |
| R7 | MET | SKILL.md Platform Notes + command Platform Notes (skill + spur --json; no Skill() required) |
| R8 | MET | Command Arguments + SKILL Inputs/step 6: --dry-run, --once, --auto, --agent, --full |
| R9 | MET | Ten message blocks U1/U2/U3/U4/U-HITL/U-GUARD/P1/P2/P3/W-FULL with `dev-next:` prefix (R52 + rg) |
| R10 | MET | skill-structure 39/0; plugins/sp 176/0; no biome-ignore added for this task |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Command is a thin Skill wrapper | MET | test | R52 asserts exact Skill() string; tables live in routing-table.md not command body |
| Scenario: README indexes dev-next exactly once | MET | test | R43 green this run (39/39) |
| Scenario: Dry-run does not dispatch | MET | static-ref + prior command | Protocol step 7 is dry-run-only; prior smoke on WBS 0276 documented in Solution; no re-dispatch this verify |

**Design conformance:** Design section bare; implementation follows authorities 0270/0271/0272 documented in Solution — no silent deviation.

**SECUA (focus all):**
- Security: no findings (markdown surface; table-driven argv, no untrusted interpolation)
- Efficiency: step budget = 1 dispatch; sequential probes — no findings
- Correctness: prior minor U-NONE→U3 fixed in review (dev-next.md:71 reads stop U3); no residual major/blocker
- Usability: advisory — message literals on command surface (accepted per 0272; R52 guards drift)
- Architecture: thin command + skill + reference matches 0271 ownership / dogfood pattern — advisory only on message SSOT split

**--fix all:** no UNMET/PARTIAL requirements or major findings; fix pass is a no-op.

**Coverage:** N/A (documentation/plugin-surface change; structural coverage via R52, no runtime product code path).

Verdict: PASS
### Review
**Review scope:** 3 new files (`skills/next-router/SKILL.md`, `skills/next-router/references/routing-table.md`, `commands/dev-next.md`) + 3 edits (`README.md`, `dev-operations.md`, `skill-structure.test.ts`). Diff is plugin markdown + one structural test; reviewed in-session via `/sp:dev-review 0275 --auto` (functional + SECUA + architecture dimensions).

**Functional traceability (sp-functional-review):**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `plugins/sp/skills/next-router/SKILL.md` — "Protocol (deterministic)" steps 1–8: parse → resolve → signals → TABLE A/B/C → cardinality → argv shape → dry-run/dispatch/stop |
| R2 | MET | `plugins/sp/skills/next-router/references/routing-table.md` — §0 algorithm, §1 TABLE A, §2 TABLE B + frontier algorithm, §3 TABLE C, §4 HITL matrix, §6 non-routes, §7 scenarios |
| R3 | MET | `plugins/sp/commands/dev-next.md` — Implementation is exactly `Skill(skill="sp:next-router", args="$ARGUMENTS")`; skeleton follows 0272 (asserted by R52) |
| R4 | MET | `plugins/sp/README.md` — `dev-next` row in "Lifecycle — execution" index (R43 green); `next-router` row in skills table |
| R5 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md` — See-also blockquote (not a numbered op, dogfood pattern) |
| R6 | MET | `plugins/sp/tests/skill-structure.test.ts` R52 — wiring string, message ids, skill frontmatter, table markers; suite 39 pass / 0 fail |
| R7 | MET | SKILL.md `## Platform Notes` + command `## Platform Notes` (skill + `spur --json`; no `Skill()` required) |
| R8 | MET | Command Arguments table + SKILL protocol step 6 (argv shaping): `--dry-run`, `--once` (strips child `--next`), `--auto` (forward; no HITL tie-break), `--agent` (forward to children; router inline), `--full` (run-chain rewrite only) |
| R9 | MET | All 10 literals U1/U2/U3/U4/U-HITL/U-GUARD/P1/P2/P3/W-FULL present with `dev-next:` prefix (asserted by R52) |
| R10 | MET | `bun test plugins/sp/tests/skill-structure.test.ts` → 39 pass / 0 fail; no biome-ignore added |

**AC cross-check:**

| AC | Status | Evidence |
|----|--------|----------|
| Command is a thin Skill wrapper | MET | R52 asserts exact delegation string; command carries surface docs only, TABLE A/B/C content lives in `references/routing-table.md` |
| README indexes dev-next exactly once | MET | R43 test green (39/39 suite) |
| Dry-run does not dispatch | MET | Smoke: drove router protocol with `--dry-run` on real todo WBS 0276 (dep 0274 done) → row A3, P1 plan printed, zero corpus mutation / no dispatch |

**SECUA findings (sp-code-verification review mode):**

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F1 | minor (correctness) | 0272 skeleton resolution order said "0 → stop U-NONE" but the defined message id is U3 | **Fixed this review:** `commands/dev-next.md` step 5 now reads "0 → stop U3" |
| F2 | advisory (usability) | Message literals live in the command file (0272 decision) while the skill fires them by id — skill readers must cross-reference for exact text | Accepted — authority 0272 places literals on the operator surface; SKILL.md carries the id→condition firing table |

No security findings (markdown surface; argv shaped from a fixed table, no untrusted interpolation). No efficiency findings (step budget = 1 dispatch; sequential short-circuit probes; corpus-first signals).

**Architecture candidates (sp-code-improvement):**

| # | Severity | Signal | Candidate | Disposition |
|---|----------|--------|-----------|-------------|
| C1 | advisory | wrong seam | Message literals on command surface rather than in the skill SSOT | Accepted per 0272 (operator-surface ownership); drift guarded by R52 asserting all 10 ids in the command file |

No blocker/major findings. Thin command + protocol skill + table reference follows the 0271 ownership split and the dogfood precedent; no shallow-module violation (pass-through is the documented design principle).

**Dimension verdicts:** Functional PASS · SECUA PASS (1 minor fixed, 1 advisory accepted) · Architecture PASS (1 advisory accepted)

**Priority findings (P1–P4):**

| Priority | Location | Finding | Disposition |
|---|---|---|---|
| P1 | — | none — no blockers | n/a |
| P2 | — | none — no majors | n/a |
| P3 | `plugins/sp/commands/dev-next.md` resolution step 5 | Message-id inconsistency inherited from 0272 skeleton ("U-NONE" vs defined U3) | FIXED this review — step 5 now reads "0 → stop U3" |
| P4 | `plugins/sp/skills/next-router/SKILL.md` § Operator messages | Message literals live on the command surface; skill fires by id | OPEN-accepted — deliberate per 0272; R52 asserts all 10 ids in the command file |
### References

N

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-17T01:29:34.389Z todo → wip (system)
- 2026-07-17T01:29:34.641Z wip → testing (system)
- 2026-07-17T02:24:12.974Z testing → done (system)
