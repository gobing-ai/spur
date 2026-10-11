---
schema_version: 1
name: Allow inbox offsets beyond the page-size ceiling
status: done
template: feature-impl
created_at: 2026-10-10T07:30:38.183Z
updated_at: "2026-10-10T23:56:13.156Z"
feature_id: G1

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 2
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1164-verdict.json
---

## 1164. Allow inbox offsets beyond the page-size ceiling

### Background

Inbox offset reuses parseLimit and clamps offsets above 500, causing repeated pages instead of older messages Evidence: `apps/server/src/modules/messages/index.ts:35` and `apps/server/src/modules/messages/index.ts:145`. Review a71c confirmed this using actual Hono requests with offsets 500, 550 and 1000 all forwarded offset 500 through an injected service. Separate direct fixes already corrected gate-lock diagnostics, absolute file.read paths, and resumed-run analytics. This task carries task-local regression scenarios below feature ship criteria.

**Refine corrections (2026-10-10)**
- The Hono route still calls parseLimit(offsetParam,0); its Number.parseInt plus Math.min(...,500) both clamps valid large offsets and accepts partial numeric strings. Freeze an independent strict decimal safe-integer offset parser rather than copying parseInt without a bound.
- AgentCoordinationService.getInbox forwards limit/offset directly to the existing inbox DAO; the route's injected service seam records exact arguments. The current stub returns one canned result, so argument assertions alone cannot prove distinct page contents. Add a pagination-aware fixture for that AC.
- parseLimit also owns global recent-message limits. Preserve that function and both limit callers, including current fallback/cap behavior; only inbox offset parsing changes.

### Requirements

- [x] R1. Parse offset independently as a nonnegative safe integer without the limit ceiling, retaining the 500 maximum for page size
- [x] R2. Missing offset remains undefined, invalid or negative offset falls back to zero, and page limits remain capped at 500
- [x] R3. Add the reproducing regression and validate the affected callers through the existing test seams.

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

1. [x] R1/R3: add failing Hono offset500/550/1000 argument regression and pagination-aware distinct-page fixture.
2. [x] R1/R2: implement private strict parseOffset and replace only the inbox offset call; correct limit/offset comments.
3. [x] R2/R3: add missing/invalid/precision table, maximum safe integer and independent capped-limit controls; retain global recent/default/missing-agent tests.
4. [x] Run apps/server tests/modules/messages/index.test.ts from its workspace and the task gate; update owning pagination surface prose if needed.
5. [x] Review/verify, record local evidence and commit.

### Solution

Gave the inbox `offset` its own strict parser with no page-size ceiling, so an offset greater than 500 is forwarded instead of being clamped back to 500 (which made every deeper page repeat the previous one).

Change map (one anchor per row):

| file:line | What changed |
| --- | --- |
| `apps/server/src/modules/messages/index.ts:26` | The route doc comment now records that `limit` is capped at 500 while `offset` has no ceiling — the two were previously described as one `<int>` pair. |
| `apps/server/src/modules/messages/index.ts:34` | The inbox route calls the new `parseOffset(c.req.query('offset'))` instead of `parseLimit(offsetParam, 0)`. `parseLimit`'s `Math.min(parsed, 500)` was the whole defect: an offset of 550 or 1000 silently became 500. |
| `apps/server/src/modules/messages/index.ts:136` | `parseLimit` keeps its `[0, 500]` clamp and its two limit callers unchanged, with a corrected comment: it parses a page SIZE and no longer claims offset semantics. |
| `apps/server/src/modules/messages/index.ts:152` | New private `parseOffset`: `undefined` stays `undefined`; otherwise the whole trimmed value must match `/^[0-9]+$/` and convert to a non-negative safe integer, else `0`. This is deliberately stricter than `parseInt` (which accepted `12abc` as 12 and `+5` as 5) and has no ceiling — it never clamps or wraps. |
| `apps/server/tests/modules/messages/index.test.ts:385` | New suite over real Hono requests: a table of omitted/blank/whitespace/negative/signed/fraction/exponent/hex/trailing-text/unsafe-integer offsets asserting `undefined` or `0`; `500`/`550`/`1000` and `Number.MAX_SAFE_INTEGER` forwarded unchanged; leading zeros normalized; `limit=9999&offset=1000` asserting the two independently (500 vs 1000); and a pagination-aware fixture with 1200 deterministic newest-first entries whose `getInbox` slices by the received offset/limit — pages 500, 550 and 1000 return 25 distinct IDs each and an offset past the end returns `{messages: [], count: 0}`. |
| `docs/design/observability-contracts.md:382` | The message API surface records the pagination contract: `limit` defaults to 50 and caps at 500, `offset` is a page position with no ceiling. |

Rationale: the offset was routed through a helper whose job is to bound a page size, so the "position" and "size" meanings shared one clamp. Splitting them is the smallest change that fixes the repetition, and the strict decimal-safe-integer rule also closes the partial-parse hole (`12abc` → 12) that `parseInt` left open. The global recent feed and all limit behavior are untouched, and no API shape, flag or DAO signature changed.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `apps/server/src/modules/messages/index.ts:152` — `parseOffset` returns `undefined` when the param is absent, and otherwise requires the whole trimmed value to match `/^[0-9]+$/` and convert to a non-negative `Number.isSafeInteger`, falling back to 0; there is no ceiling and nothing clamps or wraps. The inbox route (`:34`) calls it and the global recent feed does not. Tests: `apps/server/tests/modules/messages/index.test.ts:385` |
| R2 | MET | `parseLimit` (`:136`) keeps its `[0, 500]` clamp and both callers; `GET /api/messages` still caps at 500 with no offset; the missing-`agent` 400, response envelope and service/DAO signatures are unchanged. Asserted by the ignored-offset default test, the `limit=9999` cap cases and the untouched pre-existing suites in the same file (36 pass / 0 fail) |
| R3 | MET | Real Hono requests via `messagesModule.mount` with assertions on the recorded `getInbox` arguments, plus a pagination-aware service fixture of 1200 deterministic newest-first entries that slices by the received offset/limit. Pages 500/550/1000 with `limit=25` return 25 ids each and 75 unique ids overall; offset 5000 returns `{messages: [], count: 0}` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — Reproducing edge case is safe (req: R1, R3) | MET | test | `cd apps/server && bun test tests/modules/messages/index.test.ts` — 36 pass / 0 fail. The pagination fixture asserts `calls.inbox` offsets `[500, 550, 1000]`, that each page starts at `id-0500`/`id-0550`/`id-1000`, and that the three pages share no id; pre-fix all three requests arrived as offset 500 and repeated the same page |
| AC2 — Existing behavior remains supported (req: R2, R3) | MET | test | Same suite: the `test.each` table covers omitted → `undefined`, blank/whitespace/negative/signed/fraction/exponent/hex/trailing-text/unsafe-integer → `0`; `limit=9999&offset=1000` asserts `limit` 500 and `offset` 1000 independently; the global recent feed still forwards a clamped 500 with no offset; the pre-existing inbox/recent/POST/reply/projectPath tests pass unmodified |
| AC3 — Offset syntax and numeric precision are validated independently (req: R1, R2, R3) | MET | test | Same suite: leading zeros normalize (`00550` → 550), `Number.MAX_SAFE_INTEGER` round-trips unchanged, and `MAX_SAFE_INTEGER + 2` falls back to 0, so syntax and precision are decided by one rule and the ceiling never applies |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1164
**Scope:** 1164 diff (3 files: `apps/server/src/modules/messages/index.ts`, `apps/server/tests/modules/messages/index.test.ts`, `docs/design/observability-contracts.md`, plus the task file)
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS

##### Findings (ranked)

| # | Priority | Dimension | Finding | Location | Disposition |
|---|----------|-----------|---------|----------|-------------|
| 1 | P4 (advisory) | correctness | `parseOffset` now rejects `+5` and `12abc` to `0`, where `parseInt` previously accepted both as 5 and 12. That is a deliberate tightening (the task records it), but it is a behaviour change for a malformed query rather than a pure bug fix — a hypothetical client sending `+5` silently pages from the start instead of erroring. | `apps/server/src/modules/messages/index.ts:152` | ACCEPTED |
| 2 | P4 (advisory) | architecture | The two parsers are near-duplicates (`parseLimit` falls back on non-numeric, `parseOffset` returns 0 and enforces safe integers). Sharing one is not worth it: their fallbacks, bounds and validity rules genuinely differ, and the Design froze two private helpers over a parser framework. | `apps/server/src/modules/messages/index.ts:136` | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `parseOffset` (`apps/server/src/modules/messages/index.ts:152`) returns `undefined` for an omitted param and 0 for any value that is not a nonnegative decimal safe integer, with no ceiling; the inbox route (`:34`) is its only caller. Pinned by the ten-case invalid table, the 500/550/1000 and `MAX_SAFE_INTEGER` unchanged cases, and the leading-zero case |
| R2 | MET | `parseLimit` and both its limit callers are unchanged (`:136`), the global recent feed keeps `limit` capped at 500 with no offset, `agent`-missing still 400, and the response envelope/DAO signatures are untouched — the pre-existing inbox/recent/POST suites run unmodified in the same file |
| R3 | MET | The regression uses real Hono requests through `messagesModule.mount` and asserts the recorded `getInbox` arguments; the pagination fixture (1200 deterministic newest-first entries, service slices by received offset/limit) proves successive pages are distinct (75 unique ids across three pages) and that an offset past the end is empty rather than repeated |

##### Acceptance Criteria Verification

AC1 (reproducing edge case is safe) is the pagination-aware fixture; AC2 (existing behavior
remains supported) is the omitted/invalid/negative table plus the independent `limit=9999` cap
assertion and the untouched recent-feed test; AC3 (syntax and precision validated independently) is
the fractional/exponent/signed/trailing-text/unsafe-integer table together with the
`MAX_SAFE_INTEGER` round trip.

##### Residual Risk

See finding 1: malformed-but-previously-tolerated offsets (`+5`, `12abc`) now page from 0. No
security concern — the parameter is read-only query input feeding a numeric DAO argument, and the
stricter parse removes numeric-prefix ambiguity. No allocation risk: `MAX_SAFE_INTEGER` is forwarded
to the service but never used to size a buffer or preallocate a page.

**Next:** proceed to verify.

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
- 2026-10-10T19:25:42.109Z todo → wip (system)
- 2026-10-10T19:32:47.720Z wip → testing (system)
- 2026-10-10T19:32:50.204Z testing → done (system)

