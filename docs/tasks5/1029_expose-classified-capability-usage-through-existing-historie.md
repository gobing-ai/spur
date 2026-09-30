---
schema_version: 1
name: Expose classified capability usage through existing Histories breakdowns
status: todo
template: feature-impl
created_at: 2026-09-30T20:26:19.398Z
updated_at: "2026-09-30T20:52:15.187Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 8

dependencies: ["1028"]
---

## 1029. Expose classified capability usage through existing Histories breakdowns

### Background

E93 R8 makes the corrected extraction usable through the existing Histories module. The upstream task must provide a tested contract and the actual package release/version before dependency adoption. Current skill-load counts read history_skill_call while skill token attribution reads history_tool_call; the distinction is intentional. This task is one end-to-end Histories behavior, including migration, query, DTO and existing presentation changes, rather than separate layer tasks. Concurrent E91 materialization work must be accommodated without restoring a forbidden raw scan.

**Refine corrections (2026-09-30)**
- Original consumer prose said existing load counts already mean successful loads → skillCallRollup uses COUNT(*) with no result-status predicate → freeze the intentional corrected confirmed-load measure and legacy unknown behavior in design 8.3.
- Original fresh/raw parity wording left an extra runtime query path possible → normal and stale services already call historyBoardSkillBreakdownFromRollup → use direct SQL reference parity in tests, without inventing a raw capability fallback.
- Original rollup duplicate handling and late result updates were unspecified → per-minute aggregation can double-count cross-bucket representations or update only the result bucket → select representatives before bucketing and recompute the original event bucket.
- Original DTO/UI changes were open-ended → current HistorySkillBreakdown and SummaryTab are the existing seams → freeze additive byCapability dimensions and reuse the Skill Load Breakdown region; no new navigation, endpoints or global filters.
- Original dependency handoff did not pin the API or version gate → task 1028 now defines CapabilityOrigin/schema/output semantics, while the current package is 0.5.11 → require the actual verified released version before dependency adoption; do not invent a version.

### Requirements

- [ ] R1. Adopt the verified released upstream importer contract through Spur's migration ledger and expose independent kind, invoker and evidence dimensions.
- [ ] R2. Make materialized counts and any existing supported bounded fallback use the same correlated invocation population, with requests separate from confirmed loads/delegation and unknown origins visible.
- [ ] R3. Preserve token accounting and existing query bounds while updating the existing Histories DTOs, consumers and presentation with integration checks.

### Acceptance Criteria

- [ ] AC1 — Histories breakdowns preserve capability semantics across read paths (req: R1; R2; R3)

Verification lens: Use the real migration/domain/service/DTO/UI test homes named in Design. The composite fixture yields byCapability total 8 and confirmed legacy load total 3, matches the direct SQL reference before/after filters and bucket partitioning, handles late-result invalidation, and preserves token totals.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-30T20:27:31.036Z

Closed decisions: adopt a verified released importer version after task 1028, use Spur's existing migration ledger and materialized query ownership, retain null legacy identity/outcome until replay, and keep token attribution unchanged. Task 1028 completion plus package-version availability is an execution prerequisite. Do not add an unbounded fallback or reimplement source extraction in Spur.

#### Q&A entry — 2026-09-30T20:47:30.936Z

Ready-depth closure: source facts remain owned by 1028; internal origin input, fact adoption, minute-grain rollup, representative algorithm, byCapability response and existing UI region are fixed in design 8.3. No new runtime raw capability fallback exists or is required. Token measures are unchanged. Missing published package is a dependency gate, not permission for a local parser or node_modules patch. No unresolved DTO/query/UI scope choice remains.

### Design

Implement E93 R8 end to end after 1028 supplies its frozen producer contract and a verified released package. Frozen WHAT/WHY: consume the importer-produced evidence in the existing Histories breakdown because producer identity and consumer aggregation already have owners (ADR-103/104/105). No source extraction in Spur and no new public Spur API.

Names and ownership are fixed in docs/design/history-capability-detection.md section 8.3:
- Internal HistoryServiceContext.capabilityOrigins forwards the readonly CapabilityOrigin index to runJsonlImport; absent index remains unresolved. No automatic historical manifest inference.
- Extend history_board_skill_5m with capability_kind/evidence_kind/status at its existing minute grain; retain source/name/invoker/calls. Allocate the next unused active migration prefix during execution and adopt producer schema through the ledger, never edit old migrations.
- Update HistoryBoardSkill5mRow/HistoryBoardSkillBreakdown and skillCallRollup, replaceHistoryBoardRollups, refreshHistoryBoardRollupsIncremental, historyBoardSkillBreakdownFromRollup and all affected seed/write/read callers.
- Extend historySkillBreakdownSchema with byCapability: [{skillName, capabilityKind: command|subagent|skill|null, invocationKind: user|model, evidenceKind: request|load|delegation|null, status: ok|error|unknown, calls}]. Default only the new array to [] at legacy payload/mock boundaries, preserve fresh.
- Legacy bySkill/bySource/byInvocationKind/trend use confirmed evidence_kind=load AND status=ok, regardless of converted logical kind. Null legacy evidence appears unknown in byCapability. Requests, delegation, failed and unconfirmed events are visible separately.

Algorithm: select one representative per source/session/invocation/invoker/evidence class before bucket/window grouping. Null invocation_id falls back to record_hash. Choose earliest valid native/parent event time, then record_hash; status precedence ok > error > unknown within a class. Distinct attempts have distinct invocation ids. A late result invalidates the original event's bucket. Preserve existing materialized-only policy and any already-supported bounded fallback for other measures; compare this breakdown to a SQL reference in tests, never add an unbounded runtime path. Bump the current rollup definition version v6 to the next valid revision at execution, and rebuild changed grain/cache/mart inputs through existing refresh behavior.

WHERE: root dependency/catalog/lockfile adoption; next active migration; packages/domain/src/analytics/history-board-rollup.ts, rollup-watermark.ts, history-board-marts.ts and affected schema declarations; packages/app/src/services/history-service.ts, history-analysis-service.ts, history-board-service.ts; packages/contracts/src/history.ts; existing apps/web/src/modules/history/SummaryTab.tsx. Trace readers including normal/stale service branches and test/mock responses. Apps/server remains thin and needs changes only if existing contract plumbing requires it.

UI: read root DESIGN.md; show capability kind, invoker, evidence and outcome in the existing Skill Load Breakdown region using existing native markup/components. Preserve accessibility and fresh=false behavior. No new navigation, endpoint, chart dependency, global filter family or request-only token series. Keep token sums and tool-call allocation exactly unchanged.

Executable oracle: section 8.3's fixture has 2 requests, 3 successful loads, 1 dispatch, 1 failed load and 1 unconfirmed load; correlated duplicate load evidence must not inflate totals. byCapability sums to 8 and legacy confirmed loads sum to 3. Window/source/name filtering, partitioned minute buckets and late-result refresh equal a direct SQL reference. Existing history token-total/attribution fixtures remain numerically equal.

Observation homes: packages/domain/tests/analytics/history-board-rollup.test.ts and history-board-marts.test.ts; packages/domain/tests/dao/migrations.test.ts; packages/app/tests/services/history-board-service.test.ts and history-response-shape.test.ts; apps/web/tests/modules/history/components.test.tsx. Test real domain queries/service/DTO paths, with an in-memory migrated DB; don't mock away the aggregation being proved.

Dependencies: 1028 owns extraction/schema/types, not this task. Step 0 verifies upstream revision/schema/released-package availability and installed-versus-lockfile agreement; absence means execution waits, not a local dependency patch. Leave 1030 the compatible migration/refresh/read contract, exact count oracle and verified provenance. Spur main has staged unrelated docs/SummaryTab work and A9/I33 worktrees; preserve their edits and use a clean owned execution tree. Budget 8h; preserve current proof and remaining failures at the boundary. Non-goals: classifier duplication, live replay, another runtime query service or token-accounting changes.

### Plan

1. (R1) Verify 1028's revision, source support, exported API/schema and actual package release; check dependency/installed provenance and current materialization/SummaryTab concurrent changes. Stop before adoption if release availability is missing.
2. (R1) Adopt the released importer using catalog/lockfile conventions. Add only the next active migration/schema changes and forward internal HistoryServiceContext.capabilityOrigins without a new CLI flag.
3. (R2) Implement representative selection before bucketing; update all full/incremental rollup writes, current minute-grain keys, freshness/version logic and late-result original-bucket invalidation.
4. (R1, R2) Extend the existing domain/service/DTO/mock shapes with byCapability and confirmed-load legacy arrays, retaining null identity/outcome and materialized read policy.
5. (R3) Update the existing SummaryTab breakdown region after reading DESIGN.md, reusing current UI components and accessibility behavior without adding navigation or filter families.
6. (R1–R3) Run the named migration/query/service/contract/UI checks with the 8/3 oracle, filtered/partitioned parity, late results, stale signaling and unchanged token fixtures. Run each workspace's focused tests, then applicable task-local gates.
7. (R1–R3) Update owning history satellites to implemented behavior and record the released version/migration/rollup definition/SQL oracle for 1030. Keep execution evidence in the task; do not claim live replay completion.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
