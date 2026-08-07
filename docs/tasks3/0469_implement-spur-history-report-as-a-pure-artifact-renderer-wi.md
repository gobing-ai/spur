---
template: feature-impl
schema_version: 1
name: "Implement spur history report as a pure artifact renderer with markdown sidecar and staleness banner"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0474"]
ac_numbering: task-local
created_at: "2026-08-07T05:02:01.061Z"
updated_at: "2026-08-07T20:51:01.889Z"
---

## 0469. Implement spur history report as a pure artifact renderer with markdown sidecar and staleness banner

### Background
Graduated from the consumption-surface investigation (feature E1). **Depends on task 0474**, which
writes the artifact this renders. (Earlier drafts of this Background cited 0468 — that was wrong;
0468 was the 0466 fix-up ticket and is done. The `dependencies[]` edge has always been 0474.)

`spur history report` is an explicit not-implemented stub today
(`apps/cli/src/commands/history.ts:39-52`). Task 0464 settled what it becomes: **a pure renderer of
the analyze artifact that never opens the database.**

That separation is the contract, not an implementation detail. It is what makes the morning report
reproducible (the same artifact always renders the same report), diffable (yesterday's and today's
artifacts share a stable selector digest), and cheap (re-rendering costs a file read, not a corpus
scan). The moment `report` issues a query, all three properties are lost.

`formatSummary` (`packages/domain/src/analytics/costs.ts:90-125`) survives this move — its padded
column layout is good and re-deriving it would be waste. It becomes one section of the renderer, fed
from the artifact's `totals`/`bySource`/`byModel` instead of an in-memory `AnalyticsSummary`. So do
`cacheHitRatio` and `formatRatio` (`packages/domain/src/analytics/costs.ts:81-131`), whose
never-fabricate `n/a` behavior is exactly what the artifact's `recordsWithUsage` and
`durationUnmeasured` denominators exist to feed.

Sequence this immediately after the analyze cut-over so the artifact is never write-only.

Full spec: task 0464 `### Design` § R2 (artifact shape and versioning rule) and § R8 (delivery,
staleness banner).
### Requirements
- R1 — Render the analyze artifact into a human report without opening the database; the command must issue no SQL and require no DB connection.
- R2 — Reuse formatSummary, cacheHitRatio, and formatRatio rather than re-implementing the spend rollup layout, feeding them from artifact fields.
- R3 — Render the forensic sections the spend summary lacks: per-tool time cost, per-tool token and result-byte cost, tool-call counts, detected loops, and the session leaderboard.
- R4 — Refuse an artifact whose schemaVersion is unknown, reporting the artifact path and the expected version rather than rendering a shape the renderer does not understand.
- R5 — Render unavailable values as unavailable, never as zero, using the artifact's recordsWithUsage and durationUnmeasured denominators.
- R6 — Resolve the newest artifact by default via the latest.json pointer, with an explicit path argument overriding it.
- R7 — Print a prominent staleness banner when the resolved artifact is older than 36 hours, since artifact freshness is the first-line missed-run signal.
- R8 — Write a rendered markdown sidecar next to the JSON so the morning read requires no CLI invocation.
### Acceptance Criteria
```gherkin
Feature: 0469 report renders the artifact and never queries the database

  Scenario: R1 — rendering is database-free
    Given a valid analyze artifact on disk and no reachable database
    When report runs against that artifact
    Then the report renders in full
    And no database connection is opened

  Scenario: R4 — an unknown schema version is refused, not guessed
    Given an artifact whose schemaVersion is newer than the renderer understands
    When report runs against it
    Then rendering is refused with the artifact path and the expected version
    And no partially-rendered output is emitted

  Scenario: R5 — unknown values render as unavailable
    Given an artifact whose durationUnmeasured equals its tool-call count
    When report renders the per-tool timing section
    Then the timing column reads unavailable rather than zero

  Scenario: R7 — a stale artifact is loud
    Given the newest artifact was generated more than 36 hours ago
    When report runs with no explicit path
    Then a staleness banner naming the artifact age is printed before the report

Scenario: R2 — the spend rollup layout is reused, not re-implemented
    Given an artifact carrying totals, bySource, and byModel
    When report renders the spend section
    Then the existing summary formatter produces it from artifact fields

  Scenario: R3 — the forensic sections the spend summary lacks are rendered
    Given an artifact carrying byTool, loops, and bySession
    When report renders
    Then per-tool time cost, per-tool token and result-byte cost, detected loops, and the session leaderboard all appear

  Scenario: R6 — the newest artifact is found without an explicit path
    Given several artifacts exist across multiple dates
    When report runs with no path argument
    Then the newest artifact is resolved through the latest pointer
    And an explicit path argument overrides that resolution

  Scenario: R8 — a markdown sidecar is written for reading without the CLI
    Given a rendered report
    When the render completes
    Then a markdown file is written next to the JSON artifact
```
### Q&A
**Closed during implement-ready refinement (2026-08-07):**

- *Background said "depends on 0468" — which is right?* **0474.** The `dependencies[]` edge was
  always `0474`; the prose was stale (0468 was the 0466 fix-up ticket, now done). Background
  corrected, because an implementer reading it would have gone to the wrong task for the artifact
  contract.
- *How is "never opens the database" actually enforced?* **By running the command with no reachable
  database** (Plan step 9), not by inspecting imports. A unit test that simply does not call `getDb`
  proves nothing about a lazily-constructed service. Keep `render-report.ts` free of any `DbAdapter`
  import so the seam is also visible statically, but the behavioral test is the guard.
- *Is a lower-than-current `schemaVersion` a migration case?* **No.** 0464 § R2 ruled there is no
  migration path: old artifacts stay readable by old renderers. Only v1 exists, so the check is
  equality. If v2 ever ships, that decision is ADR-worthy and is made then.
- *Where does the markdown sidecar go, and is it optional?* Beside the JSON, same basename, `.md`
  extension, written unconditionally — no flag. Its purpose (0464 § R8) is the morning read with no
  CLI invocation, which a flag defeats.
- *Is `formatSummary` physically moved into the renderer?* **No.** It stays in
  `packages/domain/src/analytics/costs.ts` and is called through `artifactToSummary`. 0464 § R5's
  "becomes a section of `report`" is about role, not file location; moving it would churn `run-cost`
  and the existing tests for no gain.
- *Should the staleness banner print when an explicit path was given?* **No.** An operator who named
  a file already knows its age; a banner there is noise that trains the reader to ignore it — which
  costs exactly the signal layer 1 exists to provide.

**Deferred:**

- Rendering `coverage[].status` transitions (was non-empty yesterday, empty today) as a warning —
  that comparison needs two artifacts and belongs with 0470, which owns the `empty` state's meaning.
  This task renders all three states as given.

**Ordering.** Blocked on **0474** (writes the artifact). Blocks nothing, but 0471 R7 consumes the
rendered report path, so keep the sidecar path derivable from the artifact path.
### Design
**WHAT.** Replace the `spur history report` not-implemented stub
(`apps/cli/src/commands/history.ts:39-52`) with a renderer that reads one JSON artifact from disk and
prints a report. No database, no aggregation, no fallback query path.

**WHY.** "Never opens the DB" is the whole contract, not a preference. It is what buys reproducible
(same artifact ⇒ same report), diffable (stable selector digest across days), and cheap (a file read,
not a corpus scan) — and 0474 pays a full SQL rewrite to make the artifact trustworthy. One
convenience query here forfeits all three.

**WHERE — frozen file targets.**

| File | Change |
| --- | --- |
| `packages/domain/src/analytics/render-report.ts` | **New.** Pure `artifact → string` rendering. No I/O, no `DbAdapter` import. |
| `packages/domain/src/analytics/costs.ts:90-125,127-131` | `formatSummary` and `formatRatio` reused as-is; `formatRatio` is exported by 0474. No behavior change here. |
| `apps/cli/src/commands/history.ts:39-52` | Replace the stub body: resolve path → read + parse → version-check → render → write sidecar. |
| `packages/app/src/services/history-service.ts` | Add `report()` **only if** path resolution needs the runtime FS seam. It must not receive `getDb`. |
| `docs/04_DESIGN.md` §`spur history report` | Same-commit surface update (T3) — the section currently documents the reserved stub. |

**Frozen names.**

- `renderReport(artifact: HistoryArtifact): string` — the stdout report.
- `renderMarkdown(artifact: HistoryArtifact): string` — the `.md` sidecar body (R8).
- `artifactToSummary(artifact: HistoryArtifact): AnalyticsSummary` — the adapter that feeds
  `formatSummary` from `totals` / `bySource` / `byModel` / `daily`. **This is R2's reuse mechanism**;
  it exists so the padded layout is never re-implemented.
- `resolveArtifactPath(explicit?: string): string` — explicit path wins, else the
  `.spur/reports/history/latest.json` pointer (R6).
- `STALENESS_THRESHOLD_HOURS = 36` (R7).
- CLI: `spur history report [<path>] [--json]`. The markdown sidecar is written unconditionally beside
  the JSON — not behind a flag.

**Version check precedence — order matters and is testable.** Resolve path → read → parse →
**`schemaVersion` check → then render**. On an unknown version, refuse with the artifact path and the
expected version, set a non-zero exit code, and emit **nothing else** (R4). A renderer that prints
three sections and then discovers it cannot understand the fourth has already misled the reader. The
check accepts `schemaVersion === HISTORY_ARTIFACT_SCHEMA_VERSION`; a *lower* known version is not a
migration case — there is only v1 today, and 0464 ruled there is no migration path.

**Unavailable rendering (R5) — the reuse is the point.** `cacheHitRatio` already returns `null`, and
`formatRatio(null)` already prints `n/a` (`costs.ts:81-87,127-131`). Extend the same shape to
duration: when `durationUnmeasured === toolCalls` for a bucket, the timing column reads `n/a`, never
`0`. Do not invent a second unavailable convention — one `n/a` spelling across the report.

**Sections to render (R3).** The spend rollup via `formatSummary`, then the four forensic sections the
spend summary cannot express: per-tool time cost, per-tool token and result-byte cost, detected loops
(`loops[]`), and the session leaderboard (`bySession[]`). These map 1:1 onto artifact keys — if a
section needs a value the artifact does not carry, that is a 0474 defect to raise, not a reason to
query.

**Staleness banner (R7).** Printed **before** the report, not appended, and only when no explicit path
was given — an operator who named a file knows what they asked for. It states the artifact's age.
This is detection layer 1 of the four in 0464 § R8; it is the one that catches "the whole loop
stopped".

**Anti-patterns:**

- Do **not** open the database. No `getDb`, no `DbAdapter` import, no "just to fill in the gap when
  the artifact is missing". A missing artifact is an error message, not a fallback query.
- Do **not** re-implement the spend layout. `formatSummary` + `artifactToSummary` or it is not R2.
- Do **not** render anything before the version check passes.
- Do **not** print `0` for an unmeasured value.
- Do **not** synthesize a missing field to keep rendering. An artifact missing a required key is a
  malformed artifact — fail loud with its path.
- Do **not** widen scope into writing artifacts, fan-out, or scheduling. Those are 0474 / 0470 / 0471.

**Handoff.**

- **Assumes from dep 0474:** the artifact shape, `HISTORY_ARTIFACT_SCHEMA_VERSION`, `selectorDigest`,
  the `latest.json` pointer, the `.spur/reports/history/<date>/` layout, and an exported `formatRatio`.
  All are 0474's to define — this task consumes them and must not redefine any. If a needed field is
  absent, raise it against 0474 rather than adding a field here.
- **Leaves for 0470:** `coverage[].status` renders as `ok` / `failed` / `empty`; 0470 populates those
  values. Render all three states now so fan-out needs no renderer change.
- **Leaves for 0471:** the rendered report path is what 0471 R7 surfaces through the daily-summary
  surface. Keep the sidecar path derivable from the artifact path (same dir, `.md` extension) so 0471
  does not need a new lookup.

**ADR: no.** Surface-level; `docs/04_DESIGN.md` §`spur history report`, same commit (T3).
### Plan
- [ ] **0. Confirm 0474 landed.** The artifact types, `HISTORY_ARTIFACT_SCHEMA_VERSION`, the
      `latest.json` pointer, and the exported `formatRatio` must exist. If any is missing, stop and
      raise it against 0474 — do not define it here. Baseline `bun run lint` green.
- [ ] **1. Fixture first.** Commit a small artifact fixture exercising every rendered key:
      `byTool`, `loops`, `bySession`, `coverage` with `ok`/`failed`/`empty`, and a bucket whose
      `durationUnmeasured` equals its `toolCalls`. Every later test reads this fixture.
- [ ] **2. Version gate (R4).** Implement resolve → read → parse → version-check, ahead of any
      rendering. Test that an artifact with an unknown `schemaVersion` produces the path, the expected
      version, a non-zero exit, and **no** partial output.
- [ ] **3. Spend section via reuse (R2).** `artifactToSummary` + `formatSummary`. Test that the
      rendered spend block is byte-identical to `formatSummary` called on the adapted summary — that
      assertion is what stops a re-implementation from creeping in.
- [ ] **4. Forensic sections (R3).** Per-tool time, per-tool tokens/result-bytes, `loops`, and the
      session leaderboard. Test each appears with fixture values.
- [ ] **5. Unavailable, never zero (R5).** Render `n/a` via the existing `formatRatio` convention when
      `durationUnmeasured === toolCalls`. Test the timing column reads `n/a` and the string `0` does
      not appear in that cell.
- [ ] **6. Path resolution (R6).** `resolveArtifactPath` — explicit argument wins, else `latest.json`.
      Test with several dated artifact dirs that the pointer resolves to the newest, and that an
      explicit path overrides it.
- [ ] **7. Staleness banner (R7).** Print before the report when the resolved artifact is older than
      `STALENESS_THRESHOLD_HOURS` and no explicit path was given. Test both sides of the boundary
      (35 h quiet, 37 h loud) with an injected clock — never the real one.
- [ ] **8. Markdown sidecar (R8).** `renderMarkdown` written beside the JSON, same basename, `.md`
      extension. Test the file lands at the derived path with the rendered content.
- [ ] **9. Prove the DB is never touched (R1).** Run the command against a fixture with **no**
      database configured or reachable; assert it renders in full. This is the contract's regression
      guard — a unit test that merely avoids calling `getDb` does not prove it.
- [ ] **10. CLI wiring.** Replace the stub at `apps/cli/src/commands/history.ts:39-52`. `--json`
      emits the artifact as read; the default prints the rendered report. Confirm the reserved-stub
      message is gone.
- [ ] **11. Docs (T3).** Update `docs/04_DESIGN.md` §`spur history report` — it currently documents
      the reserved stub — in this commit.
- [ ] **12. Gates.** `bun run autofix && bun run spur-check`; `bun run lint`, `bun run test`,
      `bun run build` green. Targeted `bun test <file> --test-name-pattern <test>` while iterating.
- [ ] **13. Record.** `### Solution` gets the `path:line` change map; `### Testing` gets the commands,
      the no-database evidence from step 9, and the coverage claim.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
