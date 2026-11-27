---
schema_version: 1
name: Compute same-kind action ambiguity from the state total row count in the progress projection
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:45.245Z
updated_at: "2026-11-27T16:54:26.806Z"
feature_id: E721

estimate_hours: 1
priority: P1
---

## 1465. Compute same-kind action ambiguity from the state total row count in the progress projection

### Background

Feature E721 R2: when a workflow state's same-kind action rows map one-to-one onto the definition's actions, the projection must never report them as ambiguous.

`packages/app/src/workflow/progress-projection.ts` (~:505-530) computes `candidateRows` as same-kind rows **not yet used**:

```ts
const candidateRows = stateActionRows.filter((r) => r.kind === kind && !usedActionRowIds.has(r.id));
const sameKindDefCount = defActionList.filter((a) => a.action.kind === kind).length;
if (sameKindDefCount > 1 && candidateRows.length > 1 && candidateRows.length !== sameKindDefCount) { /* ambiguous */ }
```

Once the first same-kind action consumes a row, the remaining unused count drops below `sameKindDefCount`. A correct 3-declared / 3-recorded state is then flagged ambiguous on the second action.

Existing coverage: `packages/app/tests/workflow/progress-projection.test.ts:310-363` proves 3 rows for 2 declared is ambiguous. No test covers the equal-count case.

**Refine corrections (2026-11-27)**

- Code location "~:505-530" → verified: `candidateRows` at `progress-projection.ts:507`, `sameKindDefCount` and the ambiguity predicate at `:524-525` → premise and bug confirmed.
- Q&A "the under-recorded case already falls outside the `> 1` / `!==` guard" → false for ≥2 recorded rows: with 2 recorded / 3 declared, both counts exceed 1 and differ, so it is flagged ambiguous today and stays ambiguous after the fix; only 1 recorded row falls outside the guard and maps → behaviour unchanged either way; Q&A corrected below.
- AC row used the non-canonical `R2 —` form → rewritten as `AC1 — … (req: …)` with its test layer.

### Requirements

- [ ] R1. The ambiguity check compares the **total** same-kind row count for the state (`stateActionRows.filter(r => r.kind === kind).length`) with `sameKindDefCount`, not the unused remainder.
- [ ] R2. A state with N declared and N recorded same-kind actions (N ≥ 2) maps every row with no ambiguity diagnostic.
- [ ] R3. The existing over-recorded case (3 rows / 2 declared) still reports ambiguous.

Out of scope: matching by action id or ordinal; the E721 R1 visibility diagnostics (task 1272).

### Acceptance Criteria

- [ ] AC1 — A one-to-one same-kind mapping is never reported ambiguous (req: R1; R2; R3) — unit: `packages/app/tests/workflow/progress-projection.test.ts` adds a 3-declared/3-recorded same-kind case with no ambiguity diagnostic and every row mapped, while the existing 3-recorded/2-declared case (`:310-363`) still reports ambiguous.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:53:59.591Z

- **Q: Hoist the total count out of the per-action loop?** A: Yes. Compute it once per `(state, kind)`; the value does not change while rows are consumed.
- **Q: Does the under-recorded case (fewer rows than declared) change?** A: No. It already falls outside the `> 1` / `!==` guard as an unmatched action, and the fix keeps that.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Correction — what happens to the under-recorded case?** A: Unchanged by the fix. With ≥2 recorded rows but fewer than declared it is ambiguous before and after (supersedes the earlier "falls outside the guard" answer); with exactly 1 recorded row it maps. No new test needed for it.

### Design

- **Chosen:** a one-line predicate change in `progress-projection.ts`, using the total same-kind count per state.
- **Rejected:** ordinal matching, which goes beyond this bug.
- **Invariants:** ambiguity holds iff declared > 1 AND recorded > 1 AND recorded ≠ declared, all counted over the whole state.
- **Anti-patterns:** loosening the existing ambiguous test.
- **Handoff:** none.

### Plan

1. Failure mode first: add a test with 3 declared and 3 recorded same-kind actions expecting no ambiguity. It must fail on the current code.
2. Change the predicate to the total same-kind count.
3. Run `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)`. The new case and the 3-rows/2-declared case both pass.
4. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/app/src/workflow/progress-projection.ts` (~:505-530)
- `packages/app/tests/workflow/progress-projection.test.ts:310-363`
- Feature E721

### History

- 2026-11-27T07:54:33.006Z backlog → todo (system)

