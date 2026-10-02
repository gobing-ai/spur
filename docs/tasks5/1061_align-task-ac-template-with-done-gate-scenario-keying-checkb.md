---
schema_version: 1
name: Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)
status: backlog
template: feature-impl
created_at: 2026-10-02T23:30:56.374Z
updated_at: "2026-10-02T23:40:56.047Z"
feature_id: F96

---

## 1061. Align task AC template with done-gate scenario keying (checkbox ACs key L4.uncovered-task-scenario)

### Background

**Origin:** D62 runall session (2026-10-02), dogfood finding F3-adjacent; task 1056's first done attempt was blocked by `L3.unchecked-checklist` + `L4.uncovered-task-scenario` (plus 2 bare anchors, separately fixed). 1053-1056 all had to convert their AC sections to freeform `- ACn:` rows mid-flight to pass the done gate; 1056's Review records the template mismatch as P3.

**Verified mechanics:**

- **Templates teach scenario-keyed checkbox ACs.** Every task template ships the same AC guidance — `config/templates/task/issue.md:30`, `feature-impl.md:30`, `brainstorm.md:30` (also `standard.md`, `review.md`, `meta.md`): "`- [ ] AC1 — <feature scenario title without its R-number>` bullets or `Scenario: AC1 — <title>` blocks; add `(req: R<n>)` to bind a task requirement; task-only checks go in prose below, or set `ac_altitude: task-local`."
- **The checker keys on that shape.** `packages/app/src/services/task-check.ts` — `:842` uncovered = requirement ids with no matching AC (`reqIds` vs `acIds`), `:850` message "Requirements with no Acceptance Criteria scenario", `:960` terminal-status open-checkbox check (`L3.unchecked-checklist`, 0182 R7), `:1812` uncovered-scenario loop. Finding codes in `packages/config/src/finding-codes.ts:60,151` (`L4.uncovered-task-scenario`).
- **1056's bind:** the owning feature (D62) was planned with gherkin ACs R1-R15 at feature time; refinement task 1056's work (persist-out subpath citation classification) corresponds to NO feature scenario, so scenario-titled ACs were impossible to write honestly. The template's escape hatches (`task-only checks in prose`, `ac_altitude: task-local`) exist in the comment but were either unknown or not obviously applicable at run time; the working corpus precedent became freeform `- ACn:` rows (apparently unkeyed → gate passes), which is undocumented as a sanctioned form.

**So the defect is not "template vs checker disagree" but:** three overlapping AC conventions — (a) scenario-titled checkbox rows (template-taught, checker-keyed, fail-closed), (b) freeform `- ACn:` rows (undocumented, what 1053-1056 actually shipped, gate-passing), (c) `ac_altitude: task-local` (template-documented escape, unused, semantics unpinned vs (b)) — with no decision table for which applies when, and refinement-batch tasks (the common runall case) structurally unable to satisfy (a).

**Excluded:** the L3 unchecked-checkbox gate itself (correct: check your boxes before done); the bare-anchor rule (fixed by 1055); the D62 corpus (already converted and done — do not touch).

### Requirements

1. **Pin the semantics** of all three AC forms against the checker's actual behavior: scenario-titled checkbox rows (keyed, matched against feature gherkin scenario titles), freeform `- ACn:` rows (confirm: unkeyed, always pass coverage?), `ac_altitude: task-local` (confirm: exempts feature-scenario matching, requires task-local checks in prose?). Source-verify each in `packages/app/src/services/task-check.ts`; label anything the source does not clearly define as a decision, not a fact.
2. **Write the decision table** for which form applies when: feature-scenario-bound work → (a); refinement/task-only work → (b) or (c) — recommend converging (b) and (c) into ONE sanctioned task-local form so the corpus does not carry two spellings of the same intent.
3. **Apply the smaller fix:** either update the template AC comments (`config/templates/task/*.md`) to teach the resolved convention (including the refinement-task case), or extend the checker if a form's behavior must change. Prefer template/docs when behavior is already correct; the checker stays fail-closed for requirements with genuinely no AC coverage.
4. **Document the resolved convention** in the owning surface (`docs/design/` task-corpus/design satellite or the ac-style-guide reference — `plugins/sp/skills/spur-dev/references/ac-style-guide.md` exists and is the likely owner) so the next runall batch does not rediscover this mid-flight.
5. **No silent corpus migration:** existing checkbox-AC tasks keep their semantics; existing freeform tasks (1053-1056) keep passing. If a migration is warranted it is a separate decision, not part of this task.

### Acceptance Criteria

- AC1: a decision table exists in the owning style guide covering all three AC forms with source-verified semantics, including the refinement-task case.
- AC2: a throwaway task created from the default template with scenario-bound ACs still requires real scenario matches (fail-closed canary passes), and a task-local-form task reaches `done` without AC-style rewrites; both evidenced by `spur task check` output on throwaway tasks (cleaned up after).
- AC3: 1053-1056 corpus tasks still pass their done checks after the change (`spur task check <wbs> --json` for each).
- AC4: template AC comments teach the resolved convention; checker behavior changed only if the decision table demanded it; `bun run spur-check` (or the feature-scoped pass) green on the touched workspaces.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

- Source verification first: read the AC-parsing paths in `packages/app/src/services/task-check.ts` (sections around :842, :960, :1812) and record per-form behavior in the task's Design Notes before changing anything.
- `(cd packages/app && bun test tests/services/task-check.test.ts)` — extend with per-form cases from the decision table; 192 existing tests must stay green.
- Canary checks: `spur task check 1053 --json` / `1054` / `1055` / `1056` before and after the change.
- Throwaway-task proof (AC2): `spur task create` + `spur task update --section` in a scratch state, run its check, record output, then delete the throwaway; do not leave corpus debris.
- If templates changed: `bun run corpus-check` affected inputs (T11), and `superskill install sp --dry-run` if plugin skill references moved.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
