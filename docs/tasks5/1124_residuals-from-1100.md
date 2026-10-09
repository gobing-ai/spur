---
schema_version: 1
name: Residuals from 1100
status: done
template: standard
created_at: 2026-10-08T16:31:15.479Z
updated_at: "2026-10-09T21:30:39.961Z"

ac_numbering: task-local
ac_altitude: task-local
feature_id: P1
done_forced: "true"
done_reason: "Implemented and verified inside /sp:dev-verifyall --feature P1 --fix all (2026-10-08), not via task-pipeline; verdict PASS (.spur/memory/evidence/1124-verdict.json), test apps/web/tests/modules/observability/decisions-tab.test.tsx:216, inline review recorded. Operator-approved audited bypass."
---

## 1124. Residuals from 1100

### Background

Source task: 1100 (feature P1) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:97fa12df — apps/web/src/modules/observability/DecisionsTab.tsx:168: Run-1 finding #4 residual sub-item: the DESIGN.md:462-466 Refresh button is still absent — the only drift sub-item not implemented (five of six are). Every active observability tab ships without one (grep over `apps/web/src/modules/observability/`: only the unmounted legacy ToolUsingTab "Live refresh" aria-label), so there is no in-repo pattern to copy and the remediation anchor scoped the fix to "pattern parity, no scope growth". The tab fetches on mount/filter/range change only.

### Requirements

- [x] R1. The Observability Decisions tab filters row ends with a Refresh button (DESIGN.md:462-466) that refetches the decision list with the active tab-local filters and the shell time range, without resetting any filter.
- [x] R2. The button is disabled while a list fetch is in flight and carries an accessible name.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Refresh refetches the decision list with the active filters (req: R1, R2)
  Given the Decisions tab is loaded with the outcome filter set to Fallback
  When the operator clicks the "Refresh decisions" button
  Then exactly one more list request is sent
  And that request still carries outcome=fallback
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-08T16:38:08.335Z

- Scope: manual Refresh only (DESIGN.md:462-466); auto-refresh/live polling is out of scope (no DESIGN line asks for it).

### Design

- Add a `refreshKey` generation counter and bundle the list-fetch inputs into one memoized `listQuery` (filters + `generation`), the same idiom as `FeatureDetail.tsx` `loadTarget`. The fetch effect depends on `[listQuery]`, so a Refresh click is a real effect input. This avoids an unused-dependency suppression (biome `useExhaustiveDependencies`).
- Reuse the shared `@/ui` `Button` (ghost, xs), as in the Jobs tab. It is disabled while `loading`. No new component and no auto-refresh timer, because the DESIGN line asks only for a manual Refresh.

### Plan

1. Write a failing test: clicking Refresh sends one more list request that keeps outcome=fallback.
2. Add `refreshKey` + memoized `listQuery`; add the Refresh `Button` before the retention badge.
3. Run biome, web typecheck and the observability web suite.

### Solution

- `apps/web/src/modules/observability/DecisionsTab.tsx:72-73`: the `refreshKey` generation state.
- `apps/web/src/modules/observability/DecisionsTab.tsx:89-99,140`: the memoized `listQuery` (filters + generation) drives the fetch effect.
- `apps/web/src/modules/observability/DecisionsTab.tsx:208-218`: the Refresh `Button` (`aria-label="Refresh decisions"`, disabled while loading), placed before the `RetentionBadge`.
- Test (written first, failed before the change): `apps/web/tests/modules/observability/decisions-tab.test.tsx:216`.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/web/src/modules/observability/DecisionsTab.tsx:208-218` Refresh button ends the filters row before the RetentionBadge; `apps/web/src/modules/observability/DecisionsTab.tsx:93-95` the memoized listQuery carries the active filters plus the refresh generation into the fetch effect at `apps/web/src/modules/observability/DecisionsTab.tsx:140`; the test at `apps/web/tests/modules/observability/decisions-tab.test.tsx:216` passes fresh (4 pass / 0 fail) |
| R2 | MET | `apps/web/src/modules/observability/DecisionsTab.tsx:212` disabled while loading; `apps/web/src/modules/observability/DecisionsTab.tsx:214` aria-label "Refresh decisions", which the test at `apps/web/tests/modules/observability/decisions-tab.test.tsx:216` queries by role and name |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Refresh refetches the decision list with the active filters (req: R1, R2) | MET | test | `apps/web/tests/modules/observability/decisions-tab.test.tsx:216` sets Fallback, clicks the Refresh button, and asserts exactly one more list request that still contains outcome=fallback. It failed before the change and passes now (4 pass / 0 fail; biome and web tsc clean) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

## Review — inline sp:code-verification review mode, 2026-10-08 (verifyall P1 --fix all)

**Verdict: PASS.** The diff is 2 files, +47/-3. Its scope matches R1/R2 exactly.

- **S:** no new input surface. The button only re-issues the existing GET with the same encoded params.
- **E:** one request per click. The button is disabled while `loading`, so double clicks cannot stack fetches, and the existing `fetchIdRef`/AbortController guard still discards stale responses.
- **C:** filters are preserved because `listQuery` carries them unchanged. `loadOlder` keeps its own cursor and is unaffected.
- **U:** the button has an accessible name ("Refresh decisions"). It reuses `@/ui` `Button` ghost/xs, matching the Jobs tab, so no new pattern is introduced.
- **A:** the memoized-query idiom mirrors `FeatureDetail.tsx` `loadTarget` with no lint suppression.

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | usability | The browser was not checked live. Behaviour is proven in happy-dom only. | `apps/web/tests/modules/observability/decisions-tab.test.tsx:216` | ACCEPTED — component test drives the real click → fetch path |

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-08T16:38:16.388Z backlog → todo (system)
- 2026-10-08T16:38:16.768Z todo → wip (system)
- 2026-10-08T16:38:51.193Z wip → testing (system)
- 2026-10-08T16:43:38.361Z testing → done (system)

