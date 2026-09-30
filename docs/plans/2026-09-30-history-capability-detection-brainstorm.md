---
kind: plan
title: History capability detection review
status: approved
created_at: 2026-09-30
updated_at: 2026-09-30
related:
  - docs/design/history-data-processing.md
  - docs/design/history-board-module.md
  - E93
  - docs/design/history-capability-detection.md
tags: [brainstorm, history, agent]
needs_design: true
run_id: idea-fab66c82-1761-4bf7-8124-143f1f9222b1
---

# History capability detection review

## 1. Objective and outcome
Turn the operator's complete idea, preserved in `.spur/run/idea-fab66c82-1761-4bf7-8124-143f1f9222b1-idea-input.md`, into a feature and tasks for reliable command, subagent, and skill detection across agent histories. The operator accepted this discovery direction. Feature E93 now carries the intent and nine scenarios. The system design is accepted and tasks 1028–1030 are created with dependency ordering.

## 2. Premises and dependencies
Extraction already lives in `@gobing-ai/ts-llm-jsonl-importer` 0.5.11. Its `extractSkillCalls` dispatches source-specific detectors, canonicalizes names, and emits `history_skill_call`. Invocation kind is only user/model. Codex matches a bodyless child-element wrapper; pi only matches user wrappers. These are verified installed-source facts, not a complete live-corpus audit.

Spur consumes skill-load counts through `skillCallRollup` and exposes `HistorySkillBreakdown`; tool-derived skill metrics have a different input path. Preserve that distinction. Superskill historical origin metadata is unverified and must be audited before exact classification claims. Subagent user requests do not prove agent delegation.

## 3. Approaches
| Approach | Benefit | Cost / limitation | Confidence |
| --- | --- | --- | --- |
| Patch missing wrapper signatures only | Smallest immediate repair | Does not deliver the three kinds or implicit tool loads | High: current mapper source |
| Extend importer events and source detectors | Reuses the existing authoritative extraction path and preserves provenance | Requires upstream release and safe reprocessing | High on ownership; medium on historical metadata coverage |
| Add Spur-side post-import detection | Fast local iteration | Duplicates importer parsing and risks inconsistent counts | Low: conflicts with reusable-engine ownership |

Recommendation: extend the existing importer. Evidence inspected on 2026-09-30: importer `src/mappers.ts:121`, `src/types.ts:176`, `src/schema-sql.ts:113`; Spur `packages/domain/src/analytics/history-board-rollup.ts:268` and `packages/app/src/services/history-board-service.ts:327`.

## Design Summary
Keep logical capability kind (command/subagent/skill) separate from invoker (user/model) and evidence form (user invocation, injected wrapper, native load, verified file read, delegation). Reuse existing importer rows and normalization, extending the contract only where existing fields cannot represent these distinctions. Resolve converted capabilities through verifiable Superskill origin identity; preserve unresolved classification honestly rather than guess from names.

Use structured user invocation syntax for explicit requests and source-specific tool calls for observed loads/delegation. Keep intent distinguishable from observed action. Correlate source record, message, and call identities to avoid duplicate events when a request, wrapper, and load represent the same invocation; preserve genuinely repeated calls. Do not treat quoted examples, tool outputs, skill catalogs, or arbitrary mentions as invocations. Keep native delegation lineage when available; do not claim a skill-emulated subagent spawned a child process.

Audit every registered source against retained fields and fixtures. Existing full-fidelity sources are the initial delivery set; retain deferred labels for other sources unless their formats are proven and explicitly included. Improve ordinary native loads and file reads where verified; avoid executing shell text from history. For opaque tool expressions, report an extraction limit rather than run them.

Propagate event classification to existing Histories breakdown/query surfaces with fresh/raw-path parity, without inventing token attribution for request-only events. Perform backup and dry-run before real-data reprocessing, record importer provenance, and verify replay idempotence. Update owning history satellites when accepted contracts change. No new public CLI noun or verb is proposed.

`needs_design: true`: importer schema, source extraction, materialization, and transport/query contracts cross multiple boundaries.

## 4. Execution sequence
1. Audit source fixtures, Superskill origin identity, invocation/load correlation, and current consumer semantics; resolve ambiguous evidence rules in the design.
2. Extend the reusable importer contract and source detectors with positive/negative fixture checks; release the owning package.
3. Consume the released contract in Spur, update materialization and history projections, and verify raw/materialized parity.
4. Back up, dry-run, then perform authorized reprocessing and verify stable counts on repeat import.

This sequence is captured in the created task batch: upstream extraction (1028), existing Histories integration (1029), and isolated replay verification (1030).

## 5. Risks and verification
Require fixture checks for each delivered source and kind: explicit commands, user/model ordinary skills, native and converted subagents, full-body wrappers, nested tool calls, failed load attempts, quoted examples, ambiguous names, and repeat calls. Preserve timestamps and parent identity. Reimport must not duplicate events; failed/unsupported sources must not read as zero verified usage. Preserve existing token allocation.

Self-review: no placeholders, no invented metadata availability, no silent expansion of deferred full-fidelity sources, no claim of execution from a user request. The I7 ambiguity is explicitly surfaced and reshaped.

## 6. Follow-up
The supplied `sp-dev-idea` skill says `--auto` skips objective gates only. The operator accepted idea-eval and system design, including per-agent formats and necessary ts-libs enhancement. Planning is complete; the handoff recommends /sp:dev-runall --feature E93 --auto. The repository command/reference currently gives `--auto` broader consent; both taste decisions were answered explicitly in this run.

