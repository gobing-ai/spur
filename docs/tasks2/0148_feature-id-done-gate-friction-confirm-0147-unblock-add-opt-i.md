---
template: standard
schema_version: 1
name: "feature_id done-gate friction: confirm 0147 unblock + add opt-in feature-link healing (not auto, not gate-time)"
description: ""
status: wip
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-28T23:29:00.250Z"
updated_at: 2026-06-29T00:10:39.989Z
---

## 0148. feature_id done-gate friction: confirm 0147 unblock + add opt-in feature-link healing (not auto, not gate-time)

### Background
**Operator observation.** Across `/sp:dev-verify`, the done-gate, and `sp:super-coder` runs, a
blank/missing `feature_id` repeatedly blocked tasks from reaching `done`. Proposed fix: an
LLM-as-judge mechanism in `sp:spur-dev` that heals the missing `feature_id` via `spur feature`,
wired into the agent + `dev-*` commands.

**Evaluation (2026-06-28), reconciled after operator pushback — auto-healing is NOT a design breach;
the right trigger is operator-chosen strictness, not gate-time automation.**

Verified behavior of `feature_id: null` (live, post-0147):

| Mode | feature_id finding | pass? | Used by |
|------|--------------------|-------|---------|
| plain `spur task check` | warning | True | ad-hoc |
| `--strict-core` | **warning** | **True** | the **real** done-gate (both lifecycle guards, `task.ts:651`) |
| `--strict` | **error** | **False** | **manual audit only** (`task.ts:411`); no lifecycle/dev-* path invokes it |

**Reconciled conclusions:**

1. **Nullable `feature_id` = deferral, not "permanently standalone."** Tasks may be created with a
   blank edge to postpone the feature decision; the warning is the standing TODO. (Operator's framing
   — correct; supersedes the earlier "benign/optional steady-state" read.)
2. **The default done-gate (`--strict-core`) does NOT require `feature_id`** — verified twice; a
   parentless task reaches `done` cleanly post-0147. So the *automated* flow never forces it, and the
   original blocker (the `--strict` fallback bug + unavailable adapter) is genuinely **closed by 0147**.
3. **`--strict` mode legitimately DOES require `feature_id`** — and when an operator opts into that
   rigor, filling the deferred edge is the natural consequence and deserves an assist. Today there is
   **no** assist: the operator hits a bare error with no help resolving it.
4. **Therefore healing is sound — scoped to the operator's strictness choice, not the gate.** The
   thing to reject is *silent, always-on, gate-time auto-create* (it would fight the `--strict-core`
   design and explode the 19-feature tree with synthetic single-task nodes vs. 17 parentless tasks).
   The thing to build is a **strictness-triggered, prefer-existing, confirm-before-apply link helper.**

**Refined trigger model:**

| When | Behavior |
|------|----------|
| plain / `--strict-core` (default) | warning + actionable hint; deferral allowed; no healing |
| operator runs/intends `--strict` rigor, OR explicitly asks to link | offer the LLM-judge link helper: match an EXISTING feature first, create only if none fits, confirm before applying |
| deliberate traceability audit (`spur task check --strict` across the corpus) | helper supports a **batch sweep**: list the N orphan tasks, propose a best-fit existing feature per orphan, apply confirmed links in one pass |

`spur feature {list,show,create}`, `spur task list --feature`, and `spur task update --feature <id>`
provide the primitives.

**Net effect (the design intent, operator-confirmed).** By the original design, `feature_id` is the
*only* thing standing between a task and a `--strict` PASS during a deliberate traceability audit.
This enhancement makes that an explicit operator **choice** at audit time — keep the edge blank
(accept the `--strict` finding; deferral is legitimate) **or** heal it via the assisted helper. The
default flow never forces the choice; strict rigor surfaces it with an assist instead of a wall.

Source: this session's 0143→0147 dogfood campaign; live re-verification + operator reconciliation 2026-06-28.
### Acceptance Criteria
```gherkin
Feature: strictness-triggered, opt-in feature_id link healing (never silent/gate-time)

  Scenario: Default gate keeps deferral legal (regression guard)
    Given a task with feature_id = null and a done-ready body
    When it transitions testing → done via the real --strict-core guard
    Then the transition succeeds (feature_id stays a warning, deferral allowed)

  Scenario: Actionable warning instead of a bare one
    Given spur task check reports L4 "Missing feature_id"
    When the operator reads it
    Then the message names the fix: spur task update <wbs> --feature <id> (or the heal helper)

  Scenario: Strict rigor triggers the link helper (single task)
    Given an operator runs (or intends) --strict-level traceability rigor on a parentless task
    When the feature_id error surfaces
    Then the sp:spur-dev link helper is offered (not silently applied)
    And it proposes the best-fit EXISTING feature first (create only if none fits)
    And it applies via spur task update --feature / spur feature ONLY on confirmation

  Scenario: Batch audit sweep across the corpus
    Given a deliberate traceability audit (spur task check --strict over all tasks) lists N orphans
    When the operator invokes the link helper in sweep mode
    Then it proposes a best-fit existing feature per orphan in one pass
    And the operator can confirm/skip/override per orphan before any link is applied
    And declining an orphan leaves its feature_id blank (deferral remains a valid choice)

  Scenario: The default done-gate never auto-heals
    Given any task transitioning through the default (--strict-core) done-gate or a --next chain
    When feature_id is null
    Then no feature is auto-created and no link is auto-applied
    And the contract treats feature_id as a warning, unchanged
```

- [ ] AC1 — Regression: a `feature_id: null` task transitions `testing → done` under `--strict-core` (deferral stays legal; the 0147 unblock is locked by a test).
- [ ] AC2 — The L4 "Missing feature_id" warning message is actionable (names `spur task update <wbs> --feature <id>` and the heal helper).
- [ ] AC3 — A **strictness-triggered, opt-in** LLM-judge link helper exists in `sp:spur-dev` (single-task): fires when the operator invokes/intends `--strict` rigor OR explicitly asks to link; matches an EXISTING feature first; creates only if none fits; confirms before applying via `spur feature` / `spur task update --feature`.
- [ ] AC4 — A **batch sweep** mode of the helper supports a deliberate audit: enumerate orphan tasks (`spur task list` / `--strict` audit), propose a best-fit existing feature per orphan, apply per-orphan confirmed links in one pass; declining leaves the edge blank (deferral preserved).
- [ ] AC5 — The default `--strict-core` done-gate and all `--next` chains are unchanged — NEVER auto-heal, NEVER auto-create. `super-coder.md` + `dev-*.md` reference the helper for discoverability only.
### Plan
Scoped to the **reconciled** design: deferral legal by default; healing triggered by the operator's
strictness choice; prefer-existing + confirm; never gate-time/automatic; single-task + batch-sweep.

- [ ] P1 (AC1) — Regression test in `apps/cli/tests/commands/task.test.ts` (next to the 0147 done-gate
      tests): a `feature_id: null` done-ready task passes the `--strict-core` `testing→done` gate.
      Locks the 0147 unblock so feature_id is never silently re-elevated into the default gate.
- [ ] P2 (AC2) — Make the L4 warning actionable in `packages/app/src/services/task-check.ts:242`:
      append the corrective path (`spur task update <wbs> --feature <id>`, or "run the sp:spur-dev
      feature-link helper"). Keep severity `warning`; update the message test. No DD-07 change.
- [ ] P3 (AC3) — Add the **strictness-triggered, opt-in single-task** feature-link helper to
      `sp:spur-dev` (reference section + sub-flow). Trigger: operator invokes/intends `--strict` rigor
      on a parentless task, OR asks to "link this task to a feature." Steps: (a) LLM-judge reads task
      Background/Requirements; (b) `spur feature list` → propose the best-fit **existing** feature with
      reasoning; (c) only if no node fits AND operator confirms → `spur feature create`; (d) apply via
      `spur task update <wbs> --feature <id>`; (e) ALWAYS show the proposal before any mutation.
      Boundary: NOT in the `--strict-core` gate, NOT in any `--next` chain, NOT automatic.
- [ ] P4 (AC4) — Add the **batch sweep** mode to the helper: enumerate orphans
      (`spur task list --json` filtered to `feature_id: null`, or the `--strict` audit set), propose a
      best-fit existing feature per orphan, and present a per-orphan confirm/skip/override list before
      applying any link. Declining an orphan leaves its edge blank (deferral preserved). Apply via
      `spur task update <wbs> --feature <id>` per confirmed orphan.
- [ ] P5 (AC5) — Reference the helper for discoverability in `plugins/sp/agents/super-coder.md` and the
      relevant `plugins/sp/commands/dev-*.md` (one line: "to resolve a deferred feature_id under strict
      rigor, use the sp:spur-dev feature-link helper — single-task or sweep"). Do NOT wire it into the
      DoD terminal gate or transitions; the default done contract stays feature_id-agnostic.
- [ ] P6 — Gate: `bun run lint && bun run test && bun run test-cf && bun run build` green; confirm the
      only done-gate-adjacent change is the warning-message text (no severity/behavior change).

**Dependency:** P1 builds on 0147 (done). P2–P5 are independent doc/skill + one message edit.
**Out of scope:** changing DD-07 severity, making `--strict` a lifecycle gate, or any automatic
gate-time feature creation.
### Solution

### Testing

### Review

### References

### History
- 2026-06-29T00:10:39.989Z backlog → wip (system)
