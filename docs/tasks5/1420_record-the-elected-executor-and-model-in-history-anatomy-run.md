---
schema_version: 1
name: Record the elected executor and model in history-anatomy run provenance
status: done
template: issue
created_at: 2026-11-21T04:33:09.024Z
updated_at: "2026-11-21T05:14:59.253Z"
feature_id: E6

priority: P3
ac_altitude: task-local
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1420. Record the elected executor and model in history-anatomy run provenance

### Background

History-anatomy reports do not record which executor profile served the agent stages or whether the run failed
over, and the model-authored `Scope and provenance` body still prints the probe-time placeholder.

**Evidence (observed 2026-11-20, re-verified 2026-11-20 refine).**

- `docs/report/2026-11-20-history-anatomy.md:57`: `Executor is \`not available: probe did not receive an executor\`.
  Model is \`not available: probe did not receive a model\`.` — body text, written by enrich from the probe-time
  `.spur/run/<runId>-provenance.json`.
- The same report's stamped frontmatter already names the agent and model (`:29` `executor: "pi"`, `:31` `model:
  "commandcode/deepseek/deepseek-v4.1-flash"`) but `:30` `executorProfile: "not available: invocation executor absent"`
  and every `dispatches` row (`:38-44`) carries the same absent executor.
- The run actually dispatched `commandcode` / `deepseek/deepseek-v4.1-flash`
  (`.spur/run/0a2b3965-…/agent-sessions/coder/fresh-enrich/*.jsonl` `model_change` event).

**Refine corrections (2026-11-20)**

- Premise "provenance records neither executor nor model" → stale: 1326 `applyFinalProvenance`
  (`packages/app/src/services/history-anatomy.ts:901-950`, called by `stamp` in `history-anatomy-cli.ts:236-257`)
  already records agent + model per dispatch and at top level. Missing: the executor PROFILE (always
  `invocation executor absent`), failover visibility, and the body placeholder.
- R1 "the provenance file … names that executor" → the probe-time `-provenance.json` is a workflow-internal input
  written before any dispatch (`config/workflows/history-anatomy.yaml` probe state); it cannot know the elected
  executor. The published report's stamped provenance is the record of truth; R1/AC1 re-targeted to it.
- Root cause of `invocation executor absent` → `AgentRunExecutor` does put `executor`, `tier`, `role` on the
  invocation (`agent-run-executor.ts:795-817`) but the trace projection whitelist `TRACE_INVOCATION_FIELDS`
  (`workflow-trace-projection.ts:143`) drops them.
- R2 "failover visible" → the ladder is persisted as `resultData.ladder` (`agent-run.ts:1687`,
  `AgentLadderDecision[]`), but the projection copies scalars only (`workflow-trace-projection.ts:253-280`), so it
  never reaches stamp.
- R3 "the Scope and provenance section renders the recorded executor/model" → that section is model-authored by
  enrich from probe values (`plugins/sp/skills/history-anatomy/references/operations.md:27`; no deterministic
  renderer emits it), before stamp. Fix is a deterministic stamp-time substitution of explicit pending tokens.
- AC3 "cache-probe hit records `not-applicable`" → a hit reuses the published model half via `refreshReport`
  (`history-anatomy.ts:1126-1131`), whose stamped identity correctly names who authored that half. Only a cached
  report still carrying a placeholder/pending value gets the explicit `not-applicable` rewrite.

### Requirements

- [x] R1. The stamped (published) report's per-dispatch provenance names the executor profile that served each agent
  stage (`DispatchProvenance.executor`), sourced from the dispatch invocation — never
  `not available: invocation executor absent` when the dispatch recorded one.
- [x] R2. A dispatch that failed over records it: `DispatchProvenance.failover` (optional, `a→b[, b→c]`) derived
  from the run's ladder escalation decisions, rendered in frontmatter and parsed back symmetrically; the serving
  executor stays the dispatch's final `executor`.
- [x] R3. The published body's `Scope and provenance` never carries a probe placeholder: probe writes explicit
  pending tokens, enrich copies them verbatim, and stamp deterministically substitutes them with the stamped
  executor/model.
- [x] R4. Cache-hit refresh never emits a probe placeholder: a cached report whose identity is a legacy placeholder
  or pending token is rewritten to `not-applicable: cache hit, no agent stage ran`; a cached report with a real
  stamped identity keeps it.

Out of scope: changing which executor is elected; new workflow states; recording identity for non-history-anatomy
workflows beyond the shared trace projection fields.

### Acceptance Criteria

- [x] AC1 — Stamped provenance names the executor profile (req: R1): Given a trace whose enrich action invocation
  carries `executor: "pi-commandcode-dsv4.1"`, `applyFinalProvenance` records it on the dispatch row and the stamped
  frontmatter renders it; `invocation executor absent` appears only when the invocation lacked the field. Layer:
  `packages/app/tests/services/history-anatomy-final-provenance.test.ts` + `workflow-trace-projection.test.ts`
  (projection keeps `executor`/`tier`/`role`).
- [x] AC2 — Failover is visible (req: R2): Given an action result whose `ladder` has escalation rows `a→b`, the
  projected trace carries `failover: "a→b"`, the dispatch row records it, and `parseProvenance(stampReport(…))`
  round-trips it; a run with no escalation has no `failover` key. Layer: same two test files.
- [x] AC3 — Body placeholder resolved at stamp (req: R3): Given a candidate body containing the probe pending tokens,
  `stampReport` output contains the stamped executor and model in their place and no `not available: probe did not
  receive` / pending token remains. Layer: `history-anatomy-final-provenance.test.ts`.
- [x] AC4 — Cache hit stays defined (req: R4): `refreshReport` on a report with legacy placeholder identity yields
  `not-applicable: cache hit, no agent stage ran`; on a report with a real identity it is byte-identical apart from
  `validated_at` / disposition. Layer: existing history-anatomy refresh tests.

### Q&A

- **Closed (refine 2026-11-20):** the stamped published report is the provenance of record; the probe-time
  `-provenance.json` stays a pre-dispatch input.
- **Closed:** failover is a bounded scalar (`a→b, b→c`), not a projected array.
- **Closed:** body placeholder fixed by deterministic token substitution at stamp, not by trusting enrich.

### Design

**WHAT.** Carry dispatch identity + failover through the trace projection into 1326's stamp, and make the body
placeholder a deterministic stamp-time token.

**Frozen names.**

- `TRACE_INVOCATION_FIELDS` += `'executor'`, `'tier'`, `'role'` (`workflow-trace-projection.ts:143`).
- Projected result scalar `failover`: built in `projectActionTraceResult` from `result.ladder` rows with
  `kind === 'escalation'` as `${executor}→${toExecutor}` joined by `, `, passed through `redactAndBound(…, 256)`;
  omitted when there are no rows. No new array projection.
- `DispatchProvenance.failover?: string` (`history-anatomy.ts:47`); render/parse symmetric with the other dispatch
  fields; absent key ≠ empty string.
- Probe tokens (replace `history-anatomy.ts:1020-1021`): `PENDING_EXECUTOR = 'pending: executor resolved at stamp'`,
  `PENDING_MODEL = 'pending: model resolved at stamp'` (exported consts).
- Stamp substitution: in the stamp path, replace every body occurrence of `PENDING_EXECUTOR` / `PENDING_MODEL` and the
  legacy `not available: probe did not receive an executor|a model` strings with the stamped top-level
  executor / model. Plain string replace — no markdown parsing.
- Refresh: `refreshReport` maps a cached identity equal to a pending token or legacy placeholder to
  `NOT_APPLICABLE_HIT = 'not-applicable: cache hit, no agent stage ran'`.
- Rubric: `plugins/sp/skills/history-anatomy/references/operations.md:27` — one line: copy provenance executor/model
  values verbatim (they may be pending tokens the stamp resolves); do not paraphrase them.

**WHERE.** `packages/app/src/services/workflow-trace-projection.ts`, `packages/app/src/services/history-anatomy.ts`,
`plugins/sp/skills/history-anatomy/references/operations.md`; tests in the two existing test files. No workflow
YAML change (stamp already receives `--trace`).

**Anti-patterns.** Do not have stamp re-read agent-session JSONL; do not rewrite the probe-time provenance file; do
not project the full ladder array into the trace; do not parse model prose beyond exact-token replace.

**Decisions.** Closed: stamped report is the record of truth (not the probe file). Closed: failover is a bounded
scalar string, not structured trace data.

### Plan

1. Failing tests first: projection keeps `executor`/`tier`/`role` and derives `failover`
   (`packages/app/tests/services/workflow-trace-projection.test.ts`); dispatch executor + failover round-trip, body
   token substitution, refresh rewrite (`history-anatomy-final-provenance.test.ts`).
2. Projection: whitelist fields + `failover` derivation (R1, R2).
3. `history-anatomy.ts`: `DispatchProvenance.failover`, render/parse, pending consts, stamp substitution, refresh
   rewrite (R2–R4).
4. Rubric line in `operations.md` (R3).
5. `(cd packages/app && bun test tests/services/workflow-trace-projection.test.ts tests/services/history-anatomy-final-provenance.test.ts)`,
   then `bun run spur-check`.

### Root Cause

Three gaps between the dispatch and the published report:

1. **Trace projection drops identity.** `TRACE_INVOCATION_FIELDS` (`packages/app/src/services/workflow-trace-projection.ts:143`)
   omits `executor` / `tier` / `role`, so `applyFinalProvenance` (`history-anatomy.ts:926-931`) always falls back
   to `not available: invocation executor absent`.
2. **Trace projection drops failover.** `projectActionTraceResult` (`:212-284`) copies only string fields of
   `TRACE_RESULT_FIELDS`; `resultData.ladder` (array, `agent-run.ts:1687`) is discarded.
3. **Body authored from probe placeholders.** `buildProvenance` (`history-anatomy.ts:1020-1021`) writes
   `not available: probe did not receive …`; enrich copies it into `Scope and provenance`; `stampReport` only
   rewrites frontmatter, so the placeholder survives into the published body.

### Solution

| File:lines | Change |
| --- | --- |
| `packages/app/src/services/workflow-trace-projection.ts:143-160` | `TRACE_INVOCATION_FIELDS` gains `executor`, `tier`, `role` — the elected identity was resolved on the invocation and then dropped by this whitelist, which is why every stamped dispatch said `invocation executor absent`. |
| `packages/app/src/services/workflow-trace-projection.ts:268-292` | `failover` derived from `result.ladder` rows with `kind === 'escalation'` as one `a→b, b→c` scalar (redacted + bounded 256), omitted when no row matches. The decision array itself stays out of the trace. |
| `packages/app/src/services/history-anatomy.ts:47-58` | `DispatchProvenance.failover?: string` — absent key ≠ empty string. |
| `packages/app/src/services/history-anatomy.ts:878-891` | `TraceAction.result` carries the projected `failover`; the dispatch row appends it only when present. |
| `packages/app/src/services/history-anatomy.ts:272-280` | `parseProvenance` reads `failover` back symmetrically so a cache-hit republish keeps it. |
| `packages/app/src/services/history-anatomy.ts:1104-1112` | Frontmatter renders `, failover: a→b` on the dispatch line. |
| `packages/app/src/services/history-anatomy.ts:1030-1052` | Probe identity becomes the exported tokens `PENDING_EXECUTOR` / `PENDING_MODEL` (replacing the `not available: probe did not receive …` prose), plus `NOT_APPLICABLE_HIT` and the legacy-prose list. |
| `packages/app/src/services/history-anatomy.ts:1155-1172` | `stampReport` substitutes every pending token and legacy prose form in the BODY with the stamped executor profile (falling back to the agent when the profile itself is absent) and model — a plain exact-token replace, no markdown parsing. |
| `packages/app/src/services/history-anatomy.ts:1174-1192` | `refreshReport` rewrites a placeholder/pending identity to `not-applicable: cache hit, no agent stage ran`; a real identity is kept verbatim (only `validatedAt`/disposition move). |
| `plugins/sp/skills/history-anatomy/references/operations.md:26-30` | Enrich rubric: copy the provenance executor/model **verbatim** — they may be pending tokens the stamp resolves. |
| `packages/app/tests/services/workflow-trace-projection.test.ts:331-380` | AC1/AC2 projection: identity fields survive, escalation rows become one scalar, no-escalation carries no key. |
| `packages/app/tests/services/history-anatomy-final-provenance.test.ts:190-285` | AC1–AC4 stamping: profile on the row + frontmatter round-trip, failover rendered/omitted/round-tripped, body tokens resolved, cache-hit placeholder rewrite vs real identity. |

No workflow-YAML change: `stamp` already receives `--trace`. The probe-time `-provenance.json` stays a pre-dispatch input, never re-read by the stamp.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/services/workflow-trace-projection.ts:143-160` adds `executor`, `tier`, `role` to `TRACE_INVOCATION_FIELDS`; `history-anatomy.ts:925-940` reads `inv.executor` into `DispatchProvenance.executor`, so `invocation executor absent` now appears only when the invocation genuinely lacked the field, and `refreshReport` keeps a real identity verbatim. |
| R2 | MET | `workflow-trace-projection.ts:268-292` derives one bounded scalar from `result.ladder` rows with `kind === 'escalation'` (`a→b, b→c`), omitting it when no row matches — no array projection. `history-anatomy.ts:47-58` declares `DispatchProvenance.failover?: string`, `:878-891` records it, `:1104-1112` renders it, `:272-280` parses it back, so the cache-hit republish keeps it. |
| R3 | MET | Probe identity is now `PENDING_EXECUTOR`/`PENDING_MODEL` (`history-anatomy.ts:1030-1052`), and `stampReport` (`:1155-1172`) replaces those tokens **and** the legacy prose in the body with the stamped executor profile (falling back to the agent when the profile itself is absent) and model — an exact-token replace, no markdown parsing, no re-reading of session JSONL. `plugins/sp/skills/history-anatomy/references/operations.md:26-30` instructs enrich to copy the values verbatim. |
| R4 | MET | `refreshReport` (`:1174-1192`) maps a pending/legacy placeholder identity to `not-applicable: cache hit, no agent stage ran` and leaves a real identity untouched; absent key ≠ empty string end-to-end. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `packages/app/tests/services/workflow-trace-projection.test.ts:331` (identity fields projected) and `history-anatomy-final-provenance.test.ts:215` (row + `executorProfile` in frontmatter, round-trips through `parseProvenance`). |
| AC2 | MET | test | `history-anatomy-final-provenance.test.ts:232` — `failover` recorded on the row, rendered in frontmatter, round-tripped; a dispatch without escalation carries no key and the rendered frontmatter contains no `failover:`. |
| AC3 | MET | test | `history-anatomy-final-provenance.test.ts:253` — a body carrying both pending tokens and the legacy prose stamps to the stamped executor/model with none of the four placeholder strings left. |
| AC4 | MET | test | `history-anatomy-final-provenance.test.ts:270` — legacy-placeholder identity republishes as `not-applicable: cache hit, no agent stage ran`; a real identity keeps the executor and only `validatedAt`/disposition change. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- `packages/app/src/services/workflow-trace-projection.ts:131-156`, `:212-284`
- `packages/app/src/services/history-anatomy.ts:47-56`, `:901-950`, `:1020-1021`, `:1126-1131`
- `packages/app/src/services/history-anatomy-cli.ts:236-257`; `agent-run-executor.ts:795-817`; `agent-run.ts:1687`
- `config/workflows/history-anatomy.yaml` (probe, refresh-provenance, stamp)
- `plugins/sp/skills/history-anatomy/references/operations.md:27`
- Related: 1326 (final provenance stamp), 1418 (failover that this makes visible)
- Concurrency: no other worktree, no `wip` task (checked 2026-11-20).

### History

- 2026-11-21T05:14:41.255Z todo → wip (system)
- 2026-11-21T05:14:57.858Z wip → testing (system)
- 2026-11-21T05:14:59.249Z testing → done (system)

