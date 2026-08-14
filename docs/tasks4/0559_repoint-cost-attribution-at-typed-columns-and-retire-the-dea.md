---
template: feature-impl
schema_version: 1
name: "Repoint cost attribution at typed columns and retire the dead ETL path"
description: ""
status: done
type: task
profile: standard
feature_id: E6
parent_wbs: null
priority: P2
tags: []
dependencies: ["0557", "0558"]
ac_numbering: task-local
created_at: "2026-08-14T02:43:13.363Z"
updated_at: "2026-08-14T17:16:35.987Z"
---

## 0559. Repoint cost attribution at typed columns and retire the dead ETL path

### Background
Two defects, one root cause: the cost path reads tables that no longer receive rows.

Measured 2026-08-13 against the live `.spur/spur.db` — **all ten `history_etl_*` tables hold 0 rows**,
while `history_message` holds 1,296,633. `loadAllEtlPayloads`
(`packages/domain/src/analytics/run-cost.ts:107`) iterates `SOURCE_TABLES`
(`packages/domain/src/analytics/query.ts:8-16`) over exactly those empty tables, so
`spur workflow trace` run-cost attribution is blind to every source including the default agent.

Feature E2 identified this on 2026-08-09, ruled it out of scope as "real, unowned, and E1's
cost-attribution surface", and it has been unowned since. It now blocks feature J6.

Separately, `provenance` does not mean what its name says: `detectProvenance(cwd)`
(`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:61-64`) returns `spur-run` when the
cwd string contains `/spur`, so 52,692 rows are labelled spur-launched on a path substring — including
ambient sessions that merely ran inside a spur directory.
### Requirements
- [ ] **R1.** Attribute run cost from `history_message`'s typed token columns — `input_tokens`,
      `output_tokens`, `cache_read_tokens`, `cache_write_tokens` — joined through the
      `history_run_session` mapping, replacing the `history_etl_*` payload path. Measurable: cost
      attribution for a workflow action with correlated history returns non-zero token figures where
      the old path returned nothing.
- [ ] **R2.** Weight the result by mapping `exactness`: figures from an `exact` mapping are reported
      exact, from an `estimated` mapping as estimated, and the two are never summed into one number.
      Measurable: a mixed fixture reports both separately.
- [ ] **R3.** No dollar figure is computed or emitted. `history_message.cost_usd` exists as a column
      and stays unread; `MODEL_PRICING` / `UNKNOWN_MODEL_PRICING` gain no new consumer. Measurable:
      no currency value in output, asserted by test, and no new call site for the pricing helpers.
- [ ] **R4.** Confirm every `history_etl_*` table is empty and unwritten, then delete the dead path —
      `loadAllEtlPayloads`, `SOURCE_TABLES`, `payloadToCostRecord`, and the `extractClaudeTokens`
      call sites that only served it — along with their exports. Leaving them dormant invites the next
      reader to build on them again. Measurable: the symbols are gone, no caller references them, and
      the suite is green.
- [ ] **R5.** Correct `detectProvenance` so `provenance` distinguishes a session spur launched from
      one it did not, using the correlation from task 0557 rather than a cwd substring. A session that
      merely ran inside a spur directory is not reported as spur-launched. Measurable: an ambient
      session under a `/spur` path imports as `ambient`.
### Acceptance Criteria
Covers feature E6 scenarios:

- **R5 — Cost attribution reads the columns that hold data**
- **R6 — The dead ETL path is removed, not left dormant**
- **R7 — provenance means launch provenance**

```gherkin
Scenario: R5 — Cost attribution reads the columns that hold data
  Given token data lives in history_message typed columns and every history_etl_ table is empty
  When run cost is attributed for a workflow action
  Then the figures derive from the typed columns
  And no dollar value is computed or emitted

Scenario: R6 — The dead ETL path is removed, not left dormant
  Given every history_etl_ table is confirmed empty and unwritten
  When the cost path no longer reads them
  Then the ETL payload loader and its source-table allowlist are deleted
  And no caller references them

Scenario: R7 — provenance means launch provenance
  Given provenance is currently derived from a cwd substring match
  When a session is imported
  Then a session spur launched is distinguishable from one it did not
  And a session merely run inside a spur directory is not reported as spur-launched
```
### Q&A
**Closed during refine (2026-08-13).**

- **Delete the ETL path or leave it dormant?** Delete (R4). A dormant loader is how the next reader
  builds on eight empty tables — which is exactly what task 0547's first spec did.
- **Can `cost_usd` be used since the column exists?** No (R3). Tokens, never prices; the column is a
  tempting shortcut to an untrustworthy number.
- **How does `provenance` become meaningful?** Derived from task 0557's mapping — a session present
  in `history_run_session` was spur-launched. The cwd substring is deleted, not tuned.
- **Is the trace path the only consumer?** `loadAllEtlPayloads` is exported from the analytics barrel
  and covered by `run-cost.test.ts`; confirm the full caller set before deleting (R4).

**Deferred with owner.**

- **Why `claude` and `codex` capture no token rows** — owner: feature E1/E5. This task cannot
  attribute data that was never imported; it bounds coverage rather than fixing the mapper.
- **Backfilling `history_message.run_id` from the mapping table** — owner: operator. The mapping is
  sufficient for the join; denormalising into the column is an optimisation, not a requirement.

**Added during refine (2026-08-13).**

- **Is `coordination_runs` an alternative cost-correlation source?** No — 0 rows. It is G4's
  supervised-coordination table and nothing populates it. Attribution flows through
  `history_run_session` (task 0557), not through it.
### Design
**Verify empty before deleting (R4).** The measurement is from one machine's database. Confirm the
tables are not merely empty here but genuinely unwritten — no importer path populates them — before
removing the loader. An empty table on one box and a dead code path are different claims.

**Delete, do not deprecate (R4).** A dormant `loadAllEtlPayloads` is an invitation: the next reader
finds a plausible cost API and builds on eight empty tables, exactly as this task's own spec did
before measurement. The project's standing rule is remove obsolete code rather than accumulate
compatibility layers.

**Exactness must survive to the output (R2).** A total assembled from estimated correlations is worth
less than one from observed mappings, and the operator can only weigh it if the two are reported
apart. This mirrors `actionCost` versus `actionCostEstimated`, which already exist.

**Tokens, never prices (R3).** `cost_usd` is a real column on `history_message` and is the tempting
shortcut. It stays unread. Per-model pricing is too volatile to hold correctly, and
`UNKNOWN_MODEL_PRICING`'s unmeasured $3/$15 fallback is precisely why any stored figure is already
untrustworthy.

**`provenance` becomes derived, not guessed (R5).** With task 0557's mapping, spur-launched is a
fact: a session appearing in `history_run_session` was launched by spur. The cwd substring heuristic
is then deletable rather than tunable.

#### Frozen names

| Frozen | Value | Location |
| --- | --- | --- |
| To delete | `loadAllEtlPayloads` · `SOURCE_TABLES` · `payloadToCostRecord` | `packages/domain/src/analytics/run-cost.ts:107`, `query.ts:8-16` |
| Exports to remove | `loadAllEtlPayloads` (and any now-unused siblings) | `packages/domain/src/analytics/index.ts:52-56` |
| To keep | `actionCost` · `actionCostEstimated` · `foldTotals` · `TokenTotals` | same module |
| Never read | `history_message.cost_usd` · `MODEL_PRICING` · `UNKNOWN_MODEL_PRICING` · `getModelPricing` | `models.ts:4`, `:31`, `:35` |
| New source columns | `history_message.input_tokens` / `output_tokens` / `cache_read_tokens` / `cache_write_tokens` | `~/xprojects/ts-libs/…/schema-sql.ts:43-46` |
| Mapping consumed | `history_run_session` | task 0557 |
| Provenance function | `detectProvenance(cwd)` → replaced by a correlation-derived value | `~/xprojects/ts-libs/…/mappers.ts:61-64` |

#### Anti-patterns — what not to implement

- Do **not** keep `loadAllEtlPayloads` "just in case" (R4).
- Do **not** read `cost_usd` or introduce any currency value (R3).
- Do **not** sum exact and estimated attributions (R2).
- Do **not** tune the cwd substring in `detectProvenance` — replace the signal (R5).
- Do **not** repair the `history_etl_*` writers. The typed tables superseded them; reviving the ETL
  path would recreate two sources of truth.

#### Cross-task contract

**Assumes from 0557:** the `history_run_session` mapping with `exactness`, which both R1's join and
R5's provenance derivation require. **Assumes from 0558:** estimated mappings exist and are labelled,
so R2 has both classes to report.

**Leaves for dependents:** feature J6 task **0547** consumes the repaired attribution — its frozen
names still cite `extractClaudeTokens` and `foldTotals`, and its § *PREMISE CORRECTION* records that
the ETL path is dead. When this task lands, 0547's source becomes the typed columns through this
mapping.

#### PREMISE VERIFICATION (2026-08-13)

Re-measured against the live `.spur/spur.db`:

| Measured | Value |
| --- | --- |
| All 10 `history_etl_*` tables | **0 rows** — confirmed dead |
| `history_message` | 1,296,633 rows; 166,162 carry token data |
| `history_message.run_id` | **0** rows populated (filled by tasks 0557/0558) |
| `agent.invoke.*` events | 202 rows, `run_id` NULL until task 0557 |
| `coordination_runs` | 0 rows |

R4's "confirm unwritten, not merely empty" still stands: emptiness on this machine is evidence, not
proof. Check that no importer path writes the `history_etl_*` tables before deleting the loader.
### Plan
- [ ] Confirm every `history_etl_*` table is unwritten, not merely empty on one machine (R4)
- [ ] Attribute cost from `history_message` typed token columns via the `history_run_session` mapping (R1)
- [ ] Report exact and estimated attributions separately, never summed (R2)
- [ ] Assert no currency value is emitted and no new pricing call site exists (R3)
- [ ] Delete `loadAllEtlPayloads`, `SOURCE_TABLES`, `payloadToCostRecord` and their exports (R4)
- [ ] Replace `detectProvenance`'s cwd substring with a correlation-derived launch signal (R5)
- [ ] Add tests: typed-column attribution, exact/estimated split, ambient-under-spur-path provenance (R1-R3, R5)
- [ ] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:1002` |
| `apps/cli/src/commands/workflow.ts:1004` |
| `apps/cli/src/commands/workflow.ts:1015` |
| `apps/cli/src/commands/workflow.ts:1019` |
| `apps/cli/src/commands/workflow.ts:28` |
| `apps/cli/src/commands/workflow.ts:823` |
| `apps/cli/tests/commands/workflow.test.ts:10` |
| `apps/cli/tests/commands/workflow.test.ts:1696` |
| `apps/cli/tests/commands/workflow.test.ts:1714` |
| `apps/cli/tests/commands/workflow.test.ts:1719` |
| `apps/cli/tests/commands/workflow.test.ts:1758` |
| `apps/cli/tests/commands/workflow.test.ts:1774` |
| `apps/cli/tests/commands/workflow.test.ts:1785` |
| `apps/cli/tests/commands/workflow.test.ts:1827` |
| `packages/app/src/index.ts:241` |
| `packages/app/src/index.ts:5` |
| `packages/app/src/services/agent-service.ts:1` |
| `packages/app/src/services/agent-service.ts:318` |
| `packages/app/src/services/agent-service.ts:50` |
| `packages/app/src/services/agent-service.ts:61` |
| `packages/app/src/services/agent-service.ts:675` |
| `packages/app/src/services/agent-service.ts:740` |
| `packages/app/src/services/agent-service.ts:779` |
| `packages/app/src/services/agent-service.ts:809` |
| `packages/app/src/services/agent-service.ts:858` |
| `packages/app/src/services/agent-service.ts:882` |
| `packages/app/src/services/agent-service.ts:986` |
| `packages/app/src/services/agent-service.ts:997` |
| `packages/app/src/services/history-service.ts:191` |
| `packages/app/src/services/history-service.ts:218` |
| `packages/app/src/services/history-service.ts:30` |
| `packages/app/src/services/workflow-service.ts:10` |
| `packages/app/src/services/workflow-service.ts:324` |
| `packages/app/src/services/workflow-service.ts:7` |
| `packages/app/src/services/workflow-service.ts:9` |
| `packages/app/src/services/workflow-service.ts:916` |
| `packages/app/src/services/workflow-service.ts:921` |
| `packages/app/src/services/workflow-service.ts:925` |
| `packages/app/tests/services/agent-service.test.ts:16` |
| `packages/app/tests/services/agent-service.test.ts:2` |
| `packages/app/tests/services/agent-service.test.ts:2768` |
| `packages/app/tests/services/history-service.test.ts:469` |
| `packages/app/tests/services/history-service.test.ts:5` |
| `packages/app/tests/services/system-event-tap.test.ts:159` |
| `packages/domain/src/analytics/index.ts:33` |
| `packages/domain/src/analytics/index.ts:44` |
| `packages/domain/src/analytics/index.ts:51` |
| `packages/domain/src/analytics/index.ts:55` |
| `packages/domain/src/analytics/query.ts:0` |
| `packages/domain/src/analytics/query.ts:2` |
| `packages/domain/src/analytics/run-cost.ts:10` |
| `packages/domain/src/analytics/run-cost.ts:124` |
| `packages/domain/src/analytics/run-cost.ts:127` |
| `packages/domain/src/analytics/run-cost.ts:142` |
| `packages/domain/src/analytics/run-cost.ts:146` |
| `packages/domain/src/analytics/run-cost.ts:15` |
| `packages/domain/src/analytics/run-cost.ts:150` |
| `packages/domain/src/analytics/run-cost.ts:159` |
| `packages/domain/src/analytics/run-cost.ts:164` |
| `packages/domain/src/analytics/run-cost.ts:178` |
| `packages/domain/src/analytics/run-cost.ts:18` |
| `packages/domain/src/analytics/run-cost.ts:180` |
| `packages/domain/src/analytics/run-cost.ts:192` |
| `packages/domain/src/analytics/run-cost.ts:2` |
| `packages/domain/src/analytics/run-cost.ts:20` |
| `packages/domain/src/analytics/run-cost.ts:24` |
| `packages/domain/src/analytics/run-cost.ts:27` |
| `packages/domain/src/analytics/run-cost.ts:29` |
| `packages/domain/src/analytics/run-cost.ts:33` |
| `packages/domain/src/analytics/run-cost.ts:41` |
| `packages/domain/src/analytics/run-cost.ts:43` |
| `packages/domain/src/analytics/run-cost.ts:45` |
| `packages/domain/src/analytics/run-cost.ts:55` |
| `packages/domain/src/analytics/run-cost.ts:61` |
| `packages/domain/src/analytics/run-cost.ts:77` |
| `packages/domain/src/dao/index.ts:18` |
| `packages/domain/src/index.ts:25` |
| `packages/domain/src/migrations.ts:122` |
| `packages/domain/src/migrations.ts:167` |
| `packages/domain/src/migrations.ts:272` |
| `packages/domain/src/migrations.ts:304` |
| `packages/domain/tests/analytics/analytics.test.ts:1` |
| `packages/domain/tests/analytics/analytics.test.ts:123` |
| `packages/domain/tests/analytics/analytics.test.ts:141` |
| `packages/domain/tests/analytics/analytics.test.ts:4` |
| `packages/domain/tests/analytics/query.test.ts:2` |
| `packages/domain/tests/analytics/query.test.ts:82` |
| `packages/domain/tests/analytics/run-cost.test.ts:10` |
| `packages/domain/tests/analytics/run-cost.test.ts:112` |
| `packages/domain/tests/analytics/run-cost.test.ts:117` |
| `packages/domain/tests/analytics/run-cost.test.ts:131` |
| `packages/domain/tests/analytics/run-cost.test.ts:134` |
| `packages/domain/tests/analytics/run-cost.test.ts:151` |
| `packages/domain/tests/analytics/run-cost.test.ts:165` |
| `packages/domain/tests/analytics/run-cost.test.ts:170` |
| `packages/domain/tests/analytics/run-cost.test.ts:173` |
| `packages/domain/tests/analytics/run-cost.test.ts:181` |
| `packages/domain/tests/analytics/run-cost.test.ts:193` |
| `packages/domain/tests/analytics/run-cost.test.ts:195` |
| `packages/domain/tests/analytics/run-cost.test.ts:213` |
| `packages/domain/tests/analytics/run-cost.test.ts:22` |
| `packages/domain/tests/analytics/run-cost.test.ts:223` |
| `packages/domain/tests/analytics/run-cost.test.ts:231` |
| `packages/domain/tests/analytics/run-cost.test.ts:238` |
| `packages/domain/tests/analytics/run-cost.test.ts:240` |
| `packages/domain/tests/analytics/run-cost.test.ts:248` |
| `packages/domain/tests/analytics/run-cost.test.ts:250` |
| `packages/domain/tests/analytics/run-cost.test.ts:261` |
| `packages/domain/tests/analytics/run-cost.test.ts:27` |
| `packages/domain/tests/analytics/run-cost.test.ts:270` |
| `packages/domain/tests/analytics/run-cost.test.ts:275` |
| `packages/domain/tests/analytics/run-cost.test.ts:286` |
| `packages/domain/tests/analytics/run-cost.test.ts:289` |
| `packages/domain/tests/analytics/run-cost.test.ts:291` |
| `packages/domain/tests/analytics/run-cost.test.ts:30` |
| `packages/domain/tests/analytics/run-cost.test.ts:301` |
| `packages/domain/tests/analytics/run-cost.test.ts:308` |
| `packages/domain/tests/analytics/run-cost.test.ts:317` |
| `packages/domain/tests/analytics/run-cost.test.ts:320` |
| `packages/domain/tests/analytics/run-cost.test.ts:33` |
| `packages/domain/tests/analytics/run-cost.test.ts:336` |
| `packages/domain/tests/analytics/run-cost.test.ts:349` |
| `packages/domain/tests/analytics/run-cost.test.ts:49` |
| `packages/domain/tests/analytics/run-cost.test.ts:7` |
| `packages/domain/tests/analytics/run-cost.test.ts:73` |
| `packages/domain/tests/analytics/run-cost.test.ts:94` |
| `packages/domain/tests/analytics/run-cost.test.ts:97` |
| `packages/domain/tests/dao/migrations.test.ts:141` |
| `packages/domain/tests/dao/migrations.test.ts:144` |
| `packages/domain/tests/dao/migrations.test.ts:179` |
| `packages/domain/tests/dao/migrations.test.ts:355` |
| `packages/domain/tests/dao/migrations.test.ts:61` |
| `packages/domain/tests/dao/migrations.test.ts:75` |
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/run-cost.ts:57-75` — `attributeActionCost` folds `history_message` typed token columns (`input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_write_tokens`) through `RunSessionDao.getByRunId` (run→session mapping); test `packages/domain/tests/analytics/run-cost.test.ts:181` asserts non-zero figures via an exact mapping. Re-confirmed this run: `bun test packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/query.test.ts` → 19 pass / 0 fail on the bumped dependency. |
| R2 | MET | `run-cost.ts:15-24` — `ActionCostAttribution.exact`/`estimated` buckets never summed; test `run-cost.test.ts:213` mixed fixture reports both apart; renderer `apps/cli/src/commands/workflow.ts:1007-1025` renders exact and `~`-prefixed estimated figures separately. Suite green this run (19 pass). |
| R3 | MET | `workflow.ts` `formatTokenCost` emits tokens only; `costUsd` stays 0 in the attribution path; tests `never emits a currency value (R3)` (workflow.test.ts) and `costUsd stays 0` (run-cost.test.ts:151); no new pricing call site — `costs.ts:6` `resolvePricing` consumer is the pre-existing analyze rollup, unchanged. |
| R4 | MET | `loadAllEtlPayloads`, `SOURCE_TABLES`, `queryEtlRecords`, `payloadToCostRecord`, `matchEtlPayloads`/`matchEtlForAction`, `extractSessionId`, `EtlMatch` deleted from `query.ts` and `run-cost.ts`; barrel exports pruned (`index.ts:30-56`); grep confirms no production caller remains; suite green this run (19 pass / 0 fail proves no dangling references). |
| R5 | MET | Released dist verified this run: `@gobing-ai/ts-llm-jsonl-importer@0.4.33` resolved (`bun.lock`), installed `dist/mappers.js` has **0** `detectProvenance` hits and every splitter emits `provenance: 'ambient'` (heuristic deleted, not tuned; upstream ts-libs `HEAD e63ba6d`, tree clean, format fix landed `a626fe5` and shipped in release `38465bd`). Correlation-derived correction: `packages/app/src/services/history-service.ts:209-216` runs `RunSessionDao.alignMessageProvenance` after import; `packages/domain/src/dao/run-session-dao.ts:154-186` two-way alignment (ambient→spur-run for mapped, reverse self-heal for unmapped spur-run). Tests against the released dist: `history-service.test.ts:496` (cwd `/home/user/projects/spur-work` — contains `/spur` — imports `['ambient']` when unmapped), `:520` (mapped → `spur-run`), `:526` (mapped ambient-cwd promoted), `:544` (dry-run never corrects); `run-session-dao.test.ts` two-way. `bun test packages/app/tests/services/history-service.test.ts packages/domain/tests/dao/run-session-dao.test.ts` → 35 pass / 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: R5 — Cost attribution reads the columns that hold data | MET | test | `packages/domain/tests/analytics/run-cost.test.ts:181` — attribution via exact mapping yields non-zero token figures from `history_message` typed columns; `:151` asserts `costUsd` stays 0; re-run this verify: run-cost + query suites 19 pass / 0 fail |
| Scenario: R6 — The dead ETL path is removed, not left dormant | MET | command | `bun test packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/query.test.ts` → 19 pass / 0 fail (suite compiles and passes with the loader gone, proving no caller references it); static: `rg 'loadAllEtlPayloads |
| Scenario: R7 — provenance means launch provenance | MET | test | `packages/app/tests/services/history-service.test.ts:496` — session under `/spur` cwd imports as `['ambient']` when unmapped (the old heuristic would have labelled it spur-run); `:520` mapped session imports `['spur-run']`; `run-session-dao.test.ts` two-way alignment; verified against released dist 0.4.33 (0 `detectProvenance` hits in `dist/mappers.js`) — 35 pass / 0 fail across the two files |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P2 | delivery | `~/xprojects/ts-libs` `7d17414` vs `bun.lock:399` | R5's mapper fix is unreleased: the monorepo still resolves `@gobing-ai/ts-llm-jsonl-importer@0.4.32`, which still ships the cwd-substring `detectProvenance` (10 hits in the installed dist). `alignMessageProvenance` (history-service.ts:209-216) makes end-state provenance correct either way, but the requirement's "heuristic deleted, not tuned" is only true in the ts-libs working tree. Required before done: republish ts-libs (≥0.4.33), `bun update` in this repo, re-run the provenance tests. Also the ts-libs tree carries an uncommitted format fix (`forensic-contract.test.ts`) — the R5 change is not fully landed there. |
| P3 | dead code | `packages/domain/src/analytics/query.ts:24`, `index.ts:33` | `extractClaudeTokens` + `ExtractedTokens` remain exported with zero production callers (only tests). It consumes `EtlPayload`, the dead ETL data shape — R4's "delete, don't leave dormant" rationale applies to it too. Either delete it with its tests or name a live consumer. |
| P4 | documentation | `docs/04_DESIGN.md` §3.1, `history_etl_<source>` row | R4's "confirm unwritten" is only partially confirmed: importer generic sources (opencode/antigravity/openclaw) still target `history_etl_<source>` on the write side; the 10 tables are empty only on the measured machine. The read-path deletion is safe regardless (nothing reads them) — documented caveat, not a defect. |
| P4 | correctness | `packages/domain/src/analytics/run-cost.ts:104-107` | The fold adds `cache_read + cache_write` to `input_tokens`, assuming the typed column excludes cache. True for pi/codex/omp (mapper reads `usage.input` fresh); claude's `raw.inputTokens` may already include cache reads — bounded impact because claude captures no token rows today (deferred to feature E1/E5). Test encodes the assumption (run-cost.test.ts:181). |

**Functional traceability (task 0559, requirements)**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/run-cost.ts:57-75` — `attributeActionCost` folds `history_message` typed token columns through `RunSessionDao.getByRunId` (run→session mapping); test `packages/domain/tests/analytics/run-cost.test.ts:181` asserts non-zero figures via an exact mapping |
| R2 | MET | `run-cost.ts:15-24` — `ActionCostAttribution.exact/estimated` buckets never summed; test `run-cost.test.ts:213` mixed fixture reports both apart; renderer `apps/cli/src/commands/workflow.ts:1007-1025` renders exact and `~`-prefixed estimated figures separately |
| R3 | MET | `workflow.ts` `formatTokenCost` emits tokens only; `costUsd` stays 0 in the attribution path; tests `never emits a currency value (R3)` (workflow.test.ts) and `costUsd stays 0` (run-cost.test.ts:151); no new pricing call site — `costs.ts:6` `resolvePricing` consumer is the pre-existing analyze rollup, unchanged |
| R4 | MET | `loadAllEtlPayloads`, `SOURCE_TABLES`, `queryEtlRecords`, `payloadToCostRecord`, `matchEtlPayloads`/`matchEtlForAction`, `extractSessionId`, `EtlMatch` deleted from `query.ts` and `run-cost.ts`; barrel exports pruned (`index.ts:30-56`); grep confirms no production caller remains (P3 residue noted above); suite green |
| R5 | MET | `packages/app/src/services/history-service.ts:209-216` runs `RunSessionDao.alignMessageProvenance` after import; `packages/domain/src/dao/run-session-dao.ts:154-186` two-way alignment (ambient→spur-run for mapped, reverse self-heal); ts-libs `7d17414` deletes `detectProvenance` (all splitters emit `'ambient'`); tests `history-service.test.ts:472-520` (ambient-under-`/spur`-path) and `run-session-dao.test.ts:167+` — P2 delivery gap above is the residual |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | All frozen delete names gone; kept names (`actionCost`, `actionCostEstimated`, `foldTotals`, `TokenTotals`) present with `foldTotals` retention documented for 0547 (run-cost.ts:122-127); `cost_usd`/pricing never read by the attribution path; no exact+estimated summing; no cwd-substring tuning (replaced by mapping-derived alignment); docs/04_DESIGN.md updated in-tree (T3) |

**Validation (run this review)**

- `bun test packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/query.test.ts` → 19 pass, 0 fail
- `bun test apps/cli/tests/commands/workflow.test.ts` → 107 pass, 0 fail
- `bun test packages/app/tests/services/{history-service,agent-service,system-event-tap}.test.ts packages/domain/tests/dao/{run-session-dao,migrations}.test.ts` → 237 pass, 0 fail
- `bun test packages/domain apps/cli` → 1556 pass, 1 fail (`registerServeCommand` 5s timeout — serve untouched by this diff, passes in isolation; environmental flake)
- `bun run lint` (biome + per-workspace tsc) → green; `biome check` on the 7 changed source files → clean

**Disposition:** functional verdict PASS; review gate blocked on P2 (republish ts-libs importer + `bun update` so the resolved dependency actually ships the R5 deletion) before `done`. P3/P4 items are post-landing candidates.
### References
- **Dead path to remove:** `packages/domain/src/analytics/run-cost.ts:98-112` (`loadAllEtlPayloads`),
  `packages/domain/src/analytics/query.ts:8-16` (`SOURCE_TABLES`),
  `packages/domain/src/analytics/index.ts:52-56` (exports)
- **Measured evidence:** all 10 `history_etl_*` tables 0 rows; `history_message` 1,296,633 rows,
  166,162 with token data (`.spur/spur.db`, 2026-08-13)
- **Replacement columns:** `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:43-46`
- **Pricing boundary:** `packages/domain/src/analytics/models.ts:4`, `:31`, `:35` — never called;
  feature J6 § *Tokens, not prices*
- **Provenance defect:** `~/xprojects/ts-libs/packages/llm-jsonl-importer/src/mappers.ts:61-64`
- **Prior ruling that deferred this:** feature E2 § Out of scope (2026-08-09) — "real, unowned, and
  E1's cost-attribution surface"
- **Upstream:** tasks 0557, 0558 · **Downstream:** feature J6 task 0547
### History
- 2026-08-14T07:45:29.000Z todo → wip (system)
- 2026-08-14T17:16:34.437Z wip → testing (system)
- 2026-08-14T17:16:35.987Z testing → done (system)
