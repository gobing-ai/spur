---
template: feature-impl
schema_version: 1
name: "Decide where per-source forensic mapping lives: upstream SourceDefinition vs transform hook"
description: ""
status: cancelled
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0455", "0458"]
created_at: "2026-08-06T23:09:54.546Z"
updated_at: "2026-08-06T23:29:59.263Z"
---

## 0459. Decide where per-source forensic mapping lives: upstream SourceDefinition vs transform hook

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Blocked by 0455 and 0458.**

**The question:** Can `SourceDefinition` express step forensics as a declarative field map, or does
per-source mapping need real code — and if so, where does that code live?

**Why it is open.** Today `SourceDefinition` is declarative: `defaultRoots`, `filePatterns`, a flat
field-rename map, and a `splitConfig` with `one-to-one` / `one-to-many` / `custom` modes
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:59-108`). Step forensics needs
conditional record-type dispatch, cross-line joins (a `tool_use` block pairing with a `tool_result`
that arrives later), nested extraction from `message.usage.iterations[]`, and derived durations.
That may exceed what a rename map can state.

**Options to weigh (not a menu — argue the tradeoff):**

- Extend the declarative model — richer transforms, typed extractors — keeping every source
  describable as data.
- Add a per-source transform hook: declarative for the simple sources, code for claude/codex.
  `splitConfig.mode: 'custom'` already exists — check what it permits before inventing a new seam.
- Move mapping into Spur (`packages/domain` or `packages/app`) and leave the importer generic.
  Contradicts the `AGENTS.md` prefer-fix-the-facade rule; needs a real reason.
- Have `ts-ai-runner`'s shims own history location while the importer owns parsing (see 0462).

**Constraints:**

- Upstream edits are authorized (map Decisions, 2026-08-06): `~/xprojects/ts-libs`, developed against
  Spur via `bun link`. `bun link` is for validating unreleased fixes only — landing needs a released
  version and a catalog bump.
- `@gobing-ai/ts-llm-jsonl-importer` has consumers beyond Spur. Assess blast radius before changing
  a published contract; `HISTORY_IMPORT_SCHEMA_SQL` is consumed by
  `packages/domain/src/migrations.ts:4`, so a schema change is a Spur migration too.
- Whatever is chosen must leave adding the deferred sources (gemini, opencode, antigravity-ide,
  openclaw, hermes) mechanical rather than a redesign.

**Resolved when** the task body names the chosen placement with its reasoning, states the migration
path for the existing `history_etl_*` tables, and says whether this warrants an ADR
(`docs/00_ADR.md`) — a change to a shared package's extension model probably does.
### Requirements
- R1 — Determine whether the declarative SourceDefinition model can express step forensics, including conditional record-type dispatch, cross-line joins, and nested extraction.
- R2 — Establish what `splitConfig.mode: custom` already permits before proposing any new extension seam.
- R3 — Choose where per-source mapping lives, with reasoning against the AGENTS.md prefer-fix-the-facade rule.
- R4 — Assess blast radius on consumers beyond Spur, including the `HISTORY_IMPORT_SCHEMA_SQL` dependency in `packages/domain/src/migrations.ts`.
- R5 — State the migration path for existing `history_etl_*` tables and whether the change warrants an ADR.
### Acceptance Criteria
```gherkin
Feature: 0459 wayfinder investigation

  Scenario: R1 — mapping placement is decided with its blast radius understood
    Given the forensic contract from 0455 and the claude/codex field maps from 0458
    When ticket 0459 is resolved
    Then the chosen placement is named with its reasoning
    And the existing custom split mode was evaluated before proposing a new seam
    And a migration path for existing history_etl_ tables is stated
    And the ADR question is answered either way
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
- 2026-08-06T23:29:59.263Z todo → cancelled (system)
