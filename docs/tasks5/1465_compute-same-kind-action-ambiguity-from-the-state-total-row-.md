---
schema_version: 1
name: Compute same-kind action ambiguity from the state total row count in the progress projection
status: done
template: feature-impl
created_at: 2026-11-27T07:35:45.245Z
updated_at: "2026-11-27T18:05:02.229Z"
feature_id: E721

estimate_hours: 1
priority: P1
done_forced: "false"
done_reason: unforced close
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

- [x] R1. The ambiguity check compares the **total** same-kind row count for the state (`stateActionRows.filter(r => r.kind === kind).length`) with `sameKindDefCount`, not the unused remainder.
- [x] R2. A state with N declared and N recorded same-kind actions (N ≥ 2) maps every row with no ambiguity diagnostic.
- [x] R3. The existing over-recorded case (3 rows / 2 declared) still reports ambiguous.

Out of scope: matching by action id or ordinal; the E721 R1 visibility diagnostics (task 1272).

### Acceptance Criteria

- [x] AC1 — A one-to-one same-kind mapping is never reported ambiguous (req: R1; R2; R3) — unit: `packages/app/tests/workflow/progress-projection.test.ts` adds a 3-declared/3-recorded same-kind case with no ambiguity diagnostic and every row mapped, while the existing 3-recorded/2-declared case (`:310-363`) still reports ambiguous.

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

| File | Change |
| --- | --- |
| `packages/app/src/workflow/progress-projection.ts:525-537` | The ambiguity predicate now compares `sameKindRowCount` — the state's **total** same-kind row count (`stateActionRows.filter(r => r.kind === kind).length`) — against `sameKindDefCount`, instead of the unused remainder `candidateRows.length` (R1). The diagnostic lists the same-kind rows rather than only the still-unused ones, so an over-recorded state names all three rows. |
| `packages/app/tests/workflow/progress-projection.test.ts:367-416` | New case: 3 declared / 3 recorded same-kind `shell` actions in one state asserts no `ambiguous-action` diagnostic, no `ambiguous` action status, and that all three rows map (`attempts[].actionRunId` = `a1,a2,a3`) (R2). The pre-existing 3-recorded / 2-declared case at `packages/app/tests/workflow/progress-projection.test.ts:310-363` still asserts ambiguity, untouched (R3). |

Root cause: the check measured "how many rows are left" rather than "how many rows exist". The first same-kind action consumes one row, so from the second action on the remainder (2, then 1) never equals the declared count (3) and a correct one-to-one state reported `ambiguous` twice. Keeping the `> 1` guard preserves both edges: a single recorded row still maps, and an under-recorded state with ≥ 2 rows stays ambiguous (as the refine Q&A correction records).

Proof: the new case failed on the pre-fix code with `ambiguous-action` diagnostics naming `a2, a3` for `s1:onEnter:1` and `s1:onEnter:2`; after the one-predicate change `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)` → 18 pass, 0 fail (including the untouched over-recorded case). Consumer check `(cd apps/cli && bun test tests/commands/workflow/progress.test.ts)` → 5 pass; `bun run --filter @gobing-ai/spur-app typecheck` clean; `spur task gate 1465 light` PASS (2 changed files, 6 checks).

probe: not-applicable (no public surface changed — existing `spur workflow progress` projection internals only)
precheck: light gate ran the changed-path matrix, rules presets and related tests (receipt `.spur/run/1465-check-receipt.json`).

Plan steps 1-4 completed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/progress-projection.ts:529-530` compares `sameKindRowCount` — `stateActionRows.filter((r) => r.kind === kind).length`, the state total — against `sameKindDefCount`; the unused remainder `candidateRows.length` no longer participates in the predicate. |
| R2 | MET | `packages/app/tests/workflow/progress-projection.test.ts:367-416` builds 3 declared / 3 recorded same-kind actions and asserts zero `ambiguous-action` diagnostics, no `ambiguous` action status, and `['a1','a2','a3']` mapped; `(cd packages/app && bun test tests/workflow/progress-projection.test.ts)` → 18 pass, 0 fail. |
| R3 | MET | The pre-existing over-recorded case `packages/app/tests/workflow/progress-projection.test.ts:310-363` is untouched and still passes; total 3 ≠ declared 2 keeps it ambiguous, and the diagnostic now names all three rows (`a1, a2, a3`). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — A one-to-one same-kind mapping is never reported ambiguous (req: R1; R2; R3) | MET | test | `packages/app/tests/workflow/progress-projection.test.ts:367` — new 3-declared/3-recorded case with no diagnostic and all rows mapped, while `packages/app/tests/workflow/progress-projection.test.ts:310-363` still reports ambiguous; both in one `bun test tests/workflow/progress-projection.test.ts` run (18 pass, 0 fail). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): `sameKindRowCount` is recomputed inside the per-action loop even though it is constant per `(state, kind)`, where the task's Q&A recorded "compute it once per (state, kind)". Behaviour is identical and the loop is bounded by one state's declared actions, so this stays advisory — hoist it into a `Map<kind, number>` beside `usedActionRowIds` the next time this function is opened for other reasons.

Residual risk: the predicate now counts rows across **all** visits of a state, so a loop state that legitimately records N rows per visit (2 visits × 3 same-kind actions = 6 rows) reads as over-recorded and stays `ambiguous` — unchanged from the pre-fix behaviour (the old unused-remainder count was 6 on the first action too), but it is the same latent limitation, not a new one. Ordinal/id matching is explicitly out of scope per the task.

Disposition: PASS — one-predicate fix plus its red-first regression test, over-recorded case untouched and still green, consumers (CLI progress command, app typecheck) verified.

### References

- `packages/app/src/workflow/progress-projection.ts` (~:505-530)
- `packages/app/tests/workflow/progress-projection.test.ts:310-363`
- Feature E721

### History

- 2026-11-27T07:54:33.006Z backlog → todo (system)
- 2026-11-27T18:04:17.873Z todo → wip (system)
- 2026-11-27T18:04:57.363Z wip → testing (system)
- 2026-11-27T18:05:02.221Z testing → done (system)

