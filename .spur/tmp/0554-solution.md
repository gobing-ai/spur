## Solution

**Derived-variable pipeline (MetricRegistry) — `packages/domain/src/analytics/derived.ts` (new, 368 lines)**

- Types: `Phase` (derived.ts:17), `PhaseResult` (:26), `TimeDecomposition` (:33), `Bottleneck` (:47), `DerivedVariables` (:55), metric-input rows `SessionSpanRow` (:66), `SessionToolDurationRow` (:76), `TodoToolCallRow` (:84), `MetricContext` (:97), `MetricFn` (:106).
- `parseTodoItems` (derived.ts:166) — two-shape replay of todo-tool `args_raw`: codex `{plan:[{step,...}]}`, others `{todos:[{content,...}]}`; malformed JSON → `[]`, non-string/empty names dropped.
- `extractPhases` (derived.ts:196) — per-session grouping; first `in_progress` ts → `startedAt`, first `completed` ts → `endedAt`, never-completed falls back to the session's last todo-call ts.
- `computeDerived` (derived.ts:344) — folds span/tool/todo rows into `DerivedVariables`; time decomposition carries the never-fabricate invariant: any unmeasured duration in a session routes the remainder to `unattributedMs` instead of fabricating `idleMs`.
- `derivedWarnings` (derived.ts:356) — emits `derived-unattributed-time` warnings for sessions with unmeasured time; `emptyDerived` (:141) for no-data artifacts.
- `createDefaultRegistry` (derived.ts:329) + `MetricRegistry` — ordered metric list; default metrics are exactly the three above. Registry exists so 0555/0556 report modes can extend without touching `analyze`.

**SQL inputs — `packages/domain/src/analytics/forensic-query.ts`**

- `sessionSpans` (forensic-query.ts:357) — per-session first/last ts + `assistantDurationMs`/`assistantDurationUnmeasured` from `history_message.duration_ms`.
- `sessionToolDurations` (forensic-query.ts:373) — per-session tool time + unmeasured count from `history_tool_call.duration_ms`.
- `todoToolCalls` (forensic-query.ts:391) — reads the 0012 `args_raw` column (allowlist-filtered at import by task 0553), `WHERE` clause hoisted to a separate `const whereClause` **outside** the SQL template literal — the R2 structural scan treats backticks as query boundaries, so nested template literals inside SQL are prohibited.
- All three carry `GROUP BY`/`LIMIT ?` per the R2 bounded-query invariant.

**Artifact — `packages/domain/src/analytics/artifact.ts`**

- `derived?: DerivedVariables` (artifact.ts:136) — optional, additive; `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 (old artifacts remain valid, `assertArtifactVersion` strict-equality gate unchanged).

**Wiring — `packages/app/src/services/history-service.ts`**

- `analyze()` computes derived after SQL aggregation (history-service.ts:264), appends `derivedWarnings(derived)` (:301), and writes `derived` onto the artifact (:304). No corpus loading — metrics consume the three query row sets only.

**Exports — `packages/domain/src/analytics/index.ts`**

- `derived` module re-exported (:19-32): `computeDerived`, `derivedWarnings`, `emptyDerived`, `extractPhases`, `parseTodoItems`, `MetricRegistry`, `createDefaultRegistry` + all row/value types; forensic-query additions `sessionSpans`/`sessionToolDurations`/`todoToolCalls` also exported.

**Docs (T3)** — `docs/04_DESIGN.md` §`spur history analyze` gained a "Derived variables (task 0554)" paragraph (04_DESIGN.md:563-576).

**Dependency note (validation-time only):** runtime validation uses a local dist copy of `@gobing-ai/ts-llm-jsonl-importer` 0.4.32+args_raw under `packages/{domain,app}/node_modules/` (real dir, not symlink — symlinks break tsc type identity by realpath-ing into the ts-libs tree, where `ts-db` resolution falls through to a stale `~/node_modules` 0.4.31). Final delivery requires npm publish (0.4.33) + `bun update` per AGENTS.md; npm auth was unavailable this session.
