---
schema_version: 1
name: "Enforce analyze invariants: ordered phase intervals and absent-not-zero telemetry"
status: todo
template: feature-impl
created_at: 2026-08-26T05:38:44.955Z
updated_at: "2026-08-26T05:39:24.595Z"
feature_id: I81
priority: P2
tags: ["history", "analytics", "correctness", "telemetry"]
---

## 0677. Enforce analyze invariants: ordered phase intervals and absent-not-zero telemetry

### Background

Two analyze-side defects make the forensics artifact quietly untrustworthy, and both reports named them.

First, derived phase intervals include reversed timestamps. Measured on the current corpus: of 4,545 rendered phase records, **1,185 have `endedAt` earlier than `startedAt`**, 1,732 are zero-length, and only 1,628 are positively ordered. Every reversed sample carries `source: "todo"` — for example index 3, `startedAt 2025-11-16T04:06:03.855Z` against `endedAt 2025-11-16T04:03:59.672Z`. `render-forensics.ts:166` computes `Date.parse(endedAt) - Date.parse(startedAt)` with no ordering guard, so those rows enter elapsed-duration analysis as negative durations.

Second, unmeasured telemetry is rendered as zero rather than absent. The artifact warns that 44.2 billion ms "could not be attributed to llm/tool/idle because some durations were unmeasured", and the support matrix shows why: duration is recorded for 127,634 of 458,360 assistant steps, with AGY, Claude, Codex and Gemini at zero. Because absent reads as zero, the unattributed and idle buckets look like actionable findings when they are instrumentation gaps, and both reports had to spend a paragraph each warning readers not to act on them.

### Requirements
- [ ] R1. Add an ordering invariant to phase derivation: a phase whose `endedAt` precedes its `startedAt` must not enter elapsed-duration analysis as a positive interval, and must be recorded as invalid rather than silently emitted.
- [ ] R2. Investigate and record the derivation cause for the `source: "todo"` reversal before choosing between rejecting and marking — trace the boundary assignment for the cited sample indices (3, 10, 13, 14, 16) rather than guarding the symptom at the renderer.
- [ ] R3. Keep unmeasured duration and unmeasured provider usage as null through the artifact and the renderer; never coerce absent to zero.
- [ ] R4. Render an absent value as "not available" in the forensics output, distinct from a measured zero.
- [ ] R5. Keep the `stepSupport` matrix as the authoritative statement of what is measured, and make the unattributed-time warning reference it so a reader can tell an instrumentation gap from a workload category.
- [ ] R6. Do not fabricate values for sources that expose nothing — this task makes absence legible; the adapter mapping work is a separate task.
### Acceptance Criteria

```gherkin
@core
Scenario: R9 — A derived phase whose end precedes its start is rejected or explicitly marked
  Given a derivation input that would produce a phase with "endedAt" earlier than "startedAt"
  When the analyze stage derives phases
  Then that phase does not enter elapsed-duration analysis as a positive interval
  And the artifact records it as invalid rather than silently emitting a negative duration

@core
Scenario: R10 — Unmeasured telemetry is null, never zero
  Given a source whose assistant steps carry no measured duration and no provider usage
  When the analyze artifact and the forensics renderer present that source
  Then its duration and usage values are absent rather than zero
  And the rendered output shows "not available" for them
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

**Fix the derivation, not the renderer.** Adding `Math.max(0, …)` at `render-forensics.ts:166` would hide 1,185 broken rows rather than fix them, and every other consumer of `derived.phases` would still see the reversal. The guard belongs where the boundaries are assigned — that is the root-cause fix and the smaller diff across all callers, which is why R2 requires tracing the derivation before writing the guard.

The reversal is uniform in `source: "todo"`, which points at how todo-list records are paired into phase boundaries — most likely adjacent boundaries assigned from records that are not monotonically ordered by timestamp. The likely correct shape is to sort boundary candidates by timestamp before pairing, at which point the reversal cannot be constructed. If some inputs are genuinely unordered in the source data, then marking (an explicit `invalid: true` on the phase) is the honest outcome and the renderer skips them.

**Absent-not-zero is a type discipline, not a formatting choice.** The row columns are already nullable in SQLite; the coercion happens on the way out. The fix is to keep `number | null` through the aggregation and artifact types and let the renderer decide presentation, which also makes R4 a single formatting helper rather than a scatter of conditionals.

**Why this is worth doing before the adapter work.** Once absent renders as "not available", the next task's audit has a truthful baseline to measure against — and if it turns out a source genuinely emits nothing, the report already says so correctly without any adapter change.

**Reversibility.** Both changes are additive guards; reverting restores the current (wrong) output with no data rewrite.

### Plan

1. Trace phase derivation for sample indices 3, 10, 13, 14, 16 and record the actual boundary-assignment cause in the task's Solution section.
2. Apply the ordering fix at the derivation seam; if some inputs are irreducibly unordered, mark those phases invalid instead.
3. Update the forensics renderer to skip or explicitly label invalid phases rather than printing a negative duration.
4. Walk the aggregation and artifact types for duration and provider usage; keep `null` end to end where it is currently coerced to `0`.
5. Add the "not available" rendering helper and apply it to the affected columns.
6. Make the unattributed-time warning cite `stepSupport` so the gap is attributable.
7. Tests: a reversed-boundary input produces no positive interval; a null duration renders "not available" and a measured zero renders "0"; the warning names the support matrix.
8. Regenerate an artifact over the current corpus and confirm the reversed-interval count is zero (or fully marked); run `bun run lint`, `bun run test`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
