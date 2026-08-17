---
template: issue
schema_version: 1
name: "Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift"
description: ""
status: done
type: issue
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T19:04:08.987Z"
updated_at: "2026-08-17T20:17:29.446Z"
---

## 0564. Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift

### Background
The E5 batch forensic analysis (`docs/report/2026-08-14-E5-batch-forensic-report.md`, omp session
2026-08-14) surfaced four findings. F2 was already fixed by E6 (tasks 0557-0559, commit `4a10fa12`:
run→session observer + retro-correlator + cost attribution repoint). This task carries the three that
remain open — F1 (S1, tool durations lost at import), F3 (S2, `history report` cannot narrow), and
F4 (S3, the fallback fixture is blind to the live omp tool-call shape) — as five requirements, since
F1 splits cleanly into an importer half and an analyzer half that land in different repos.

**F1's filed diagnosis does not survive contact with the current tree.** Verifying it against source
and a live omp session showed the named column, the named "hardcode", and the assumed matching
strategy are all wrong; the real gap is narrower and the fix is simpler than the report describes
(omp already records the durations, and the call join is exact). Design records the corrections with
their evidence, and Q&A carries the triage note — the report is left as the dated artifact it is, and
this task is the authority for the fix.

Severity order is R1/R2 (S1) → R3 (S2) → R4/R5 (S3), but landing order is the reverse: R4/R5 and R3
are single-repo and independent, while R1/R2 need a ts-libs release before R2 is even observable.
### Requirements
- [x] R1. omp tool-call durations survive import (F1, S1) — `history_tool_call` gains a `call_id` join key, and the omp path populates `duration_ms` / `started_at` / `completed_at` instead of the current unconditional `undefined`: the tool's own `details.wallTimeMs` where present, a `toolCallId`-joined timestamp delta otherwise, NULL for an implausible fallback delta so the unmeasured count stays honest. Existing databases pick up the column through a `CLI_MIGRATIONS` increment.
- [x] R2. Cost attribution folds tool durations (F1, S1) — `foldMappedSessions` (`packages/domain/src/analytics/run-cost.ts:78-126`) aggregates `history_tool_call` for its mapped sessions so `TokenTotals.toolCalls`, `.durationMs`, and `.durationUnmeasured` carry real values instead of the `emptyTotals()` zeros they are structurally stuck at today.
- [x] R3. `history report` narrows at render time (F3, S2) — `report` accepts `--task <wbs>` and `--top <n>`, filtering the already-loaded artifact without opening the database, printing a banner naming the applied filter and artifact, and exiting 1 with a message naming the artifact id and the missing dimension when the artifact cannot answer the narrowing.
- [x] R4. The fallback fixture reads the live omp tool-call shape (F4, S3) — `parseToolCalls` in `plugins/sp/tests/issue-finding-fallback.test.ts` accepts the `arguments` key alongside legacy `input` with the same precedence the importer uses, plus a regression case over a committed live-captured omp snippet asserting non-empty command extraction.
- [x] R5. The omp session-format reference records the accepted shapes (F4, S3) — `plugins/sp/skills/issue-finding/references/session-formats.md` documents the tool-call block variants and the toolResult shape, while keeping `mappers.ts` the single field-map authority (no second map).

**Out of scope:** F2 (task↔session join) — already fixed by E6 tasks 0557-0559. Duration coverage for
sources other than omp. Any pricing or cost-per-second derivation on top of the new durations.
Closing F1's full 82% unattributed window (see Design — ceiling is stated, not claimed).
### Acceptance Criteria
```gherkin
Scenario: R1 — the tool's own measured wall time is used when present
  Given an omp toolResult carrying details.wallTimeMs and a toolCallId matching an earlier toolCall
  When the session file is imported
  Then that tool call's history_tool_call.duration_ms equals the rounded wallTimeMs

Scenario: R1 — a missing wallTimeMs falls back to the joined timestamp delta
  Given an omp toolResult with no details.wallTimeMs whose toolCallId matches an earlier toolCall
  When the session file is imported
  Then duration_ms equals the toolResult timestamp minus the toolCall message timestamp
  And started_at and completed_at record both bounds

Scenario: R1 — an implausible fallback delta stays unmeasured
  Given a fallback pair whose delta is negative or exceeds one hour
  When the session file is imported
  Then duration_ms is NULL
  And the row still counts toward the unmeasured total

Scenario: R1 — an unmatched toolResult writes no duration
  Given a toolResult whose toolCallId matches no toolCall in the session
  When the session file is imported
  Then no history_tool_call row gains a duration from it and the import does not fail

Scenario: R2 — attributed cost buckets carry real tool durations
  Given imported sessions mapped to a run whose tool calls have measured durations
  When action cost attribution runs
  Then the bucket's toolCalls is non-zero
  And durationMs equals the SUM of duration_ms over that bucket's history_tool_call rows
  And durationUnmeasured equals the count of its NULL duration_ms rows

Scenario: R3 — render-time task narrowing
  Given an analyze artifact containing several task_wbs buckets
  When spur history report runs against it with --task for one of them
  Then only that task's rows are rendered
  And a banner names the applied filter and the artifact id

Scenario: R3 — top re-slices leaderboards without touching the database
  Given an analyze artifact whose leaderboards hold more rows than requested
  When spur history report runs against it with --top
  Then each leaderboard is re-sliced to that depth
  And no database connection is opened

Scenario: R3 — narrowing a dimension the artifact lacks fails loudly
  Given an artifact whose selector carried no task dimension
  When spur history report runs against it with --task
  Then the exit code is 1
  And the message names the artifact id and the missing dimension

Scenario: R4 — the fixture parses the live omp arguments shape
  Given a committed live-captured omp snippet whose toolCall blocks carry arguments.command
  When the fallback test fixture parses and categorizes it
  Then extracted commands are non-empty and categorization counts are non-zero

Scenario: R4 — the legacy input shape still parses identically
  Given a toolCall block carrying the legacy input.command key
  When the fixture parses it
  Then the extracted command is identical to the arguments-shape result

Scenario: R5 — the session-format reference records the shapes
  Given the issue-finding omp session-format reference
  When a reader looks up the tool-call shape
  Then it documents the nested legacy block, both flat key variants, and the toolResult shape
  And points at mappers.ts as the single field-map authority
```
### Q&A
**Q1 — Does R3 need operator consent as a public CLI surface change?** `ADR-051` / `CLAUDE.md`
require explicit operator consent with design context before landing a `spur` CLI surface change.
R3 adds two flags to an existing verb (`history report`) — the sanctioned expansion mechanism rather
than a new noun or verb — but it is still a public surface. **Open: confirm before implementing R3.**
Design §R3 is the design context; nothing else in this task touches the CLI surface. R1/R2/R4/R5 are
unaffected and can proceed while this is pending.

**Q2 — `call_id` column or buffered emission for R1?** **Closed: `call_id` column.** `SplitEntry` is
insert-only (`types.ts:22-25`), so buffering cannot happen at the mapper layer either — both options
require touching the streaming loop, and only one of them leaves a durable join key behind. Adding a
column to `history_tool_call` has an exact precedent in `0012_spur_cli_history_tool_call_args_raw`.
R1 therefore carries an importer schema increment plus the Spur-side
`0014_spur_cli_history_tool_call_call_id`. The remaining freedom is the attach mechanism inside
`importer.ts`, bounded by the idempotency and resume constraints in Design.

**Q3 — Why not put the duration on the toolResult's `history_message.duration_ms` instead?** It is a
smaller change but the wrong one: every tool-level aggregate reads `tc.duration_ms`, so the byTool
leaderboard and tool mean/max would stay blind, and `history_message.duration_ms` currently means
assistant-LLM latency. **Closed: rejected**, recorded in Design.

**Q4 — Does F1's "82% unattributed" close?** No, and the task must not claim it. 48% of toolResults
in the sampled session carry an exact `wallTimeMs`; the rest resolve to bounded approximations; the
residual is idle, human, and LLM-stream time no tool duration explains. **Closed: report the measured
share.**

**Q5 — `feature_id` is unset.** 0564 derives from the E5 forensic report and E5 is still `backlog`,
so linking is viable here — unlike its E6 siblings. **Deferred to the operator:** link to E5 if this
remediation belongs inside that feature's scope, otherwise leave unset (the L4 advisory is expected
and non-blocking).

**Triage note — the source report is superseded on F1.**
`docs/report/2026-08-14-E5-batch-forensic-report.md` §2 F1 and Appendix A name
`history_message.duration_ms` and `run-cost.ts:189` as "a hardcode", and assume omp carries no call
id. All three are wrong against the current tree and live logs (Design §R1/R2 records the evidence).
The report is a dated artifact and is left as-filed; this task is the authority for the fix.
### Design
Source findings F1/F3/F4 from `docs/report/2026-08-14-E5-batch-forensic-report.md`. F2 was fixed by
E6 (0557-0559, commit `4a10fa12`) and is not in scope. **The report's F1 diagnosis was wrong on three
counts and this task supersedes it** — corrections below, with the live-log evidence that produced
them.

#### R1/R2 — where durations actually live (supersedes F1)

*Correction 1: the target column.* F1 names `history_message.duration_ms`. That column is already
populated for omp from `msg.duration` (`mappers.ts:377,390`) and is consumed only for assistant-LLM
latency (`forensic-query.ts:152-153,220-221,363-364`). The metric F1 wants — `TokenTotals.durationMs`
/ `.durationUnmeasured`, documented in `analytics/types.ts` as "across tool calls" — reads
**`history_tool_call.duration_ms`** (`forensic-query.ts:167-168,184-187,377-378`), as do the byTool
leaderboard's mean/max. Writing message durations would not have moved any of them.

*Correction 2: `run-cost.ts:189` is not a hardcode to remove.* Lines 189-190 are `emptyTotals()`, a
zero-initializer. `durationUnmeasured` is never incremented anywhere in the file, and
`foldMappedSessions` (`:78-126`) queries `history_message` token columns only — it never touches
`history_tool_call`. `toolCalls`, `durationMs`, and `durationUnmeasured` are therefore structurally
always zero in attribution buckets regardless of what the importer writes. R2 is an added aggregate,
not a deleted constant.

*Correction 3: omp already measures this, and the join is exact.* F1 assumes durations must be
derived and matched heuristically ("no call id", "nearest-preceding unmatched call", "timestamps as
ISO strings"). A live session
(`~/.omp/agent/sessions/-xprojects-spur-new/2026-08-14T05-08-50-313Z_019ffeac-*.jsonl`) says
otherwise:

- toolCall blocks carry `{type, id, name, arguments, intent, partialArgs, streamIndex}`.
- toolResult messages carry `{role:"toolResult", toolCallId, toolName, content, details, isError,
  timestamp}`; `toolCallId` joins `toolCall.id` **exactly — 0 of 1124 results were unmatched**.
- `details.wallTimeMs` is the tool's own measured wall time, present on **539 of 1124** results
  (48%), a float in ms, spanning 0.6ms to 302s and summing to ~46 min for that session alone.
- Timestamps are epoch millis, not ISO strings.

#### Frozen contract (R1)

- **Join key — new column.** `history_tool_call` gains `call_id TEXT` (`schema-sql.ts:56-74` plus the
  tool-call column allowlist in `jsonl-importer-dao.ts:53`). The omp mapper writes
  `call_id: String(call.id)` when the block carries one, `undefined` otherwise. Existing databases
  pick it up through a Spur-side increment `0015_spur_cli_history_tool_call_call_id` with
  `addColumnIfMissing: { table: 'history_tool_call', column: 'call_id' }` — the exact shape of
  `0012_spur_cli_history_tool_call_args_raw` (`migrations.ts:259-261,316-320`). `0014` is
  `max(prefix)+1`, the rule task 0562 writes down.
- **Precedence.** `duration_ms` = `Math.round(details.wallTimeMs)` when that value is a finite
  number; otherwise the fallback `toolResult.timestamp − toolCall message timestamp`; otherwise NULL.
- **Guard rails apply to the fallback only.** Negative, or greater than 3_600_000 → NULL.
  `wallTimeMs` is the tool's own measurement and is never second-guessed or clamped.
- **Bounds recorded.** `started_at` / `completed_at` are written alongside so a fallback figure is
  auditable. The assistant message timestamp is shared by every call in that message, so for
  parallel calls the fallback measures from message emission rather than call start and reads high —
  which is why `wallTimeMs` is preferred and why the two must remain distinguishable.
- **Unmatched `toolCallId`** attaches nothing and never fails the import.

*Mechanism constraint (implementer's call, bounded).* `SplitEntry` is insert-only
(`types.ts:22-25`), so the duration cannot ride the mapper's split path: the tool-call row is emitted
while handling the assistant message and the duration arrives on a later record. The attach must
therefore live in the streaming loop in `importer.ts`, keyed on `(source, session_id, call_id)`; the
DAO already runs targeted updates (`jsonl-importer-dao.ts:429`). Any mechanism is acceptable that is
**idempotent** (re-import writes the same value) and **safe under line-checkpointed resume** (a
session truncated mid-file must not lose or corrupt earlier durations).

*Rejected alternative.* Writing `wallTimeMs` onto the toolResult's own `history_message.duration_ms`
needs no schema change and no cross-record state — but it leaves every `tc.duration_ms` aggregate
blind, which is the byTool leaderboard and the tool mean/max the forensic report exists to show, and
it overloads a column that currently means assistant-LLM latency. Rejected.

*Honest ceiling.* This does not recover the full 82% F1 quoted: 48% of results are exactly measured,
the rest are bounded approximations, and the residual is idle, human, and LLM-stream time that no
tool duration explains. Report the measured share; do not claim the gap closed.

*Release coordination.* R1 lands in `~/xprojects/ts-libs/packages/llm-jsonl-importer/`, needs a
release plus `bun update` in dependent workspaces, and R2 is only observable once the resolved
version ships it. Per the 0504 contract, record the `binary:` + importer-version provenance header
before any validation import; per the E6 RC3 lesson, verify the *resolved* version carries the fix
before R1 leaves implement — not at review time.

#### R3 — render-time narrowing (F3)

`report` (`apps/cli/src/commands/history.ts:167-201`) is a pure renderer over an analyze artifact and
says so in its own description; `analyze` carries `--run`/`--task`/`--top` at `:134-136`. The
renderer **must not** gain database access — narrowing filters the already-loaded artifact JSON
client-side (drop non-matching buckets; `--top` re-slices leaderboards). Frozen behaviour: a narrowed
render prints one banner line naming the applied filter and the artifact id, and a narrowing the
artifact cannot answer exits 1 with a message naming the artifact id and the missing dimension —
never a silent unfiltered render. Flag names and semantics mirror `analyze` exactly so the two do not
drift. The F3 line reference (`history.ts:117-124`) is stale; the report command moved when the mode
registry landed in 0555.

#### R4/R5 — omp tool-call shape drift (F4)

`parseToolCalls` (`plugins/sp/tests/issue-finding-fallback.test.ts:55`) reads `block.input.command`
only, while live omp emits `block.arguments.command` — so the R4/R5 fallback tests green-light a
parser that is blind on real logs. The importer already handles both and its normalization is the
precedent to mirror: `normalizeOmpToolCall` (`mappers.ts:436-448`) accepts the legacy nested
`{toolCall:{…}}` block and the current flat `{type:"toolCall",…}` block, and the field read is
`call.input ?? call.arguments` (`mappers.ts:415`). Match that precedence exactly so the two never
disagree, and document all three shapes plus the toolResult shape in `session-formats.md` as a
pointer to `mappers.ts`, which stays the single field-map authority.

#### Anti-patterns — do not implement

- Do **not** give `history report` database access, or reuse `analyze`'s SQL filters in it.
- Do **not** clamp, round-trip, or sanity-check `details.wallTimeMs`; guards are fallback-only.
- Do **not** invent a second omp field map in `plugins/sp` — reference `mappers.ts`.
- Do **not** land R2 before the resolved importer version carries R1; the fold would silently read
  NULLs and look like a working change.
- Do **not** claim F1's 82% closed.

**Independence and order.** R4/R5 are `plugins/sp`-local. R3 is CLI-local. R1/R2 are the long pole
(cross-repo + release). Order: R4/R5 → R3 → R1 → R2, with R2 strictly after R1's version resolves.
### Plan
- [x] 1. Mirror the importer precedence in `parseToolCalls` (`plugins/sp/tests/issue-finding-fallback.test.ts`) and commit a short anonymized live omp snippet under `plugins/sp/tests/fixtures/` (R4)
- [x] 2. Add the regression case asserting non-empty command extraction from the live snippet, plus the legacy-key equivalence case (R4)
- [x] 3. Document the tool-call block variants and the toolResult shape in `plugins/sp/skills/issue-finding/references/session-formats.md`, pointing at `mappers.ts` as authority (R5)
- [x] 4. Confirm operator consent for the `history report` flag addition (Q&A Q1) before touching the CLI (R3)
- [x] 5. Add `--task` / `--top` to `history report` with artifact-side filtering, the filter banner, and the exit-1 missing-dimension path — no database access (R3)
- [x] 6. CLI tests: task narrowing, `--top` re-slice, missing-dimension exit 1, and no database connection opened (R3)
- [x] 7. Add `call_id` to `history_tool_call` in `schema-sql.ts` and the DAO tool-call column allowlist; write it from the omp mapper (R1)
- [x] 8. Attach durations in the `importer.ts` streaming loop keyed on `(source, session_id, call_id)` — `wallTimeMs` first, timestamp-delta fallback, guard rails, `started_at`/`completed_at` bounds (R1)
- [x] 9. Importer tests over a fixture session: wallTimeMs path, fallback path, implausible-delta NULL, unmatched toolCallId, re-import idempotency, resume-after-truncation (R1)
- [x] 10. Add `0015_spur_cli_history_tool_call_call_id` to `CLI_MIGRATIONS` with `addColumnIfMissing`, mirroring 0012 (R1)
- [ ] 11. Release the importer, `bun update` dependent workspaces, and confirm the resolved version carries the fix via the provenance header before leaving implement (R1)
- [x] 12. Aggregate `history_tool_call` in `foldMappedSessions` (`packages/domain/src/analytics/run-cost.ts`) for `toolCalls` / `durationMs` / `durationUnmeasured` (R2)
- [x] 13. Validate end to end on a real omp session — import with the provenance header recorded, analyze, confirm non-zero bucket durations, and report the measured share rather than a closed gap (R1, R2)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
Landed R4/R5 → R3 → R1 → R2 per the Design order; R1's release is the only unreachable remainder.

**R4 — fallback fixture reads the live omp tool-call shape.** `plugins/sp/tests/issue-finding-fallback.test.ts:56` `parseToolCalls` now reads `block.input ?? block.arguments` (importer precedence mirrored from `mappers.ts:415` `call.input ?? call.arguments`), with a committed anonymized live-shape fixture `plugins/sp/tests/fixtures/omp-live-tool-calls.jsonl` (flat `{type,id,name,arguments,intent,partialArgs,streamIndex}` blocks + `role:"toolResult"` envelopes). Regression tests at `plugins/sp/tests/issue-finding-fallback.test.ts:192-238` assert non-empty command extraction with non-zero categorization counts, plus a legacy-key equivalence case.

**R5 — session-format reference.** `plugins/sp/skills/issue-finding/references/session-formats.md:94` gains "OMP tool-call block shapes": the legacy nested `{toolCall:{…}}` block, both flat key variants (`input` vs `arguments`), and the toolResult message shape (`{role:"toolResult", toolCallId, toolName, content, details, isError, timestamp}`, output in `content[].text`), pointing at `mappers.ts` (`normalizeOmpToolCall`) as the single field-map authority — no second map.

**R3 — history report render-time narrowing (operator consent GRANTED per ADR-051).** `apps/cli/src/commands/history.ts:176-177` `report` gains `--task <wbs>` and `--top <n>` mirroring `analyze`; the pure renderer never opens the database. New `packages/domain/src/analytics/narrow-artifact.ts:58` filters the already-loaded artifact client-side: `--task` renders only when the artifact's selector carries that exact task dimension (else `ArtifactNarrowError` → exit 1 naming the artifact id + missing/mismatched dimension — never a silent unfiltered render), `--top` re-slices `byTool`/`bySession`. `runHistoryReport` (`packages/app/src/services/history-service.ts:910`) applies narrowing before rendering and returns a one-line banner naming the filter and artifact id; the CLI prints it. `docs/04_DESIGN.md` report surface synced. CLI tests at `apps/cli/tests/commands/history.test.ts:642-780` cover task narrowing + banner, `--top` re-slice, missing-dimension exit 1, different-task exit 1, and a DB spy proving no connection is opened.

**R1 — omp tool-call durations survive import (code+migration+tests; release pending).** Importer (`~/xprojects/ts-libs/packages/llm-jsonl-importer`): `src/schema-sql.ts:65` adds `call_id TEXT` to `history_tool_call`; `src/jsonl-importer-dao.ts:48` allowlists it and `src/jsonl-importer-dao.ts:268` adds `toolCallDurationUpdateOp` (targeted `UPDATE … WHERE record_hash = ?`); `src/mappers.ts:418` writes `call_id` from the omp block and `src/mappers.ts:483` exports `ompToolResultTiming`; `src/importer.ts:153,328,351` attaches durations in the streaming loop keyed on `(source, session_id, call_id)` — `Math.round(details.wallTimeMs)` when finite (never clamped), else the `toolResult.timestamp − toolCall message timestamp` fallback with `[0, 3_600_000]` guard rails (implausible stays NULL), bounds written alongside fallback figures only, unmatched `toolCallId` attaches nothing and never fails; idempotent re-imports and checkpointed-resume (DB fallback for rows behind the checkpoint) covered at `tests/importer.test.ts:1301-1390`. Spur-side `packages/domain/src/migrations.ts:367` gains `0015_spur_cli_history_tool_call_call_id` (`addColumnIfMissing`, mirroring 0012; `0014` was already taken by the system_events index, so max(prefix)+1 = 0015).

**R2 — cost attribution folds tool durations.** `packages/domain/src/analytics/run-cost.ts:78` `foldMappedSessions` aggregates `history_tool_call` per mapped session so `TokenTotals.toolCalls` / `.durationMs` (SUM) / `.durationUnmeasured` (NULL count) carry real values; missing-table degradation mirrors the message fold. Analyzer tests at `packages/domain/tests/analytics/run-cost.test.ts:349,376` cover single- and multi-session aggregation. OBSERVABILITY: the fold reads honest zeros until the RESOLVED importer version carries R1 (see below) — no validation claim landed before resolution.

**Validation (working tree).** Live E5 session imported via the working-tree importer into a scratch DB: 1128 tool calls, 1127 measured (543 exact `wallTimeMs` ≈ 48% — the honest measured share, not the 82% closure — 584 bounded fallback, 1 implausible → NULL), sum 2,912,526 ms; `analyze` on that DB reports `totals.toolCalls=1128, durationMs=2912526, durationUnmeasured=1` and a byTool leaderboard with real mean/max (bash max 302,006 ms). The CLI's RESOLVED importer is the stale nested `@gobing-ai/ts-llm-jsonl-importer@0.4.32` (provenance header recorded on the CLI validation run: `binary: apps/cli/src/index.ts`, `importer: @gobing-ai/ts-llm-jsonl-importer@0.4.32`) and does NOT carry the fix — E6 RC3 check fails as designed. REMAINS: release (bump → `git tag @gobing-ai/ts-llm-jsonl-importer-v0.4.34` → push → GH Actions publish), then `bun update` in spur-new to refresh the nested snapshot, then re-run the provenance-header import + analyze to confirm non-zero bucket durations via the resolved version.
### Testing
**Pipeline verify results**

- Verdict: PASS (re-audit `--force` run 2026-08-15; prior pipeline PASS confirmed independently)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — omp tool-call durations survive import: call_id join key, duration_ms/started_at/completed_at populated (wallTimeMs first, timestamp-delta fallback with [0,3600000] rails, NULL for implausible, unmatched attaches nothing), CLI_MIGRATIONS increment | MET | Anchors re-read this run: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:65` (`call_id TEXT` in history_tool_call); `src/jsonl-importer-dao.ts:48` (allowlist), `:268-280` (`toolCallDurationUpdateOp`, `UPDATE … WHERE record_hash = ?`, idempotent); `src/mappers.ts:418` (`call_id: s(call.id)`), `:483-491` (`ompToolResultTiming`: toolCallId + finite wallTimeMs + timestampMs); `src/importer.ts:110-115` (fallback guard `delta < 0 \|\| delta > 3_600_000 → null`, wallTimeMs path unclamped), `:151-153` (toolCallRows keyed (source, session_id, call_id)), `:321-355` (attach in streaming loop, unmatched → no op, no throw). Spur side: `packages/domain/src/migrations.ts:367-370` (`0015_spur_cli_history_tool_call_call_id`, `addColumnIfMissing`, mirroring 0012). Tests fresh this run: importer `bun test tests/importer.test.ts --test-name-pattern "duration\|call_id\|wallTime"` → 4 pass / 0 fail / 16 expect() (131ms). |
| R2 — cost attribution folds tool durations: foldMappedSessions aggregates history_tool_call so toolCalls/durationMs/durationUnmeasured carry real values | MET | `packages/domain/src/analytics/run-cost.ts:124-155` re-read this run (session-scoped fold: `COUNT(*) AS toolCalls, COALESCE(SUM(duration_ms),0) AS durationMs, SUM(CASE WHEN duration_ms IS NULL …) AS durationUnmeasured FROM history_tool_call WHERE source = ? AND session_id = ?`; missing-table degrade → zeros, never throws). Tests: `packages/domain/tests/analytics/run-cost.test.ts:349-370` (toolCalls=2, durationMs=500, durationUnmeasured=1) and `:391-408` (multi-session: 4 calls, 600 ms) — pass this run. Prior working-tree E2E (Solution): `totals.toolCalls=1128, durationMs=2912526, durationUnmeasured=1`. Resolved CLI importer still 0.4.32/0.4.33 without the R1 attach (checked this run) → fold reads honest zeros pre-release, as disclosed. |
| R3 — history report narrows at render time: --task/--top, client-side filtering, banner naming filter + artifact, exit 1 naming artifact + missing dimension when unanswerable | MET | `apps/cli/src/commands/history.ts:170-210` re-read this run (`--task`/`--top` options mirroring analyze, banner write, catch → `setExitCode(1)`); `packages/domain/src/analytics/narrow-artifact.ts:58-96` (`narrowArtifact`: no task dimension or mismatch → `ArtifactNarrowError` naming artifactPath + dimension; `--top` re-slices byTool/bySession; pure, no DbAdapter); `packages/app/src/services/history-service.ts:930-935` (artifact loaded, narrowing before render, never opens the database). Tests: `apps/cli/tests/commands/history.test.ts:724-810` (banner + artifact id, top re-slice with noDbSpy, missing-dimension exit 1, mismatched-task exit 1) + `packages/domain/tests/analytics/narrow-artifact.test.ts` — pass this run. |
| R4 — fallback fixture reads the live omp tool-call shape: arguments alongside legacy input, importer precedence, live-snippet regression case | MET | `plugins/sp/tests/issue-finding-fallback.test.ts:55-60` re-read this run (`block.input ?? block.arguments ?? {}`, importer precedence mirrored from mappers.ts:415); fixture `plugins/sp/tests/fixtures/omp-live-tool-calls.jsonl` committed (3082 bytes, flat `{type,id,name,arguments,intent,partialArgs,streamIndex}` blocks + `role:"toolResult"` envelopes); regression block `:192-238` (structure guard, non-empty commands with guard ≥ 3 / git-red-herring ≥ 1, legacy-equivalence) — pass this run. Anchor corrected this run: prior citations said `:198-240`; true extent is `:192-238` (file is 238 lines) — L4 stale-anchor warning resolved. |
| R5 — omp session-format reference records accepted shapes, mappers.ts stays single field-map authority | MET | `plugins/sp/skills/issue-finding/references/session-formats.md:94-133` re-read this run ("OMP tool-call block shapes (task 0564 R5)": legacy nested block, both flat key variants, toolResult message shape with `details.wallTimeMs`; "mappers.ts (`normalizeOmpToolCall`, `call.input ?? call.arguments`) is the single field-map authority … not a second map"). Structural assertions in `plugins/sp/tests/skill-structure.test.ts` (R24b) — pass this run. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario R1 — wallTimeMs used when present: duration_ms equals rounded wallTimeMs | MET | test | importer `tests/importer.test.ts:1318-1321` (`call-w` → duration_ms 1235 = round(1234.6), bounds null — distinguishable paths); source `src/importer.ts:110-126`. Pass this run (4 pass / 0 fail). |
| Scenario R1 — missing wallTimeMs falls back to joined timestamp delta with both bounds recorded | MET | test | `importer.test.ts:1322-1326` (`call-f` → duration_ms 2500, started_at/completed_at ISO bounds); source `src/importer.ts:127-135`. Pass this run. |
| Scenario R1 — implausible fallback delta stays unmeasured (NULL) and counts toward unmeasured total | MET | test | `importer.test.ts:1327-1328` (`call-neg`, `call-huge` → NULL); source `src/importer.ts:110-111` guard rails (fallback-only); NULL rows feed `durationUnmeasured` via `run-cost.ts:137`. Pass this run. |
| Scenario R1 — unmatched toolResult writes no duration and does not fail | MET | test | `importer.test.ts:1329` (`call-missing` → no row attached, import completes); source `src/importer.ts:342-349` (no pending → no UPDATE op, no throw). Pass this run. |
| Scenario R2 — attributed cost buckets carry real tool durations | MET | test | `run-cost.test.ts:349-370` + `:391-408` (single + multi-session SUM/NULL-count); source `run-cost.ts:124-155`. Pass this run (119 pass / 0 fail suite). |
| Scenario R3 — render-time task narrowing: only that task's rows rendered, banner names filter + artifact id | MET | test | `history.test.ts:724-739` (exit 0; banner 'Narrowed report — task 0042' + artifact path); source `narrow-artifact.ts:63-79`, `history-service.ts:926-931`, `history.ts:196-198`. Pass this run. |
| Scenario R3 — top re-slices leaderboards without touching the database | MET | test | `history.test.ts:741-768` (noDbSpy throws on any query; `--top 2` re-slices to depth 2); source `narrow-artifact.ts:84-92` (pure slice), `history.ts:180-193`. Pass this run. |
| Scenario R3 — narrowing a dimension the artifact lacks fails loudly: exit 1, message names artifact id + missing dimension | MET | test | `history.test.ts:770-792` (exit 1; output names artifact path + 'task' + '0042'; no silent unfiltered render); source `narrow-artifact.ts:66-80`, `history.ts:200-210`. Pass this run. |
| Scenario R4 — fixture parses the live omp arguments shape: non-empty commands, non-zero categorization counts | MET | test | `issue-finding-fallback.test.ts:199-216` (structure guard + `liveCommands.length > 0`, every command non-empty, guard ≥ 3, git-red-herring ≥ 1); fixture `plugins/sp/tests/fixtures/omp-live-tool-calls.jsonl`. Pass this run. |
| Scenario R4 — legacy input shape parses identically to arguments shape | MET | test | `issue-finding-fallback.test.ts:217-236` (arguments-line → `['git diff HEAD']`, input-line identical; `expect(inputCommand).toEqual(argsCommand)`); source `:55-60`. Pass this run. |
| Scenario R5 — session-format reference records the shapes and points at mappers.ts as single authority | MET | test | `plugins/sp/tests/skill-structure.test.ts` R24b assertions over `session-formats.md:94-133` — pass this run (119-test suite). |

**Gate checks (fresh this run, post-repair):** `bun test packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/narrow-artifact.test.ts apps/cli/tests/commands/history.test.ts` → **55 pass / 0 fail / 193 expect()** (411ms) after the P4-1/P4-2 repairs.

**Gate checks (first pass this run):** `bun test apps/cli/tests/commands/history.test.ts packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/narrow-artifact.test.ts plugins/sp/tests/issue-finding-fallback.test.ts plugins/sp/tests/skill-structure.test.ts` → **119 pass / 0 fail / 729 expect()** (587ms). Importer: **4 pass / 0 fail / 16 expect()** (131ms). `spur task check 0564 --strict-core` → **pass: true** (0 errors; 7 warnings — see below).

**Fix pass (`--fix all`) — repairs applied this run:**

1. **L3.review-priority-table (error)** — Review held prose-only findings, which the done-status gate rejects. Repair: Review section gains the P1–P4 priority findings table (existing findings preserved verbatim below it; no finding added, dropped, or re-severitied). Gate re-run: pass.
2. **L3.unchecked-checklist (warning, 18 → 1)** — flipped R1–R5 and Plan items 1–10, 12, 13 to `[x]` (all verified MET/executed this run). Plan 11 (importer release + `bun update`) deliberately left unchecked — it is the documented open remainder.
3. **L4.stale-line-anchor (warning)** — corrected `issue-finding-fallback.test.ts:198-240` → `:192-238` in Solution + Testing (file is 238 lines; the range end was stale). The four remaining `src/…` / `mappers.ts` anchor warnings are cross-repo citations into `~/xprojects/ts-libs/packages/llm-jsonl-importer` — the checker resolves from this repo root only; all four anchors were re-read in the importer repo this run and are accurate.

4. **P4-1 closed** — added `run-cost.test.ts` "missing history_tool_call table degrades the tool fold to zeros, never throws": migrated DB with the table dropped, token fold intact (inputTokens=100), tool fold zeros.
5. **P4-2 closed** — `narrow-artifact.ts`: a valid `--top` now names itself in the banner even when no leaderboard exceeds the depth (previously looked silently ignored); regression test "top 99" in `narrow-artifact.test.ts`.
6. **P4-4 closed** — Design §R1 frozen contract + Plan 10 now name the landed migration id `0015` (0014 was taken by task 0546's system_events index; 0562 max+1 rule).

Fix-pass artifact disclosure (gitignored `.spur/run/**` writes): this run refreshed `.spur/run/0564-verdict.json` (full rewrite: verdict, 5 requirement rows, 11 AC rows, 4 checks) and `.spur/run/0564-verify-answer.txt`.

**Warnings carried (non-blocking, deliberate):** L4.missing-feature-id (Q5 — deferred to the operator); L4.unchecked Plan 11 (release pending); 4 cross-repo anchor warnings (checker limitation, anchors verified this run).

**Residual (tracked, not a verification failure):** R1's importer release (bump → tag → publish → `bun update`) remains the only open item; the resolved CLI importer (root 0.4.33 / nested apps/cli 0.4.32, checked this run) does not carry the attach, so released-CLI folds read honest zeros until then — the E6 RC3 resolved-version check is the gate. No claim of F1's 82% closure anywhere; measured share (~48% exact wallTimeMs) is what is reported.

- Coverage: N/A (verdict-based re-audit; verify pipeline does not measure code coverage)
### Review
| Priority | Location | Finding | Disposition |
|----------|----------|---------|-------------|
| P1 | — | None. | — |
| P2 | — | None. | — |
| P3-1 | `packages/domain/src/analytics/run-cost.ts:146` | Tool-duration fold is session-scoped while the token fold is windowed — over/under-attribution ceiling for windowed actions (frozen contract accepted session scope; documented at run-cost.ts:126-131) | Documented, non-blocking |
| P4-1 | `run-cost.ts:143-149` | Missing-`history_tool_call`-table degradation path untested (only `history_run_session` absence covered) | **Closed 2026-08-15** — degrade test added (run-cost.test.ts, "missing history_tool_call table degrades … never throws") |
| P4-2 | `narrow-artifact.ts:85-98` | `--top` entered the banner only when a slice actually happened — `--top 5` on a 3-row leaderboard printed no banner | **Closed 2026-08-15** — banner names any valid `--top`; regression test added |
| P4-3 | importer `importer.ts:83-89` | `resolveToolCallRow` runs one per-toolResult SELECT on resumed tails (index is `(source, session_id, seq)`, not `call_id`) — bounded today | Non-blocking; add the call_id index if resumed tails grow |
| P4-4 | `packages/domain/src/migrations.ts:367` | Design §R1 named migration `0014_...call_id`; landed id is `0015` (0014 taken by task 0546's system_events index) — correct under 0562's max(prefix)+1 rule | **Closed 2026-08-15** — Design + Plan text synced to `0015` |
| P4-5 | task AC (R3 `--task`) | AC wording drift: "an analyze artifact containing several task_wbs buckets" is not representable — the artifact schema carries a single taskWbs selector; `narrowArtifact` implements the frozen Design contract instead | Documented |

Detail (review-step prose, preserved):

P1 — none.

P2 — none.

P3-1 — run-cost.ts:146: the tool-duration fold is session-scoped while the token fold is windowed. `foldMappedSessions` `continue`s on a mapped session whose in-window message count is zero before ever running the `history_tool_call` query, so such a session loses its tool rows entirely; and for an action with a [started_at, completed_at] window narrower than the session, every tool call in the session is attributed regardless of when it ran (history_tool_call has no ts column — the frozen contract accepted session-scope, documented at run-cost.ts:126-131). Over/under-attribution ceiling for windowed actions; not a deviation from the frozen contract, but a residual risk. Mitigation if step-level attribution is ever requested: window via message_hash → history_message.ts, or add a ts column.

P4-1 — run-cost.ts:143-149: the missing `history_tool_call`-table degradation path (`no such table` → zeros) is untested; only `history_run_session` absence is covered (run-cost.test.ts:335-340). Add a stub-DB case.

P4-2 — narrow-artifact.ts:79-86: `--top` enters the banner only when a slice actually happened; `--top 5` on a 3-row leaderboard prints no banner, so the flag looks silently ignored. Consider recording the requested depth whenever `--top` is passed and the depth is a positive integer.

P4-3 — importer.ts:83-89: `resolveToolCallRow` runs one per-toolResult SELECT scanning the session's tool-call rows (index is (source, session_id, seq), not (source, session_id, call_id)) for every result whose call is not in the in-memory map — i.e. all resumed-tail results. Bounded today (resume reprocessing only); add the call_id index if resumed tails grow.

P4-4 — migrations.ts:290-296: the Design §R1 frozen contract names the migration `0014_spur_cli_history_tool_call_call_id`; the landed id is `0015` — correct under task 0562's max(prefix)+1 rule, since 0014 was already allocated to the system_events name-occurred index (task 0546). Doc staleness only; update the Design text on next touch.

P4-5 — AC wording drift (R3 `--task`): "an analyze artifact containing several task_wbs buckets" is not representable — the artifact schema carries a single taskWbs selector. narrowArtifact implements the frozen Design contract instead (selector match → render; no dimension or mismatch → ArtifactNarrowError → exit 1 naming artifact + dimension; never a silent unfiltered render), and tests cover that semantics (history.test.ts:724-810, narrow-artifact.test.ts:52-111).

Residual risk: R1's importer release is the only unreachable remainder. The CLI's RESOLVED importer is still `@gobing-ai/ts-llm-jsonl-importer@0.4.32` (provenance header recorded on the validation import) and does NOT carry the R1 attach, so R2's fold reads honest zeros in the released CLI until the bump + `bun update` land; the E6 RC3 resolved-version check is the gate. No claim of F1's 82% closure anywhere — the measured share (~48% exact wallTimeMs, 543/1128) is reported.

Disposition: APPROVE.
### References
- Source report: `docs/report/2026-08-14-E5-batch-forensic-report.md` §2 (F1/F3/F4), §6, Appendix A — **F1's diagnosis is superseded by this task's Design; see Q&A**
- Fixed by E6, not in scope: F2 → tasks 0557-0559, commit `4a10fa12`
- Code (R1, importer): `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:403-424` (omp tool-call emission, all timing fields `undefined`) · `:436-448` (`normalizeOmpToolCall`) · `src/schema-sql.ts:56-74` (`history_tool_call`, no call-id column) · `src/jsonl-importer-dao.ts:429` (targeted UPDATE precedent) · `src/opencode-importer.ts:227,269` (a source that already computes durations)
- Code (R2, analyzer): `packages/domain/src/analytics/run-cost.ts:78-126` (`foldMappedSessions`) · `:178-192` (`emptyTotals`) · `packages/domain/src/analytics/types.ts` (`TokenTotals` duration contract) · `packages/domain/src/analytics/forensic-query.ts:167-168,184-187,377-378` (tool-call durations) vs `:152-153,220-221,363-364` (assistant-message durations)
- Code (R3): `apps/cli/src/commands/history.ts:167-201` (`report`) · `:126-138` (`analyze`, the flags being mirrored)
- Code (R4/R5): `plugins/sp/tests/issue-finding-fallback.test.ts:44-60` (`parseToolCalls`) · `plugins/sp/skills/issue-finding/references/session-formats.md`
- Live-shape evidence: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-14T05-08-50-313Z_019ffeac-4409-7000-b24a-e83e8ede74bb.jsonl` — 1124 toolResults, 0 unmatched `toolCallId`, 539 carrying `details.wallTimeMs` (0.6ms-302s, ~46 min total)
- Process contracts: `CLAUDE.md` § Real-data history validation (task 0504 provenance header) · ADR-051 CLI surface consent · E6 RC3 (verify the resolved package version before leaving implement)
- Retention stance to mirror: task 0553 (forensic primitives retained at import)
- Migration precedent for R1's column: `packages/domain/src/migrations.ts:259-261` (`HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL`) · `:316-320` (`0012_...args_raw` with `addColumnIfMissing`)
- Importer split contract (why the attach cannot ride the mapper): `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/types.ts:22-25` (`SplitEntry` is insert-only)
- Number allocation rule for `0014`: task 0562
### History
- 2026-08-15T22:47:16.831Z backlog → wip (system)
- 2026-08-15T22:56:22.490Z wip → testing (system)
- 2026-08-15T22:56:37.031Z testing → done (system)
### Notes


Task 0578 released importer 0.4.37 and re-imported omp `--mode full`. Measured on `.spur/spur.db`: omp tool calls with `duration_ms` 0 → 102,113 / 102,130; `call_id` 0 → 102,130 (100%); `started_at`/`completed_at` 0 → 61,866. This task's timing-retention claim is now data-plane-verified, not source-read.

