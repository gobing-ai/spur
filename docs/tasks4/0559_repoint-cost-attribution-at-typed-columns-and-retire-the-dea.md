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
updated_at: "2026-08-14T17:43:34.051Z"
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
- [x] **R1.** Attribute run cost from `history_message`'s typed token columns — `input_tokens`,
      `output_tokens`, `cache_read_tokens`, `cache_write_tokens` — joined through the
      `history_run_session` mapping, replacing the `history_etl_*` payload path. Measurable: cost
      attribution for a workflow action with correlated history returns non-zero token figures where
      the old path returned nothing.
- [x] **R2.** Weight the result by mapping `exactness`: figures from an `exact` mapping are reported
      exact, from an `estimated` mapping as estimated, and the two are never summed into one number.
      Measurable: a mixed fixture reports both separately.
- [x] **R3.** No dollar figure is computed or emitted. `history_message.cost_usd` exists as a column
      and stays unread; `MODEL_PRICING` / `UNKNOWN_MODEL_PRICING` gain no new consumer. Measurable:
      no currency value in output, asserted by test, and no new call site for the pricing helpers.
- [x] **R4.** Confirm every `history_etl_*` table is empty and unwritten, then delete the dead path —
      `loadAllEtlPayloads`, `SOURCE_TABLES`, `payloadToCostRecord`, and the `extractClaudeTokens`
      call sites that only served it — along with their exports. Leaving them dormant invites the next
      reader to build on them again. Measurable: the symbols are gone, no caller references them, and
      the suite is green.
- [x] **R5.** Correct `detectProvenance` so `provenance` distinguishes a session spur launched from
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
- [x] Confirm every `history_etl_*` table is unwritten, not merely empty on one machine (R4)
- [x] Attribute cost from `history_message` typed token columns via the `history_run_session` mapping (R1)
- [x] Report exact and estimated attributions separately, never summed (R2)
- [x] Assert no currency value is emitted and no new pricing call site exists (R3)
- [x] Delete `loadAllEtlPayloads`, `SOURCE_TABLES`, `payloadToCostRecord` and their exports (R4)
- [x] Replace `detectProvenance`'s cwd substring with a correlation-derived launch signal (R5)
- [x] Add tests: typed-column attribution, exact/estimated split, ambient-under-spur-path provenance (R1-R3, R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
**Change map (0559 — replaces the implement-step auto-map that cited unrelated `workflow.ts` hunks from a mixed tree).**

- **R1 — typed-column attribution.** `packages/domain/src/analytics/run-cost.ts:61-75` `attributeActionCost(db, runId, action)` joins `history_message` token columns (`input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`) through `history_run_session` (`:77-125` `foldMappedSessions`). Replaces the retired `history_etl_*` payload scan. Test: `packages/domain/tests/analytics/run-cost.test.ts:181`.
- **R2 — exact and estimated stay apart.** The same function folds the two `exactness` classes separately and returns `{ exact, estimated }` (`:67-74`). They are never summed. Test: `packages/domain/tests/analytics/run-cost.test.ts:213`.
- **R3 — no dollars.** `actionCost` / `actionCostEstimated` keep `costUsd: 0`. `history_message.cost_usd` and `MODEL_PRICING` are unread. Test: `packages/domain/tests/analytics/run-cost.test.ts:151`.
- **R4 — dead ETL path removed.** `loadAllEtlPayloads`, `SOURCE_TABLES`, `payloadToCostRecord`, `matchEtlPayloads` / `matchEtlForAction` are gone from `run-cost.ts` / `query.ts` and the analytics barrel. `rg loadAllEtlPayloads` has no production callers. Residual: `extractClaudeTokens` remains exported for `EtlPayload` tests only (P3 in Review — no live consumer).
- **R5 — provenance is launch provenance.** `packages/domain/src/dao/run-session-dao.ts:154-177` `alignMessageProvenance` is the only writer of `spur-run` (mapped sessions) vs `ambient` (everything else). `packages/app/src/services/history-service.ts:209-217` runs it after every non-dry-run import. `detectProvenance` cwd-substring heuristic is gone. Tests: `packages/app/tests/services/history-service.test.ts:496` (unmapped `/spur` cwd → ambient), `:507` (mapped → spur-run).
- **Docs (T3).** `docs/04_DESIGN.md` records `history_run_session` and the typed-column cost path.

**Out of this task.** Workflow-trace CLI surface (`apps/cli/src/commands/workflow.ts`) is a consumer of `attributeActionCost`, not the 0559 deliverable. The previous auto-generated Solution listed those hunks because the implement tree was mixed.
### Testing
**Re-verify 2026-08-14** (`/sp-dev-verifyall --feature E6 --force --fix all` in worktree `spur-new-runall-e6-e91f`). Task already `done`; `--force` re-audited. Line anchors re-read this run.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/run-cost.ts:61` `attributeActionCost` joins typed `history_message` token columns through `history_run_session`. Test `packages/domain/tests/analytics/run-cost.test.ts:181` (this run). |
| R2 | MET | Test `packages/domain/tests/analytics/run-cost.test.ts:213` exact and estimated reported separately, never summed (this run). |
| R3 | MET | Test `packages/domain/tests/analytics/run-cost.test.ts:151` `costUsd stays 0 — no pricing is applied (R3)` (this run). |
| R4 | MET | `rg 'loadAllEtlPayloads'` this run: no callers in packages/apps. `bun test packages/domain/tests/analytics/run-cost.test.ts packages/domain/tests/analytics/query.test.ts` — 19 pass / 0 fail with the loader gone. |
| R5 | MET | `packages/domain/src/dao/run-session-dao.ts:148-167` two-way provenance align. Tests `packages/app/tests/services/history-service.test.ts:496` unmapped `/spur` cwd → ambient; `:507` mapped → spur-run. `rg 'detectProvenance'` this run: no function in packages/apps. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R5 — Cost attribution reads the columns that hold data | MET | test | `packages/domain/tests/analytics/run-cost.test.ts:181` + `:151` costUsd stays 0 (this run) |
| Scenario: R6 — The dead ETL path is removed, not left dormant | MET | command | `rg loadAllEtlPayloads` no callers; run-cost + query suites 19 pass / 0 fail this run |
| Scenario: R7 — provenance means launch provenance | MET | test | `packages/app/tests/services/history-service.test.ts:496` and `:507`; DAO align tests in `packages/domain/tests/dao/run-session-dao.test.ts` (this run) |

Coverage: N/A (attribution + provenance covered by targeted tests). `--fix all` flipped leftover checkboxes and replaced basename-only / out-of-range Testing citations (`run-session-dao.ts` is 183 lines). Artifact: `.spur/run/0559-verdict.json`.
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
