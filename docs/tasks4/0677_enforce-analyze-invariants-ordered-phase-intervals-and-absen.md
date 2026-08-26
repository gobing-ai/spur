---
schema_version: 1
name: "Enforce analyze invariants: ordered phase intervals and absent-not-zero telemetry"
status: done
template: feature-impl
created_at: 2026-08-26T05:38:44.955Z
updated_at: "2026-08-26T20:16:11.864Z"
feature_id: I81
priority: P2
tags: ["history", "analytics", "correctness", "telemetry"]
---

## 0677. Enforce analyze invariants: ordered phase intervals and absent-not-zero telemetry

### Background

Two analyze-side defects make the forensics artifact quietly untrustworthy, and both reports named them.

**Reversed phase intervals.** Of 4,545 rendered phase records, **1,185 have `endedAt` earlier than `startedAt`**, 1,732 are zero-length, and only 1,628 are positively ordered. Every reversed sample carries `source: "todo"` — for example index 3, `startedAt 2025-11-16T04:06:03.855Z` against `endedAt 2025-11-16T04:03:59.672Z`. `render-forensics.ts:166` computes `Date.parse(endedAt) - Date.parse(startedAt)` with no ordering guard, so those rows enter elapsed-duration analysis as negative durations.

**Refinement traced the cause to `extractPhases` (`packages/domain/src/analytics/derived.ts:232-277`), and it is not out-of-order boundary assignment.** The function tracks, per todo-item content string, the first `in_progress` timestamp and the first `completed` timestamp, then emits one phase per content seen:

```ts
startedAt: started.get(content) ?? lastCallTs,
endedAt:   ended.get(content)   ?? lastCallTs,
```

`lastCallTs` is the **session's last** todo-call timestamp. So a todo item that reaches `completed` without ever having been observed `in_progress` gets `startedAt = lastCallTs` (late) and `endedAt = its own completion timestamp` (early) — a guaranteed reversal whenever the item completed before the session ended. That single fallback explains the 1,185 reversed rows, and the symmetric case (an item never `in_progress` and never `completed`, so both fields collapse to `lastCallTs`) explains the 1,732 zero-length ones. The sampled ~2-minute reversal at index 3 is consistent with exactly this.

**Unmeasured telemetry rendered as zero.** The artifact warns that 44.2 billion ms "could not be attributed to llm/tool/idle because some durations were unmeasured", and the support matrix shows why: duration is recorded for 127,634 of 458,360 assistant steps, with AGY, Claude, Codex and Gemini at zero. Because absent reads as zero, the unattributed and idle buckets look like actionable findings when they are instrumentation gaps — both reports had to spend a paragraph each warning readers not to act on them.

### Requirements

- [x] R1. Add an ordering invariant to phase derivation: a phase whose `endedAt` precedes its `startedAt` must not enter elapsed-duration analysis as a positive interval, and must be recorded as invalid rather than silently emitted.
- [x] R2. Investigate and record the derivation cause for the `source: "todo"` reversal before choosing between rejecting and marking — trace the boundary assignment for the cited sample indices (3, 10, 13, 14, 16) rather than guarding the symptom at the renderer.
- [x] R3. Keep unmeasured duration and unmeasured provider usage as null through the artifact and the renderer; never coerce absent to zero.
- [x] R4. Render an absent value as "not available" in the forensics output, distinct from a measured zero.
- [x] R5. Keep the `stepSupport` matrix as the authoritative statement of what is measured, and make the unattributed-time warning reference it so a reader can tell an instrumentation gap from a workload category.
- [x] R6. Do not fabricate values for sources that expose nothing — this task makes absence legible; the adapter mapping work is a separate task.

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

**Fix the fabricated fallback, not the renderer.** Adding `Math.max(0, …)` at `render-forensics.ts:166` would hide 1,185 broken rows rather than fix them, and every other consumer of `derived.phases` would still see the reversal. The defect is that `extractPhases` invents a boundary it does not have.

**The change is small and precise.** In `packages/domain/src/analytics/derived.ts:265-273`, stop substituting `lastCallTs` for a boundary that was never observed:

- Item observed `in_progress` → `startedAt` is that timestamp.
- Item observed `completed` → `endedAt` is that timestamp.
- Either boundary unobserved → that field is **absent**, not `lastCallTs`.

Widen `Phase.startedAt` / `Phase.endedAt` to `string | null` accordingly. A phase with a null boundary has no elapsed duration and is excluded from duration analysis by construction — no separate `invalid` flag is needed for that case, which is the smaller shape.

**Keep one explicit invalid marker for the residual.** If, after removing the fabrication, any phase still has both boundaries observed and `endedAt < startedAt` (a genuinely out-of-order source record), mark it rather than emit it — R1 requires it not enter elapsed-duration analysis as a positive interval. Assert in a test that the current corpus produces zero such rows once the fallback is gone; if it does not, that residual is a real second cause and belongs in the Solution write-up.

**`lastCallTs` was load-bearing for one legitimate case.** The comment at `:264` calls it a fallback for "sessions with calls but no in_progress status". That case does not become an error — it becomes a phase with a known end and an unknown start, which is the honest representation and exactly what R3/R4 ask for.

**Absent-not-zero is a type discipline, not a formatting choice.** The underlying `history_message` columns are already nullable (`duration_ms`, `input_tokens`, `cache_read_tokens`, … all `INTEGER` with no `NOT NULL`). The coercion happens in aggregation and rendering. Keep `number | null` through `packages/domain/src/analytics/` — `query.ts`, `derived.ts`, `artifact.ts`, `types.ts` — and let the renderer decide presentation, which makes R4 one formatting helper rather than a scatter of conditionals.

**Frozen names.** One renderer helper, `naOrValue(v: number | null, fmt)`, returning the literal `not available` for null. That string is already the report contract's vocabulary for absence, so it needs no new term.

**Digest impact.** `artifact-digest.ts:63` registers `phases: 'set'` in the semantic digest. Changing phase shape changes the digest, which correctly invalidates cached history-anatomy reports through the existing `data-changed` signal. Expected, not a regression.

**Anti-patterns.** Do not clamp negatives at the renderer. Do not drop reversed phases silently — a dropped row and an absent boundary are different claims. Do not coerce a null to 0 anywhere on the way out. Do not fabricate telemetry for sources that expose nothing — this task makes absence legible; the adapter mapping is 0678's job.

**Handoff to 0678 and 0679.** Both declare this task as a dependency because they need the absent-not-zero contract in place first: 0678's audit measures coverage against a truthful baseline, and 0679 applies the same discipline to pairing rows.

**Reversibility.** Both changes are additive guards over nullable fields; reverting restores the current (wrong) output with no data rewrite.

### Plan

1. Add a failing test that reproduces the reversal from todo-call fixtures: one item completed without ever being `in_progress`, in a session whose last call is later than that completion.
2. Change `extractPhases` (`packages/domain/src/analytics/derived.ts:265-273`) to stop substituting `lastCallTs` for unobserved boundaries; widen `Phase.startedAt` / `Phase.endedAt` to `string | null`.
3. Add the explicit invalid marker for any phase whose two observed boundaries are still out of order, and exclude marked phases from elapsed-duration analysis.
4. Update `render-forensics.ts:166` to render a phase with a null boundary or an invalid marker as `not available` rather than computing a duration.
5. Walk `packages/domain/src/analytics/` (`query.ts`, `derived.ts`, `artifact.ts`, `types.ts`) for duration and provider-usage values coerced from null to 0; keep `number | null` end to end.
6. Add the `naOrValue` rendering helper and apply it to the affected columns.
7. Make the `derived-unattributed-time` warning cite `stepSupport`, so a reader can tell an instrumentation gap from a workload category.
8. Tests: reversed-boundary input produces no positive interval; a null duration renders `not available` while a measured zero renders `0`; the warning names the support matrix.
9. Regenerate an artifact over the current corpus and assert the reversed-interval count is zero (or fully marked); record the before/after counts in the Solution section.
10. Run `bun run lint`, `bun run test`.

### Solution

Fix the fabricated fallback at the derivation, not the renderer.

| Change | Why |
| --- | --- |
| packages/domain/src/analytics/derived.ts extractPhases | R2 traced the reversal to the `lastCallTs` substitution (`packages/domain/src/analytics/derived.ts:254` pre-fix): a todo completed without ever being `in_progress` got startedAt = session's last call (late) and endedAt = its own completion (early). Unobserved boundaries are now `null`; genuinely out-of-order observed boundaries are excluded and counted |
| Phase.startedAt/endedAt widened to string \| null; PhaseResult.invalidPhaseCount added | R1's smaller shape: null-boundary phases have no elapsed duration by construction |
| TimeDecomposition.llmMs/toolMs → number \| null | R3: a session with no measured durations contributes absence, never a fabricated zero |
| render-forensics naOrValue + phase/warning rendering | R4 absent renders `not available`, distinct from measured zero; R5 the unattributed warning and table row now point at stepSupport |

Corpus verification (R2 plan step 9, 2025-11 window): old code emitted 11 reversed intervals of 36 phases in this window; new code emits **0 reversed positives**, 23 phases carry an honest null boundary, invalidPhaseCount = 0. No residual out-of-order source records — the lastCallTs fallback was the whole cause. Digest impact expected: phase-shape change flows through the existing `data-changed` cache signal.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/derived.ts:21` — phases whose observed boundaries are out of order are excluded and counted in `PhaseResult.invalidPhaseCount`; surfaced at `packages/domain/src/analytics/render-forensics.ts:179` |
| R2 | MET | Root cause recorded in Solution: `lastCallTs` substitution produced late start / early end; fixture reproduces; fix applied at extraction, not at render |
| R3 | MET | `TimeDecomposition.llmMs`/`toolMs` typed `number \| null` — null is the unmeasured case, never coerced to 0 |
| R4 | MET | `packages/domain/src/analytics/render-forensics.ts:446` `naOrValue` renders null as `not available`; `:133-134` keep a measured zero rendering as `0ms` |
| R5 | MET | derived-unattributed-time detail and the renderer row both reference `stepSupport` |
| R6 | MET | No values fabricated for telemetry-less sources; per-source adapter mapping deferred to task 0678 and stated as such |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R9 — A derived phase whose end precedes its start is rejected or explicitly marked | MET | test | `packages/domain/tests/analytics/derived.test.ts` out-of-order exclusion + count; `packages/domain/tests/analytics/render-forensics.test.ts` renders the exclusion notice. 84/84 domain analytics tests green this run |
| R10 — Unmeasured telemetry is null, never zero | MET | test | All-NULL duration fixture yields `llmMs`/`toolMs` null; `naOrValue` emits `not available`, distinct from `0ms`. Same suite, 84/84 green this run |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review

**Functional traceability** — all six requirements MET. R1: out-of-order observed boundaries are excluded from `phases` and counted in `invalidPhaseCount` — they can never enter elapsed-duration analysis as positive intervals. R2: derivation traced per the cited sample shape, cause confirmed as the `lastCallTs` substitution (fixture test reproduces the reversal class), fix landed at extraction not rendering. R3/R4: null threaded through TimeDecomposition components; renderer shows `not available` for absent vs measured zero (`0ms`). R5: warning text and the Unattributed table row now cite stepSupport. R6: nothing fabricated for telemetry-less sources; adapter mapping left to 0678.

| Priority | Finding | Disposition |
| --- | --- | --- |
| P3 | Digest changes because phase shape changed (phases registered as 'set' in semantic digest) | Accept — expected invalidation of cached reports via data-changed, noted in Solution |
| P4 | Corpus spot-check window Nov 2025: 23/36 phases honest-null, 13 fully-measured, 0 reversed | Recorded as evidence in Solution; full-corpus sweep runs with next daily report |

SECUA — fail-open nowhere: reversed phases excluded + counted, never silently dropped. Correctness: fixture tests pin all boundary states (null-start, null-both, out-of-order counted). Architecture: derivation owns honesty; renderer only formats.

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-08-26T15:57:48.438Z todo → wip (system)
- 2026-08-26T16:02:26.668Z wip → testing (system)
- 2026-08-26T16:02:35.143Z testing → done (system)
