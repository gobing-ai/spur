---
schema_version: 1
id: "E5"
name: "Session forensics implementation: retention, derived variables, report modes, find-issue rewrite"
status: active
priority: P2
tags: []
created_at: "2026-08-14T01:03:25.438Z"
updated_at: "2026-08-17T20:17:19.323Z"
---

# E5: Session forensics implementation: retention, derived variables, report modes, find-issue rewrite

## Goal
`spur history` carries omp's session-forensics capability end to end: the primitives it needs are
retained at import, derived variables are computed by `analyze`, `report --mode` selects a renderer,
and `/sp:dev-find-issue` consumes them instead of re-parsing raw JSONL.

This is the implementation half of feature **E2**, whose four charting tickets (0489–0492) are all
resolved. E2's destination was explicitly *"implementation-ready task files, not landed code"*
(operator ruling, 2026-08-09), so E2 stays a closed map and this feature is the downstream effort it
called for. **Every decision here is already made** — the tasks below transcribe E2's `### Decisions
so far`, they do not reopen it.

One amendment supersedes E2's contract: **tokens, never prices** (operator ruling, 2026-08-13, feature
J6). E2 was charted when the report plane was "spend + forensic" and left "cost-model currency" as a
deferred implementation concern. Under the new ruling that concern is not deferred — it is removed.
New renderers report tokens and cache efficiency; no new surface computes a dollar figure.
## Scope
- In:
    - **Import retention** — raw tool args for todo-writing tools only, alongside the existing
      `args_digest`; `duration_ms` extracted from raw JSONL. Plus probing codex/grok/agy for todo
      signal, which 0489 R4 left unprobed.
    - **Derived variables in `analyze`** — Mechanism B (0490): an in-analyze metric registry
      computing phases, time decomposition, and bottleneck ranking, surfaced as an additive optional
      block on the artifact.
    - **Report mode registry** — `report --mode <name>` resolving to built-in TS renderers; the
      registry subsumes today's `renderReport` and `renderMarkdown`; a forensics renderer covering
      0491's 8 derivable sections. Plus `daily --mode` wiring.
    - **`/sp:dev-find-issue` rewrite** — report-first per 0492: the CLI absorbs DISCOVER/ANALYZE
      extraction and rendering; the skill keeps IDENTIFY/PROPOSE and a `--create-task`-gated GENERATE.
- Out:
    - **Any new dollar figure.** Superseded by the 2026-08-13 tokens-not-prices ruling. The existing
      `renderReport` spend output and `MODEL_PRICING` are left untouched — removing shipped output is
      a separate operator call, not this feature's to take.
    - Reopening E2's decisions. Mechanism, retention policy, report-mode shape, and the find-issue
      contract are settled; a task that relitigates one has misread its scope.
    - Custom mappers for gemini/opencode/antigravity/openclaw — identified by 0489 as a genuine
      delta, but source support for those is deferred by operator ruling 2026-08-06 (feature E1).
    - Tool **result** content retention (~100 KB–5 MB/session). Ruled out 2026-08-09; issue
      categorization stays on the raw-JSONL fallback.
    - The E1 run-cost regression (`run-cost.ts:103` reads only `history_etl_*`). Real and unowned,
      but E1's surface — ruled out of E2 by the operator 2026-08-09 and still out here.
    - A new `spur history forensics` verb. Forensics routes through `report --mode` (E2 § Out of scope).
    - File-authored report templates; porting the Python reference implementation verbatim.
## Acceptance Criteria
```gherkin
Feature: Session forensics implementation

  @core
  Scenario: R1 — Import retains the primitives phase detection needs
    Given a session containing todo-writing tool calls
    When it is imported
    Then the raw arguments of todo-writing tools are retained alongside the existing args_digest
    And no other tool's raw arguments are retained
    And tool result content is not retained

  @core
  Scenario: R2 — Per-step latency is available for time decomposition
    Given source JSONL carrying per-call timing
    When it is imported
    Then duration_ms is populated for tool calls
    And a source that reports no timing leaves it absent rather than zero

  @core
  Scenario: R3 — Analyze computes derived variables without a schema break
    Given imported sessions with retained primitives
    When analyze runs
    Then the artifact carries an additive optional derived block with phases, time decomposition, and bottleneck ranking
    And an artifact produced before this change still validates

  @core
  Scenario: R4 — Report renders by selected mode
    Given a generated artifact
    When report is invoked with a mode
    Then the named built-in renderer produces that mode's output
    And an unknown mode fails naming the registered modes

  @core
  Scenario: R5 — The forensics mode reproduces the derivable sections
    Given an artifact with derived variables
    When report --mode forensics runs
    Then it renders the sections 0491 identified as derivable
    And it reports tokens and cache efficiency without any dollar figure

  @core
  Scenario: R6 — find-issue is report-first
    Given a session set
    When /sp:dev-find-issue runs with no extra flags
    Then it emits a markdown report rather than writing a task file
    And a task file is written only when --create-task is passed

  @core
  Scenario: R7 — The data plane is primary and raw JSONL is the named fallback
    Given a source with a typed mapper
    When find-issue runs
    Then extraction reads the data plane
    And raw JSONL parsing occurs only for a source with no typed mapper, an explicit --sessions, or a primitive the typed tables do not retain

```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0553 | Retain forensic primitives at import: todo-arg allowlist and per-call latency | done |
| 0554 | Compute derived variables in analyze via an in-analyze metric registry | done |
| 0555 | Add the report mode registry and the forensics renderer | done |
| 0556 | Rewrite dev-find-issue as report-first over the data plane | done |
| 0564 | Fix E5 forensic-report findings: toolResult durations, report flag passthrough, omp arguments-shape drift | done |
| 0576 | history-load dogfood follow-up findings (2026-08-17) | done |
| 0577 | pi mapper: apply the omp event-envelope fix to piSplit and re-import pi | done |
| 0578 | Close the release + re-import gap so landed mapper fixes reach the data plane | done |
| 0579 | Sanitize sentinel timestamps out of the time-decomposition span math | done |
| 0580 | Mapper fidelity: codex roles, claude usage, tool_name pollution, epoch-0 sentinel | done |
| 0581 | Per-step token/time and cache-efficiency sections in the analyze artifact | done |
<!-- END AUTO-GENERATED -->

## Notes
### Data-plane-evidence rule (0578 R5, 2026-08-17)

A mapper/retention fix is accepted only by its measured post-re-import effect on `.spur/spur.db` — importer provenance header (0.4.37) + before/after row counts, never a source-read verdict. Measured after `--mode full` re-import of omp/pi/grok/opencode:

| Signal | Before | After |
| --- | --- | --- |
| omp tool calls with `duration_ms` | 0 / 101,785 | 102,113 / 102,130 |
| omp tool calls with `call_id` | 0 | 102,130 (100%) |
| `args_raw` non-null (all sources) | 1,977 | 6,919 |
| omp `phaseSupport` | unsupported | supported (1,720 phases) |

The phase flip needed one more fix than the re-import: `parseTodoItems` in `packages/domain/src/analytics/derived.ts` only knew `{todos}`/`{plan}` shapes; omp's ops dialect (`start`/`done`/`init`/`append`) and pi's `{todoList}` with hyphenated statuses were unparsed. Both added (task 0578 R3).

### Every decision is already made

Feature E2's four tickets resolved the contract. Read `docs/features/E2_*.md` § *Decisions so far*
before starting any task here — it is the specification. The short form:

| Layer | Decision | Ticket |
| --- | --- | --- |
| Import retention | digest + per-tool allowlist (todo-writing only) + `duration_ms`; no tool results | operator 2026-08-09 |
| Coverage authority | importer `mappers.ts` is the single code authority; `session-formats.md` reduces to root table + fallback note | 0489 |
| Derived variables | Mechanism B — in-analyze metric registry, computed at query time | 0490 |
| Artifact shape | additive optional `derived?` block, **no version bump** (`assertArtifactVersion` checks equality, not key absence) | 0490 R3 |
| Report modes | built-in named TS renderers, not file templates; registry subsumes `renderReport` + `renderMarkdown` | operator 2026-08-09, 0491 |
| `daily` | stays, gains `--mode` wiring only | operator 2026-08-09 |
| find-issue | report-first; `--create-task` gate; `--use-history` and `--no-task` removed | 0492 R3 |
| Command/skill split | CLI absorbs DISCOVER/ANALYZE + rendering; skill keeps IDENTIFY/PROPOSE + gated GENERATE | 0492 R2 |

### Amendment: tokens, never prices (operator ruling, 2026-08-13)

E2 was charted while the report plane was "spend + forensic" and listed *cost-model currency* as a
deferred implementation concern — `MODEL_PRICING` falls back to `UNKNOWN_MODEL_PRICING` at $3/$15 per
1M (`packages/domain/src/analytics/models.ts:31`), unmeasured.

The 2026-08-13 ruling settles it by removal rather than measurement: per-model pricing is too volatile
to hold correctly, so no new surface computes a dollar figure. omp's step 7 ("token cost + cache
efficiency") is delivered as **tokens and a cache-hit ratio** — both provider-reported facts needing
no pricing table.

The existing `renderReport` spend output and `MODEL_PRICING` itself are **left alone**. Deleting
shipped output is a separate operator decision; this feature simply stops adding to it.

### External package boundary

Import retention reaches into `~/xprojects/ts-libs/packages/llm-jsonl-importer/`
(`src/schema-sql.ts:120` holds `args_digest`; `mappers.ts` holds the per-source maps). Per AGENTS.md,
prefer fixing the ts-libs facade over a Spur-side workaround, release by semver, and use `bun link`
only while validating an unreleased fix. Any schema change there is additive — `args_digest` is
load-bearing for Q4 loop detection (`packages/domain/src/analytics/forensic-query.ts:275`) and must
not be replaced.

### Deferred past this feature

- Custom mappers for gemini/opencode/antigravity/openclaw — blocked on the 2026-08-06 source-support
  ruling, not on anything here.
- Retention pressure — bounded at ~18 KB/session by the allowlist ruling; history-row pruning stays
  unwired and is revisited only if a future ruling retains result content.
- TTFT/generation split — deferred by 0491; the artifact carries no intra-call latency fields.
## History
- 2026-08-17T19:05:22.219Z backlog → active (system)
