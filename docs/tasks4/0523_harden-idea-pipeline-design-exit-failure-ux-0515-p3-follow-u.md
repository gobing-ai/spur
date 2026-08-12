---
schema_version: 1
name: "Harden idea-pipeline design-exit failure UX (0515 P3 follow-ups)"
status: cancelled
template: standard
created_at: 2026-08-12T04:34:06.681Z
updated_at: "2026-08-12T04:45:34.126Z"
---

## 0523. Harden idea-pipeline design-exit failure UX (0515 P3 follow-ups)

### Background
Task 0515's review (PASS, done) surfaced two P3 robustness gaps in `config/workflows/idea-pipeline.yaml` and
recommended follow-up tasks rather than a rework. Both are fail-closed (the underlying requirements hold) but
operator-hostile. This task is that follow-up — ticketed 2026-08-11 during the I2 verifyall re-audit, which
confirmed no task had been created for them.

**P3-1 — Dead-end on interactive design-exit check failure** (`config/workflows/idea-pipeline.yaml:500`,
`design-approval → decompose` guard). Interactive approve with a failing `spur feature check` dead-ends: the
`yes && check` edge fails, the remaining edges (`no`, `failed` cap, `cancelled`) do not match
`__hitlAnswer=yes`, and the engine fails the run with the generic `no-passing-transition` — no route back to
the ac-generate/feature-check retry loop, no message naming the stale AC. The auto path (`:487`) falls through
to design-approval on failure, where approving hits the same dead-end and rejecting routes to system-design,
never to AC fix.

**P3-2 — Vacuous `expectFile` on the design-review artifact** (`config/workflows/idea-pipeline.yaml:234-242`).
`system-design`'s onEnter shell pre-creates the skeleton before the agent runs, so `expectFile` passes even if
the agent no-ops and never fills `## Proposed design`. On the auto path (`design_approved=true` bypasses
design-approval) an unpopulated design can reach decompose with no downstream content check. Interactive mode
is covered by the human taste gate; the auto path is not.

Deliberately unlinked from feature I2 (status `done`) so the follow-up does not re-open a shipped feature's
completeness signals; re-link at intake if the operator prefers I2 ownership.
### Requirements
- [ ] **R1 — Route design-exit check failure back to AC repair.** Add a dedicated failure edge
      `design-approval → feature-check` guarded on `__hitlAnswer=yes` plus a failing
      `spur feature check $featureId` (feature-check already routes failures to ac-generate, capped at 3),
      mirroring the ac-generate capped-retry pattern. At minimum, if the edge is rejected at design time,
      document the failure mode in the transition description so an operator knows why the run died.
- [ ] **R2 — Prove the design artifact is populated before decompose.** Replace the vacuous `expectFile` on
      `...-idea-design-review.md` with real content proof on the auto path: an agent-written completion
      sentinel that `expectFile` asserts, or a post-agent shell action asserting a non-empty
      `## Proposed design` section (mirrors the `test -s` fail-closed pattern at
      `config/workflows/idea-pipeline.yaml:152-159`).
- [ ] **R3 — Regression coverage.** Extend `packages/app/tests/workflow/idea-pipeline-definition.test.ts` with
      focused assertions for the new failure edge and the non-empty-design proof; keep the change confined to
      `config/workflows/idea-pipeline.yaml`, its guidance, and tests — no new CLI surface, schema, or engine
      change.

**Non-goals:** rework of 0515's shipped contract (three-heading review artifact, Goal/Scope guard), engine
`onError` policy changes, retry edges for feature-create (P4, deliberate), and P4 prose-dedup notes.
### Acceptance Criteria
```gherkin
Feature: Idea-pipeline design-exit failure UX

  @core
  Scenario: R1 — A failed design-exit check routes to AC repair
    Given an interactive design-approval answer of yes with a failing spur feature check
    When the design-approval state evaluates its transitions
    Then a dedicated edge routes the run toward feature-check/ac-generate instead of no-passing-transition

  @core
  Scenario: R2 — An unpopulated design cannot reach decompose on the auto path
    Given system-design completes without filling the Proposed design section
    When the auto path advances with design_approved=true
    Then a content proof (completion sentinel or non-empty section assertion) fails the run before decompose

  @core
  Scenario: R3 — Regression tests pin both behaviors
    Given the new failure edge and design content proof
    When the idea-pipeline definition suite runs
    Then focused assertions cover both and no CLI surface or schema changed
```
### Q&A

<!-- Open questions and their resolutions. Delete if none. -->

### Design

<!-- Decision record — WHAT/WHY. Chosen approach + 1-line reason, rejected alternatives, key signatures (not bodies), invariants. ≤2 illustrative snippets MAX. -->

### Plan

<!-- Ordered checklist or table of implementation steps (not prose). The how-to-execute order within this one task. -->

### Solution

<!-- Change map — HOW/WHERE. A `file:line` table of every touched site, one sentence each; ≤8-line snippets only for non-obvious logic. NO full-function dumps. (Filled at `wip`/`testing`.) -->

### Testing

<!-- Test results + a numeric coverage claim, or explicit `N/A`. (Filled at `testing`.) -->

### Review

<!-- P1–P4 findings table (Severity / File / Finding / Recommendation). (Filled at `done`.) -->

### History
- 2026-08-12T04:45:34.126Z backlog → cancelled (system)
### Notes

**Cancelled as already-implemented (2026-08-11, `/sp:dev-refine 0523 --auto --depth ready`).**

Both 0515 P3 findings — and their regression coverage — are already landed at HEAD (commit
`19b5a049 feat(I2)` lineage); the task was authored from the pre-fix review text:

- **P3-1 (dead-end):** `config/workflows/idea-pipeline.yaml:628-634` adds the exact recommended
  `design-approval → feature-check` failure edge (`test "$__hitlAnswer" = yes && ! $spurBin feature check
  "$featureId"`), routing back through the ac-generate capped-retry loop on both the interactive and
  auto fallback paths (auto: `system-design → design-approval` at `:614-618`, then the same edge).
- **P3-2 (vacuous expectFile):** `config/workflows/idea-pipeline.yaml:247-251` adds the post-agent
  shell action asserting non-whitespace content under `## Proposed design` (awk+grep; comment cites
  `0515 P3-2`).
- **R3 (regression coverage):** `packages/app/tests/workflow/idea-pipeline-definition.test.ts:256`
  asserts the failure-edge guard; `:273` asserts the non-empty-design shell action — both green in
  the 2026-08-11 I2 verifyall re-audit (29/29).

Refinement to implement-ready depth is moot; no design or plan authored. If a future audit finds a
residual gap on these sites, reopen with the specific delta rather than the original finding text.

