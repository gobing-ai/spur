---
template: feature-impl
schema_version: 1
name: "Implement the forensic ETL contract in ts-llm-jsonl-importer: per-entry targetTable, history_message + history_tool_call schema, six source mappers"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-08-07T00:43:06.432Z"
updated_at: "2026-08-07T00:55:26.364Z"
---

## 0466. Implement the forensic ETL contract in ts-llm-jsonl-importer: per-entry targetTable, history_message + history_tool_call schema, six source mappers

### Background
Implements the forensic ETL contract decided in **task 0455** (`### Design`), using the per-source
field maps from **task 0463** (`### Solution`, including the 2026-08-07 census addendum). Read both
before starting — this task deliberately does not restate their evidence.

**The problem being fixed.** `spur history import` runs today but discards ~99% of real transcripts:
measured yield is 826/90,411 lines for claude, 2,141/224,055 for codex, 1,023/1,476,470 for pi, and
zero for omp/agy/grok which have no source definition at all. The cause is structural, not a bug —
`@gobing-ai/ts-llm-jsonl-importer` maps every source through one generic flat `sourceDefinition`
(`src/sources.ts:56-101`) whose schema requires a top-level `content: string`, while every real agent
nests its payload. Tool calls, which are the substance of any step-forensics report, live in content
blocks that the generic mapping drops entirely.

**What this task delivers.** Upstream changes to `@gobing-ai/ts-llm-jsonl-importer` in
`~/xprojects/ts-libs/packages/llm-jsonl-importer`, developed against Spur via `bun link`:

1. A per-entry `targetTable` on the existing `custom` split seam, so one JSONL line can fan out into
   both a message row and its tool-call rows.
2. The two contract tables — `history_message`, `history_tool_call` — with typed columns and a typed
   insert path (the existing insert writes a generic `payload_json` blob, which cannot be indexed or
   grouped by `tool_name`).
3. Six real source mappers — claude, codex, pi, omp, agy, grok — replacing the generic flat map, plus
   correct roots and file patterns.
4. `unknown`-disposition capture and per-import counting, so format drift is loud rather than silent.

**Why upstream and not in Spur.** Operator ruling on the E1 map (2026-08-06): `~/xprojects/ts-libs`
packages are in scope to modify, and `AGENTS.md` prefers fixing the facade over a Spur-side
workaround. 0455 established that the `custom` split seam already accepts an arbitrary
`(raw) => readonly JsonObject[]` (`src/types.ts:21-25`, applied at `src/importer.ts:174-180`), so this
is an extension of an existing seam rather than a new one.

**Two non-obvious blockers found while specifying this** — both are addressed in `### Design`, and
neither is discoverable from the contract alone:

- `VALID_TABLE_NAME` is `/^history_etl_[a-z_]+$/` (`src/sources.ts:105`). `targetTableFor()` would
  **reject** `history_message` and `history_tool_call` outright.
- `insertRecord` (`src/jsonl-importer-dao.ts:106-128`) writes a fixed generic column set
  `(record_hash, source_file, source_line, split_index, payload_json, imported_at)`, and
  `ensureTargetTables` creates every table with that same generic DDL. Typed columns need a second
  insert path.

**Not in this task:** analyze, report, and the scheduled loop; checkpoint hardening and realpath
normalization of `source_file`; reading agy's `conversations/<uuid>.db` SQLite store (deferred by
0455); the deferred sources gemini, opencode, antigravity-ide, openclaw, hermes.

**No blocking dependencies.** This task's `dependencies[]` is empty and that is correct — the contract
it implements is already decided and closed. Checkpoint hardening runs concurrently in its own task
with no ordering constraint in either direction; both write `source_file`, so whichever lands second
rebases onto the other rather than re-deciding. See `### Design` → Handoff.
### Requirements
- [ ] R1. Per-entry target table on the `custom` split seam. `SplitConfig.custom.split` returns
      entries that may each name their own target table; entries omitting it fall back to the config's
      `targetTable`, then the definition's. Existing `one-to-one` and `one-to-many` behavior is
      unchanged, and existing custom definitions returning bare objects continue to work.
- [ ] R2. Table-name gate admits the contract tables. `VALID_TABLE_NAME` accepts
      `history_message` and `history_tool_call` while still rejecting anything outside a strict
      lowercase-and-underscore allowlist. No SQL interpolation path is widened beyond that.
- [ ] R3. Typed schema and typed insert. `history_message` and `history_tool_call` are created
      with the columns and indices specified in 0455's contract, and rows are written to real typed
      columns — not a `payload_json` blob. The existing `history_etl_<source>` tables and their
      generic insert path are unchanged.
- [ ] R4. Six source mappers. claude, codex, pi, omp, agy, and grok each emit `history_message`
      rows and, where the source supports it, `history_tool_call` rows joined to the invoking message,
      per the per-source pairing table in 0455 `### Design`.
- [ ] R5. Source registry covers the six in-scope agents. `LlmJsonlSource` and
      `SOURCE_DEFINITIONS` include omp, grok, and agy, with `defaultRoots` and `filePatterns` correct
      for every one of the six — narrow enough that pi no longer sweeps non-transcript `*.json`.
- [ ] R6. Unknown records are captured and counted, never silently dropped. A record whose type
      cannot be determined is persisted with `disposition='unknown'` and a stable field-shape
      `record_type`, and `ImportResult` reports an `unknownRecords` count per import.
- [ ] R7. Yield materially exceeds the measured baseline. Import over real transcripts for all six
      sources produces a per-source yield far above the 0.9%/1.0%/0.07% baseline recorded on the E1
      map, measured with the same `--dry-run` method.
- [ ] R8. Nothing is invented. `duration_ms` and `cost_usd` are NULL wherever the source does not
      supply them and they are not derivable within a session; no value is interpolated across a gap
      or a session boundary. `history_tool_call` never stores raw tool arguments.
- [ ] R9. Package gates green. `bun run check` passes in the importer package (biome + tsc +
      tests with coverage), and Spur's `bun run lint` and `bun run test` pass against the linked
      package.
### Acceptance Criteria
```gherkin
Feature: 0466 forensic ETL contract implementation

  Scenario: R1 — one JSONL line fans out into a message row and its tool-call rows
    Given a custom split that returns one message entry targeting history_message
    And two tool-call entries targeting history_tool_call
    When the importer processes that line
    Then one row is written to history_message
    And two rows are written to history_tool_call
    And an entry that omits targetTable falls back to the definition's table

  Scenario: R1 — existing split modes are unaffected
    Given a source definition using one-to-one or one-to-many
    When the importer runs
    Then its rows land in the same tables as before this change
    And a custom split returning bare JsonObject entries still imports

  Scenario: R2 — the table-name gate admits the contract tables and nothing loose
    Given targetTableFor is called with history_message and history_tool_call
    Then both are accepted
    And a name containing a space, quote, semicolon, or uppercase is rejected

  Scenario: R3 — contract rows are queryable by column, not by JSON extraction
    Given imported forensic rows
    When history_tool_call is grouped by tool_name with a sum over duration_ms
    Then the query runs against real columns without JSON extraction
    And history_etl_<source> still holds the raw payload for the same records

  Scenario: R4 — tool calls join to the message that invoked them
    Given a real transcript for each of claude, codex, pi, omp, agy, and grok
    When the importer runs
    Then every history_tool_call row references an existing history_message record_hash
    And sources that pair calls with results populate status and, where available, duration_ms

  Scenario: R5 — every in-scope source resolves and scans its real transcripts
    Given no explicit --root is passed
    When import runs for each of the six sources
    Then each scans its real transcript directory
    And pi scans only .pi/agent/sessions rather than the whole .pi tree

  Scenario: R6 — an undeterminable record is captured and counted, never dropped
    Given a grok record carrying no type discriminator
    When the importer processes it
    Then a row is persisted with disposition unknown and a stable field-shape record_type
    And ImportResult reports a non-zero unknownRecords count for that source

  Scenario: R7 — yield materially exceeds the recorded baseline
    Given real transcripts on this machine
    When spur history import --dry-run runs per source
    Then each source's imported-to-processed ratio far exceeds its E1 baseline
    And the observed ratios are recorded in the task's Testing section

  Scenario: R8 — absent values stay absent
    Given an agy transcript, which carries no model or usage in JSONL
    When the importer runs
    Then model and the token columns are NULL for those rows
    And no duration_ms is interpolated across a session boundary
    And no raw tool arguments are written to history_tool_call

  Scenario: R9 — package and consumer gates are green
    Given the implementation is complete
    When bun run check runs in the importer package
    And Spur runs bun run lint and bun run test against the linked package
    Then all gates pass with no skipped tests

  Scenario: R1 — forensic records survive import for every in-scope source
    Given real history files for claude, codex, pi, omp, agy, and grok
    When spur history import runs against each source
    Then imported records carry tool calls, model, usage, and session/turn linkage
    And the per-source import yield is materially above the 0.9%-1.0% baseline measured 2026-08-06
```
### Q&A
**Closed during specification (2026-08-07) — do not re-litigate:**

- *Can the contract tables use the existing table-name gate?* No. `VALID_TABLE_NAME` is
  `/^history_etl_[a-z_]+$/` (`src/sources.ts:105`) and would reject `history_message` outright.
  Decided: widen to `/^history_[a-z_]+$/` rather than renaming the tables to `history_etl_message`.
  The gate exists for SQL-interpolation safety, and `[a-z_]` preserves that exactly; renaming would
  make two normalized cross-source tables masquerade as per-source ETL tables.
- *Can the contract tables reuse the existing insert path?* No. `insertRecord`
  (`src/jsonl-importer-dao.ts:106-128`) writes `payload_json`, which cannot be indexed or grouped by
  `tool_name` — the whole point of the two-table shape. Decided: one data-driven typed insert keyed by
  a per-table column allowlist, with the generic path untouched for `history_etl_*`.
- *A function per typed table, or one data-driven insert?* One, keyed by `TYPED_TABLE_COLUMNS`. Two
  tables do not justify two code paths, and a third table later should cost a config entry.
- *Does widening the custom split signature break existing definitions?* No — accepting
  `JsonObject | SplitEntry` keeps bare-object returns working. R1's second scenario tests it.
- *Where does `cost_usd` come from?* pi and omp carry a pre-computed `cost` object and are the only
  sources that do; use `cost.total` rather than recomputing from token counts. Everywhere else,
  compute only when model and tokens are both present, else NULL.
- *claude's `usage.iterations[]` vs top-level counts* — top-level authoritative (0455). Count the
  discrepancy once per import; do not persist it per row.
- *Source id for antigravity-cli* — `agy`, matching the CLI `--source` vocabulary and the shim
  `command` (`ts-ai-runner/src/agents/shims.ts:198`). The existing `antigravity` registry entry stays
  untouched; it points at the deferred IDE product.

**Open, and owned elsewhere:**

- *Realpath normalization of `source_file`* — task 0465. Both tasks write that column; whichever lands
  second rebases onto the other rather than re-deciding.
- *ADR text* — owed by 0455 R7, drafted as step 11 of this task's Plan.
- *Retention, pruning, index tuning* — E1 map fog; needs measured growth from real imports. Graduate
  after this task lands.

**Deferred with reason:**

- *agy's `conversations/<uuid>.db`* — model and usage live in protobuf/blob columns. Adding a binary
  decoder to the import path is out of proportion to the value; agy rows carry NULL model/usage in v1
  (0455).
- *Sparse codex usage* — `event_msg.token_count` frequently has `info: null`. Write NULL rather than
  zero; whether codex cost is recoverable at all is a question for 0464, not this task.
### Design
**WHAT.** Four changes to `@gobing-ai/ts-llm-jsonl-importer`, in this order: (1) widen the table-name
gate, (2) per-entry `targetTable` on the `custom` split, (3) typed schema + typed insert path,
(4) six source mappers plus registry entries. Then re-measure yield.

**WHERE.** All paths relative to `~/xprojects/ts-libs/packages/llm-jsonl-importer` unless noted.

| File | Change |
| --- | --- |
| `src/types.ts` | `SplitConfig.custom.split` return type; `LlmJsonlSource` union; `ImportResult.unknownRecords` |
| `src/sources.ts` | `VALID_TABLE_NAME`; six real definitions replacing the generic `sourceDefinition()` |
| `src/schema-sql.ts` | `history_message` + `history_tool_call` DDL and indices |
| `src/jsonl-importer-dao.ts` | typed insert path; `ensureTargetTables` DDL selection |
| `src/importer.ts` | thread per-entry table; count unknowns |
| `src/index.ts` | export any new public types |
| `tests/*.test.ts` | per-change tests (see `### Plan`) |
| Spur: `packages/domain/src/migrations.ts` | picks up new DDL via `HISTORY_IMPORT_SCHEMA_SQL` (already imported at `:4`) — verify, no edit expected |
| Spur: `packages/app/src/services/history-service.ts` | `SOURCES` array at `:29` must gain omp/grok/agy |
| Spur: `apps/cli/src/commands/history.ts` | `--source` help string at `:12` |

**Frozen names.** Tables `history_message`, `history_tool_call`. Source ids `claude`, `codex`, `pi`,
`omp`, `agy`, `grok` — **`agy`, not `antigravity-cli`**, matching the CLI `--source` vocabulary; leave
the existing `antigravity` entry alone. Column names exactly as in 0455 `### Design`. New result field
`unknownRecords`. New disposition value `unknown`.


`VALID_TABLE_NAME` is `/^history_etl_[a-z_]+$/` (`src/sources.ts:105`) and `targetTableFor()` throws
`HistoryImportError` on anything else, so `history_message` is rejected today.

Widen to `/^history_[a-z_]+$/`. This still admits only lowercase and underscore, so no SQL injection
path is opened — the gate's stated purpose (interpolation safety for custom definitions) is
preserved. Do **not** replace it with a table allowlist constant; custom source definitions are
allowed to name their own tables and an allowlist would break them.


The internal split record already carries a table — `splitRawRecord` returns `{targetTable, raw}`
(`src/importer.ts:170-192`). Only the **public** custom signature lacks one.

```ts
// src/types.ts — replace the custom arm of SplitConfig
| {
      readonly mode: 'custom';
      readonly split: (raw: JsonObject) => readonly (JsonObject | SplitEntry)[];
      readonly targetTable?: string;
  };

/** One record emitted by a custom split, optionally routed to its own table. */
export interface SplitEntry {
    readonly targetTable?: string;
    readonly record: JsonObject;
}
```

Accepting `JsonObject | SplitEntry` keeps every existing custom split working unchanged (R1 second
scenario). In `splitRawRecord`, normalize each entry: if it has a `record` property treat it as a
`SplitEntry`, else treat the object itself as the record. Resolution order for the table is
**entry → splitConfig.targetTable → definition.targetTable**, each passed through `targetTableFor()`.

`ensureTargetTables` (`src/jsonl-importer-dao.ts:53-62`) currently discovers tables statically from
the definition. A custom split can now name tables it cannot see. Simplest correct fix: keep the
static pass for the definition's own tables, and additionally ensure a table on first write. Do not
call `CREATE TABLE` per row — cache ensured names in a `Set` for the run.


`insertRecord` (`src/jsonl-importer-dao.ts:106-128`) writes a fixed generic column set, and
`ETL_TABLE_DDL` (`:22-30`) creates every table with `payload_json`. The contract tables need real
columns so `GROUP BY tool_name` and `SUM(duration_ms)` work without JSON extraction.

Add the DDL from 0455 `### Design` verbatim to `HISTORY_IMPORT_SCHEMA_SQL` in `src/schema-sql.ts`
(both `CREATE TABLE IF NOT EXISTS`, plus the four indices). Then add **one** data-driven typed insert
rather than a function per table:

```ts
/** Column allowlist per typed contract table; order is the INSERT column order. */
const TYPED_TABLE_COLUMNS: Readonly<Record<string, readonly string[]>> = {
    history_message: [/* exactly the columns in 0455's DDL, in DDL order */],
    history_tool_call: [/* ditto */],
};
```

Insert path: if `TYPED_TABLE_COLUMNS[table]` exists, build the statement from that allowlist and pull
each value from the normalized record by key (missing → `null`); otherwise fall back to the existing
generic `insertRecord`. Keep `ON CONFLICT(record_hash) DO NOTHING`. **A mapper key that is not in the
allowlist is dropped silently — that is a footgun**, so assert in the typed insert that every key of
the normalized record is either an allowlisted column or explicitly listed in a small `IGNORED_KEYS`
set, and throw `HistoryImportError` otherwise. A mapper typo must fail loudly, not vanish.

`ensureTargetTables` must create typed tables with their real DDL, never `ETL_TABLE_DDL`. Select DDL
by table name.

The ledger (`insertLedger`) is unchanged and still records every row, so `record_hash` dedupe and the
duplicate probe keep working across both table kinds.


Replace the generic `sourceDefinition()` for the six in-scope sources. Each definition supplies its
own `splitConfig: { mode: 'custom', split }` and its own Zod `schema`. Keep the helper for the
deferred sources so they are untouched.

Roots and patterns (measured; see 0463):

| source | `defaultRoots` | `filePatterns` |
| --- | --- | --- |
| claude | `['.claude/projects']` | `['*.jsonl']` |
| codex | `['.codex/sessions']` | `['*.jsonl']` |
| pi | `['.pi/agent/sessions']` | `['*.jsonl']` |
| omp | `['.omp/agent/sessions']` | `['*.jsonl']` |
| grok | `['.grok/sessions']` | `['*.jsonl']` |
| agy | `['.gemini/antigravity-cli/brain']` | `['*.jsonl']` |

Per-source split behavior — full field maps in 0463 `### Solution`:

- **claude** — one `history_message` per record. Tool calls from `message.content[]` blocks where
  `type === 'tool_use'` (`id`, `name`, `input`); results pair by `tool_result.tool_use_id === tool_use.id`
  in the following `user` record (observed 40→40, exact 1:1). `model` from `message.model`; usage from
  `message.usage`, **top-level counts authoritative over `usage.iterations[]`** (count the discrepancy,
  do not write it per row). Duration only from `system` records with `subtype: 'turn_duration'`
  (`durationMs`) — per-turn, not per-step. Keep `attachment` and `file-history-*` as
  `disposition='meta'` rows; do not drop them.
- **codex** — unwrap `payload`. `response_item.function_call` (`name`, `arguments`, `call_id`) joins
  `function_call_output` on `call_id` (observed 301→301). `model` from `turn_context.payload.model`.
  Usage from `event_msg.token_count` is sparse and often `info: null` — write NULL, never zero.
  A second, older short format exists (`{id, timestamp, instructions, git}`); route it to `unknown`
  rather than special-casing it.
- **pi / omp** — near-identical. `message` records carry `message.usage` with
  `input`/`output`/`cacheRead`/`cacheWrite` **and a pre-computed `cost` object** — pi and omp are the
  only sources with real cost; use `cost.total` for `cost_usd` rather than recomputing. Tool calls are
  `toolCall` blocks in assistant content, results are `tool_result` blocks in the next user record.
  No explicit duration — derive from adjacent `ts`. omp additionally emits `title`, `title_change`,
  `service_tier_change`, `ttsr_injection`, `session_init`, `compaction` (see the 0463 census
  addendum) — classify each, defaulting to `meta`.
- **grok** — the hard one. Content is chunked across streaming records and must be reconstructed
  before `content_text`. `tool_call` ↔ `tool_call_update`; `tool_started`/`tool_completed` bracket
  **true per-step timing** — grok is the only source that has it. Usage only per-turn from
  `turn_completed.usage`; `model` from `tool_call._meta.modelId` or `turn_completed.usage.modelUsage`.
  `~/.grok/sessions` holds several file kinds per session (`events.jsonl`, `updates.jsonl`, others),
  so the mapper must tolerate files that contain none of the expected types.
- **agy** — `SCREAMING_CASE` types (`USER_INPUT`, `PLANNER_RESPONSE`, `RUN_COMMAND`, `VIEW_FILE`,
  `GREP_SEARCH`, `CODE_ACTION`, `INVOKE_SUBAGENT`, …). Tool calls from `PLANNER_RESPONSE.tool_calls[]`
  ordered by `step_index`. **No model and no usage exist in the JSONL** — leave those columns NULL;
  the SQLite store is out of scope.


When a mapper cannot determine a record's type, emit a `history_message` row with
`disposition='unknown'` and `record_type` set to a **stable field-shape key**: top-level keys,
lowercased, sorted, joined with `+` (e.g. `method+params+timestamp`). Stability matters — this key is
how drift is tracked over time, so it must not depend on key order in the file. Add
`unknownRecords: number` to `ImportResult` and increment per emitted unknown row.

grok emits at least six such shapes today (0455 `### Design`); use them as the test fixture set.

**Precedence when sources disagree with this spec.** Real files win. If a mapper cannot satisfy a
field as specified, record the constraint in `### Solution` and leave the column NULL — do not
approximate. 0463's field maps were built from a sample; a shape not seen there is a finding, not a
license to guess.

**Anti-patterns:**

- Do **not** drop a record type because it looks like noise. `attachment` is ~18% of claude lines and
  `file-history-*` may be exactly what explains a slow session. Mark `meta`, keep the row.
- Do **not** invent `duration_ms` or `cost_usd`, and never interpolate across a gap or session
  boundary. NULL is the honest value and R8 tests for it.
- Do **not** store raw tool arguments. `args_digest` is sha256 over redacted, key-sorted args.
- Do **not** widen `VALID_TABLE_NAME` beyond `[a-z_]`, and do not build SQL by string-concatenating
  anything that has not passed `targetTableFor()`.
- Do **not** change `history_etl_<source>` shape, the checkpoint/ledger tables, or the generic insert
  path. 0465 owns checkpoint hardening; touching it here creates a merge conflict and mixes two review
  contexts.
- Do **not** rewrite `redactRecord`/`sha256` ordering. `record_hash` is computed over the redacted
  record (`src/importer.ts:93-99`); changing that invalidates every existing ledger row.
- Do **not** add a per-source mapper file for the deferred sources. R5 covers six.

**Handoff.** 0464 queries `history_message` + `history_tool_call` only, so column names are a
contract from the moment this lands. 0465 changes `source_file` to realpath-normalized values; both
tasks write that column, so whichever lands second rebases rather than re-deciding. An **ADR is owed**
(0455 R7) for the `custom` split extension and the two-table shape — write it to `docs/00_ADR.md`
before or with this task.

**Sizing.** This is one package and one review context, so it is one task by cohesion. If planning
puts it above the force-decompose guard, split by **seam** — (a) gate + split extension + typed
schema/insert with two reference mappers, (b) the remaining four mappers — never one task per source,
which would split one body of evidence across four review contexts.

**Dev workflow.** Develop with `bun link` from `~/xprojects/ts-libs/packages/llm-jsonl-importer` into
Spur (E1 map decision, 2026-08-06). Package gates: `bun run check` (biome + tsc + `bun test
--coverage`). Manual publish is disabled — release goes through GitHub Actions Trusted Publishing on
a `@gobing-ai/ts-llm-jsonl-importer-v<version>` tag, so landing in Spur needs a released version and a
root `workspaces.catalog` bump. `bun link` is for validating unreleased work only.
### Plan
Ordered; each step is independently green (`bun run check` in the importer package) before the next.
Steps 1–3 are the seam and must land before any mapper.

- [ ] **0. Baseline.** `cd ~/xprojects/ts-libs/packages/llm-jsonl-importer && bun run check` to confirm
      green before changes. Record current per-source yield with
      `bun run apps/cli/src/index.ts history import --source <s> --mode incremental --dry-run` from the
      Spur repo, so R7's improvement is measured against a number taken on this machine today.
- [ ] **1. Widen the table-name gate (R2).** `VALID_TABLE_NAME` → `/^history_[a-z_]+$/` in
      `src/sources.ts:105`. Test: `history_message` and `history_tool_call` accepted; names with space,
      quote, semicolon, uppercase, or a leading digit rejected. Extend `tests/sources.test.ts`.
- [ ] **2. Per-entry target table (R1).** Add `SplitEntry` to `src/types.ts`; widen the custom `split`
      return type; normalize entries in `splitRawRecord` (`src/importer.ts:170-192`) with resolution
      order entry → splitConfig → definition. Tests in `tests/importer.test.ts`: one line fanning into
      two tables; an entry omitting `targetTable` falling back; a legacy custom split returning bare
      objects still importing unchanged; `one-to-one` and `one-to-many` unchanged.
- [ ] **3. Typed schema and typed insert (R3).** Add both `CREATE TABLE IF NOT EXISTS` plus the four
      indices from 0455 to `src/schema-sql.ts`. Add `TYPED_TABLE_COLUMNS` and the data-driven typed
      insert to `src/jsonl-importer-dao.ts`, with the loud-failure assertion on unknown mapper keys.
      Make `ensureTargetTables` select real DDL for typed tables and ensure-on-first-write for tables a
      custom split names. Tests: typed columns are populated and queryable; an unallowlisted key throws
      `HistoryImportError`; `history_etl_*` insert path is byte-for-byte unchanged; `schema-sql.test.ts`
      covers the new DDL.
- [ ] **4. Registry (R5).** Add `omp`, `grok`, `agy` to `LlmJsonlSource` in `src/types.ts` and to
      `SOURCE_DEFINITIONS`; correct `defaultRoots`/`filePatterns` for all six per the `### Design`
      table. Mirror the source list in Spur: `packages/app/src/services/history-service.ts:29` and the
      `--source` help text in `apps/cli/src/commands/history.ts:12`. Test: every in-scope source
      resolves its real root; pi's pattern no longer matches non-transcript `*.json`.
- [ ] **5. Reference mappers — claude and pi (R4).** Do these two first: claude is the richest shape
      and pi is the simplest with 100% usage coverage, so together they exercise every column. Build
      fixtures by copying **real** transcript excerpts into `tests/fixtures/` (redact paths; keep them
      small). Assert message rows, tool-call rows joined by `message_hash`, usage mapping, and pi's
      pre-computed `cost.total` landing in `cost_usd`.
- [ ] **6. Remaining mappers — codex, omp, agy, grok (R4).** grok last; it needs streaming
      reconstruction and is the only source with true per-step timing from
      `tool_started`/`tool_completed`. For each: fixture, message rows, tool-call join, and an explicit
      assertion that unsupported columns are NULL (agy model/usage; grok per-call usage).
- [ ] **7. Unknown capture (R6).** Field-shape key derivation (lowercased, sorted, `+`-joined) with a
      stability test proving key order in the file does not change the key. Add `unknownRecords` to
      `ImportResult` and thread the count. Fixture: grok's six untyped shapes from 0455.
- [ ] **8. Re-measure yield (R7).** Re-run the step-0 dry-run per source against the linked package.
      Record before/after ratios per source in `### Testing`. Any source still near its baseline is a
      mapper defect, not an acceptable outcome — investigate before closing.
- [ ] **9. Verify absences (R8).** Assert agy rows have NULL model and token columns; assert no
      `duration_ms` spans a session boundary; grep the code path to confirm raw tool arguments never
      reach `history_tool_call`.
- [ ] **10. Gates (R9).** `bun run check` in the importer package. Then from Spur with the package
      linked: `bun run lint`, `bun run test`. No skipped tests, no `biome-ignore` added without a
      written justification.
- [ ] **11. ADR.** Write the `docs/00_ADR.md` entry for the `custom` split extension and the two-table
      forensic shape (0455 R7). Dated entry, decision + rationale + alternatives rejected.
- [ ] **12. Record.** Fill `### Solution` with a `path:line` change map across both repos, and
      `### Testing` with the before/after yield table and the commands that produced it. Note any
      per-source constraint discovered that 0463's sample did not show.
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
