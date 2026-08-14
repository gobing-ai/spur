---
template: issue
schema_version: 1
name: "Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift"
description: ""
status: backlog
type: issue
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: ["bug"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T19:04:08.987Z"
updated_at: "2026-08-14T19:37:19.974Z"
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
- [ ] R1. omp tool-call durations survive import (F1, S1) — `history_tool_call` gains a `call_id` join key, and the omp path populates `duration_ms` / `started_at` / `completed_at` instead of the current unconditional `undefined`: the tool's own `details.wallTimeMs` where present, a `toolCallId`-joined timestamp delta otherwise, NULL for an implausible fallback delta so the unmeasured count stays honest. Existing databases pick up the column through a `CLI_MIGRATIONS` increment.
- [ ] R2. Cost attribution folds tool durations (F1, S1) — `foldMappedSessions` (`packages/domain/src/analytics/run-cost.ts:78-126`) aggregates `history_tool_call` for its mapped sessions so `TokenTotals.toolCalls`, `.durationMs`, and `.durationUnmeasured` carry real values instead of the `emptyTotals()` zeros they are structurally stuck at today.
- [ ] R3. `history report` narrows at render time (F3, S2) — `report` accepts `--task <wbs>` and `--top <n>`, filtering the already-loaded artifact without opening the database, printing a banner naming the applied filter and artifact, and exiting 1 with a message naming the artifact id and the missing dimension when the artifact cannot answer the narrowing.
- [ ] R4. The fallback fixture reads the live omp tool-call shape (F4, S3) — `parseToolCalls` in `plugins/sp/tests/issue-finding-fallback.test.ts` accepts the `arguments` key alongside legacy `input` with the same precedence the importer uses, plus a regression case over a committed live-captured omp snippet asserting non-empty command extraction.
- [ ] R5. The omp session-format reference records the accepted shapes (F4, S3) — `plugins/sp/skills/issue-finding/references/session-formats.md` documents the tool-call block variants and the toolResult shape, while keeping `mappers.ts` the single field-map authority (no second map).

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
  pick it up through a Spur-side increment `0014_spur_cli_history_tool_call_call_id` with
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
- [ ] 1. Mirror the importer precedence in `parseToolCalls` (`plugins/sp/tests/issue-finding-fallback.test.ts`) and commit a short anonymized live omp snippet under `plugins/sp/tests/fixtures/` (R4)
- [ ] 2. Add the regression case asserting non-empty command extraction from the live snippet, plus the legacy-key equivalence case (R4)
- [ ] 3. Document the tool-call block variants and the toolResult shape in `plugins/sp/skills/issue-finding/references/session-formats.md`, pointing at `mappers.ts` as authority (R5)
- [ ] 4. Confirm operator consent for the `history report` flag addition (Q&A Q1) before touching the CLI (R3)
- [ ] 5. Add `--task` / `--top` to `history report` with artifact-side filtering, the filter banner, and the exit-1 missing-dimension path — no database access (R3)
- [ ] 6. CLI tests: task narrowing, `--top` re-slice, missing-dimension exit 1, and no database connection opened (R3)
- [ ] 7. Add `call_id` to `history_tool_call` in `schema-sql.ts` and the DAO tool-call column allowlist; write it from the omp mapper (R1)
- [ ] 8. Attach durations in the `importer.ts` streaming loop keyed on `(source, session_id, call_id)` — `wallTimeMs` first, timestamp-delta fallback, guard rails, `started_at`/`completed_at` bounds (R1)
- [ ] 9. Importer tests over a fixture session: wallTimeMs path, fallback path, implausible-delta NULL, unmatched toolCallId, re-import idempotency, resume-after-truncation (R1)
- [ ] 10. Add `0014_spur_cli_history_tool_call_call_id` to `CLI_MIGRATIONS` with `addColumnIfMissing`, mirroring 0012 (R1)
- [ ] 11. Release the importer, `bun update` dependent workspaces, and confirm the resolved version carries the fix via the provenance header before leaving implement (R1)
- [ ] 12. Aggregate `history_tool_call` in `foldMappedSessions` (`packages/domain/src/analytics/run-cost.ts`) for `toolCalls` / `durationMs` / `durationUnmeasured` (R2)
- [ ] 13. Validate end to end on a real omp session — import with the provenance header recorded, analyze, confirm non-zero bucket durations, and report the measured share rather than a closed gap (R1, R2)
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

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
