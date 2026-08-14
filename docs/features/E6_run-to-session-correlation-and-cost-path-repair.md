---
schema_version: 1
id: "E6"
name: "Run-to-session correlation and cost-path repair"
status: backlog
priority: P2
tags: []
created_at: "2026-08-14T02:43:12.670Z"
updated_at: "2026-08-14T02:46:12.481Z"
---

# E6: Run-to-session correlation and cost-path repair

## Goal
A `spur agent run` invocation and the session file its coding agent wrote are **correlated**, so that
anything measured about a run — tokens, duration, tool loops — can be attributed to the role, task,
and executor that caused it.

Today nothing connects them. Measured against the live `.spur/spur.db` on 2026-08-13:

| Measured | Value |
| --- | --- |
| `history_message` rows | 1,296,633 |
| …carrying token data | 166,162 (`omp`, `pi`, `opencode`, `gemini`, `grok` — **`claude` and `codex` contribute 0**) |
| …carrying `run_id` | **0** |
| All 10 `history_etl_*` tables | **0 rows** |

The `run_id` column and its `(provenance, run_id)` index (migration `0009`) exist; nothing writes
them. `provenance` is not launch provenance at all — `detectProvenance(cwd)`
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:61-64`) is a **cwd path-substring
match** (`cwd.includes('/spur')`), so its 52,692 `spur-run` rows include every ambient session that
happened to run inside a spur directory.

Meanwhile the entire ETL payload path — `loadAllEtlPayloads`, `SOURCE_TABLES`,
`payloadToCostRecord`, `extractClaudeTokens` — scans ten empty tables, so `spur workflow trace`
run-cost attribution is blind to every source including the default agent.

This feature closes the correlation gap and repairs the cost path onto the data that actually exists.
## Scope
- In:
    - **Observe-at-spawn correlation (primary).** Spur watermarks the agent's session root at
      `agent.invoke.start` and resolves the produced session at `agent.invoke.exit`, recording a
      `run_id ↔ (source, session_id)` mapping. Works for every agent because spur controls the spawn
      boundary.
    - **Dictate-when-offered (opportunistic).** Where an agent's CLI accepts a session id, pass one
      and take the exact mapping for free — the existing `sessionId` / `--session-id` path.
    - **Retroactive correlation (fallback).** Time-window matching over the 1.3M rows already
      imported, always marked **estimated**, never presented as exact.
    - Repointing cost attribution at `history_message`'s typed token columns.
    - Retiring the dead `history_etl_*` path once confirmed unused, and correcting `detectProvenance`
      so `provenance` means what its name says.
- Out:
    - **Any dollar figure.** `history_message.cost_usd` exists as a column and stays unread;
      `MODEL_PRICING` gains no new consumer. Tokens, never prices (operator ruling 2026-08-13).
    - Adding source support for `gemini`, `opencode`, `antigravity-ide`, `openclaw`, `hermes`
      (2026-08-06 ruling).
    - Investigating **why** `claude` and `codex` capture no token rows — recorded as a finding and a
      bound on coverage; the mapper fix is feature E1/E5 territory, not this feature's.
    - Changing the role model, the routing decision, or what feature J6 records.
    - Forensic primitives, derived variables, and report modes — feature E5.
## Acceptance Criteria
```gherkin
Feature: Run-to-session correlation and cost-path repair

  @core
  Scenario: R1 — A completed agent run is mapped to the session it produced
    Given spur invokes a coding agent and the agent writes a session file
    When the invocation exits
    Then a mapping from that run id to the session's source and session id is recorded
    And the mapping is marked exact

  @core
  Scenario: R2 — An agent that accepts a session id yields the mapping without observation
    Given an agent whose CLI accepts a session id
    When spur supplies one for the invocation
    Then the mapping is taken from the supplied id rather than from file observation
    And it is marked exact

  @core
  Scenario: R3 — An unresolvable spawn degrades to estimated, never to a guess
    Given two runs of the same agent in the same working directory overlap
    When the boundary cannot attribute a session file to exactly one run
    Then no exact mapping is written for the ambiguous runs
    And they are left for retroactive correlation rather than assigned arbitrarily

  @core
  Scenario: R4 — Already-imported history is correlated retroactively and marked estimated
    Given history rows imported before correlation existed
    When retroactive correlation runs over a bounded window
    Then matched rows carry a run id marked estimated
    And an exact mapping is never overwritten by an estimated one

  @core
  Scenario: R5 — Cost attribution reads the columns that hold data
    Given token data lives in history_message typed columns and every history_etl_ table is empty
    When run cost is attributed for a workflow action
    Then the figures derive from the typed columns
    And no dollar value is computed or emitted

  @core
  Scenario: R6 — The dead ETL path is removed, not left dormant
    Given every history_etl_ table is confirmed empty and unwritten
    When the cost path no longer reads them
    Then the ETL payload loader and its source-table allowlist are deleted
    And no caller references them

  @core
  Scenario: R7 — provenance means launch provenance
    Given provenance is currently derived from a cwd substring match
    When a session is imported
    Then a session spur launched is distinguishable from one it did not
    And a session merely run inside a spur directory is not reported as spur-launched
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0557 | Capture the run-to-session mapping at the agent invoke boundary | todo |
| 0558 | Correlate existing history retroactively by time window, marked estimated | todo |
| 0559 | Repoint cost attribution at typed columns and retire the dead ETL path | todo |
<!-- END AUTO-GENERATED -->

## Notes
### Why observe rather than dictate (operator ruling, 2026-08-13)

Three mechanisms were compared. The ruling is **B primary + C retroactive, A opportunistically.**

| | Mechanism | Coverage | Exactness | Retroactive |
| --- | --- | --- | --- | --- |
| A | spur dictates the session id | only agents whose CLI accepts one | exact | no |
| **B** | spur observes the session file across the invoke boundary | **all agents** | exact | no |
| **C** | time-window inference at query time | all | probabilistic | **yes** |
| D | abandon per-run attribution | all | n/a | yes |

**B over A** because A's coverage is set by vendors, not by the operator. Spur's premise is that it
wraps agents you already run; building correlation on a CLI feature only some agents expose would
mean `claude` and `codex` — already contributing zero token rows — may never correlate. B works
uniformly because spur controls the spawn boundary. A is still taken where offered: it is nearly free
and strictly better than observation.

**C alongside, not instead.** B only helps future runs; 1,296,633 rows already exist. C is the only
way to attribute them, and is honest as long as it is marked estimated — a distinction `run-cost.ts`
already models (`actionCost` versus `actionCostEstimated`).

**Not D**, which would remove the role dimension that is feature J6's entire point.

### The existing half-design

`packages/app/src/services/agent-service.ts:195-201` already documents `sessionId` as *"the primary
join key connecting a workflow `agent.run` step to imported history ETL records (R1a) … the heuristic
time-window fallback (R1b) applies"* when absent. That is A-primary/C-fallback, designed and never
wired. This feature wires it, with B added because A alone leaves coverage to vendors.

### What this unblocks

Feature J6 task **0547** (tokens per role) is blocked on exactly this: its join over `run_id` returns
nothing today. Feature J7 task **0552** renders 0547's output and inherits the block.

### Known coverage bound

`claude` and `codex` carry **0** token-bearing rows despite being full-fidelity sources. Correlation
cannot manufacture data that was never captured, so those two will correlate but report unmeasured
tokens. Recorded as a finding here; the mapper investigation belongs to feature E1/E5.
## History
