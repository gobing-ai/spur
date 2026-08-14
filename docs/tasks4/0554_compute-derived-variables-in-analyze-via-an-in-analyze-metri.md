---
template: feature-impl
schema_version: 1
name: "Compute derived variables in analyze via an in-analyze metric registry"
description: ""
status: done
type: task
profile: standard
feature_id: E5
parent_wbs: null
priority: P2
tags: []
dependencies: ["0553"]
ac_numbering: task-local
created_at: "2026-08-14T01:01:43.385Z"
updated_at: "2026-08-14T18:46:17.275Z"
---

## 0554. Compute derived variables in analyze via an in-analyze metric registry

### Background
Derived variables — phases, time decomposition, bottleneck ranking — are the layer that turns
imported rows into forensics. They do not exist: `analyze` ships the Q1–Q10 rollups, and omp's steps
5, 6, and 8 have no equivalent.

Feature E2 ticket 0490 settled the mechanism after a three-way spike: **Mechanism B, an in-analyze
metric registry** — derived variables computed inside `spur history analyze` at query time, not
materialized at import, not orchestrated through shell, not a sidecar. Recorded at MEDIUM confidence
as a spike recommendation.

0490 R3 also settled the artifact shape: derived variables land as an **additive optional block**
(`derived?: TimeDecomposition[]`) with **no version bump**, because `assertArtifactVersion` checks
equality rather than key absence — so an older artifact still validates and a new one does not break
old readers.

Phases depend on the todo arguments task 0553 retains; do not start before it lands.
### Requirements
- [x] **R1.** Implement the in-analyze metric registry (Mechanism B, 0490): derived variables computed
      during `spur history analyze` at query time. Not materialized at import, not shell-orchestrated,
      not a sidecar process. Measurable: `analyze` produces derived values in one invocation with no
      additional process or workflow step.
- [x] **R2.** Compute **phases** from the retained todo-writing tool arguments (task 0553). A source
      with no todo signal yields no phases for that session rather than fabricated ones. Measurable:
      a todo-bearing session yields named phases; a non-todo-bearing source yields none and is
      identifiable as unsupported rather than empty.
- [x] **R3.** Compute **time decomposition** — LLM versus tool versus idle — from
      `message.duration_ms` and `tool_call.started_at` / `completed_at` / `duration_ms`. Time that
      cannot be attributed is reported as unattributed rather than folded into idle. Measurable: the
      three buckets plus an explicit unattributed remainder sum to the session span.
- [x] **R4.** Compute **bottleneck ranking** over the decomposition, ordered by contribution.
      Measurable: a session with a known dominant cost ranks it first, and the ranking is
      reproducible across runs on the same artifact.
- [x] **R5.** Surface all of it as an additive optional block on the artifact with **no version
      bump** (0490 R3). An artifact produced before this change must still validate, and a new
      artifact must still be readable by a consumer that ignores the block. Measurable: old artifacts
      pass `assertArtifactVersion`; a reader unaware of `derived` is unaffected.
### Acceptance Criteria
Covers feature E4 scenario:

- **R3 — Analyze computes derived variables without a schema break**

```gherkin
Scenario: R3 — Analyze computes derived variables without a schema break
  Given imported sessions with retained primitives
  When analyze runs
  Then the artifact carries an additive optional derived block with phases, time decomposition, and bottleneck ranking
  And an artifact produced before this change still validates
```
### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

**Closed during refine (2026-08-13).**

- **Does the derived block need an artifact version bump?** No — `assertArtifactVersion`
  (`render-report.ts:34`) checks equality, not key absence, so an optional key leaves old artifacts
  valid. Recorded by 0490 R3 and re-verified against the tree.
- **Should this be a workflow action instead?** No. `host.registerAction`
  (`builtins.ts:44`) is a public seam and the schema leaves action `kind` unconstrained
  (`state-machine-workflow.schema.json:153-158`) — so it was *viable*, which is exactly why 0490 ran
  the comparison. It chose Mechanism B. Do not reopen.
- **How is "no phases" distinguished from "phases unsupported"?** An explicit `phaseSupport` field,
  frozen above. Deriving it from an empty array conflates the two.

**Deferred with owner.**

- **TTFT / generation split** — owner: feature E5 (batch-level). Deferred by 0491: the artifact
  carries no intra-call latency fields, so the split cannot be computed from it today.
- **Mechanism B is a MEDIUM-confidence spike recommendation (0490).** If implementation shows the
  registry cannot carry a metric the report needs, escalate to the operator rather than switching
  mechanism mid-task.
### Design
**Mechanism B is decided — implement it, do not re-spike (R1).** 0490 compared three options
(shell orchestration via `spur workflow`, a typed `history.derive` workflow action, and an in-analyze
registry) and chose the registry. The typed-action option was viable — `host.registerAction`
(`packages/app/src/workflow/builtins.ts:44`, `:64-78`) is a public seam and the workflow schema
leaves `kind` unconstrained — which is precisely why the comparison was worth running and why its
outcome should not be relitigated.

**Registry, not a pile of functions.** The point of a registry is that a new derived variable is a
registration rather than an edit to `analyze`'s body. Keep each metric independently testable against
a fixture artifact.

**Unattributed time is a bucket, not a rounding error (R3).** Folding unaccounted time into idle
makes idle look like the bottleneck. Report it as its own remainder so the decomposition is honest
about what it could not explain.

**No phases is a state, not an empty list (R2).** Three sources may have no todo signal at all
(task 0553 R3 determines which). "This source cannot produce phases" and "this session had no
phases" are different facts; a consumer that cannot tell them apart will read the first as the second.

**Additive block, no version bump (R5).** `assertArtifactVersion` checks equality, not key absence, so
adding an optional key does not break old artifacts — that is the reasoning 0490 R3 recorded. A
breaking artifact change remains the ADR-worthy event if one ever appears; this is not one.

**Confidence caveat.** 0490's recommendation is MEDIUM confidence from a spike. If implementation
reveals the registry cannot carry a metric the report needs, that is a finding to route back rather
than a licence to switch mechanisms mid-task.

**Not in scope:** rendering any of this (task 0555), and the TTFT/generation split (deferred by 0491 —
the artifact carries no intra-call latency fields).


Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Artifact type | `HistoryArtifact` | `packages/domain/src/analytics/artifact.ts:120` |
| Selector type | `ArtifactSelector` | `artifact.ts:17` |
| Warning type | `ArtifactWarning` | `artifact.ts:113` |
| Version guard (**unchanged**) | `assertArtifactVersion` | `packages/domain/src/analytics/render-report.ts:34` |
| New optional field | `derived?: DerivedVariables` on `HistoryArtifact` | additive, no version bump |
| New types | `DerivedVariables` `{ phases, timeDecomposition, bottlenecks }` | new module under `packages/domain/src/analytics/` |
| Phase entry | `Phase { name: string; startedAt: string; endedAt: string; source: 'todo' }` | — |
| Phase support state | `phaseSupport: 'supported' \| 'unsupported'` | distinguishes "no todo signal" from "no phases" (R2) |
| Decomposition | `TimeDecomposition { llmMs; toolMs; idleMs; unattributedMs; spanMs }` | four buckets + span (R3) |
| Timing inputs | `history_message.duration_ms` (schema-sql.ts:41) · `history_tool_call.duration_ms` (:69) | two distinct columns — do not conflate |
| Bottleneck entry | `Bottleneck { label: string; ms: number; share: number }` | ordered descending (R4) |
| Registry | `registerMetric(name, fn)` / `MetricRegistry` | in-analyze, not a workflow action |

**No new CLI surface.** No flag, no verb, no noun. `analyze` gains derived output; its signature and
options are unchanged.


- Do **not** bump the artifact version. `assertArtifactVersion` checks equality, not key absence
  (0490 R3), so an optional key is safe and a bump would break every existing artifact.
- Do **not** register a `history.derive` workflow action. That option was evaluated in 0490 and
  **not** chosen, even though `host.registerAction` (`packages/app/src/workflow/builtins.ts:44`)
  admits it and the schema leaves action `kind` unconstrained
  (`apps/cli/schemas/state-machine-workflow.schema.json:153-158`).
- Do **not** materialize derived values at import. Mechanism B is compute-at-query-time.
- Do **not** fold unattributed time into `idleMs` (R3) — it makes idle look like the bottleneck.
- Do **not** emit an empty `phases: []` for a source with no todo signal; use `phaseSupport` (R2).


**Assumes from 0553:** `args_raw` populated for allowlisted todo tools, `duration_ms` populated where
the source reports it (and NULL where it does not), plus the per-source todo-bearing verdict. This
task must **not** re-parse raw JSONL to obtain any of them — if a primitive is missing, that is a
0553 defect to route back, not to work around here.

**Leaves for dependents:** task **0555** renders `derived` and must not compute it. Any metric the
forensics report needs is added to the registry here, not derived inside a renderer.

#### Frozen names

Verified against the current tree 2026-08-13.

| Frozen | Value | Location |
| --- | --- | --- |
| Artifact type | `HistoryArtifact` | `packages/domain/src/analytics/artifact.ts:120` |
| Selector type | `ArtifactSelector` | `artifact.ts:17` |
| Warning type | `ArtifactWarning` | `artifact.ts:113` |
| Version guard (**unchanged**) | `assertArtifactVersion` | `packages/domain/src/analytics/render-report.ts:34` |
| New optional field | `derived?: DerivedVariables` on `HistoryArtifact` | additive, no version bump |
| New types | `DerivedVariables` `{ phases, timeDecomposition, bottlenecks }` | new module under `packages/domain/src/analytics/` |
| Phase entry | `Phase { name: string; startedAt: string; endedAt: string; source: 'todo' }` | — |
| Phase support state | `phaseSupport: 'supported' \| 'unsupported'` | distinguishes "no todo signal" from "no phases" (R2) |
| Decomposition | `TimeDecomposition { llmMs; toolMs; idleMs; unattributedMs; spanMs }` | four buckets + span (R3) |
| Bottleneck entry | `Bottleneck { label: string; ms: number; share: number }` | ordered descending (R4) |
| Registry | `registerMetric(name, fn)` / `MetricRegistry` | in-analyze, not a workflow action |

**No new CLI surface.** No flag, no verb, no noun. `analyze` gains derived output; its signature and
options are unchanged.

#### Anti-patterns — what not to implement

- Do **not** bump the artifact version. `assertArtifactVersion` checks equality, not key absence
  (0490 R3), so an optional key is safe and a bump would break every existing artifact.
- Do **not** register a `history.derive` workflow action. That option was evaluated in 0490 and
  **not** chosen, even though `host.registerAction` (`packages/app/src/workflow/builtins.ts:44`)
  admits it and the schema leaves action `kind` unconstrained
  (`apps/cli/schemas/state-machine-workflow.schema.json:153-158`).
- Do **not** materialize derived values at import. Mechanism B is compute-at-query-time.
- Do **not** fold unattributed time into `idleMs` (R3) — it makes idle look like the bottleneck.
- Do **not** emit an empty `phases: []` for a source with no todo signal; use `phaseSupport` (R2).

#### Cross-task contract

**Assumes from 0553:** `args_raw` populated for allowlisted todo tools, `duration_ms` populated where
the source reports it (and NULL where it does not), plus the per-source todo-bearing verdict. This
task must **not** re-parse raw JSONL to obtain any of them — if a primitive is missing, that is a
0553 defect to route back, not to work around here.

**Leaves for dependents:** task **0555** renders `derived` and must not compute it. Any metric the
forensics report needs is added to the registry here, not derived inside a renderer.
### Plan
- [x] Implement the in-analyze metric registry with independently testable metrics (R1)
- [x] Compute phases from the todo args retained by task 0553 (R2)
- [x] Report "source cannot produce phases" distinctly from "session had no phases" (R2)
- [x] Compute LLM/tool/idle time decomposition with an explicit unattributed remainder (R3)
- [x] Compute bottleneck ranking over the decomposition, reproducible on a fixed artifact (R4)
- [x] Surface as an additive optional `derived` block with no version bump (R5)
- [x] Add tests: old artifact still validates, unaware reader unaffected, buckets sum to span, no-todo source (R2-R5)
- [x] Update `docs/04_DESIGN.md` in the same commit (T3), then run `bun run autofix && bun run spur-check`
### Solution
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
### Testing
Independent re-audit 2026-08-14 (`/sp:dev-verifyall feature E5 --auto --next --force --focus all --fix all`). `--fix all` flipped 13 leftover `[ ]` boxes in Requirements + Plan. Artifact: `.spur/run/0554-verdict.json`.

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/derived.ts:329-333` (`createDefaultRegistry`); `packages/domain/src/analytics/derived.ts:344-349` (`computeDerived`) called from `packages/app/src/services/history-service.ts:284` inside `analyze()` — no extra process |
| R2 | MET | `packages/domain/src/analytics/derived.ts:166-187` (`parseTodoItems`); `packages/domain/src/analytics/derived.ts:196` (`extractPhases`); `packages/domain/src/analytics/forensic-query.ts:391-408` (`todoToolCalls`, `args_raw IS NOT NULL`). Zero-todo → `phaseSupport: 'unsupported'` (this run: derived.test.ts) |
| R3 | MET | `packages/domain/src/analytics/forensic-query.ts:357-369` (`sessionSpans`); `packages/domain/src/analytics/forensic-query.ts:373-384` (`sessionToolDurations`). Unmeasured remainder → `unattributedMs` + warning `derived-unattributed-time` (`packages/domain/src/analytics/derived.ts:356-364`) |
| R4 | MET | Default registry registers `bottlenecks` after `decomposition` (`packages/domain/src/analytics/derived.ts:329-333`). This run: fully-measured session ranks `idle`/`llm`/`tool` desc |
| R5 | MET | `packages/domain/src/analytics/artifact.ts:136` `derived?: DerivedVariables`; schema version stays 1 (this run: `artifact compatibility` test) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| Scenario: R3 — Analyze computes derived variables without a schema break | MET | test | `packages/domain/tests/analytics/derived.test.ts` this run: 11 pass / 0 fail (parseTodoItems, extractPhases, computeDerived via in-memory SQLite incl. 0012 `args_raw`, unmeasured → unattributed, zero-todo unsupported, v1 artifact without `derived` still validates) |

**SECUA Review**

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | E | `packages/domain/src/analytics/forensic-query.ts:405` | `todoToolCalls` is `LIMIT ?` (default 5000) — bounded, not a blocker |
| P4 | — | — | No P1–P3 findings; verify verdict PASS |

This run: `bun test packages/domain/tests/analytics/derived.test.ts` → 11 pass / 0 fail; `derived.ts` 93.33% funcs / 100.00% lines on that file.
### Review
**L3 review — P1–P4 findings:**

| # | Severity | File | Finding |
|---|----------|------|---------|
| 1 | P3 | packages/domain/src/analytics/forensic-query.ts:391 | `todoToolCalls` `LIMIT ?` default 5000 — a session set with more todo calls silently truncates phase replay; ceiling acceptable for forensics (0556 report labels data bounds), no pagination warranted until a real corpus exceeds it. |
| 2 | P3 | packages/domain/src/analytics/derived.ts:196 | `extractPhases` matched by todo *name* equality; agents that rewrite the same todo name with changed scope conflate phases. Matches importer allowlist semantics; revisit only if real sessions show name churn. |
| 3 | P4 | packages/domain/src/analytics/derived.ts:344 | `idleMs` attribution assumes llm/tool durations are non-overlapping; concurrent tool batches can double-count against wall-clock span, inflating `unattributedMs` (never fabricating the other way). Correct conservative direction. |
| 4 | P4 | packages/domain/src/analytics/artifact.ts:136 | `derived` is additive-optional; consumers must treat absent `derived` as "not computed", not "zero". Documented in 04_DESIGN.md §analyze. |

No P1/P2 findings. All four accepted as-is with rationale; none block done.
### References
- **Specification:** feature E2 § *Decisions so far* — "Mechanism B: in-analyze metric registry"
  (0490, MEDIUM confidence); "Artifact schema versioning — additive optional block, no version bump"
  (0490 R3)
- **Seam considered and not chosen (do not revisit):** `packages/app/src/workflow/builtins.ts:44`,
  `:64-78` (`host.registerAction`); `apps/cli/schemas/state-machine-workflow.schema.json:153-158`
  (unconstrained `kind`); builtin kinds in `packages/app/src/workflow/actions/`
- **Existing analyze surface:** `packages/domain/src/analytics/forensic-query.ts` (Q1–Q10),
  `apps/cli/src/commands/history.ts` (`analyze`)
- **Timing columns (R3):** `message.duration_ms`, `tool_call.started_at` / `completed_at` /
  `duration_ms`; per-source population verified by task 0553
- **Upstream dependency:** task 0553 (retained todo args; phases cannot be computed without them)
- **Downstream consumer:** task 0555 (`report --mode forensics` renders these)
- **Surface docs (T3, same commit):** `docs/04_DESIGN.md`
### History
- 2026-08-14T07:17:58.213Z todo → wip (system)
- 2026-08-14T16:22:46.440Z wip → testing (system)
- 2026-08-14T16:22:46.951Z testing → done (system)
