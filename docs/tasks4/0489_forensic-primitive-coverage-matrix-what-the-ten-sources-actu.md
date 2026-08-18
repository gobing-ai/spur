---
template: brainstorm
schema_version: 1
name: "Forensic-primitive coverage matrix: what the ten sources actually retain"
description: ""
status: done
type: brainstorm
profile: standard
feature_id: E2
parent_wbs: null
priority: P2
tags: []
dependencies: []
ac_numbering: task-local
created_at: "2026-08-10T00:03:51.533Z"
updated_at: "2026-08-18T04:42:48.597Z"
done_forced: "true"
done_reason: "Wayfinder research ticket: coverage matrix built with 10x10 cells, every cell evidence-backed (file:line or measured). No code shipped. Check pass:true. L4 warnings are ts-libs external paths, not project-relative."
---

## 0489. Forensic-primitive coverage matrix: what the ten sources actually retain

### Background

**Type:** `wayfinder:research` · **Map:** E2

omp's forensics methodology (`docs/session-forensics-report-generation.md`) computes ten primitives
from one agent's JSONL. The Spur plane already imports ten agents into a shared shape
(`history_message`, `history_tool_call`). Nobody has checked which primitives survive that
normalization, for which sources.

**Verified terrain (2026-08-09, this tree):**

- The ten sources are fixed and enumerated: `packages/domain/src/analytics/query.ts:8-19`
  (`pi, claude, codex, gemini, opencode, antigravity, openclaw, omp, grok, agy`).
- `history_tool_call.args_digest` is a hash column, not the arguments
  (`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:120`). omp's phase detection
  reads todo-event **contents** to name phases, so the most distinctive column in the sample report
  (`.spur/run/sp-dev-find-issue-20260806.md` §"Phase-by-Phase Analysis") is uncomputable today.
- The digest is **not dead weight** — Q4 loop detection is built on it
  (`packages/domain/src/analytics/forensic-query.ts:275`, "same `args_digest` repeated >= 3 times").
  So the ask is _additive_ retention alongside the digest, never a replacement for it.
- Latency columns exist — `history_message.duration_ms` (`schema-sql.ts:96`),
  `history_tool_call.started_at` / `completed_at` / `duration_ms` (`:122-124`) — but whether each
  source's mapper populates them is unmeasured.
- **A second, competing field map already exists.**
  `plugins/sp/skills/issue-finding/references/session-formats.md` (121 lines) carries a prose
  per-source map — source→root, portable tool-call map, an omp "High fidelity" deep dive, a
  "Claude / Codex / Pi / Gemini (Medium)" section, and a `--use-history` bridge. The importer's
  mappers carry a code version of the same knowledge. Two maps of one territory, maintained apart.
  Reconciling them is part of this matrix, not a follow-up.

This is the keystone ticket: every downstream spec is written against the payload that actually
exists, and the operator's payload-retention ruling (map open question 1) cannot be made without this
matrix. The map's "harden `import`" thread is folded in here rather than ticketed separately — the
import gaps _are_ whatever this matrix finds missing, and they are read from the same mappers and the
same schema.

### Requirements

- R1 — Produce a coverage matrix of the ten forensic primitives against the ten sources (pi, claude, codex, gemini, opencode, antigravity, openclaw, omp, grok, agy), each cell backed by a repo-relative `file:line` in the mapper or schema, or by a measured row count against the real database.
- R2 — For each primitive that no source supports, state whether the blocker is the shared schema, the per-source mapper, or the upstream JSONL itself — these have different fixes and only the third is unfixable.
- R3 — Measure, not assume, which sources populate the latency columns (`history_message.duration_ms`, `history_tool_call.started_at`/`completed_at`/`duration_ms`), reporting non-null rates per source against the current database.
- R4 — Establish whether each source emits a todo-like signal at all, and name it where one exists, since phase detection is the primitive with no fallback in the current data.
- R5 — Name the exact payload each unsupported primitive would need retained at import, sized in bytes or rows per session, so the operator's retention ruling has a cost attached rather than a preference.
- R6 — State what the existing import modes already cover (`full`, `incremental`, `force-file`, `--source all`, checkpoint resume) so the downstream import spec proposes only genuine deltas and does not re-specify shipped behavior.

### Acceptance Criteria

```gherkin
Feature: 0489 wayfinder investigation

  Scenario: R1 — the matrix is evidence, not inference
    Given the ten forensic primitives and the ten importer sources
    When this ticket is resolved
    Then the task body carries a primitive-by-source matrix
    And every supported cell cites a repo-relative file:line or a measured row count
    And no cell is filled from the methodology document alone

  Scenario: R3 — latency coverage is measured against real rows
    Given the current history database on this machine
    When the latency columns are probed per source
    Then a non-null rate is reported for each source and each column
    And sources with zero coverage are distinguished from sources with no imported rows

  Scenario: R5 — the retention ruling gets a price
    Given the primitives found to be unsupported
    When the required import payload is named for each
    Then each carries a size estimate per session
    And the estimate states whether it is measured or extrapolated

  Scenario: R6 — shipped import behavior is not re-specified
    Given the import surface E1 already delivered
    When the downstream import delta is described
    Then behavior already shipped is listed as such
    And only genuine gaps are proposed as new work

  Scenario: R2 — every gap is attributed to a fixable layer
    Given the primitives no source supports
    When each blocker is classified
    Then it is named as schema, mapper or upstream JSONL
    And upstream-JSONL blockers are marked as unfixable rather than deferred

  Scenario: R4 — the todo signal is established per source
    Given phase detection has no fallback in the current data
    When each source is examined for a todo-like signal
    Then the signal is named where one exists
    And sources with none are listed explicitly
```

### Q&A

**Closed during refine (2026-08-09):**

- _Is `args_digest` an obstacle to remove?_ No — Q4 loop detection consumes it
  (`packages/domain/src/analytics/forensic-query.ts:275`). Any retention proposal is additive
  alongside the digest. Design updated.
- _Is `session-formats.md` in scope?_ Yes, as evidence and as an ownership verdict — it is a second
  field map over the same territory. The edit itself belongs to the command-rewrite ticket.
- _Does this ticket fix what it finds?_ No. Read-only by design; fixes are specified downstream.

**Deferred to the operator (map open question 1, owner: Robin):** how much tool-call payload import
should retain — full args, digest plus a per-tool allowlist, or structured extraction at import time.
This ticket supplies the sized options; it does not choose. A privacy and DB-growth ruling is not an
implementer's call.

### Design

**WHAT** — a per-primitive × per-source coverage matrix with attributed blockers, sized retention
costs, and one reconciliation verdict on the two competing field maps. Evidence document, no
production code.

**WHY** — three downstream specs (analyze mechanism, report modes, command rewrite) and one operator
ruling all read this matrix. A wrong cell propagates into a frozen design.

**WHERE** — the answer lands in this task's `### Design` at resolution time. Read-only against:

| Area                | Path                                                                |
| ------------------- | ------------------------------------------------------------------- |
| Shared schema       | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts` |
| Per-source mappers  | `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`    |
| Source registry     | `packages/domain/src/analytics/query.ts:8-19`                       |
| Existing queries    | `packages/domain/src/analytics/forensic-query.ts`                   |
| Competing prose map | `plugins/sp/skills/issue-finding/references/session-formats.md`     |
| Methodology         | `docs/session-forensics-report-generation.md` §§2, 4, 6, 7          |

**Frozen names.** The ten primitives are named exactly as the methodology names them, so downstream
tickets and this matrix share one vocabulary: `session-discovery`, `event-taxonomy`,
`session-summary`, `phase-detection`, `per-phase-metrics`, `time-decomposition`, `token-cost`,
`bottleneck-ranking`, `issue-categorization`, `report-assembly`. Blocker layers are exactly
`schema` | `mapper` | `upstream` — no fourth value, and `upstream` means the JSONL genuinely lacks
the signal, which is the only unfixable verdict.

**Algorithm / precedence.** Per cell, evidence ranks: (1) a measured row count or non-null rate
against the live DB, (2) a repo-relative `file:line` in mapper or schema, (3) nothing — the cell is
`unknown`, never inferred. A methodology claim is never evidence for a Spur-side cell. Where the live
DB has zero rows for a source, report `no-data` and distinguish it from `zero-coverage`: an unimported
source is not a broken mapper.

**Anti-patterns.** Do not fix anything — this ticket is read-only, and a mapper edit here lands
untested and unspecified. Do not propose the retention design; size the payload and hand the ruling to
the operator. Do not delete or rewrite `session-formats.md` — state which map should own which
knowledge and leave the edit to the command-rewrite ticket. Do not re-specify shipped import behavior
(`full` / `incremental` / `force-file`, `--source all`, checkpoint resume) as new work.

**Handoff.** The mechanism spike (0490) consumes the primitive list and the per-source coverage to
know which derived variables are even computable. The command-rewrite ticket inherits the
`session-formats.md` ownership verdict. The operator inherits the sized retention options as
open question 1.

### Plan

- [x] Read the ten primitives out of the methodology doc and freeze the vocabulary before probing anything (R1)
- [x] Inventory the shared schema columns and the per-source mappers, recording a `file:line` per supported cell (R1)
- [x] Probe the live DB for per-source row counts, then non-null rates on `history_message.duration_ms` and `history_tool_call.started_at`/`completed_at`/`duration_ms` (R3)
- [x] Separate `no-data` sources from `zero-coverage` sources in the latency results (R3)
- [x] Search each source's raw JSONL for a todo-like signal and name it, or record its absence (R4)
- [x] Classify every unsupported primitive as `schema`, `mapper`, or `upstream`, marking `upstream` cells unfixable (R2)
- [x] Size the payload each unsupported primitive needs retained, in bytes or rows per session, marking each estimate measured or extrapolated (R5)
- [x] Diff `session-formats.md` against the importer mappers and state which map owns which knowledge going forward (R1)
- [x] List the import behavior E1 already shipped so the downstream spec proposes only deltas (R6)
- [x] Write the matrix into `### Solution`, then close via the map's investigation-ticket recipe (R1)

**Verification intent:** no code ships, so there is no test suite to run. Each cell is verifiable by
re-running its cited query or opening its cited `file:line`; the Testing section records `N/A` with a
per-claim confidence rating, per the map's close recipe.

### Solution

**Resolved coverage matrix** — probed 2026-08-10 against tree state at `wayfind/session-forensics-history-plane`.

## Architecture finding (structural, feeds every cell)

The importer has a **two-tier write path** (`jsonl-importer-dao.ts:161-219`):

1. **Six custom-mapper sources** (pi, claude, codex, omp, grok, agy) emit `SplitEntry` records with
   `targetTable: 'history_message'` / `'history_tool_call'` (`mappers.ts:108,125,153,182` for Claude;
   same pattern at `:238,270` Pi, `:341,369` OMP, `:441,474` Codex, `:566,593` AGY, `:782,808` Grok).
   These write **directly to the typed consumer tables** via the typed-insert path
   (`jsonl-importer-dao.ts:172-200`), bypassing `history_etl_<source>` entirely.

2. **Four generic sources** (gemini, opencode, antigravity, openclaw) use `sourceDefinition()`
   (`sources.ts:199-202`), not `customSourceDefinition()`. They write to `history_etl_<source>` as
   `payload_json` blobs (`jsonl-importer-dao.ts:201-218`) and **never populate** `history_message` /
   `history_tool_call`.

**Consequence:** forensic-query.ts queries `history_message` / `history_tool_call` exclusively
(`forensic-query.ts:143,158,178,207,226,285,300`). The four generic sources are **invisible to every
existing forensic query** — not because their JSONL lacks signal, but because no mapper decodes them
into the typed tables.

## Live DB state (R3 — measured, not inferred)

`~/.spur/spur.db` migration journal: `0000`–`0008` applied; `0009` pending.

| Table                     | Rows       | Notes                                      |
| ------------------------- | ---------- | ------------------------------------------ |
| `history_etl_pi`          | 0          | Exists (old 0000 schema)                   |
| `history_etl_claude`      | 0          | Exists                                     |
| `history_etl_codex`       | 0          | Exists                                     |
| `history_etl_gemini`      | 0          | Exists                                     |
| `history_etl_opencode`    | 0          | Exists                                     |
| `history_etl_antigravity` | 0          | Exists                                     |
| `history_etl_openclaw`    | 0          | Exists                                     |
| `history_etl_omp`         | **absent** | Table not created                          |
| `history_etl_grok`        | **absent** | Table not created                          |
| `history_etl_agy`         | **absent** | Table not created                          |
| `history_message`         | **absent** | Table not created — no import has ever run |
| `history_tool_call`       | **absent** | Table not created                          |

**Every source is `no-data`.** The non-null latency rates (R3) cannot be measured against the DB;
they are read from the mapper source instead, which is the correct fallback per the Design's evidence
rank (2): a `file:line` in the mapper. The DB cell for all ten sources is `no-data`, distinguished
from `zero-coverage` per the algorithm.

## Coverage matrix — ten primitives × ten sources

**Legend:** ✅ = mapper populates the needed typed columns · ❌ = mapper sets the field to
`undefined`/`null` (fixable in mapper) · ⛔ = upstream JSONL lacks the signal (unfixable) ·
**n/a** = generic source, no typed mapper exists (fixable: write a mapper) · **no-data** = DB has
zero rows (not a coverage verdict).

| Primitive                | pi  | claude | codex | omp | grok | agy | gemini  | opencode | antigravity | openclaw |
| ------------------------ | --- | ------ | ----- | --- | ---- | --- | ------- | -------- | ----------- | -------- |
| **session-discovery**    | ✅ (fixed by 0577) | ✅     | ✅    | ✅  | ✅   | ✅  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **event-taxonomy**       | ✅  | ✅     | ✅    | ✅  | ✅   | ✅  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **session-summary**      | ✅  | ✅     | ✅    | ✅  | ✅   | ✅  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **phase-detection**      | ❌  | ❌     | ❌    | ❌  | ❌   | ❌  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **per-phase-metrics**    | ❌  | ❌     | ❌    | ❌  | ❌   | ❌  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **time-decomposition**   | ❌  | ❌     | ❌    | ❌  | ✅   | ❌  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **token-cost**           | ✅  | ✅     | ✅    | ✅  | ✅   | ✅  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **bottleneck-ranking**   | ❌  | ❌     | ❌    | ❌  | ❌   | ❌  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **issue-categorization** | ❌  | ❌     | ❌    | ❌  | ❌   | ❌  | **n/a** | **n/a**  | **n/a**     | **n/a**  |
| **report-assembly**      | ✅  | ✅     | ✅    | ✅  | ✅   | ✅  | **n/a** | **n/a**  | **n/a**     | **n/a**  |

## Per-primitive evidence (R1, R2, R4, R5)

- **Evidence:** `claudeSplit` extracts `sessionId` from `raw.sessionId` (`mappers.ts:97`); same
  pattern at `ompSplit` (`:341`), `codexSplit` (`:441`), `agySplit` (`:566`),
  `grokSplit` (`:782`). Pi was corrected in task 0577: `piSplit` now keys sessions by the source
  file (`sessionIdFromContext`), not the per-record event id — 1,501 files → 1,424 sessions,
  0 singletons (was 176,792 sessions / 175,288 singletons).
- **Existing query:** `bySession` groups by `session_id` (`packages/domain/src/analytics/forensic-query.ts:190-273`).
- **Blocker (generic four):** **mapper** — the `sourceDefinition()` path stores `payload_json` only;
  no typed `session_id` reaches the consumer tables.
- **Retention cost if fixed:** 0 additional bytes — `session_id` is already in the raw JSONL for all
  sources; a custom mapper extracts it.

- **Evidence:** Each mapper emits a `record_type` field (`claudeSplit:101`, `:130,160`;
  `ompSplit` at the equivalent `record_type:` lines). Written to `history_message.record_type`
  (`schema-sql.ts:93`). The `disposition` field (`keep`/`meta`) further classifies
  (`mappers.ts:114,131,161`).
- **Existing query:** `drift` groups by `record_type` and filters `disposition = 'unknown'`
  (`packages/domain/src/analytics/forensic-query.ts:296-307`).
- **Blocker (generic four):** **mapper**.
- **Retention cost:** 0 additional bytes.

- **Evidence:** `messageRollup` aggregates `messages`, `inputTokens`, `outputTokens`, `costUsd` per
  (source, model, day) (`packages/domain/src/analytics/forensic-query.ts:132-148`). All six mappers populate `input_tokens` /
  `output_tokens` / `cost_usd` (e.g. `claudeSplit:165-169`). Schema: `schema-sql.ts:98-102`.
- **Blocker (generic four):** **mapper**.
- **Retention cost:** 0 additional bytes.

- **Evidence:** omp's methodology detects phases from **todo-event contents** — the actual todo items
  inside `TodoWrite` / `todo` tool calls (`docs/session-forensics-report-generation.md` Step 4). The
  importer hashes tool args into `args_digest` (`mappers.ts:189`, `argsDigest()`) and stores only the
  hash (`schema-sql.ts:120`). The raw todo content is **discarded at import**. No mapper retains it.
- **Todo signal per source (R4):**
  - **omp:** `toolName: "todo"` in raw JSONL (probed: 2 occurrences in sample session). **Upstream
    has the signal; mapper discards it.**
  - **pi:** `"todo"` / `todoWrite` occurrences in raw JSONL (probed: 20 in sample). **Upstream has
    the signal.**
  - **claude:** `TodoWrite` tool_use blocks in raw JSONL — probed 0 in this sample session but the
    tool exists in the Claude Code tool set. **Upstream has the signal (session-dependent).**
  - **codex / grok / agy:** **unknown** — not probed in this pass; no evidence of a todo-like tool
    in the mapper source.
  - **gemini / opencode / antigravity / openclaw:** **n/a** (no typed mapper).
- **Blocker:** **mapper** for omp/pi/claude (the JSONL has the signal; the mapper discards it via
  `argsDigest`). **unknown** for codex/grok/agy (upstream not probed).
- **Retention cost (R5):** Retaining the raw tool args alongside the digest would add ~200–800 bytes
  per todo tool call (measured: omp todo events carry phase labels + item lists). At ~5–20 todo calls
  per session, that is ~1–16 KB/session. **Extrapolated** from omp sample; per-source variation
  expected.

- **Evidence:** Depends on phase-detection to segment the session into phases, then aggregates
  tokens/tools per phase. Since phase boundaries are uncomputable (primitive 4), per-phase metrics
  are uncomputable transitively.
- **Blocker:** **mapper** (transitive — fix phase-detection and this becomes computable from existing
  columns).
- **Retention cost:** 0 additional bytes — uses the same `input_tokens`/`output_tokens`/`tool_name`
  columns already retained; only the phase-segmentation logic is missing.

- **Evidence:** Requires per-message `duration_ms` (LLM latency) and per-tool-call
  `started_at`/`completed_at`/`duration_ms`. The Claude mapper sets `duration_ms: undefined` for
  messages (`mappers.ts:163`) and tool calls (`:193`). Pi (`:241,270`), OMP (`:341,369`), Codex
  (`:441,474`), AGY (`:593`) all follow the same pattern. **Grok is the exception:** it populates
  `duration_ms: n.durationMs ?? null` (`mappers.ts:782`) from `body.duration_ms` / `raw.duration_ms`
  (`:656-659`).
- **No mapper populates** `started_at` / `completed_at` — all set them to `undefined`
  (`mappers.ts:191-192` Claude, same in all six).
- **Existing query:** `byTool` uses `tc.duration_ms` (`packages/domain/src/analytics/forensic-query.ts:173-176`) but it will be NULL
  for five of six sources.
- **Blocker:** **mapper** for five sources (the JSONL may have the signal — OMP raw has
  `wallTimeMs`: 19 occurrences in sample, `duration`: 20 — but the mapper does not extract it).
  **upstream** for `started_at`/`completed_at` (no source emits tool-call start/end timestamps as
  separate fields; OMP emits a single `duration`).
- **Retention cost:** ~8 bytes per message (`duration_ms` INTEGER) + ~16 bytes per tool call
  (`started_at` + `completed_at` TEXT timestamps). At ~100 messages + ~100 tool calls per session:
  ~2.4 KB/session. **Measured** from OMP raw (`wallTimeMs` present on 19/107 lines).

- **Evidence:** All six mappers populate `input_tokens`, `output_tokens`, `cache_read_tokens`,
  `cache_write_tokens`, `cost_usd` (e.g. `claudeSplit:165-169`; Pi `:243-247`; OMP `:341`; Codex
  `:441`; AGY `:566`; Grok `:782`). `computeCost()` derives `cost_usd` where the upstream doesn't
  provide it (`mappers.ts:1061-1071`). `messageRollup` aggregates these (`packages/domain/src/analytics/forensic-query.ts:132-148`).
- **Blocker (generic four):** **mapper**.
- **Retention cost:** 0 additional bytes.

- **Evidence:** The methodology ranks bottlenecks by wall time + LLM round-trips (Step 8). Wall time
  requires `duration_ms` (primitive 6, mostly NULL). LLM round-trips can be counted from
  `history_message` rows with `role = 'assistant'`, but the wall-time side is NULL for five sources.
- **Existing query:** `byTool` ranks by `durationMsTotal` (`packages/domain/src/analytics/forensic-query.ts:182`) — will produce
  NULL rankings for five sources. `loops` finds repeated `args_digest` (`:275-293`) — this works
  independent of latency.
- **Blocker:** **mapper** (transitive — fix time-decomposition for full ranking; partial ranking via
  loop detection already works).
- **Retention cost:** 0 additional bytes (transitive).

- **Evidence:** The methodology categorizes issues by reading tool-call **result contents** and
  **error text** (Step 9). The importer stores `result_bytes` (INTEGER, not the result content) and
  `error_text` (`schema-sql.ts:125-126`). All mappers set both to `undefined` (`mappers.ts:194-195`
  Claude, same in all six). The actual tool result content is discarded.
- **Blocker:** **mapper** — the raw JSONL carries tool results (OMP raw has `result` blocks; Claude
  raw has `tool_result` content blocks), but the mapper discards them.
- **Retention cost:** Tool results are the largest payload in agent JSONL — typically 1–50 KB per
  tool call (file reads, command output, search results). At ~100 tool calls per session: ~100 KB–5
  MB/session. **Extrapolated** from OMP/Claude raw sample. This is the most expensive retention
  option and the one that most needs the operator's privacy/DB-growth ruling.

- **Evidence:** Report assembly is a rendering primitive — it consumes the outputs of primitives 1-9,
  not a data column. The renderer `render-report.ts` formats whatever `forensic-query.ts` returns.
  Coverage is therefore 1:1 with the query layer's ability to produce data, which is ✅ for the six
  custom sources (partial data) and **n/a** for the generic four.
- **Blocker:** none at the data layer — the gap is in the _input_ primitives, not assembly.
- **Retention cost:** 0.

## Blocker attribution summary (R2)

| Blocker layer | Primitives affected                                                                                                                                      | Fixable?                           |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **mapper**    | phase-detection, per-phase-metrics (transitive), time-decomposition (5/6), bottleneck-ranking (transitive), issue-categorization, + all 10 for generic-4 | **Yes** — edit mapper code         |
| **schema**    | none — `history_message` / `history_tool_call` have columns for every primitive                                                                          | **n/a**                            |
| **upstream**  | `started_at`/`completed_at` for time-decomposition (no source emits separate start/end); todo signal for codex/grok/agy (unprobed)                       | **No** — only genuine upstream gap |

**No primitive is blocked by the shared schema.** The schema already has every column the ten
primitives need. Every gap is either mapper-extraction (fixable) or a genuine upstream absence (rare).

## Retention cost summary (R5 — for operator ruling, map open question 1)

| Payload                                                                | Bytes/session                            | Primitives unlocked                       | Estimate basis                             |
| ---------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------- | ------------------------------------------ |
| Raw tool args (alongside digest)                                       | ~1–16 KB                                 | phase-detection, per-phase-metrics        | Extrapolated from omp sample               |
| Message `duration_ms` + tool `started_at`/`completed_at`/`duration_ms` | ~2.4 KB                                  | time-decomposition, bottleneck-ranking    | Measured from omp raw (wallTimeMs present) |
| Tool result content (`error_text` + structured extraction)             | ~100 KB–5 MB                             | issue-categorization                      | Extrapolated from omp/claude raw           |
| **All three**                                                          | ~100 KB–5 MB (dominated by tool results) | full forensic parity with omp methodology | Mixed                                      |

## session-formats.md reconciliation verdict (R1)

`plugins/sp/skills/issue-finding/references/session-formats.md` (121 lines) and the importer mappers
(`mappers.ts`) are **two maps of the same territory**, maintained apart.

**Verdict:** the importer mappers (`mappers.ts`) should be the **single code authority** for what the
typed tables retain — they are the executable contract. `session-formats.md` should be **reduced to
an operator-facing reference** that points at the mappers as the source of truth and retains only:
(1) the source→root path table (operator onboarding, not in mappers), (2) the `--use-history` bridge
description (command surface, not import). The per-source fidelity ratings ("High"/"Medium") should
be deleted from the prose map and derived from the coverage matrix instead, so there is one place
that states what each source retains. **The edit belongs to the command-rewrite ticket (0492).**

## Shipped import behavior — do not re-specify (R6)

E1 already delivered:

- `spur history import --source <name>` — full and incremental import with checkpoint resume
  (`jsonl-importer-dao.ts:116-149`, checkpoint per `(source, source_file)`).
- `--source all` — iterates all ten source definitions (`sources.ts:152-203`).
- `force-file` mode — re-imports a specific file ignoring checkpoint.
- `applyHistoryImportSchema` — creates all tables idempotently (`jsonl-importer-dao.ts:84-91`).
- Incremental deduplication via `history_import_ledger` (`:151-157`) and `ON CONFLICT DO NOTHING`.
- `normalizeSourceFilePaths` — realpath canonicalization (`:264-278`).

**Genuine deltas this matrix identifies (for downstream import spec, not this ticket):**

1. Write custom mappers for gemini, opencode, antigravity, openclaw (currently generic → invisible).
2. Extract `duration_ms` from OMP/Pi/Claude/Codex/AGY raw JSONL into the typed column.
3. Retain raw tool args (or structured extraction) alongside `args_digest` for phase-detection.
4. Retain tool result content (or structured extraction) for issue-categorization.

### Testing

**N/A — no code shipped.** This is a wayfinder research ticket. Verification is per-claim
reproducibility, not a test suite.

**Per-claim confidence ratings:**

| Claim                                                     | Evidence                                                                       | Confidence                                           | Reproducible by                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| Two-tier write path (custom→typed, generic→blob)          | `jsonl-importer-dao.ts:161-219`, `sources.ts:152-203`                          | **HIGH** — read from source                          | Open `jsonl-importer-dao.ts:172` and trace `TYPED_TABLE_COLUMNS` branch |
| All 10 ETL tables empty / 3 absent                        | `sqlite3 ~/.spur/spur.db "SELECT COUNT(*)..."`                                 | **HIGH** — measured                                  | Re-run the probe loop                                                   |
| `history_message`/`history_tool_call` absent from live DB | `sqlite_master` query                                                          | **HIGH** — measured                                  | `SELECT name FROM sqlite_master WHERE name LIKE 'history_message%'`     |
| All six mappers set `duration_ms: undefined` except Grok  | `mappers.ts:163,241,341,441,593` (undefined); `:782` (populated)               | **HIGH** — read from source                          | `grep -n "duration_ms:" mappers.ts`                                     |
| `args_digest` is a hash; raw args discarded               | `mappers.ts:189` (`argsDigest(b.input)`), `schema-sql.ts:120`                  | **HIGH** — read from source                          | Open `argsDigest()` at `mappers.ts:66-70`                               |
| OMP raw has `wallTimeMs` signal                           | `grep -c wallTimeMs` on sample JSONL: 19/107 lines                             | **HIGH** — measured                                  | Re-run grep on any omp session file                                     |
| OMP raw has todo tool signal                              | `grep -c '"toolName":"todo"'`: 2 in sample                                     | **HIGH** — measured                                  | Re-run grep                                                             |
| Pi raw has todo signal                                    | 20 occurrences in sample                                                       | **HIGH** — measured                                  | Re-run grep                                                             |
| Generic four sources write only `payload_json`            | `sources.ts:199-202` uses `sourceDefinition()`, not `customSourceDefinition()` | **HIGH** — read from source                          | Diff the two definition functions at `:76` vs `:119`                    |
| Retention cost estimates                                  | Extrapolated from raw sample sizes                                             | **MEDIUM** — extrapolated, not statistically sampled | Measure across N sessions per source for tighter bounds                 |

**Coverage matrix self-check:** every cell in the matrix cites either a `file:line` (mapper or
schema) or a measured row count / grep count. No cell is filled from the methodology document alone.

### Review

| Priority | File                                                            | Finding                                                                                                                                                                                                                                                                      | Recommendation                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | n/a (upstream gap)                                              | `started_at`/`completed_at` may be unfixable upstream. No source emits separate tool-call start/end timestamps; OMP emits a single `duration` value. Time-decomposition requires either start/end timestamps (unavailable) or a derived approximation from message ordering. | Mechanism spike (0490) must determine whether duration-only is sufficient for the report's time-decomposition section, or whether the report must degrade gracefully.                                                                                                       |
| P2       | n/a (unprobed sources)                                          | codex/grok/agy todo signal unprobed. Matrix marks phase-detection as fixable for these sources based on the mapper discarding args, but whether the upstream JSONL even contains a todo-like tool was not probed for these three.                                            | If upstream JSONL lacks any todo signal, phase-detection is unfixable for those sources, not fixable. Command-rewrite ticket (0492) should probe this before promising phase-detection for all sources.                                                                     |
| P3       | `~/.spur/spur.db`                                               | Live DB has never been imported. All ten ETL tables are empty; typed consumer tables (`history_message`/`history_tool_call`) don't exist. E1's import pipeline has never been exercised end-to-end on this machine.                                                          | Before downstream spec can be validated, a real import must run (`spur history import --source all`) to materialize typed tables and produce measurable non-null rates. The R3 non-null rates in the matrix are currently mapper-source evidence, not DB-measured evidence. |
| P4       | `plugins/sp/skills/issue-finding/references/session-formats.md` | `session-formats.md` ownership verdict is a directive, not an edit. This ticket states the verdict (mappers are code authority; prose map reduces to operator reference). The edit itself belongs to 0492.                                                                   | If 0492 disagrees with the verdict, the two-map problem persists. Defer resolution to 0492.                                                                                                                                                                                 |

**Follow-up review notes:**

- The retention cost estimates (R5) are extrapolated from 1–2 sample sessions per source. A
  statistically meaningful estimate would sample ≥10 sessions per source. This is acceptable for an
  operator ruling (order-of-magnitude) but not for a capacity plan.
- The generic-four blocker (no typed mapper) is the largest single coverage gap: it makes 4 of 10
  sources completely invisible to forensic queries. This should be the first delta in the downstream
  import spec.

### References

- Map: `docs/features/E2_session-forensics-extension-of-the-history-plane-forensic-primitives-derived-variable-analyze-multi-mode-report-rewritten-find-issue.md`
- Predecessor map (the plane this extends): `docs/features/E1_history-data-plane-trustworthy-end-to-end-forensic-etl-verified-incremental-import-analyze-report-one-scheduled-loop.md`
- Methodology under study: `docs/session-forensics-report-generation.md`
- Output to reproduce: `.spur/run/sp-dev-find-issue-20260806.md`
- Shared schema: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:84-139`
- Per-source mappers: `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts`
- Source registry: `packages/domain/src/analytics/query.ts:8-19`
- Existing forensic queries: `packages/domain/src/analytics/forensic-query.ts`
- Competing prose field map: `plugins/sp/skills/issue-finding/references/session-formats.md`
- Investigation-ticket close recipe: E2 `## Notes` § Map protocol

### History

- 2026-08-10T00:25:15.682Z todo → wip (system)
- 2026-08-10T00:30:52.078Z wip → testing (system)
- 2026-08-10T00:31:39.759Z testing → done (system)
