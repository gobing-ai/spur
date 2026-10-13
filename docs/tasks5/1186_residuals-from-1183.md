---
schema_version: 1
name: Residuals from 1183
status: cancelled
template: standard
created_at: 2026-10-12T21:34:05.573Z
updated_at: "2026-10-13T02:43:43.365Z"

---

## 1186. Residuals from 1183

### Background

Source task: 1183 (feature G631) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:a9e056ea — packages/app/src/database/database-browser-service.ts:52, :159-167: `page` and `offset` are bounded only from below, so an integer-valued but unrepresentable value reaches SQL as an OFFSET the driver rejects. Reproduced on the mounted module: `?page=1e21` → 500 `{"error":"datatype mismatch"}` and `?offset=1e21` → 500 (same for `1e300`), where `?page=9999999999999999` answers 200 with an empty page and `?pageSize=1e21` is clamped to 200 correctly. `Number.isInteger(1e21)` is true, so `normalizePage` (`packages/app/src/database/database-browser-service.ts:52-56`) passes it and the offset validator (`:159-167`) does the same; the product is bound as OFFSET at `packages/domain/src/dao/database-inspector.ts:167`. No requirement or AC commits the routes to a behaviour for an unbounded page (R4 bounds `pageSize` only), it is unreachable from the documented client (the design's pager drives `?page=` from integer URL state, `docs/design/projects-database-tab.md:90-91`), and there is no data loss or exposure — a hardening gap, not a requirement breach.

**Resolved and closed (2026-10-13).** Fixed directly rather than carried as a follow-up — the
operator's instruction was no new-task deferral. The fix is commit `45465ed47 fix(app): bound the
database browse page and offset above`; the evidence is in `## Solution` / `## Testing` below, and the
full gate passed on the change (`bun run spur-check` → EXIT=0).

### Requirements

<!-- One R-item per line, exactly `- [ ] R1. <text>` (checkbox + `R<n>.`); `spur task check` flags any other form. Keep empty until requirements are known. -->

### Acceptance Criteria

<!-- Number items AC1, AC2, … (never R<n> — that is the Requirements namespace). Preferred: `Scenario: AC1 — <concrete outcome> (req: R1)` blocks with Given/When/Then, declaring both `ac_altitude: task-local` and `ac_numbering: task-local` for task-local regression criteria (altitude skips only the feature-subset check; numbering makes `(req: R<n>)` count toward requirement coverage). Parsed checkbox rows `- [ ] AC1 — <title>` are supported but never bind requirements — only `Scenario:` titles read `(req: R<n>)`. Bare `- AC1` bullets are legacy unparsed records, not a traceability bypass. Requirements use `- [ ] R1. <text>`, checked at close. Keep empty if this task has no objective AC yet. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen approach, key tradeoffs, invariants, and impacted surfaces. Keep snippets short. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

Fixed directly in the batch's parent change set rather than carried as a follow-up (operator
instruction: no new-task deferral). `page` and `offset` are now bounded above at the largest integer
this build can bind, so an unrepresentable value is a rejected request instead of a 500.

| file:line | Change |
| --- | --- |
| `packages/app/src/database/database-browser-service.ts:16` | `MAX_DATABASE_PAGE = Number.MAX_SAFE_INTEGER` — the bound, with why an over-bound value cannot simply be clamped. |
| `packages/app/src/database/database-browser-service.ts:57` | `normalizePage` returns `number \| null`: malformed values still fall back to `1` (unchanged contract), while a whole number above the bound returns `null`. |
| `packages/app/src/database/database-browser-service.ts:95` | `normalizeRowQuery` maps that `null` to `invalid-request` with a message naming the range. |
| `packages/app/src/database/database-browser-service.ts:178` | The row-detail offset validator rejects `offset > MAX_DATABASE_PAGE`, alongside its existing non-integer/negative checks. |
| `packages/app/tests/database/database-browser-service.test.ts:157` | Service-level regression: `1e21`, `1e300` and `MAX_SAFE_INTEGER + 1` rejected for both `page` and `offset`. |
| `packages/app/tests/database/database-browser-service.test.ts:186` | Guard against over-correcting: a representable page past the end still answers `ok` with an empty page and the true total, at that page number — never silently clamped to 1. |
| `apps/server/tests/modules/database/index.test.ts:143` | Route-level regression for the reported symptom: `?page=1e21` and `?offset=1e21` answer **400 `{error:'invalid-request'}`**, not the 500 `{error:'datatype mismatch'}` the driver produced. |

Rejected as the fix: clamping an over-bound page to the last page or to 1. Both answer 200 with a page
the caller never asked for, and clamping to 1 would break ordinary paging (a representable page past
the end is legal and must keep answering an empty page — pinned by the second test above).

### Testing

- Failing test written first (project rule): before the fix, `packages/app/tests/database/database-browser-service.test.ts` was **11 pass / 2 fail** — both new representability tests failed, the past-the-end guard already passed.
- After the fix: `(cd packages/app && bun test tests/database/database-browser-service.test.ts)` → **13 pass / 0 fail**.
- Route level (the reported symptom was a 500, not a service return): `(cd apps/server && bun test tests/modules/database tests/modules/registry.test.ts)` → **14 pass / 0 fail**, including `?page=1e21` and `?offset=1e21` → 400 `invalid-request`.
- Domain inspector unaffected: `(cd packages/domain && bun test tests/dao/database-inspector.test.ts)` → 16 pass / 0 fail.
- `bun run lint` (biome + per-workspace typecheck) → exit 0.
- Full gate: `bun run spur-check` → **EXIT=0** (51 pre-check rules, 11243 tests / 0 fail, 2 post-check rules).

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T02:42:55.501Z backlog → cancelled (system)

