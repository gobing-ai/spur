---
schema_version: 1
name: Residuals from 1184
status: cancelled
template: standard
created_at: 2026-10-13T00:24:49.589Z
updated_at: "2026-10-13T02:43:44.469Z"

---

## 1188. Residuals from 1184

### Background

Source task: 1184 (feature G631) — deferred residuals filed by residual-scan settle (unlinked: a deferral must not hold the completing feature open).

- review-finding:1f570519 — apps/web/src/modules/projects/DatabaseView.tsx:468 (handler) and apps/web/src/modules/projects/DatabaseView.tsx:619 (input): The contains-filter input issues one server read per keystroke: `changeFilterValue` rewrites the `f` query key on every change and the rows URL is the fetch effect's dependency. Each read runs `SELECT COUNT(*)` over the filtered table plus the window select, executed synchronously on `bun:sqlite` inside the Bun server, so typing one term against `history_message` (~3.2M rows) blocks the shared event loop once per character. The two comparable server-driven filter boxes in this repo debounce 250 ms.

**Resolved and closed (2026-10-13).** Fixed directly rather than carried as a follow-up — the
operator's instruction was no new-task deferral. The fix is commit `59c2e6013 fix(web): settle the
database filter before reading the server`; the evidence is in `## Solution` / `## Testing` below, and
the full gate passed on the change (`bun run spur-check` → EXIT=0).

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
instruction: no new-task deferral). The contains filter now waits for the value to settle before it
reaches the server, so a burst of keystrokes costs one read instead of one per character.

| file:line | Change |
| --- | --- |
| `apps/web/src/modules/projects/DatabaseView.tsx:35` | `FILTER_DEBOUNCE_MS = 250`, matching the repo's other server-driven filter boxes (`HistoryShell.tsx:322-329`, `SystemEventsTab.tsx:822-831`). |
| `apps/web/src/modules/projects/DatabaseView.tsx:393` | `filterValueSettled` state, seeded from the URL value so a deep link or reload sends its filter immediately (AC2), plus a 250 ms timer effect that follows `filterValue` and is cleared on each change. |
| `apps/web/src/modules/projects/DatabaseView.tsx:403` | `query` derives `filterColumn`/`filterValue` from the settled pair, so the rows URL only changes once per settle. |

Debouncing the request rather than the URL write is deliberate: the input stays bound to `?f=` so
typing is immediate and the URL stays accurate for reload and deep links — what is deferred is only
the read. `filterActive` (line 385) deliberately still reads the immediate value, because it drives the
empty-state copy ("no rows matching this filter"), which should reflect what the user just typed
rather than the last response.

Rejected as the fix: a client-side pager over fetched rows (out of scope — the server owns paging and
the grid must never hold more than one page), and dropping the filter to a submit button (changes the
documented interaction, `docs/design/projects-database-tab.md` §3.4).

### Testing

- Failing tests written first (project rule): before the fix, `apps/web/tests/modules/projects/DatabaseView.test.tsx` was **17 pass / 2 fail** — both new debounce tests failed because three keystrokes produced three reads.
- After the fix: `(cd apps/web && bun test tests/modules/projects)` → **206 pass / 0 fail** (19 in `DatabaseView.test.tsx`, including the 17 pre-existing ones — the debounce did not break the filter, URL round-trip or deep-link tests).
- The tests assert both halves: one read per burst, and that the value reaching the server is the settled one (`['start', 'abcd']`, never the intermediate `'ab'`).
- `bun run lint` (biome + per-workspace typecheck) → exit 0.
- Full gate: `bun run spur-check` → **EXIT=0** (51 pre-check rules, 11243 tests / 0 fail, 2 post-check rules).
- Not verified: the live board against a real 3.2M-row table (no browser available in this session). The regression is pinned at the request level — one read per settle — which is the property the keystroke-per-read defect violated.

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History

- 2026-10-13T02:42:57.568Z backlog → cancelled (system)

