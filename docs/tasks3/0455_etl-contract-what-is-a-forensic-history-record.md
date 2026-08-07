---
template: feature-impl
schema_version: 1
name: "ETL contract: what is a forensic history record?"
description: ""
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0463"]
created_at: "2026-08-06T23:09:53.642Z"
updated_at: "2026-08-06T23:32:28.384Z"
---

## 0455. ETL contract: what is a forensic history record?

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Blocked by 0463.**
Resolve with `sp:dev-refine` (structured Q&A, one question at a time). Consolidates cancelled tickets
0459 and the decision half of 0462.

**This is the keystone.** 0464 is blocked on it, and every implementation task graduates from it.

**The question:** What is a forensic history record — the canonical shape `spur history import`
persists so a report can attribute time cost, token cost, and tool calls *by step* — which sources
feed it, and where does the mapping that produces it live?

**Why it is open.** `ts-llm-jsonl-importer@0.4.19` persists one flat row per JSONL line into
`history_etl_<source>` with a `payload_json` blob, validated against a schema requiring top-level
`content: string`. Real transcripts nest their payload — claude puts everything under
`message.{model,usage,content[]}` across 9 record types, and tool calls are content blocks. Measured
yield is ~1%. The current shape cannot express step forensics at all.


- Granularity: one row per JSONL line, per message, per content block, or per tool call? A `tool_use`
  and its matching `tool_result` arrive on different lines — what row do they collapse into?
- Linkage: how are session, turn, and step identified across sources with different id schemes?
- Duration: derived from adjacent timestamps, or read from a field where one exists? What happens at
  gaps and interruptions?
- Usage rollup: which numbers are authoritative for cost when nested `usage.iterations[]` disagrees
  with top-level counts?
- Cross-source normalization: one shared queryable shape, or per-source tables with a view over them?
  This decides whether analyze is written once or six times.
- Backward compatibility: `packages/domain/src/analytics/run-cost.ts` and `costs.ts` already read
  `EtlPayload`. Does the new shape extend it or replace it?


0463 supplies the facts; this ticket makes the call.

- Cover Spur-launched run sessions (`.spur/run/<runId>/agent-sessions/<agent>/`), ambient `$HOME`
  history, or both? A report seeing only Spur-launched runs cannot diagnose an interactive session;
  one seeing only ambient history throws away exact run correlation Spur already has.
- If both: one source with two roots, or distinct provenance carried on the record?
- Can `run_id` and task WBS be recorded at import time for the two sources that honor
  `--session-dir` (pi, omp), instead of reconstructed? `run-cost.ts:131` matches heuristically today.
  What do claude, codex, agy, and grok fall back to?
- For agy: JSONL transcript or the `conversations/<uuid>.db` SQLite store (0463 characterizes both)?


- Can `SourceDefinition` express step forensics declaratively? It is currently `defaultRoots`,
  `filePatterns`, a flat field-rename map, and `splitConfig` with `one-to-one` / `one-to-many` /
  `custom` modes (`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:59-108`). Step
  forensics needs conditional record-type dispatch, cross-line joins, nested extraction, and derived
  durations. **Establish what `splitConfig.mode: 'custom'` already permits before proposing a new
  seam.**
- Options: extend the declarative model; add a per-source transform hook; move mapping into Spur
  (contradicts the `AGENTS.md` prefer-fix-the-facade rule — needs a real reason); or have
  `ts-ai-runner`'s shims own history location while the importer owns parsing, collapsing the two
  drifted registries into one.
- Blast radius: `@gobing-ai/ts-llm-jsonl-importer` has consumers beyond Spur, and
  `HISTORY_IMPORT_SCHEMA_SQL` is consumed by `packages/domain/src/migrations.ts:4` — a schema change
  is a Spur migration too.
- Whatever is chosen must leave adding the deferred sources (gemini, opencode, antigravity-ide,
  openclaw, hermes) mechanical rather than a redesign.

**Constraint:** upstream edits are authorized (map Decisions, 2026-08-06) — `~/xprojects/ts-libs`
developed against Spur via `bun link`. `bun link` validates unreleased fixes only; landing needs a
released version and a catalog bump.

**Resolved when** the task body carries the record shape as a concrete schema (fields, types, keys),
the granularity and linkage rules, the ingestion-path decision, the chosen mapping placement with its
migration path for existing `history_etl_*` tables, and an answer on whether this warrants an ADR
(`docs/00_ADR.md`) — changing a shared package's extension model probably does.

**Do not** write production code here. Implementation graduates into separate tasks once the contract
is settled.
### Requirements
- R1 — Define the canonical forensic record shape as a concrete schema (fields, types, keys) capable of attributing time cost, token cost, and tool calls by step.
- R2 — State the granularity rule and how a tool_use block collapses with its later tool_result, plus session/turn/step linkage across all six sources.
- R3 — State which usage numbers are authoritative for cost when nested iterations disagree with top-level counts, and how per-step duration is derived.
- R4 — Decide cross-source normalization (one shared shape vs per-source tables with a view) and whether the existing EtlPayload contract extends or is replaced.
- R5 — Decide which ingestion paths feed the record — Spur-launched run sessions, ambient $HOME history, or both — with provenance and run-correlation rules, and the fallback for sources ignoring --session-dir.
- R6 — Decide where per-source mapping lives, having first established what splitConfig.mode custom already permits, with blast-radius assessment and a migration path for existing history_etl_ tables.
- R7 — State whether the change warrants an ADR in docs/00_ADR.md.
### Acceptance Criteria
```gherkin
Feature: 0455 wayfinder investigation

  Scenario: R1 — the contract is concrete enough to implement against
    Given the per-source field map and ingestion-path facts from 0463
    When ticket 0455 is resolved
    Then the task body carries a field-level schema for the forensic record
    And each of R2 through R7 has an explicit answer or a deferral with a stated reason
    And the chosen mapping placement leaves the deferred sources mechanical to add
    And no production code was written in this ticket
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

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
