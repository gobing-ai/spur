---
schema_version: 1
name: Unify workflow and history measurements used by repo and skill tools
status: todo
template: feature-impl
created_at: 2026-10-12T03:34:10.720Z
updated_at: "2026-10-12T04:01:54.962Z"
feature_id: A91
priority: P1
tags:
  - script-consolidation
estimate_hours: 10

dependencies: ["1177"]
---

## 1178. Unify workflow and history measurements used by repo and skill tools

### Background

Implements: R6 — Workflow and history analytics share canonical measurement services.

Plan and detailed dispositions: docs/plans/2026-10-11-harness-script-consolidation.md. Scope is this vertical slice only; unrelated current edits are foreign.

**Refine corrections (2026-10-11)**

- Query extraction was described only as an app move → domain is sole SQL/DAO owner; app composes queries and measurements.
- Existing workflow-promotion and budget policy looked like reusable harness behavior → keep repository candidate/cohort policy local and centralize only reusable measurements.
- Whole transcript helper could move into app → host path/env/format normalization remains a plugin adapter; only normalized measurement/actor/window aggregation moves.
- History absence could silently look like zero → missing DB/tables is unavailable, genuinely empty measured data is zero; preserve estimate labels.
- Analytics might require a public reporting extension → current app services and documented generated packaging suffice; public transport is separately deferred.

### Requirements

- [ ] R1. Move reusable workflow run/state query and cost aggregation out of repository commands into domain query ownership plus app workflow measurement; preserve repo cohort, budget and promotion policy locally.
- [ ] R2. Move pure actor/window/run-summary aggregation into app workflow ownership while retaining host transcript resolution/normalization and summary file presentation in plugin adapters.
- [ ] R3. Replace daily-summary SQLite access with a high-level app history-health reader using existing domain history rollups; retain skill report composition and explicitly distinguish unavailable measurements from measured zero.
- [ ] R4. Preserve installed source/Node/Bun contracts, deterministic reports and provenance without new public reporting flags, migrations or paid/live-agent calls.

Out of scope: No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Acceptance Criteria

- [ ] AC1 — Workflow and history analytics share canonical measurement services (req: R1)

Given the frozen supported source and installed contracts, when this slice runs against deterministic fixtures, then new app tests/workflow/run-measurements.test.ts and run-summary.test.ts observe real query/aggregation behavior with in-memory SQLite and normalized transcript fixtures; keep scripts/commands/real-run-cost.test.ts, pipeline-budgets.test.ts and workflow-promotion.test.ts as adapter/cohort-policy parity tests. Plugin tests/run-summary.test.ts, session-timeline.test.ts and daily-summary/daily-summary.test.ts observe rendering, absence/zero distinctions and close callback behavior. Extend app history-service/history-board-service tests to observe real rollup health reads, including missing tables, empty tables and date filters. Bundle tests and isolated plugin-smoke prove source/installed/runtime parity without paid models or real history DB access.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-12T04:01:28.074Z

- Closed: no new public CLI API; canonical application services and current script contracts are sufficient for this batch.
- Closed: generated application operations remain an explicit standalone packaging exception with a single source owner, compatibility tests and no plugin DAO facade.
- Deferred owner: operator, separately approved owning-noun transport can retire the exception later. It is outside this implementation scope; --auto does not approve it.

### Design

WHAT/WHY: one measurement implementation with explicit provenance, no second SQL reader in scripts/plugin lib. No new public CLI API. Primary targets: existing domain run/action/session/transition DAOs and history-board analytics; proposed app `packages/app/src/workflow/run-measurements.ts` and `packages/app/src/workflow/run-summary.ts`; existing app history services; real-run-cost/pipeline-budgets/workflow-promotion scripts and plugin summary/timeline/daily adapters.

Move reusable readWorkflowRuns/readWorkflowMetrics/readStateMetrics and their existing WorkflowMetrics/StateMetrics result contracts to the application measurement owner. Put SQL access in existing domain DAO/query modules (a focused domain analytics workflow-measurements.ts is allowed if no existing DAO owns the joins); do not transplant bun:sqlite into app as a shortcut. App composes explicit database/project inputs instead of fixed REPO_ROOT. Repository scripts retain workflowsDir cohort selection, candidate promotion decisions, baselines, stable JSON formatting and CLI dispatch. Preserve current exported wrappers needed by local callers until callers/tests migrate coherently; no production code imports scripts/commands. Reuse existing step-profile projections/statistics when semantics match; do not replace a percentile/median with a differently defined estimator. Move workflow-promotion readAgentRunHistory and countRealTerminalRuns query bodies to the same domain/app measurement boundary. Keep their distinct existing dryRun/cohort predicates: the former excludes numeric dryRun=1 and requires valid timestamps, while the retirement count accepts only its documented absent/false/zero forms and has no timestamp gate. Do not silently align those predicates. Existing Database-accepting repository wrappers may remain temporarily for caller/test compatibility but must delegate query access rather than contain SQL. Both read-only workflow-promotion queries and real-run-cost queries must leave the repo adapter. Keep pipeline-budgets' repository threshold decisions local.

Move actorSplit and buildRunSummary plus their pure interval/token aggregation into app workflow/run-summary, preserving current structural Progress/SummaryRow/ActorSplit/RunSummary shapes and existing workflow progress projection. Normalized transcript types belong with app measurement, imported type-only by plugin; application code must not import plugins/sp. Plugin transcript.ts retains resolveTranscript, host format detection/parsing and environment/path handling; normalize once before passing rows/timestamps. Plugin run-summary-core retains close summary host callback, receipt file read, Markdown rendering and durable/scratch report writing only; use existing generated pure plan-projection entry for pure summary exports rather than adding a new bundle framework. Avoid forcing Bun into Node-pure timeline/rollup paths. Close callback remains injected into app inline runner, preserving dependency direction and nonfatal summary failure.

Add internal `readHistoryHealth` to the existing app history service, with explicit date/db inputs and result matching daily report needs. Reuse domain loop findings/tool rollup queries and current app history owners; no raw SQL or SQLite import in daily-summary. Its getSpurHistoryHealth adapter calls the high-level operation through the existing Bun-capable inline generated entry; retain Node-to-Bun conversion where required. Missing DB or required schema returns null/unavailable and renders existing n/a path; an existing empty table produces measured zero. Keep the repeats*250 estimate explicitly estimated and suggested remediation as text only. No history import/mutation or real-data telemetry during tests.

Preserve mapped/unmapped coverage, terminal/nonterminal/dry cohort filtering, null costs, stable key order and first-to-last transition active lower bound. Actor spans are clipped/unioned and priority-subtracted so categories exactly partition each run window; overlap and rollup wall span are not sums of elapsed windows. Missing transcript/gate receipt remains n/a with a reason; receipt.runId must match. Retain total versus noncached token semantics. No new parser, general analytics abstraction or extra registry.

Dependencies and handoff: Requires 1177 canonical runtime loader/export boundaries (1173/1176 transitive); set dependency to 1177 only. Consume the preserved pure and Bun-capable generated entries without new bundle/CLI contracts. Final A91 slice leaves all measurement ownership in domain/app and only repo/host presentation policy in adapters.

Environment: use current Bun/TypeScript workspaces and Superskill conversion; no dependency or migration change. No wip tasks or extra worktrees existed at batch kickoff. Recheck file conflicts and generated freshness before implementation.

No new public CLI API: do not add/change a spur noun, verb, flag, hidden command, output/error contract or implicit automation. Use current services and the explicitly documented standalone packaging exception. Do not edit generated adapters by hand. Preserve supported installed argv and exit behavior, redaction, validation, run identities and durable evidence. No new dependency, generic runner, lock manager or unrelated refactor. Only planning sections are changed by this refinement; implementation owns Solution/Testing/Review.

### Plan

- [ ] 1. R1: inventory real-run-cost, pipeline-budgets and workflow-promotion queries/callers; freeze deterministic outputs and cohort/statistics semantics with in-memory SQLite fixtures.
- [ ] 2. R1: move queries to domain and reusable aggregation to app run-measurements; update all repository imports while leaving candidate/budget/config policy local.
- [ ] 3. R2: move pure run-summary aggregation/types to app; normalize host rows in plugin, update run-summary/timeline/close callers and use existing pure generated export entry.
- [ ] 4. R3: add readHistoryHealth using current app/domain history queries; replace daily-summary direct SQLite with high-level call and explicit unavailable/empty handling.
- [ ] 5. R4: regenerate affected bundles/twins; test unknowns, overlap partitions, skew, installed summary/daily behavior, deterministic reports, placement/standalone and task-local gate. Update ownership docs and shrink baseline only after current scans prove removal.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

Feature A91; ADR-130 (2026-10-11 amendment), ADR-129, ADR-065, ADR-021. Investigation: `docs/plans/2026-10-11-harness-script-consolidation.md`.

Premise sources:
- `scripts/commands/real-run-cost.ts:133`
- `scripts/commands/real-run-cost.ts:354`
- `scripts/commands/pipeline-budgets.ts:35`
- `scripts/commands/workflow-promotion.ts:1`
- `plugins/sp/lib/run-summary-core.ts:167`
- `plugins/sp/lib/run-summary-core.ts:288`
- `plugins/sp/lib/run-summary-core.ts:502`
- `plugins/sp/lib/transcript.ts:248`
- `plugins/sp/scripts/daily-summary/daily-summary.ts:290`
- `packages/app/src/workflow/step-profile.ts:244`
- `packages/app/src/services/history-service.ts:1`
- `packages/app/src/services/history-board-service.ts:1`

### History
