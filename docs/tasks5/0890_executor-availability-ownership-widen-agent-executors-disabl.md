---
schema_version: 1
name: "Executor availability ownership: widen agent.executors[].disabled to carry owner/since/reason, normalize readers, and enforce owner precedence in the B5 drain"
status: done
template: feature-impl
created_at: 2026-09-17T23:19:46.552Z
updated_at: "2026-09-18T15:05:13.974Z"
feature_id: B6
priority: P1
tags:
  - config
  - executor-availability
  - B6
estimate_hours: 6

dependencies: []
---

## 0890. Executor availability ownership: widen agent.executors[].disabled to carry owner/since/reason, normalize readers, and enforce owner precedence in the B5 drain

### Background

B5 (ADR-111) persists `agent.quota.exhausted` as `disabled: true` with no record of who disabled the executor, so nothing can safely re-enable it. Authority: `docs/design/session-pinned-dispatch.md` §3.1 (ownership state), §3.2 (row fields), AC R1/R2/R10; `packages/config/src/index.ts` `AgentExecutorConfigSchema` (`disabled: z.boolean().default(false)`), `packages/config/src/executor-update.ts`, `packages/app/src/services/agent-quota-updates.ts`.

### Requirements

- [x] R1. `AgentExecutorConfigSchema.disabled` accepts `boolean | {{ owner: 'operator'|'quota'|'probe', since: RFC3339 string, reason: string }}`; a bare `true` normalizes to `{{ owner: 'operator' }}`; one exported normalizer in `packages/config` is the only reader of the raw shape.
- [x] R2. `setProjectExecutorDisabled` writes the object form for automatic callers (owner `quota` or `probe`, `since`, `reason`) and keeps the YAML updater's backup + atomic-rename + conflict-detection behaviour and its error codes.
- [x] R3. The `agent_executor_updates` row gains `owner` and `layer` columns (next four-digit drizzle migration); the serial drain applies a `quota`/`probe` update only when the current owner is not `operator`, records the classified no-op in `last_error`-free form (a distinct `skipped_reason`), and keeps B5's `(observed_at, observation_id)` ordering between automatic writers.
- [x] R4. `apps/cli/schemas/spur-config.schema.json`, `config/config.example.yaml` and the configuration design satellite document the object form and the bare-boolean equivalence.
- [x] R5. Tests: schema round-trip for both forms; drain precedence (operator-owned row survives a quota update; quota-owned row accepts a later probe update); `bun run spur-check` passes.

### Acceptance Criteria

Covers feature B6 scenarios R1, R2, R10.

- [x] AC1 — A quota-driven disable records its owner, timestamp and reason (req: R1)
- [x] AC2 — An operator-owned disable is never re-enabled automatically (req: R3)
- [x] AC3 — Owner precedence resolves concurrent writers (req: R3)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

Decision: ownership lives in the config value itself, not in a side table, so the file a human reads is the truth and the B5 conflict detection keeps working on one YAML node (docs/design/session-pinned-dispatch.md §3.1). Bare boolean stays valid forever; `true` means operator because only humans write bare booleans. Precedence is a two-line rule (operator wins; automatic writers order by observation) applied in the existing drain, not a new state machine. `layer` is recorded now so task 4's global updater needs no second migration. Mutation policy: `packages/config` (schema, normalizer, updater), `packages/domain` (migration + DAO for the two columns), `packages/app/src/services/agent-quota-updates.ts`, JSON schema, example config, tests, config satellite; no recovery consumer, no global file writes (task 4), no producer (task 5).

### Plan

1. Read design §3.1–§3.2, ADR-111 and `executor-availability.md` §5–§6; read `AgentExecutorConfigSchema`, `setProjectExecutorDisabled`, and the drain in `agent-quota-updates.ts`.
2. Widen the Zod schema with a discriminated shape; add and export the normalizer; update every reader found by `rg 'disabled' packages apps`.
3. Extend the updater to write the object form; add the drizzle migration and DAO fields; implement precedence in the drain.
4. Update JSON schema, example config, and the configuration satellite row; write the tests.
5. Run `cd packages/config && bun test`, `cd packages/app && bun test tests/services/agent-quota-updates*`, then `bun run spur-check`.
6. Record `## Solution` with a file:line map via `spur task update <wbs> --section Solution --from-file`.

### Solution

Implements 0890 executor availability ownership (feature B6): `agent.executors[].disabled` accepts the ownership object `{ owner: 'operator'|'quota'|'probe', since: RFC3339, reason }` with bare-boolean equivalence (`true` = operator-owned, only humans write booleans), one exported normalizer is the single reader of the raw shape, the updater writes the object form for automatic callers keeping backup/atomic-rename/conflict codes, and the B5 quota drain enforces operator precedence with classified skips.

| Req | Change |
| --- | --- |
| R1 | packages/config/src/index.ts:306 — `ExecutorDisabledValue` stored union: bare boolean or ownership object |
| R1 | packages/config/src/index.ts:371 — exported `normalizeExecutorAvailability`, the only raw-shape reader |
| R1 | packages/config/src/rfc3339.ts:1 — RFC 3339 `since` check shared by the zod refine and updater validation |
| R1 | packages/app/src/services/agent-service.ts:506 — executor list reader normalized through the normalizer |
| R1 | packages/app/src/services/fleet-service.ts:230 — fleet eligibility reader normalized through the normalizer |
| R2 | packages/config/src/executor-update.ts:29 — `setProjectExecutorDisabled` outcome; automatic callers write owner/since/reason, backup + atomic rename + conflict codes unchanged |
| R3 | packages/domain/src/dao/agent-executor-update-dao.ts:105 — `agent_executor_updates` upsert carries `owner`, `layer`, `skipped_reason` |
| R3 | packages/domain/src/migrations.ts:301 — `0048_spur_cli_agent_executor_updates_owner_columns` registration (guarded ALTERs + backfill, 0044 precedent) |
| R3/AC2 | packages/app/src/services/agent-quota-updates.ts:302 — operator-owned rows skip automatic quota/probe updates as classified no-ops (`skippedOperatorOwned`) |
| R2/R3 | packages/app/src/services/agent-quota-updates.ts:323 — automatic disables record the classified row owner (`quota`/`probe`) with since/reason |
| R4 | apps/cli/schemas/spur-config.schema.json:169 — JSON schema documents the object form and bare-boolean equivalence |
| R4 | config/config.example.yaml:137 — example config documents automatic-writer object form |
| R4 | docs/design/configuration-contracts.md:218 — configuration satellite documents the widened updater contract |
| R5 | packages/config/tests/executor-availability.test.ts:1 — schema round-trip for both disabled forms (R1) |
| R5 | packages/config/tests/executor-update.test.ts:246 — updater ownership-object behaviour (R2) |
| R5 | packages/app/tests/services/agent-quota-updates.test.ts:466 — drain precedence: operator survives quota update, quota accepts later probe (R3) |
| R5 | packages/domain/tests/dao/migrations.test.ts:917 — drizzle/0048 folder-load parity + journal/applied-count updates |

Tests: 28 pass (packages/config: executor-update + executor-availability), 23 pass (packages/app agent-quota-updates), 58 pass (packages/domain migrations). `bun run lint` (biome --error-on-warnings + repo-wide typecheck) clean. Full `bun run spur-check` gate owned by the pipeline test stage.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Schema union `packages/config/src/index.ts:298-337` (`executorDisabledObjectSchema` :298, `ExecutorDisabledValue` :307, `disabled: z.union(...)` :337; RFC3339 refine via `packages/config/src/rfc3339.ts:11-13`); single reader `packages/config/src/index.ts:371` (`normalizeExecutorAvailability`); all readers routed: `packages/app/src/services/agent-service.ts:506`, `:569-574`, `:643`, `:2487` (`executorDisabled` classified reader), `packages/app/src/services/fleet-service.ts:230`, `packages/config/src/index.ts:616`; repo sweep found no unconverted raw `disabled` reader; tests `packages/config/tests/executor-availability.test.ts:11` (round-trip both forms), `:25` (rejects malformed objects/non-booleans), `:40` (bare `true` → operator) |
| R2 | MET | `packages/config/src/executor-update.ts:38-45` (`ExecutorDisabledUpdate`, owner quota\|probe only), signature `:63`, object write `:140-145`, arg validation `:190-205`; backup/atomic-rename/conflict + error codes preserved (`:16` codes, `:152-171` conflict-detect + fsync + rename + mode restore); only caller is the drain `packages/app/src/services/agent-quota-updates.ts:332` (object for disable, `false` for recovery); tests `packages/config/tests/executor-update.test.ts:246` describe 0890 R2 (`:253` writes object, `:265` byte-stable replay no-op, `:274` rewrites on new owner/since, `:293` recovery overwrites object, `:304` rejects operator/bad-since/empty-reason) + 0797 regression pins `:110`, `:163`, `:216` |
| R3 | MET | Row fields `packages/domain/src/dao/agent-executor-update-dao.ts:26-30` (owner/layer/skipped_reason); upsert carries them `:101-131`; classified no-op `ackSkipped` `:187-205` (`skipped_reason` set, `last_error` stays NULL); B5 ordering kept `:255-266` (`ORDER BY observed_at ASC, observation_id ASC`) + `:295-298` (`observationIsNewer`); migration `packages/domain/src/migrations.ts:1518-1527` (`0048_..._owner_columns`, `addColumnIfMissing` guard + NULL→quota backfill), SQL `:296-309`, drizzle `drizzle/0048_spur_cli_agent_executor_updates_owner_columns.sql:1-10`; drain precedence `packages/app/src/services/agent-quota-updates.ts:300-311` (operator-owned → `ackSkipped('operator-owned')`, warn, not a failure), per-row config reload `:262-265`; tests `packages/app/tests/services/agent-quota-updates.test.ts:467` (operator survives quota update), `:494` (quota accepts later probe), `:521` (legacy NULL→quota), `packages/domain/tests/dao/migrations.test.ts:917` (0048 folder-load parity) |
| R4 | MET | `apps/cli/schemas/spur-config.schema.json:169-184` (anyOf boolean/object, owner enum operator\|quota\|probe, since date-time, reason, bare-`true`=operator note); `config/config.example.yaml:133-151` (bare-`true` note :136, object example :144, never-auto-re-enable note); `docs/design/configuration-contracts.md:216-235` (updater contract, single-reader rule, drain precedence pointer) |
| R5 | MET | Schema round-trip `packages/config/tests/executor-availability.test.ts:11`; drain precedence `packages/app/tests/services/agent-quota-updates.test.ts:467` (operator-owned survives quota) + `:494` (quota accepts later probe); runtime `apps/server/tests/serve.test.ts:957` (drain-persisted object reloads through the normalizer); repo gate `bun run spur-check` GREEN per pipeline receipt (8457 pass / 0 fail, 2026-09-17 ~20:13 UTC; observe-only session without shell — scoped suites line-anchored this run, gate not re-executed here) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Drain writes `{owner: quota\|probe, since: observed_at, reason}` — `packages/app/src/services/agent-quota-updates.ts:323-332` (`desired` at :324, `since: row.observed_at` :328); row provenance `packages/app/src/services/agent-quota-updates.ts:153-162` (`owner: 'quota'` :161) + `packages/domain/src/dao/agent-executor-update-dao.ts:101-131`; tests `packages/app/tests/services/agent-quota-updates.test.ts:494` (YAML carries probe ownership object) and runtime `apps/server/tests/serve.test.ts:957` (persisted `owner: quota` reloads as `{disabled:true, owner:'quota', since, reason}` via the normalizer) |
| AC2 | MET | test | `packages/app/tests/services/agent-quota-updates.test.ts:467` (operator bare `true` survives quota update: `applied=0`, `skippedOperatorOwned=1`, `skipped_reason='operator-owned'`, `last_error` NULL, YAML untouched) and `:533` (a recovery event also cannot re-enable an operator object); implementation `packages/app/src/services/agent-quota-updates.ts:300-311` |
| AC3 | MET | test | `packages/app/tests/services/agent-quota-updates.test.ts:494` (quota-owned object accepts a strictly newer probe write in the same drain); latest-observation supersede guard `packages/domain/src/dao/agent-executor-update-dao.ts:101-131` + `:295-298` with `packages/app/tests/services/agent-quota-updates.test.ts:178` (older arrival superseded); serial ordering `agent-executor-update-dao.ts:255-266` |
| AC-1 | MET | test | Quota-driven drain records owner/since/reason: `packages/app/src/services/agent-quota-updates.ts:323` automatic disables record classified owner (`quota`/`probe`) with since/reason; object write `packages/config/src/executor-update.ts:140-145`; bare `true` normalizes to operator `packages/config/src/index.ts:371`; tests `packages/app/tests/services/agent-quota-updates.test.ts:467,:494,:521`, `packages/config/tests/executor-availability.test.ts:40` (bare true -> operator) |
| AC-2 | MET | test | Operator-owned disable never auto re-enabled: drain classifies operator-owned rows as `ackSkipped('operator-owned')` no-ops `packages/app/src/services/agent-quota-updates.ts:300-311` (warn, never failure, `last_error` NULL `packages/domain/src/dao/agent-executor-update-dao.ts:187-205`); tests `agent-quota-updates.test.ts:467` (operator survives quota update), `:591` (operator-owned never recovered) |
| AC-10 | MET | test | Owner precedence under concurrent writers: single updater — drain is the only caller of the shared write core (`agent-quota-updates.ts:332` -> `packages/config/src/executor-update.ts:160-290` with per-path lock `:266`, conflict detection `:243-249`); operator-owned state never overwritten by quota-owned (`ackSkipped`, tests `:467` operator survives, `:494` quota accepts later probe) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-09-18T02:13:08.974Z todo → wip (system)
- 2026-09-18T03:24:53.261Z wip → testing (system)
- 2026-09-18T03:24:54.600Z testing → done (system)

