---
schema_version: 1
name: Expose classified capability usage through existing Histories breakdowns
status: done
template: feature-impl
created_at: 2026-09-30T20:26:19.398Z
updated_at: "2026-10-03T22:17:46.510Z"
feature_id: E93
priority: P1
tags:
  - history
  - capabilities
estimate_hours: 8

dependencies: ["1028"]
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-dev-runall-e93-4ff4/.spur/memory/evidence/1029-verdict.json
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

- [x] R1. Adopt the verified released upstream importer contract through Spur's migration ledger and expose independent kind, invoker and evidence dimensions.
- [x] R2. Make materialized counts and any existing supported bounded fallback use the same correlated invocation population, with requests separate from confirmed loads/delegation and unknown origins visible.
- [x] R3. Preserve token accounting and existing query bounds while updating the existing Histories DTOs, consumers and presentation with integration checks.

### Acceptance Criteria

- [x] AC1 — Histories breakdowns preserve capability semantics across read paths (req: R1; R2; R3)

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

Upstream adoption (R1): importer 0.5.12 (released on npm 2026-10-03, verified `npm view` latest
+ installed dist export receipts) adopted via root `package.json` catalog pin `^0.5.12` (E93
batch-wide), `bun install` updated the lockfile; `importer-schema-check` needed no change (it
delegates to `checkImporterSchemaVersion` reading the installed `HISTORY_IMPORT_SCHEMA_VERSION`).

- `packages/domain/src/migrations.ts` — migration `0050_spur_cli_history_board_skill_5m_capability_grain` (constant `packages/domain/src/migrations.ts:880`, ledger entry `packages/domain/src/migrations.ts:1590`, skip guard `packages/domain/src/migrations.ts:1831`)
  (constant `HISTORY_BOARD_SKILL_5M_CAPABILITY_GRAIN_SCHEMA_SQL`, CLI_MIGRATIONS entry, table-absence
  skip guard like 0035): shadow-table rebuild of `history_board_skill_5m` extending the PK to the
  classification grain `(bucket_start, source, skill_name, invocation_kind, capability_kind,
  evidence_kind, status)`; legacy rows copy with `''` sentinels; read index recreated. The base
  template `HISTORY_BOARD_ROLLUPS_SCHEMA_SQL` was extended to the same grain so fresh imports agree
  (0032 kept byte-identical — never edit old migrations).
- `packages/app/src/services/history-service.ts` — `HistoryServiceContext.capabilityOrigins?` (`packages/app/src/services/history-service.ts:354`, forwarded at `packages/app/src/services/history-service.ts:597`)
  (readonly `CapabilityOrigin[]` from the installed importer) forwarded into `runJsonlImport`.
- `apps/cli/src/commands/history.ts` — repeatable `--capability-origin (`parseCapabilityOriginSpec` at `apps/cli/src/commands/history.ts:84`)
  source:skillName:artifactDigest:capabilityKind:originIdentity` (structural split: source = first
  segment, digest/kind/identity = last three, colon-bearing middle = skill name — canonical
  harness names like `sp:demo` contain colons). The skill name is canonicalized through the
  importer's `canonicalizeSkillName` (`sp-demo`/`$sp-demo`/`/skill:sp-demo` -> `sp:demo`) because
  `matchCapabilityOrigin` compares the origin's skillName to the observed canonical name verbatim
  (external evidence: installed `@gobing-ai/ts-llm-jsonl-importer` 0.5.12, `capability.ts`
  `matchCapabilityOrigin` — file outside this repo) — a non-canonical value would silently never
  classify (found by the task's live-replay verification; 64-hex digest, kind ∈
  command|subagent|skill; usage errors as envelopes), parsed before service construction.

Materialization (R2):

- `packages/domain/src/analytics/history-board-rollup.ts` — `HistoryBoardSkill5mRow` + class fields
  ('' = unclassified sentinel); `SKILL_ROLLUP_REP_SQL` selects one representative per
  source×session×invocation_key×invocation_kind×capability_kind×evidence_kind
  (`invocation_key = COALESCE(NULLIF(invocation_id,''),'h:'||record_hash)`, earliest started_at →
  record_hash) with window-SUM class status precedence ok > error > unknown (`packages/domain/src/analytics/history-board-rollup.ts:311`); 8-column inserts (`packages/domain/src/analytics/history-board-rollup.ts:354`);
  class-level `skill5mBucketOps`; `lateSkillResultBuckets` pre-pass in
  `refreshHistoryBoardRollupsIncremental` repairs outcome-update buckets joined via re-imported
  sessions (500-bucket cap → bounded full skill_5m rematerialization; advances no watermark) (`packages/domain/src/analytics/history-board-rollup.ts:2170`, wired at `packages/domain/src/analytics/history-board-rollup.ts:2233`).
- `packages/domain/src/analytics/rollup-watermark.ts` — `ROLLUP_DEFINITION_VERSION` v6 → `'v7'` (`packages/domain/src/analytics/rollup-watermark.ts:31`)
  (forces one full rebuild; digest pinned in the 0741 R6 test).
- `packages/domain/src/analytics/history-board-marts.ts` — source-grain skills CTE narrowed to (skills CTE at `packages/domain/src/analytics/history-board-marts.ts:204`, predicate at `packages/domain/src/analytics/history-board-marts.ts:209`)
  confirmed loads (`evidence_kind = 'load' AND status = 'ok'`).
- Read path: `historyBoardSkillBreakdownFromRollup` (`packages/domain/src/analytics/history-board-rollup.ts:1229`) legacy arrays (bySkill/bySource/
  byInvocationKind/trend) = confirmed loads only; new `byCapability` keeps the selector scope and
  surfaces requests, delegation, failed, and unclassified (''→null via NULLIF) rows; LIMIT 10,
  same filters, empty/'unknown' names excluded.

DTO + presentation (R3):

- `packages/contracts/src/history.ts` — `historySkillBreakdownSchema.byCapability` (`packages/contracts/src/history.ts:151`; tolerant
  strings, `.default([])` for legacy payloads); `historyCapabilityUsageSchema`.
- `packages/app/src/services/history-board-service.ts` — byCapability threaded through both read (`packages/app/src/services/history-board-service.ts:331`, `packages/app/src/services/history-board-service.ts:697`)
  paths (rollup + stale/exact) and the empty-db default; `packages/app/src/testing/
  history-board-mock.ts` shape updated.
- `apps/web/src/modules/history/SummaryTab.tsx` — "By Capability" block (`apps/web/src/modules/history/SummaryTab.tsx:1117`, guarded read at `apps/web/src/modules/history/SummaryTab.tsx:396`) in the existing Skill Load
  Breakdown region (kind/evidence chips, warning tone for non-ok status, rep-count number),
  graceful absence via `?? []`; no new navigation/filters/charts.
- `docs/help/cmd_history.md` — `--capability-origin` flag row (0800 R3 parity test).

Token accounting, existing query bounds, and the materialized-only policy are untouched.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Re-verified this run (force re-audit). Installed importer `node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json` version 0.5.12 = catalog pin `package.json:36` `^0.5.12`; ledger migration `0050_spur_cli_history_board_skill_5m_capability_grain` at `packages/domain/src/migrations.ts:1590` with skip guard `:1831`; independent dimensions wired: `HistoryServiceContext.capabilityOrigins?` `packages/app/src/services/history-service.ts:354` forwarded `:597`; CLI `parseCapabilityOriginSpec` `apps/cli/src/commands/history.ts:84`. migrations tests green this run (131 pass / 0 fail domain suite incl. migrations.test.ts). |
| R2 | MET | Same correlated invocation population: `SKILL_ROLLUP_REP_SQL` `packages/domain/src/analytics/history-board-rollup.ts:311` with `invocation_key = COALESCE(NULLIF(invocation_id,''),'h:' |
| R3 | MET | Token accounting untouched; DTO `byCapability` with `.default([])` `packages/contracts/src/history.ts:151`; threaded on both read paths `packages/app/src/services/history-board-service.ts:331` and `:697`; presentation "By Capability" block in the existing Skill Load Breakdown region `apps/web/src/modules/history/SummaryTab.tsx:1117`. Integration checks green this run: app history-board-service + history-response-shape 31/0, cli history-capability-origin 5/0, web history components 27/0. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Explicit user commands retain command identity | MET | test | Producer-side contract re-certified at 1028 this batch (upstream suite 398 pass / 0 fail); installed 0.5.12 receipt above. Not exercised by the 1029 diff (no extraction code in spur). |
| R2 — Model delegation identifies subagents separately from user requests | MET | test | 1028 evidence base stands (re-certified this batch); delegation remains an independent evidence class in the 1029 grain (rollup PK + oracle fixture, domain suite green this run). |
| R3 — Ordinary skill loads include explicit and implicit use | MET | test | 1028 evidence base stands; load/ok vs load/error vs load/unknown materialize as separate classes (status in rollup PK; `packages/domain/src/analytics/history-board-rollup.ts:311` re-read this run). |
| R4 — Converted capabilities preserve verifiable origin kinds | MET | test | Origin forwarding path green: cli history-capability-origin tests 5/0 this run; `history-service.ts:597` forwarding + `apps/cli/src/commands/history.ts:84` parser re-read; unresolved origins surface as null-kind rows via reader NULLIF. |
| R5 — Duplicate representations collapse without losing repeated invocations | MET | test | Representative-selection oracle (8.3) green in this run's domain suite; invocation-key fallback re-read at `packages/domain/src/analytics/history-board-rollup.ts:314`. |
| R6 — Quoted examples and unrelated tool reads produce no invocation | MET | test | 1028 exclusion evidence stands (re-certified this batch); 1029 adds no extraction logic (importer consumed as node_modules dependency). |
| R7 — Source coverage distinguishes verified extraction from unavailable evidence | MET | test | 1028 coverage evidence stands; honest-unknown preserved consumer-side ('' sentinel → null via NULLIF in `historyBoardSkillBreakdownFromRollup`, `packages/domain/src/analytics/history-board-rollup.ts:1229`). |
| R8 — Histories breakdowns preserve capability semantics across read paths | MET | test | Kind + invoker independently identifiable in byCapability (`packages/contracts/src/history.ts:151` re-read); requests not counted as loads (`packages/domain/src/analytics/history-board-marts.ts:209`); both read paths thread byCapability (`history-board-service.ts:331`/`:697`); fresh materialized = SQL reference parity (8.3 oracle green this run); token totals unchanged (no token lines in the 1029 diff surface). Focused run this batch: 194 pass / 0 fail across domain/app/cli/web history homes. |
| R9 — Historical reprocessing upgrades safely and remains repeatable | N/A | n/a | 1030 scope. Groundwork re-verified here: additive ledger migration 0050 (`migrations.ts:1590`), v7 invalidates old-definition rollups (`rollup-watermark.ts:31`), legacy '' sentinels (migrations tests green this run). |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-03T20:26:17.582Z todo → testing (system)
- 2026-10-03T20:28:10.686Z testing → done (system)

