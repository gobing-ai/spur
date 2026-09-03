---
schema_version: 1
name: "Persist tool identity at import: effective_tool_name, tool_name_alias, and the alias resolution seam"
status: todo
template: feature-impl
created_at: 2026-09-03T16:43:04.048Z
updated_at: "2026-09-03T17:26:52.484Z"
feature_id: E91
priority: P1
tags: ["history", "etl", "tool-identity"]
---

## 0739. Persist tool identity at import: effective_tool_name, tool_name_alias, and the alias resolution seam

### Background
`EFFECTIVE_TOOL_NAME_SQL` (`packages/domain/src/analytics/history-board-rollup.ts:27`) is a multi-branch CASE over `json_extract(tc.args_raw, ...)` plus `call_id` prefix matching, evaluated per row per query. It is unindexable because it is an expression over JSON. Verified 2026-09-03: **12 call sites** interpolate it — 3 in `history-board-rollup.ts` (lines 81, 379, 423/425) and 7 in `forensic-query.ts` (lines 169, 341, 351, 483, 487, 1093, 1129).

Removing the double evaluation is worth 0.5% (4.152 s vs 4.171 s measured) — the scan and join dominate. **This task is a correctness and groupability fix, not a latency fix, and must not be justified as the latter.**

It fixes a live defect: `toolSequenceQuery` (`packages/domain/src/analytics/forensic-query.ts:1857`) filters raw `tc.tool_name IN (…)` at `packages/domain/src/analytics/forensic-query.ts:1880`, while the Summary top-tools path groups by `EFFECTIVE_TOOL_NAME_SQL` (`packages/domain/src/analytics/forensic-query.ts:341`). A tool picked from the Summary list can therefore match nothing in Tool Using.

`history_board_tool_5m.tool_name` is **already** populated from `EFFECTIVE_TOOL_NAME_SQL` at `packages/domain/src/analytics/history-board-rollup.ts:379`, so the rollup path already stores the extracted name. What is missing is the persisted column on the *fact* table, which is what makes the raw-path queries groupable and indexable.

Separately, `history_tool_call` holds 256 distinct `tool_name` values. The shell family alone spans nine `(source, tool_name)` pairs across eight agents and ~233K calls: pi|bash 80572, omp|bash 47258, codex|exec_command 32737, agy|run_command 22179, claude|Bash 17965, codex|exec 17495, grok|run_terminal_command 10842, opencode|bash 2730, codex|shell 1077. Cross-agent tool breakdowns are not comparable today.
### Requirements
- [ ] R1. `history_tool_call` carries a persisted `effective_tool_name` column with a supporting index, populated at import.
- [ ] R2. The Summary top-tools path and the tool-sequence path both filter on `effective_tool_name`; a tool selected from the Summary list returns matching rows in the tool-sequence view.
- [ ] R3. `history_tool_call` carries a `tool_name_alias` column whose value defaults to that row's `effective_tool_name`.
- [ ] R4. Alias resolution goes through a single seam that falls through to identity when no mapping entry exists.
- [ ] R5. Backfill migrations populate both columns for every pre-existing row.
- [ ] R6. With an empty mapping table, every tool breakdown is identical to the breakdown produced before the columns existed.
- [ ] R7. Adding a mapping entry regroups alias-grouped breakdowns into a single row while leaving `effective_tool_name` and every breakdown grouped by it unchanged.
### Acceptance Criteria
```gherkin
Feature: History read path materialized-only: incremental rollup ETL, per-table freshness, and precomputed UI aggregates

  @core
  Scenario: R9 — Tool identity is persisted once at import and used consistently
    Given tool calls whose effective name is currently derived by a CASE expression at query time
    When the corpus is imported
    Then history_tool_call carries a persisted effective_tool_name column with a supporting index
    And the summary top-tools path and the tool-sequence path both filter on that column
    And a tool selected from the Summary list returns matching rows in the tool-sequence view.


  @core
  Scenario: R19 — Tool names carry a cross-agent alias that defaults to identity
    Given the same logical tool recorded under different names by different coding agents
    When the corpus is imported
    Then history_tool_call carries a tool_name_alias column whose value defaults to that row's effective_tool_name
    And alias resolution goes through a single mapping seam that falls through to identity when no mapping entry exists
    And a backfill migration populates tool_name_alias for every pre-existing row
    And with an empty mapping table every tool breakdown is identical to the breakdown produced before the column existed.


  @edge
  Scenario: R20 — Adding a tool alias mapping regroups breakdowns without changing facts
    Given a mapping entry that maps several agent-specific tool names onto one alias
    When the mapping is applied and rollups are refreshed
    Then breakdowns grouped by alias report those names as a single row
    And effective_tool_name is unchanged for every affected row
    And breakdowns grouped by effective_tool_name are unchanged.


```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-03T17:26:52.483Z

**Is the Summary-vs-Tool-Using mismatch real? — Yes, verified 2026-09-03.** `toolSequenceQuery` filters `tc.tool_name IN (…)` (`packages/domain/src/analytics/forensic-query.ts:1880`) while the Summary top-tools path groups by `EFFECTIVE_TOOL_NAME_SQL` (`packages/domain/src/analytics/forensic-query.ts:341`). A tool whose displayed name came from the CASE expression matches no raw `tool_name`.

**Does the rollup already store the effective name? — Yes, partly.** `history_board_tool_5m.tool_name` is populated from the CASE expression at `packages/domain/src/analytics/history-board-rollup.ts:379`. That does not make the fact table groupable or indexable, and it does not help the raw-path forensic queries, which is where the defect lives.

**One column or two? — Two.** `effective_tool_name` is extraction (recover the name from a wrapper or empty field); `tool_name_alias` is canonicalization (group the same tool across agents). Collapsing them destroys the extraction result that drill-down still needs. They compose one way only: extract, then canonicalize.

**Who owns the alias mapping table? — Spur.** ADR-105 axis one assigns table DDL to the layer that creates it, and the taxonomy is curated, not observed. The two fact columns are the importer's under axis two. `resolveToolAlias` is the only seam between them.

**Is the alias vocabulary decided here? — No, deliberately.** Whether the shell family canonicalizes to `shell`, `bash`, or `exec` is a taxonomy decision nobody has reviewed, and it is harder to reverse than adding the column. The map ships empty, the alias defaults to identity, and R6 proves day-one behavior is unchanged. Owner of the vocabulary decision: the operator, when a cross-agent comparison is actually needed.

**Is this a performance task? — No.** The double-evaluation removal measured 4.152 s vs 4.171 s, 0.5%. Scan and join dominate. Justifying this task on latency would be dishonest and would set the wrong acceptance bar; its value is correctness (R2) and groupability (R7).

**When is `EFFECTIVE_TOOL_NAME_SQL` deleted? — After the backfill migration that uses it is written.** A migration must remain reproducible from the tree at its own commit, so the expression outlives its last read-path use by exactly one change.
### Design
**WHAT.** Persist two columns on `history_tool_call` — `effective_tool_name` (extraction) and `tool_name_alias` (canonicalization) — written by the importer, backfilled for existing rows, with a single alias-resolution seam that falls through to identity.

**WHY.** Recomputing an unindexable JSON expression per row per query is the read-path work ADR-103 exists to remove, and the two paths that compute it differently produce a user-visible mismatch. Fact-row identity belongs to the party that can populate it at write time (ADR-105, ADR-106).

**WHERE.** Upstream `@gobing-ai/ts-llm-jsonl-importer`: `src/schema-sql.ts` (`history_tool_call` block), `src/mappers.ts` (per-source population), `src/index.ts`. Downstream Spur: `packages/domain/src/migrations.ts` (backfill + indexes), `packages/domain/src/analytics/history-board-rollup.ts`, `packages/domain/src/analytics/forensic-query.ts` (12 interpolation sites), `packages/domain/tests/analytics/forensic-query-history.test.ts`.

**Two columns, not one.** They solve different problems and compose in one direction — extract, then canonicalize.

| Column | Problem | Example |
| --- | --- | --- |
| `effective_tool_name` | Extraction: recover the real name from a wrapper or empty `tool_name` | `call_bash_xyz` → `bash`; 19,429 empty rows |
| `tool_name_alias` | Canonicalization: group the same tool across agents | `bash` / `Bash` / `shell` / `exec` / `exec_command` / `run_command` / `run_terminal_command` |

Collapsing them into one column loses the extraction result, which downstream drill-down still needs.

**Frozen names**

| Name | Where | Kind |
| --- | --- | --- |
| `effective_tool_name` | importer `history_tool_call` DDL | `TEXT NOT NULL DEFAULT 'unknown'` |
| `tool_name_alias` | importer `history_tool_call` DDL | `TEXT NOT NULL DEFAULT 'unknown'`; defaults to the row's `effective_tool_name` |
| `history_tool_alias_map` | Spur-owned table | `(source TEXT NOT NULL, effective_tool_name TEXT NOT NULL, alias TEXT NOT NULL, PRIMARY KEY (source, effective_tool_name))` |
| `resolveToolAlias(source, effectiveToolName)` | `packages/domain/src/analytics/tool-alias.ts` | the single seam; identity fallthrough |
| `idx_history_tool_call_effective_tool_name` | Spur migration | index on `(effective_tool_name)` |
| `idx_history_tool_call_alias` | Spur migration | index on `(tool_name_alias)` |
| `0033_spur_cli_history_tool_identity` | `packages/domain/src/migrations.ts` + `drizzle/` | backfill + indexes; `0031` is the current max and `0032` is reserved by task 0748 |

**Precedence and algorithm**

1. **Extraction rules move verbatim.** The CASE branches in `EFFECTIVE_TOOL_NAME_SQL` are ported into the importer's mappers unchanged, including the `'unknown'` default. R6 — every breakdown byte-identical with an empty mapping table — is only provable if the extraction is a port, not a rewrite.
2. **`tool_name_alias` defaults to `effective_tool_name`, and `history_tool_alias_map` ships empty.** Day-one behavior is therefore unchanged by construction. Fine-tuning later means adding mapping rows plus a re-backfill, never changing query code.
3. **The alias table is Spur-owned; the columns are importer-owned.** ADR-105 axis one puts the mapping table under the layer that curates the taxonomy (Spur); axis two puts the fact columns under the party that populates them at write time (the importer). `resolveToolAlias` is the only place the two meet.
4. **All 12 interpolation sites are repointed in one change.** Leaving any site on the CASE expression preserves the exact Summary-vs-Tool-Using mismatch this task exists to fix. `toolSequenceQuery`'s raw `tc.tool_name IN (…)` filter (`packages/domain/src/analytics/forensic-query.ts:1880`) is the one with the live user-visible defect.
5. **Backfill is a single migration over the existing corpus**, computing `effective_tool_name` with the same SQL expression being retired and setting `tool_name_alias = effective_tool_name`. The expression is deleted only after the backfill migration that uses it is written.

**Deliberately not decided here:** the alias vocabulary itself (`shell` vs `bash` vs `exec` as the canonical label). Committing to a taxonomy nobody has reviewed would be harder to reverse than the column is to add. Structure now, mapping later.

**Anti-patterns**

- **Do not rewrite the extraction rules while moving them.** A port that "improves" a branch makes R6 unprovable and silently changes 256 tool names' grouping.
- **Do not leave `EFFECTIVE_TOOL_NAME_SQL` interpolated at any read site.** Partial migration reproduces the defect on whichever path was missed.
- **Do not delete `EFFECTIVE_TOOL_NAME_SQL` before the backfill migration is written** — the backfill needs it, and a migration must stay reproducible from the tree at its own commit.
- **Do not populate the columns from a Spur migration on an ongoing basis.** The backfill is one-time; steady-state population is the importer's, or the columns drift on every new import.
- **Do not seed `history_tool_alias_map` with a guessed taxonomy.** R6 requires an empty map on day one; a seeded map makes the identity-behavior proof impossible.
- **Do not index the CASE expression as a workaround.** It is an expression over JSON; that is why persisting it is the fix.

**Handoff to dependents**

Task 0743 (dimension marts + read routing) groups its tool dimension by `tool_name_alias` and drills down by `effective_tool_name`; both names are frozen above. Task 0745 (unchanged-surface verification) treats R6's byte-identical breakdown output as one of its baselines. Neither may reintroduce `EFFECTIVE_TOOL_NAME_SQL`.

Authority: ADR-103, ADR-105, ADR-106; `docs/design/history-incremental-materialization.md` section 9 (D7).
### Plan
1. **R1a (upstream DDL).** Add `effective_tool_name` to the importer's `history_tool_call` block in `HISTORY_IMPORT_SCHEMA_SQL`.
2. **R1b (upstream population).** Port the `EFFECTIVE_TOOL_NAME_SQL` CASE branches into the per-source mappers verbatim, including the `'unknown'` default. Test intent: assert the mapper output equals the SQL expression's output for a fixture covering every branch — wrapper `call_*` prefixes, each `args_raw` JSON field, empty `tool_name`, and the unresolved default. That equivalence is what makes R6 provable.
3. **R3 (alias column).** Add `tool_name_alias` defaulting to the row's `effective_tool_name`.
4. **R4 (seam).** Add `history_tool_alias_map` and `resolveToolAlias(source, effectiveToolName)` in `packages/domain/src/analytics/tool-alias.ts` with identity fallthrough. Test intent: an absent mapping row must return the input unchanged — the fallthrough is what guarantees R6 holds for every unmapped tool.
5. **R5 (backfill + indexes).** Migration `0033_spur_cli_history_tool_identity` populates both columns over the existing corpus using the expression being retired, and adds `idx_history_tool_call_effective_tool_name` and `idx_history_tool_call_alias`. Test intent: assert zero rows left with the pre-backfill sentinel after the migration on a populated fixture.
6. **R2 (repoint all 12 sites).** Replace every `EFFECTIVE_TOOL_NAME_SQL` interpolation with the persisted column, and change `toolSequenceQuery`'s filter from `tc.tool_name IN (…)` to `tc.effective_tool_name IN (…)`. Test intent: select a tool from the Summary top-tools output and assert the tool-sequence view returns a non-empty result for it — the concrete user-visible defect.
7. **R6 (identity proof).** With `history_tool_alias_map` empty, assert every tool breakdown is byte-identical to the pre-change output. Test intent: prove the change is inert on day one; any diff here is a ported-rule error from step 2.
8. **R7 (regrouping proof).** Insert a mapping entry collapsing several shell names onto one alias, refresh, and assert alias-grouped breakdowns report one row while `effective_tool_name` values and every breakdown grouped by them are unchanged.
9. Run the domain and app test suites plus `bun run spur-check`.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent feature: `docs/features/E91_history-read-path-materialized-only-incremental-rollup-etl-per-table-freshness-and-precomputed-ui-aggregates.md`
- `docs/00_ADR.md` — ADR-103 (materialized-only read path), ADR-105 (three-axis ownership), ADR-106 (measure vector / fact identity)
- `docs/design/history-incremental-materialization.md` — section 9 (D7, tool identity split)
- Expression being retired: `packages/domain/src/analytics/history-board-rollup.ts:27`; its 12 interpolation sites at `packages/domain/src/analytics/history-board-rollup.ts:81`, `:379`, `:423`, `:425` and `packages/domain/src/analytics/forensic-query.ts:169`, `:341`, `:351`, `:483`, `:487`, `:1093`, `:1129`
- Live defect: `packages/domain/src/analytics/forensic-query.ts:1857` (`toolSequenceQuery`), raw filter at `packages/domain/src/analytics/forensic-query.ts:1880`
- Upstream DDL and mappers: `@gobing-ai/ts-llm-jsonl-importer` `src/schema-sql.ts` line 57 (`history_tool_call`), `src/mappers.ts`
- Current max migration `0031_spur_cli_history_board_tool_stats_columns`; `0032` reserved by task 0748
- Dependents: task 0743 (groups by `tool_name_alias`), task 0745 (uses R6 output as a baseline)
### History
