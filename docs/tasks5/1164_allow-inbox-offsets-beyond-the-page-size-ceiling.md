---
schema_version: 1
name: Allow inbox offsets beyond the page-size ceiling
status: todo
template: feature-impl
created_at: 2026-10-10T07:30:38.183Z
updated_at: "2026-10-10T16:35:09.207Z"
feature_id: G1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
---

## 1164. Allow inbox offsets beyond the page-size ceiling

### Background

Inbox offset reuses parseLimit and clamps offsets above 500, causing repeated pages instead of older messages Evidence: `apps/server/src/modules/messages/index.ts:35` and `apps/server/src/modules/messages/index.ts:145`. Review a71c confirmed this using actual Hono requests with offsets 500, 550 and 1000 all forwarded offset 500 through an injected service. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- The Hono route still calls parseLimit(offsetParam,0); its Number.parseInt plus Math.min(...,500) both clamps valid large offsets and accepts partial numeric strings. Freeze an independent strict decimal safe-integer offset parser rather than copying parseInt without a bound.
- AgentCoordinationService.getInbox forwards limit/offset directly to the existing inbox DAO; the route's injected service seam records exact arguments. The current stub returns one canned result, so argument assertions alone cannot prove distinct page contents. Add a pagination-aware fixture for that AC.
- parseLimit also owns global recent-message limits. Preserve that function and both limit callers, including current fallback/cap behavior; only inbox offset parsing changes.

### Requirements

- [ ] R1. Parse offset independently as a nonnegative safe integer without the limit ceiling, retaining the 500 maximum for page size
- [ ] R2. Missing offset remains undefined, invalid or negative offset falls back to zero, and page limits remain capped at 500
- [ ] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Reproducing edge case is safe (req: R1, R3)
  Given an inbox with more than 1000 messages and requests for offsets 500, 550 and 1000
  When the Hono inbox route forwards pagination to coordination.getInbox
  Then each valid offset is forwarded unchanged and successive pages remain distinct

Scenario: AC2 — Existing behavior remains supported (req: R2, R3)
  Given missing, invalid and negative offsets and an excessive page limit
  When the existing supported operation executes
  Then Missing offset remains undefined, invalid or negative offset falls back to zero, and page limits remain capped at 500
```
```gherkin
Scenario: AC3 — Offset syntax and numeric precision are validated independently (req: R1, R2, R3)
  Given omitted, blank, fractional, exponent, signed, trailing-text and unsafe-integer offset query values
  When real Hono inbox requests are handled
  Then omitted offset is undefined and every invalid offset becomes zero
  And complete nonnegative decimal safe integers are forwarded unchanged without the page-size ceiling
```

### Q&A

- Closed: trim then strict decimal digits plus Number.isSafeInteger; invalid falls back to0 and missing remains undefined. No partial parseInt acceptance.
- Closed: preserve both limit callers and their existing cap500; large valid offsets are independent.
- Closed: Hono argument tables plus a slicing service fixture prove transport behavior; no DB redesign or actual message sending is necessary.

### Design

**Minimal fix / frozen input semantics.** Add private parseOffset(raw:string|undefined):number|undefined in apps/server/src/modules/messages/index.ts and use it only for GET /api/messages/inbox offset. Missing raw returns undefined. Otherwise trim whitespace, require the entire value to match /^[0-9]+$/, convert with Number and require Number.isSafeInteger plus >=0; invalid returns0. Accept 0, leading zeros, whitespace-wrapped decimal integers, 500,550,1000 and Number.MAX_SAFE_INTEGER unchanged numerically. Reject negatives, empty/whitespace, fractions, exponent/hex notation, plus sign, numeric prefixes with trailing text, NaN/Infinity and unsafe integers to0. This deliberately tightens formerly partial parseInt acceptance to meet the safe-integer contract. No offset ceiling; do not clamp or wrap.

Keep parseLimit and its limit defaults50/cap500 exactly as-is for inbox and recent feed. Update its misleading limit/offset comment and the inbox route query documentation. Preserve missing-agent400, response envelope, context-undefined no-op and service/DAO signatures. No new API/flag, query field, shared parser framework or exported helper. Update the existing message API design surface only if its pagination contract is recorded there; no public CLI surface is changed.

**Regression seam.** In apps/server/tests/modules/messages/index.test.ts make actual Hono requests and assert service arguments for each case, including separate 500/550/1000 and MAX_SAFE_INTEGER. Use encodeURIComponent for whitespace/plus/sign fixtures so URL decoding is explicit. Table-test omitted→undefined and invalid→0. With limit9999 + offset1000 assert limit500 and offset1000 independently; retain global recent limit tests. Add one local pagination-aware service fixture with >1100 deterministic message IDs in a fixed newest-first array, slicing by received offset/limit: requests500/550/1000 with limit25 return the expected distinct IDs/counts and beyond-end empty result. This fixture validates transport pagination, not database ordering; no actual DB/seed data or real messages are needed. Existing canned stub tests remain valid.

**Scope / dependencies.** 1163 UI terminal state and 1165 message-session ownership are separate seams; no prerequisite. No inbox persistence/order redesign, client pagination changes, message delivery side effects or MAX_SAFE_INTEGER-sized allocations.

### Plan

1. [ ] R1/R3: add failing Hono offset500/550/1000 argument regression and pagination-aware distinct-page fixture.
2. [ ] R1/R2: implement private strict parseOffset and replace only the inbox offset call; correct limit/offset comments.
3. [ ] R2/R3: add missing/invalid/precision table, maximum safe integer and independent capped-limit controls; retain global recent/default/missing-agent tests.
4. [ ] Run apps/server tests/modules/messages/index.test.ts from its workspace and the task gate; update owning pagination surface prose if needed.
5. [ ] Review/verify, record local evidence and commit.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

`apps/server/src/modules/messages/index.ts:35` and `apps/server/src/modules/messages/index.ts:145`

#### Readiness review (2026-10-10)

Outcome: refined; depth: ready; status: todo → todo; corrections: 3.

| id | pass | evidence |
| --- | --- | --- |
| requirements | true | Current-tree audit; observable R-items and explicit scope below. |
| design | true | Chosen seams, fixtures, edge behavior and non-goals frozen in Design. |
| plan | true | Ordered implementation and test plan linked to R-items. |
| ac | true | Task-local scenarios and req links; task check --as todo PASS, no errors. |
| decisions | true | Closed decisions in Q&A; no unresolved implementation decision. |
| dependencies | true | Prerequisite and sibling ownership recorded in Design; declared edges where needed. |
| premises | true | Source/callers/tests inspected; verified facts and corrected hypotheses recorded in Background. |

Planning-only receipt: no implementation pipeline or behavior-change verification PASS is claimed. Recheck source and ownership before implementation; batch began on main at 13da1554f with one worktree, no WIP tasks and a clean tree. Runtime Bun 1.3.14; no dependency install needed for refinement.

### History

- 2026-10-10T07:30:43.875Z backlog → todo (system)

