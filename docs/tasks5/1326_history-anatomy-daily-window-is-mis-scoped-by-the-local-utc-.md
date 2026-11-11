---
schema_version: 1
name: history-anatomy daily window is mis-scoped by the local UTC offset; validatedAt, executor, model and spurVersion provenance are false or missing
status: done
template: issue
created_at: 2026-11-10T16:34:29.083Z
updated_at: "2026-11-10T21:07:55.128Z"
feature_id: I81

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 8
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1326-verdict.json
---

## 1326. history-anatomy daily window is mis-scoped by the local UTC offset; validatedAt, executor, model and spurVersion provenance are false or missing

### Background

Source run: `spur workflow run config/workflows/history-anatomy.yaml --vars '{"mode":"daily","date":"2026-11-08","recompute":"true","agent":"auto"}'`
(run `43a5034e-9093-4838-ab4f-d93e5418601c`, 49 min, published
`docs/report/2026-11-08-history-anatomy.md`, structure gate PASS on the first pass, initial
validate FAIL → one correction pass → PASS). Every stage started on Antigravity/
`claude-opus-5-5-medium`, exhausted quota, and escalated to Grok/`grok-4.7`; the final
successful model work was therefore Grok, not Antigravity.

The published report is evidence of harness defects, not a truthful description of 2026-11-08.
The first defect is a correctness blocker: offset selectors and UTC selectors denoting the same
instants select different rows, and the same defect also reaches pairing and verified-outcome
planes. The final report must be regenerated after the fixes rather than retro-edited.

| ID | Severity | Defect | Current-tree verification |
| --- | --- | --- | --- |
| P1 | P1 | Text predicates mis-scope `history_message.ts`, `system_events.occurred_at`, and `runs.started_at` | offset SQL vs `julianday` SQL; source inspection |
| P2 | P2 | `validatedAt` is stamped at probe time, 48.5 min before the final validation PASS | provenance JSON vs validation artifact mtime |
| P3 | P2 | Provenance records the selector and drops the artifact version; it has no truthful per-stage executor/model record | `executor: auto`, `model`/`spurVersion: not available`; action trace |
| P4 | P2 | Enrich emitted a false numeric relation that the structure gate could not reject | initial validation FAIL + `correction-count` 1 |
| P5 | P3 | Workflow JSON mode suppresses the human escalation line even though all four dispatches escalate | zero `Escalating` lines vs four `agent.invoke.escalated` events |
| P6 | P3 | Action-start metadata drops a numeric-string timeout, printing `timeout=unbounded` while the real agent budget is 3,600,000 ms | `projectActionMetadata` vs heartbeat/action invocation |
| P7 | P4 | `spur workflow trace <8-char-prefix>` fails although progress lines print that prefix | reproduced; full UUID succeeds |

Measured windows on the current `.spur/spur.db` (same query batch, so no data-drift explanation):

| Window | agy | claude | codex | pi |
| --- | ---: | ---: | ---: | ---: |
| 2026-11-07 offset text predicates (shifted) | 659 | 2,063 | 1,165 | 5,816 |
| 2026-11-07 true local day (`julianday`) | 0 | 666 | 0 | 3,657 |
| 2026-11-08 offset text predicates (shifted) | 1 | 2,613 | 0 | 5,977 |
| 2026-11-08 true local day (`julianday`) | 1 | 3,279 | 0 | 5,513 |

The store also has 276,713 non-null `history_message.ts` values in seconds-only `…Z` form rather
than millisecond `….SSSZ`. Normalizing only the selector therefore cannot fix every row. All
65,936 `system_events.occurred_at` values are canonical millisecond UTC; three legacy `runs`
rows carry numeric `started_at` values and remain outside ISO windows as they are today.

**Refine corrections (2026-11-10)**

- **Renumber:** operator requested 1322 → 1326. No CLI renumber verb exists, so the filename and
  canonical heading alone were changed as a narrow exception; all spec edits remain CLI-gated.
- **Window design:** selector-only `toISOString()` normalization was rejected; mixed-precision
  stored timestamps require parsed-instant comparison on both sides.
- **Caller coverage:** added `pairings` and verified outcomes to R1-R3. The original one-seam
  design would have left those planes mis-scoped.
- **Actual executor:** corrected the source-run claim. All four dispatches escalated to Grok;
  provenance must describe each final invocation, not hardcode the initial Antigravity attempt.
- **Escalation:** existing structured events prove the ladder fired. Reuse that mechanism and
  remove JSON-mode suppression instead of adding a second 429 classifier.
- **Timeout:** the 3.6M ms agent budget is enforced. The defect is numeric-string metadata being
  dropped by the reporter, not an unverified execution budget.
- **Report outcome:** F1/F2 and `not comparable` must be re-derived, not forced away. The true
  current window still has one agy row and no codex row, and its source set still differs from
  the baseline's.
- **Arithmetic:** a prompt cannot prove model arithmetic. Require machine-checkable `calc:`
  assertions and reject contradictions in the deterministic structure gate; keep independent
  validation for artifact provenance.
- **Daily buckets:** `messageRollup`/`toolRollup` `DATE(ts)` buckets remain UTC. Local-day
  relabeling is a separate schema/design change and is out of scope; selector correctness is not.
- **Feature lifecycle:** I81 was reopened `verifying → active` because this P1 invalidates its
  local-day acceptance criterion. Feature verification resumes only after 1326 is done.
- **Concurrency:** `git worktree list` showed only this checkout and `spur task list --status wip
  --json` returned `[]` at audit time; no overlapping implementation owner was found.
- **Final audit — timeout format:** `formatDuration(3600000)` returns `60m 0s`, not `1h 0m 0s`;
  R9/AC6 were corrected to the actual formatter contract.
- **Final audit — durable escalation:** writing `ctx.output.error` alone would not prove presence
  in the consolidated record. R8 now requires an `AgentRunLog.append` at the existing ladder hop.
- **Final audit — arithmetic detection:** the gate now has a closed comparative-signal vocabulary
  and field-local requirement rule; implementers do not choose their own detection heuristic.
- **Final audit — data drift:** the measured counts are the 2026-11-10 audit baseline. E2E uses
  fresh direct SQL as its authority rather than failing blindly if another import changes the DB.
- **Final audit — prefix errors:** exact ids win; prefix lookup is bounded to 21 rows, with at most
  20 ids in the ambiguity diagnostic, so an empty/short broad prefix cannot flood the run record.

### Requirements

- [x] R1. `spur history analyze` must apply equivalent ISO instants identically across every data plane it reads: `history_message.ts`, `system_events.occurred_at`, and `runs.started_at`. For example, `2026-11-08T00:00:00.000-08:00` and `2026-11-08T08:00:00.000Z` must select the same rows. Selector text, selector digests, stored timestamps, and cache identity must remain unchanged; only predicate evaluation changes.
- [x] R2. Regression coverage must run the offset and `Z` forms through real query seams and prove identical row sets for messages/coverage, pairings, and verified outcomes. Fixtures must include millisecond `….SSSZ`, seconds-only `…Z`, rows immediately inside/outside both bounds, and NULL timestamps. The tests must fail on the current text predicates, including a seconds-only row at the inclusive upper-bound second that selector-only normalization would miss.
- [x] R3. A daily report's provenance `identity.date` and analyze `coverage[]` must describe its local calendar day. Existing `resolvePaths` 23 h/25 h DST bounds must feed real analyze queries and select corresponding 23 h/25 h fixture populations. On the audited 2026-11-10 database, 2026-11-08 direct-SQL coverage is agy 1, claude 3,279, pi 5,513; if a later import changes the DB before E2E, fresh direct SQL at run time is the authority and the drift is recorded. UTC `daily` bucket labels remain unchanged and are not part of this requirement.
- [x] R4. After R1-R3 and the provenance/report fixes land, regenerate only the 2026-11-08 report through the workflow with `recompute=true`; do not hand-edit it or re-import history. F1 (`coverage:history-analyze:codex-row-absent`), F2 (`telemetry:history-import:agy-import-watermark`), F4/F10, and the comparability verdict must be re-derived from the corrected artifacts. Stale shifted-window evidence must be withdrawn or re-anchored; a true current-window absence may remain only with new evidence and an honest causal label. No particular finding removal or comparability outcome is preordained.
- [x] R5. On the cache-miss/model-work path, `validatedAt` must come from the final validation artifact whose last line is exactly `Verdict: PASS`, after verdict normalization/rescue completes, and must be later than `generatedAt`. On the cache-hit path, only `validatedAt`, cache disposition, and the banner change; the original generated time, artifact evidence, and dispatch provenance remain intact. Both paths need focused tests.
- [x] R6. Published provenance must carry `spurVersion` from the analyze artifact and a `dispatches[]` entry for every successful `agent.run` action: `node`, `actionId`, canonical `agent`, resolved executor profile, `model`, and `timeoutMs` (a number or `unbounded`). The legacy top-level `executor`/`model` fields must describe the final PASS validation invocation, with executor profile retained separately. Values must come from the run's final action receipts, never from re-resolving `auto` or assuming the initial attempt. A genuinely absent executor/model must use a stated unavailable reason; a resolved value may not render `not available`.
- [x] R7. Enrich and correct must express every derived numeric comparison, delta, ratio, or sum used in an observation/inference as an adjacent machine-checkable `calc:` assertion. `spur history anatomy-check` must reject a false assertion and a derived comparison missing its required assertion before independent validation, using exact integer arithmetic and a documented relative tolerance for ratios. The observed inversion (`719,838,772` claimed larger than `725,707,709`) must be a failing fixture; the correct relation and gap `5,868,937` must pass. Independent model validation remains the artifact-ownership check; no second model gate is added.
- [x] R8. When the existing fallback ladder fires, its `Escalating: <from> failed with <signal>; retrying on <to>` line must reach the run record even when agent output is JSON. JSON stdout must remain machine-parseable and the existing `agent.invoke.escalated` event must remain unchanged. A hermetic two-attempt test must prove the line, final successful executor, valid JSON, and unchanged event. Do not invent another provider-429 classifier.
- [x] R9. `projectActionMetadata` must preserve finite positive numeric and numeric-string `timeoutMs` values so an `agent.run` action line prints the effective budget (`timeout=60m 0s` for 3,600,000 ms). Invalid values must not be rendered as valid budgets, and execution behavior must remain unchanged. A metadata test and a rendered-line test are required.
- [x] R10. `spur workflow trace` must resolve a unique run-id prefix to the same run as the full id, prefer an exact full-id match, reject an ambiguous prefix with candidate ids, and report absence distinctly. `--follow` and `--follow --output` must resolve the full id before polling or opening run records. Tests must cover unique, exact, ambiguous, absent, and log-follow behavior. Prefix lookup is capped at 21 rows and ambiguity diagnostics at 20 candidate ids to keep broad prefixes bounded.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Equivalent selectors return identical rows on every plane (req: R1, R2)
  Given a `HistoryService` fixture with millisecond and seconds-only UTC timestamps, boundary rows, and NULL timestamps
  And equivalent offset-form and Z-form selectors over the same instants
  When `packages/app/tests/services/history-service.test.ts` analyzes both selectors
  Then artifact `totals.messages`, `coverage[]`, pairings, and verified outcomes are identical
  And `packages/domain/tests/analytics/pairings.test.ts` and `packages/domain/tests/dao/run-dao.test.ts` prove the same instant semantics at their query seams
  And the seconds-only row at the inclusive upper-bound second is selected
  And these tests fail on the pre-fix text predicates

Scenario: AC2 — Daily coverage follows local and DST calendar days (req: R3)
  Given local-day bounds from `resolvePaths` for 2026-11-08, a 23 h spring-forward day, and a 25 h fall-back day in `America/Los_Angeles`
  When the analyze fixture runs each bound pair
  Then coverage for 2026-11-08 equals direct `julianday` SQL counts: agy 1, claude 3,279, pi 5,513 on the audited database
  And fresh direct SQL at E2E time supersedes those baseline counts if a later import caused drift
  And the DST fixtures select exactly 23 h and 25 h of rows rather than a fixed 24 h offset slice
  And existing 23 h/25 h bounds tests in `packages/app/tests/services/history-anatomy-cli.test.ts` remain green

Scenario: AC3 — The regenerated report re-derives evidence without window artifacts (req: R4)
  Given R1-R3 and the remaining report/provenance fixes are implemented and focused tests pass
  When `spur workflow run config/workflows/history-anatomy.yaml --vars '{"mode":"daily","date":"2026-11-08","recompute":"true","agent":"auto"}'` completes
  Then the new run's current artifact coverage equals fresh direct true-day SQL counts at run time
  And F1/F2/F4/F10 are withdrawn or re-anchored to corrected evidence rather than the shifted counts
  And comparability is decided by the corrected artifacts, including `not comparable` if source coverage still differs
  And the run id, report path, assertions, and direct-SQL comparison are saved in `.spur/run/1326-history-anatomy-e2e.json`

Scenario: AC4 — Provenance records validation time and actual dispatches (req: R5, R6)
  Given a forced-recompute run whose final PASS validation used Grok/`grok-4.7` after an Antigravity escalation
  When stamp consumes the final validation artifact and full trace JSON
  Then `validatedAt` equals the final PASS artifact mtime and is later than `generatedAt`
  And `spurVersion` equals the analyze artifact value
  And `dispatches[]` names each successful action's canonical agent, executor profile, model, action id, node, and numeric-or-unbounded timeout
  And top-level executor/model name the final PASS validation invocation, not `auto` or the failed initial attempt
  And a cache-hit refresh preserves the original dispatch evidence and changes only R5's allowed fields

Scenario: AC5 — False arithmetic fails the deterministic gate (req: R7)
  Given a candidate containing `calc: 719838772 > 725707709`
  When `checkReportStructure` evaluates it in `packages/app/tests/services/history-anatomy.test.ts`
  Then it returns an arithmetic-contradiction finding before independent validation
  And `calc: 719838772 < 725707709` plus `calc: 725707709 - 719838772 = 5868937` passes
  And a derived comparison lacking its required `calc:` assertion fails with an arithmetic-evidence-missing finding

Scenario: AC6 — Escalation and effective timeout are visible in JSON workflow records (req: R8, R9)
  Given a hermetic first attempt that exhausts resources and a second attempt that succeeds
  When agent output is JSON
  Then stdout remains parseable JSON and the run record carries the existing `Escalating:` line with both executors
  And exactly one unchanged `agent.invoke.escalated` event is emitted
  And `projectActionMetadata('agent.run', { timeoutMs: '3600000' })` preserves 3600000
  And the rendered action line says `timeout=60m 0s`, never `timeout=unbounded`

Scenario: AC7 — Trace resolves prefixes safely (req: R10)
  Given one run whose id starts with a unique prefix and another run sharing an ambiguous prefix
  When `spur workflow trace <unique-prefix>` runs
  Then it resolves the same timeline as the full id and an exact full id takes precedence
  And an ambiguous prefix fails with up to 20 candidate ids while an absent prefix reports `Run not found`
  And `--follow --output` reads the full resolved run's durable record, not a prefix-named missing file
```

### Q&A

- **One delegation unit:** keep R1-R10 together as “make history-anatomy evidence and its run
  provenance truthful.” The shared final regeneration is the acceptance receipt for all groups;
  splitting would duplicate the 49-minute model run and leave cross-plane assertions without a
  home. The implementation is multi-package but has one observable deliverable.
- **I81 lifecycle:** reopened to `active` during this refine. The P1 violates I81 R1-R3, so I81
  must not return to `verifying` until 1326 supplies corrected artifacts and verification.
- **Final executor is evidence-dependent:** the source run's final successful executor/model was
  Grok/`grok-4.7`. Future runs may resolve differently or escalate differently. The contract must
  assert equality with the trace, never a hardcoded provider.
- **Daily buckets:** retain SQLite `DATE(ts)` UTC bucket semantics. This task fixes row selection,
  not the separate question of presenting local-day buckets.
- **Regeneration:** only 2026-11-08 is regenerated, after focused tests pass. No import, other
  report date, or retro-edit is authorized. `agent: auto` reproduces the source selector; the
  implementer may use a reachable explicit executor if quota requires it, because AC compares
  provenance to the actual trace.
- **Data drift:** the measured coverage counts are the 2026-11-10 audit baseline. E2E recomputes
  direct SQL at run time; any later import is recorded as drift, never forced back to the baseline.
- **Testing budget:** hermetic regression tests come first for each change. The live workflow is
  the sole E2E and runs once at the end; it may incur model cost and take roughly the source
  run's 49 minutes. Save one JSON receipt with all assertions.
- **Dependencies:** no `dependencies[]` are needed. Existing I81 implementation tasks are done;
  R4 is an ordered step inside this task, not a second WBS. No active worktree or `wip` owner was
  present during refinement.
- **Environment:** source-local Spur and `apps/cli/package.json` both report 0.4.30, matching the
  source artifact. Use the source-local CLI for implementation and real-data assertions; link and
  rebuild the bundle after CLI changes per AGENTS.md.
- **Feature altitude:** `ac_altitude: task-local` is intentional. These regression and operational
  scenarios are not new feature ship criteria, although they repair evidence for I81.

### Design

#### Frozen implementation contract

**R1-R3 — instant selection.** Extend the existing internal
`packages/domain/src/analytics/selector-time-range.ts` `buildTimeRangeClauses` with
`grain: 'instant'`. It emits inclusive `julianday(<column>) >= julianday(?)` and
`julianday(<column>) <= julianday(?)` while preserving raw parameters. Use it in
`buildMessageWhereClauses` and `pairings.eventWindow`. In `RunDao.traceRows`, use the same parsed
comparison for `started_at >= ?3`; keep keyset `before` comparisons unchanged. In
`deriveVerifiedOutcome`, compare the upper bound with `Date.parse`, not text. NULL/unparseable
stored values stay excluded. Do not normalize selector text or change `selectorDigest`.

Test-first at three layers: helper SQL shape in `selector-time-range.test.ts`; real message and
event rows in `history-service.test.ts` / `pairings.test.ts`; run rows in `run-dao.test.ts` and
`verified-outcome.test.ts`. Include mixed timestamp precision and both inclusive bounds. Update
`message-where.test.ts` and the current-query assertion in `history-parity-evidence.test.ts` from
raw text predicates to parsed predicates; the frozen 1309 evidence and source digests stay
untouched. Retain UTC `DATE(ts)` buckets. A real-data check compares both selector forms and
`julianday` counts for 2026-11-07/08, and records query timing so the existing bounded-analyze
performance requirement is not regressed.

**R5-R6 — final provenance.** Add additive `CacheProvenance.dispatches[]` entries
`{ node, actionId, agent, executor, model, timeoutMs }`. Executor/model are strings; an absent
value uses `not available: invocation executor absent` or `not available: invocation model absent`.
`timeoutMs` is a positive number or the literal `unbounded`. In the workflow's `stamp` state,
first write `.spur/run/$__runId-trace.json` with `spur workflow trace "$__runId" --json`, then
call `spur history anatomy-stamp` with new `--validation <path>` and `--trace <path>` inputs.
A pure/core finalizer must:

1. Require the validation artifact's last line to equal `Verdict: PASS`, and set `validatedAt`
   from that file's mtime after normalization/rescue. Do not use probe time or candidate mtime.
2. Read successful `agent.run` events and their final `invocation`, preserving each `node`,
   `actionId`, canonical `agent`, executor profile (`invocation.executor`), `model`, and
   `timeoutMs`. Repeated states remain distinct actions.
3. Set top-level `executor` and `model` from the latest successful validation invocation; add
   `executorProfile` for its profile. `spurVersion` comes from the analyze JSON, with an explicit
   unavailable-reason only when the artifact lacks it.
4. Render/parse `dispatches[]` through the existing flat-list YAML representation. Cache-hit
   refresh preserves it. A miss that performed model work but lacks a final validation receipt
   fails closed instead of stamping `auto` or silent `not available`.

`cache-probe` remains early and need not know the future executor. Stop passing `--executor
"$agent"`; the selector is not provenance. Existing `anatomy-stamp` behavior without the two new
inputs remains available for unit/backward compatibility, while this workflow always supplies
both. Update `docs/design/history-anatomy.md` and the history CLI reference for the additive
flags/frontmatter.

**R7 — deterministic arithmetic.** Extend `report-contract.md` and the `operations.md`
enrich/correct rubric with one grammar, then enforce it in `checkReportStructure`:

- `calc: <number> <+|-> [number ...] = <number>` (left-associative sums/deltas)
- `calc: <number> * <number> = <number>` and `calc: <number> / <number> = <number>`
- `calc: <number> <|<=|>|>= <number>` (ordering claims)

No `eval`, parentheses, unit suffixes, or arbitrary JavaScript. Integers are exact; ratio results
use relative tolerance `1e-9`. Every derived comparison/delta/ratio/sum in an observation or
inference needs an adjacent `calc:` line in the same field. Detection is deterministic: a field
is derived when it contains `%` or one of `larger|smaller|higher|lower|more than|less than|above|below|exceeds|dominates|gap|delta|difference|sum|sums|sum of|share|ratio|mean|average` (case-insensitive); raw artifact fields such as `totals.inputTokens` alone do not trigger it. Return `arithmetic-contradiction` for a false assertion and `arithmetic-evidence-missing` when such a field lacks `calc:`. The validator still checks that
operands belong to the cited artifact. Do not add a model stage or silently correct the report.

**R8 — existing escalation visibility.** In `agent-run-executor.ts`, append the existing
`Escalating:` line through `AgentRunLog.append('stderr', …)` at the ladder hop so it reaches the
consolidated durable record even under `jsonOutput`; keep the existing human stderr diagnostic
and `agent.invoke.escalated` semantics unchanged. Test at the AgentService seam with two mocked
attempts: first resource exhaustion, second success, JSON parse succeeds, the durable run log
contains one line naming both executors, and one event is observed. Do not rely on
`ctx.output.error` alone as proof of persistence, and add no new classifier/event.

**R9 — timeout metadata.** In `projectActionMetadata`, accept finite positive numbers and numeric
strings, truncating to integer milliseconds exactly as `command-gate` does. Reject/omit other
values without changing `agent.run` normalization or execution. Add focused metadata and
`renderStepLine` assertions (`60m 0s` for one hour).

**R10 — safe prefix resolution.** Add `RunDao.traceRowsByIdPrefix(prefix)` using
`substr(id, 1, length(?1)) = ?1 LIMIT 21` (no wildcard semantics). Add
`WorkflowInspectOps.resolveTraceRunId`: exact lookup first, then a unique prefix; zero matches
throws `Run not found: <input>`, multiple matches throw `Ambiguous run id prefix: <input>;
candidates: <ids…>` with at most 20 ids. Expose it through `WorkflowAppService.resolveRunId`,
call it before the existing worker-liveness probe in `trace`, and resolve in the CLI before
`followTrace` or `followRunLog`. Full ids continue through the same trace path and tests.

#### Primary files

- Domain: `selector-time-range.ts`, `message-where.ts`, `pairings.ts`, `run-dao.ts` plus their
  focused tests and `history-parity-evidence.test.ts`.
- App: `history-anatomy.ts`, `history-anatomy-cli.ts`, `verified-outcome.ts`,
  `agent-run-executor.ts`, `workflow/observability.ts`, `workflow-inspect-ops.ts`,
  `workflow-service.ts` plus focused tests.
- CLI: `apps/cli/src/commands/workflow/trace.ts` and `apps/cli/tests/commands/workflow/trace.test.ts`.
- Workflow/skill: `config/workflows/history-anatomy.yaml`,
  `plugins/sp/skills/history-anatomy/references/{operations.md,report-contract.md}`.
- Docs: `docs/design/history-anatomy.md`, the owning history CLI design reference.

#### Anti-patterns and non-goals

- No selector-only normalization, timestamp migration/backfill, localizing UTC buckets, generic
  SQL framework, new public `spur` noun/verb, second model validator, new 429 classifier, new
  escalation event, or hardcoded executor expectation.
- No initial-attempt provenance, silent unavailable defaults, forced F1/F2 removal, forced
  comparability verdict, report hand-editing, or history re-import.
- No prefix semantics added to `continue`, `cancel`, or `progress`; this task owns `trace` and its
  two follow modes only.
- `mutationPolicy`: source/test/config/doc changes plus generated run artifacts and the one named
  report. Execution budget: 8 hours of implementation plus one bounded live E2E; preserve partial
  artifacts at failure and do not launch a replacement run.

### Plan

1. **R1/R2 red tests first.** Add offset-vs-UTC equivalence and mixed-precision fixtures to
   `selector-time-range.test.ts`, `history-service.test.ts`, `pairings.test.ts`, `run-dao.test.ts`,
   and `verified-outcome.test.ts`. Confirm failure on current predicates, especially the
   seconds-only inclusive-upper-bound row.
2. **Implement instant selection.** Add `grain: 'instant'`, route message/event predicates through
   it, update `RunDao.traceRows` and the verified-outcome upper-bound comparison, and update the
   current-query parity assertion without rewriting the frozen 1309 artifact.
3. **Prove R1-R3.** Run the focused domain/app tests. Use `resolvePaths` bounds in the 23 h/25 h
   analyze fixtures. Against the real DB, compare offset/Z/julianday counts for 2026-11-07/08 and
   record timing; expected 2026-11-08 coverage is agy 1, claude 3,279, pi 5,513.
4. **Write provenance red tests.** Cover final-PASS mtime, per-stage final invocation fields,
   repeated validate actions, artifact `spurVersion`, missing-receipt refusal, and cache-hit
   preservation in `history-anatomy.test.ts` and `history-anatomy-cli.test.ts`.
5. **Implement final provenance.** Add `dispatches[]`, stamp `--validation`/`--trace`, the trace
   snapshot in `history-anatomy.yaml`, and final-PASS validation. Stop passing the selector as the
   executor. Update the owning history-anatomy design/CLI references.
6. **Write arithmetic red tests, then implement.** Pin the observed inversion, valid gap/ratio,
   missing-`calc:` rejection, the closed derived-signal vocabulary, and tolerance. Implement the
   bounded `calc:` grammar in `checkReportStructure`; update the enrich/correct/report contracts
   without another model gate.
7. **Write observability red tests, then implement.** Pin JSON-mode durable-log escalation output
   and one unchanged event, then append through `AgentRunLog`. Pin numeric-string metadata and
   the rendered `60m 0s` budget, then fix `projectActionMetadata` without touching execution.
8. **Write trace-prefix red tests, then implement.** Cover exact, unique, ambiguous, absent, and
   full-id log-follow paths. Add the DAO prefix query and app resolver, then resolve before the
   worker probe and before CLI follow/log reads.
9. **Run the focused set and synchronize.** Run each owning workspace's named tests, Biome and
   typecheck on touched surfaces, and the workflow/skill structure tests. Link the source CLI and
   run `bun run --filter @gobing-ai/spur build:bundle` after CLI changes. Inspect the diff against
   every R-item and update only owning docs.
10. **Run the single E2E.** Execute the R4 workflow for 2026-11-08 with `recompute=true`. Do not
    re-import or hand-edit the report. Assert true-day coverage against fresh direct SQL, F1/F2/F4/F10
    evidence, comparability, final-PASS mtime, per-dispatch provenance, arithmetic gate, durable
    escalation and `60m 0s` timeout lines, and unique-prefix trace. Save the run id, report path,
    commands, direct-SQL baseline, and assertion results in `.spur/run/1326-history-anatomy-e2e.json`.
11. **Close with the task gate.** Run `bun run spur-check` once, inspect `git status --short`,
    review only the intended paths, and record Solution/Testing/Review through the normal
    pipeline. If E2E fails, preserve its run id and partial artifacts; fix before any rerun.

### Root Cause

**P1 — mixed-representation predicates (verified).** `buildMessageWhereClauses` pushes raw bounds
into `m.ts >= ?` / `<= ?`, `pairings.eventWindow` does the same for `occurred_at`, and
`RunDao.traceRows` / `deriveVerifiedOutcome` compare `started_at` as text. SQLite TEXT collation
does not order offset forms by instant. Seconds-only and millisecond UTC forms also compare
inconsistently at an inclusive bound. This is why 2026-11-07's shifted predicate returns agy 659,
claude 2,063, codex 1,165, pi 5,816 while the true local day has claude 666 and pi 3,657 only.
Parsed comparison on both sides is required; normalizing only the parameter leaves the
seconds-only upper-bound defect alive.

**P2 — validation time captured before validation (verified).** `buildProvenance` assigns both
`generatedAt` and `validatedAt` from the probe's `nowIso`. The published values are
`2026-11-10T07:16:14.279Z`; the final validation PASS artifact was written at `08:04:43Z`.

**P3 — provenance inputs describe selection, not execution (verified).** The workflow passes
`--executor "$agent"`, which is `auto`, and supplies neither model nor version although the
analyze artifact contains `spurVersion: 0.4.30`. Existing action receipts contain the final
invocation: every source-run stage attempted Antigravity first and completed with Grok/`grok-4.7`.
A single initial-executor field would be just as false as `auto`; per-action receipts are the
correct granularity.

**P4 — structure gate has no arithmetic contract (verified).** The initial validation rejected
`positive:history-analyze:cache-read-covers-recorded-input` for calling 719,838,772 the larger
figure against 725,707,709. `checkReportStructure` verifies shape and anchors, not arithmetic.
The final validation file is overwritten by the later PASS, so the initial FAIL evidence is the
run log and `correction-count` 1.

**P5 — JSON mode hides the real ladder (verified).** `agent-run-executor.ts` wraps the human
`Escalating:` write in `if (!jsonOutput)`. The database already carries four
`agent.invoke.escalated` events for this run, and action invocations prove the final Grok
attempts. The defect is visibility, not missing recovery or missing structured events. Because
`ctx.output.error` is not itself a durable-record assertion, the fix must append through the
existing `AgentRunLog` at the same ladder hop.

**P6 — numeric strings disappear from metadata (verified).** `${vars.stepTimeoutMs}` resolves to
string `3600000`. `projectActionMetadata` accepts only a number and prints `timeout=unbounded`,
while `normalizeAgentInvocation` accepts the same string and the subprocess heartbeat reports the
real 3,600,000 ms budget. `command-gate` already documents and implements the numeric-string
contract to mirror.

**P7 — exact-only run lookup (verified).** `traceRun` calls `RunDao.traceRowById` with the input
verbatim, so `43a5034e` fails while the full UUID succeeds. The misleading prefix comes from
`step-reporter.ts` progress lines; the async launch itself prints a full-id monitor command.
Prefix resolution must be unique and must precede both liveness checks and record-path reads.

### Solution

<!-- body-only: Solution section -->

**R1/R2 — instant selection (one seam, three planes).** `packages/domain/src/analytics/selector-time-range.ts:9-31` adds `grain: 'instant'` (`julianday(col) >= julianday(?)`) plus a `COLUMN_SQL` map so only the instant grain transforms the column. Consumers:
`packages/domain/src/analytics/message-where.ts:20-30` routes `since`/`until` through it (message/coverage/totals plane);
`packages/domain/src/analytics/pairings.ts:377-390` (`eventWindow`) does the same for `system_events.occurred_at` (pairings + escalations);
`packages/domain/src/dao/run-dao.ts:115` compares `julianday(started_at) >= julianday(?3)` (verified-outcome plane) while the keyset `before` cursor stays untouched;
`packages/app/src/services/verified-outcome.ts:113-118` replaces the in-memory TEXT `until` comparison with `Date.parse`, dropping unparseable/NULL starts exactly as the SQL predicate does.
Selector text, artifact shape and `selectorDigest` are unchanged, so no cache comparison shifts; `daily` `DATE(ts)` buckets stay UTC.

**R5/R6 — final-receipt provenance.** `packages/app/src/services/history-anatomy.ts`:
`DispatchProvenance` + `CacheProvenance.dispatches[]`/`executorProfile` (59-77),
`applyFinalProvenance` (700-780) — requires the validation artifact's last line to be exactly `Verdict: PASS`, takes `validatedAt` from its mtime, collects successful `agent.run` actions from `spur workflow trace --json` (deduped by `actionId`, failed attempts excluded), states a reason for an absent executor/model, and fails closed when the receipt is missing;
`buildProvenance` now reads `spurVersion` from the analyze artifact and stamps `executor`/`model` as a stated probe-time absence (the selector is never provenance) (764-786);
`renderProvenanceFrontmatter`/`parseProvenance` round-trip `dispatches[]` as flat list items.
`packages/app/src/services/history-anatomy-cli.ts:236-258` adds `--validation`/`--trace` to `anatomy-stamp` (both optional, so the pre-1326 stamp surface still works).
`config/workflows/history-anatomy.yaml`: `cache-probe` no longer passes `--executor "$agent"`; `stamp` writes `.spur/run/$__runId-trace.json` via `spur workflow trace "$__runId" --json`, then stamps with `--validation` and `--trace`.

**R7 — deterministic arithmetic.** `packages/app/src/services/history-anatomy.ts:441-520` adds `evaluateCalcAssertion` (frozen grammar: left-associative `+`/`-` chains, `*`, `/`, and `<|<=|>|>=`; exact integers, `1e-9` relative tolerance for ratios; no `eval`, no parentheses, no units) and `auditArithmetic`, invoked from `checkReportStructure` over the findings bodies. Codes: `arithmetic-contradiction`, `arithmetic-invalid-assertion`, `arithmetic-evidence-missing`. Derived-field detection is the closed vocabulary from the contract (`%` or one of larger/smaller/gap/share/ratio/…), so a raw artifact field name alone is not policed. Contract and rubric updated in `plugins/sp/skills/history-anatomy/references/report-contract.md` (§ Arithmetic assertions) and `operations.md` (enrich item 3, validate rubric).

**R8 — escalation visibility.** `packages/app/src/services/agent-run-executor.ts:828-838` appends the existing `Escalating: <from> … retrying on <to>` line through `AgentRunLog.append('stderr', …)` at the ladder hop, so JSON-mode runs record it; the human stderr write stays behind `!jsonOutput` and the `agent.invoke.escalated` event is unchanged (no new classifier).

**R9 — effective budget.** `packages/app/src/workflow/observability.ts:381-404` adds `positiveMs`, which accepts finite positive numbers and numeric strings and truncates to integer milliseconds (mirroring `command-gate`), omitting anything else; `projectActionMetadata` uses it, so `stepTimeoutMs: "3600000"` renders `timeout=60m 0s`.

**R10 — safe prefix resolution.** `packages/domain/src/dao/run-dao.ts:143-153` adds `traceRowsByIdPrefix` (`substr` comparison, `LIMIT 21`, no `LIKE` wildcards);
`packages/app/src/services/workflow-inspect-ops.ts:290-301` adds `resolveRunId` (exact → unique prefix → `Ambiguous run id prefix: … candidates:` capped at 20 → `Run not found: …`);
`packages/app/src/services/workflow-service.ts` exposes it and calls it in `trace()` only on the exact-miss path, so a followed run's poll still costs ONE row read (1319 R1);
`apps/cli/src/commands/workflow/trace.ts:455-470` resolves once, before `--follow`/`--follow --output` open a record path or poll loop.

**Docs (T3, same change):** `docs/design/history-cli-contracts.md` (analyze instant semantics; stamp flags; `dispatches[]`), `docs/design/history-anatomy.md` (final-receipt provenance block, stamp step in the workflow shape).

**Review follow-up — sargability (found in D1 review, fixed).** The parsed predicate alone is not
sargable: `EXPLAIN QUERY PLAN` showed `SCAN m USING COVERING INDEX idx_history_message_ts`, and a
bounded daily analyze of 2026-11-08 measured **25,736 ms / 20,588 ms** (the pre-fix run: 1,241 ms /
733 ms). `packages/domain/src/analytics/selector-time-range.ts:47-80` therefore emits a sargable
TEXT range on the raw column, widened by one second on each side, ahead of the exact `julianday`
comparison — `SEARCH m USING COVERING INDEX idx_history_message_ts (ts>? AND ts<?)`. The same file
degrades to the exact predicate alone when a bound is not a parseable instant, so correctness never
depends on the widening. Re-measured after the fix: **0.49 s** with byte-identical coverage
(`agy 1/1, claude 3279/4, pi 5513/13`).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/domain/src/analytics/selector-time-range.ts:15` grain instant uses julianday on both sides and `packages/domain/src/analytics/selector-time-range.ts:60-73` keeps raw bounds. `packages/domain/src/analytics/message-where.ts:25-28` routes history_message.ts. `packages/domain/src/analytics/pairings.ts:386-389` routes system_events occurred_at. `packages/domain/src/dao/run-dao.ts:115` uses julianday on runs.started_at. `packages/app/src/services/verified-outcome.ts:118-120` compares the upper bound with Date.parse. This run: offset and Z analyze both returned agy 1, claude 3279, pi 5513. |
| R2 | MET | `packages/app/tests/services/history-service.test.ts:233` R1 offset-form and Z-form selectors analyze the same rows, including the seconds-only upper-bound row. `packages/domain/tests/analytics/pairings.test.ts:539`, `packages/domain/tests/dao/run-dao.test.ts:333`, `packages/app/tests/services/verified-outcome.test.ts:155`, `packages/domain/tests/analytics/message-where.test.ts:29-33`, `packages/domain/tests/analytics/selector-time-range.test.ts:51`, `packages/domain/tests/analytics/history-parity-evidence.test.ts:1008-1011`. This run: those files exited 0 (domain batch 11 pass, message-where 5 pass, parity fixture 1 pass, app R1/R3 2 pass, verified-outcome 1 pass). |
| R3 | MET | `packages/app/src/services/history-anatomy.ts:717-719` feeds dayBounds from resolvePaths into the analyze window. `packages/app/tests/services/history-service.test.ts:287` selects 23 h and 25 h populations. `packages/app/tests/services/history-anatomy-cli.test.ts:443` spring-forward is 23 h and `packages/app/tests/services/history-anatomy-cli.test.ts:455` fall-back is 25 h; both exited 0 this run. Live `bun apps/cli/src/index.ts history analyze --since 2026-11-08T00:00:00.000-08:00 --until 2026-11-08T23:59:59.999-08:00 --json` exited 0 with agy 1, claude 3279, pi 5513, equal to direct julianday SQL and to the Z-form selector. |
| R4 | MET | Run 05d14930-17c2-4089-b3da-cff6b318b3c1 republished the 2026-11-08 report. `.spur` `run/1326-history-anatomy-e2e.json` line 11 records equal direct SQL and artifact coverage. `docs/report` `2026-11-08-history-anatomy.md` line 95 comparability verdict comparable. `docs/report` `2026-11-08-history-anatomy.md` line 259 re-anchors coverage:history-analyze:codex-row-absent to both windows omitting codex. `docs/report` `2026-11-08-history-anatomy.md` line 273 re-anchors telemetry:history-import:agy-import-watermark to one zero-usage agy message. This run's report grep found no shifted counts 2613, 5977, or 1165. Fresh analyze this run still matches SQL. |
| R5 | MET | `packages/app/src/services/history-anatomy.ts:873-876` sets validatedAt from the validation artifact mtime only when the last line is Verdict: PASS. `packages/app/tests/services/history-anatomy-final-provenance.test.ts:91` and `packages/app/tests/services/history-anatomy-final-provenance.test.ts:198` (cache hit keeps generatedAt and dispatches) exited 0 this run, 7 pass in that file. Live frontmatter `docs/report` `2026-11-08-history-anatomy.md` line 15 generatedAt 2026-11-10T19:13:43.180Z is earlier than line 16 validatedAt 2026-11-10T19:40:25.437Z. |
| R6 | MET | `packages/app/src/services/history-anatomy.ts:893-917` writes one dispatches row per successful agent.run and sets top-level executor and model from the final validate invocation, with executorProfile separate. `packages/app/src/services/history-anatomy.ts:980-985` reads spurVersion from the analyze artifact. `config/workflows/history-anatomy.yaml:147-156` drops the selector executor. `config/workflows/history-anatomy.yaml:333-344` writes the trace then stamps --validation and --trace. `packages/app/src/services/history-anatomy-cli.ts:249-250` applies both receipts. Provenance tests exited 0. Live frontmatter `docs/report` `2026-11-08-history-anatomy.md` line 26-38: executor grok, model grok-4.7, two dispatches, timeoutMs 3600000, no auto. `.spur` `run/1326-history-anatomy-e2e.json` line 32 spurVersion 0.4.30. |
| R7 | MET | `packages/app/src/services/history-anatomy.ts:355-398` evaluates calc assertions with exact integer relations and relative tolerance 1e-9 for ratios. `packages/app/src/services/history-anatomy.ts:409-438` requires an adjacent calc assertion on derived observation and inference fields. `packages/app/src/services/history-anatomy.ts:530` runs that audit inside checkReportStructure before independent validation. `packages/app/tests/services/history-anatomy.test.ts:1125` six cases exited 0 this run, including the inversion 719838772 > 725707709 as arithmetic-contradiction and the gap 5868937 as pass. |
| R8 | MET | `packages/app/src/services/agent-run-executor.ts:832-836` appends the Escalating line through AgentRunLog while JSON mode keeps stderr quiet, and `packages/app/src/services/agent-run-executor.ts:843` still emits agent.invoke.escalated. `packages/app/tests/services/agent-service.test.ts:3971` R8 JSON mode keeps the Escalating line in the durable run record exited 0 this run. The live E2E had no resource exhaustion, so the hermetic test is the proof. |
| R9 | MET | `packages/app/src/workflow/observability.ts:384-406` positiveMs keeps finite positive numeric strings and omits invalid budgets. `packages/app/tests/workflow/observability.test.ts:261` and `packages/app/tests/workflow/step-reporter.test.ts:94` exited 0 this run: 3600000 renders timeout=60m 0s. `.spur` `run/1326-history-anatomy-e2e.json` line 48 records the live action line timeout=60m 0s. |
| R10 | MET | `packages/domain/src/dao/run-dao.ts:145-149` prefix lookup uses substr and LIMIT 21. `packages/app/src/services/workflow-inspect-ops.ts:292-299` prefers an exact id, then a unique prefix, and caps candidates at 20. `packages/app/src/services/workflow-service.ts:571-575` resolves only on an exact miss. `apps/cli/src/commands/workflow/trace.ts:502-513` resolves before follow. `packages/app/tests/services/workflow-inspect-ops.test.ts:106` and `apps/cli/tests/commands/workflow/trace.test.ts:1053` four cases exited 0 this run. Live `bun apps/cli/src/index.ts workflow trace 05d14930 --json` exited 0 and returned runId 05d14930-17c2-4089-b3da-cff6b318b3c1 status done. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — Equivalent selectors return identical rows on every plane (req: R1, R2) | MET | test | `packages/app/tests/services/history-service.test.ts:233` totals, coverage, pairings, and verified outcomes match across offset and Z forms and keep the seconds-only upper-bound row. `packages/domain/tests/analytics/pairings.test.ts:539` and `packages/domain/tests/dao/run-dao.test.ts:333` cover the other planes. This run exited 0. |
| Scenario: AC2 — Daily coverage follows local and DST calendar days (req: R3) | MET | test | `packages/app/tests/services/history-service.test.ts:287` and `packages/app/tests/services/history-anatomy-cli.test.ts:443` plus `packages/app/tests/services/history-anatomy-cli.test.ts:455` exited 0. Command this run: `bun apps/cli/src/index.ts history analyze --since 2026-11-08T00:00:00.000-08:00 --until 2026-11-08T23:59:59.999-08:00 --json` exit 0 equals sqlite julianday counts agy 1, claude 3279, pi 5513, and the Z-form selector returns the same counts. |
| Scenario: AC3 — The regenerated report re-derives evidence without window artifacts (req: R4) | MET | command | Workflow run 05d14930-17c2-4089-b3da-cff6b318b3c1 is the regeneration. This run re-checked it: analyze and direct SQL both agy 1, claude 3279, pi 5513. `.spur` `run/1326-history-anatomy-e2e.json` line 3 names the run and line 40 the comparability verdict. `docs/report` `2026-11-08-history-anatomy.md` line 95, line 259, and line 273 re-anchor F1 and F2. Shifted-window counts are absent from the report. |
| Scenario: AC4 — Provenance records validation time and actual dispatches (req: R5, R6) | MET | test | `packages/app/tests/services/history-anatomy-final-provenance.test.ts:91` through `packages/app/tests/services/history-anatomy-final-provenance.test.ts:208` 7 pass, 0 fail this run. Live frontmatter `docs/report` `2026-11-08-history-anatomy.md` line 15-38 matches those rows: validatedAt later than generatedAt, executor grok, model grok-4.7, two dispatch rows. `.spur` `run/1326-history-anatomy-e2e.json` line 32 spurVersion 0.4.30. |
| Scenario: AC5 — False arithmetic fails the deterministic gate (req: R7) | MET | test | `packages/app/tests/services/history-anatomy.test.ts:1125` checkReportStructure arithmetic assertions exited 0 this run: false calc 719838772 > 725707709 is arithmetic-contradiction, the gap 5868937 passes, and a derived comparison without calc is arithmetic-evidence-missing. |
| Scenario: AC6 — Escalation and effective timeout are visible in JSON workflow records (req: R8, R9) | MET | test | `packages/app/tests/services/agent-service.test.ts:3971` exited 0: durable Escalating line names both executors, stderr stays quiet, one agent.invoke.escalated event, JSON stdout. `packages/app/tests/workflow/observability.test.ts:261` preserves 3600000 and `packages/app/tests/workflow/step-reporter.test.ts:94` renders timeout=60m 0s. Both exited 0 this run. |
| Scenario: AC7 — Trace resolves prefixes safely (req: R10) | MET | test | `apps/cli/tests/commands/workflow/trace.test.ts:1053` four cases (unique, exact, ambiguous, follow and follow --output) and `packages/app/tests/services/workflow-inspect-ops.test.ts:106` exited 0 this run. Command this run: `bun apps/cli/src/index.ts workflow trace 05d14930 --json` exit 0 resolved runId 05d14930-17c2-4089-b3da-cff6b318b3c1. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Disposition: PASS.** Requirements R1–R10 and scenarios AC1–AC7 are MET. The answer at `.spur/run/1326-verify-answer.txt` derives PASS. The rows below record how each review finding is closed so a residual fold keeps that PASS.

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P2 | Performance | `packages/domain/src/analytics/selector-time-range.ts` | The parsed-only predicate is not sargable. EXPLAIN QUERY PLAN degraded to a covering-index SCAN and a bounded daily analyze measured 25.7 s / 20.6 s before the fix (pre-fix 1.2 s / 0.7 s). | FIXED: a one-second-widened TEXT range on the raw column precedes the exact julianday comparison. Re-measured 0.49 s with identical coverage. Pinned by `packages/domain/tests/analytics/selector-time-range.test.ts:51`. |
| P3 | Correctness (residual) | `packages/app/src/services/history-anatomy.ts` | Left-associative grammar, no operator precedence, so a mixed-precedence chain fails as a contradiction. The rubric does not use such chains. | DEFER: `plugins/sp/skills/history-anatomy/references/report-contract.md:78-84` freezes left-associative + - * / with no precedence. Changing that grammar would contradict the approved contract. |
| P3 | Correctness (residual) | `packages/app/src/services/history-anatomy.ts` | Field-span detection keys on the contract bullet layout. A table-shaped finding is skipped. False-negative path only: a derived claim can escape the gate, and the gate never raises a false failure. | DEFER: published findings are bullet blocks under Findings. Table-row spans are outside that frozen layout at `packages/app/src/services/history-anatomy.ts:422-437`. |
| P3 | Behavior change | `packages/app/src/services/verified-outcome.ts` | An unparseable runs.started_at value, the three legacy numeric rows, is excluded from a windowed denominator. That matches the SQL plane julianday NULL semantics. Text comparison previously admitted them. | FIXED: exclusion of unparseable timestamps is the intended window match at `packages/app/src/services/verified-outcome.ts:115-120`. |
| P4 | Observability | `packages/app/src/services/history-anatomy.ts` | On the Grok path executorProfile reads "not available: invocation executor absent". dispatches[] carries the same value. No requirement asks for the ladder to be recorded. | Advisory. Honest absence. No requirement asks for a recorded ladder. |

**Residual risk.** R8's durable escalation line has hermetic coverage only. This E2E run hit no resource exhaustion, so the live escalation path is unproven. The regenerated report is gitignored. Durable evidence is `.spur/run/1326-history-anatomy-e2e.json` plus run `05d14930-17c2-4089-b3da-cff6b318b3c1`.

### References

- Source run: `43a5034e-9093-4838-ab4f-d93e5418601c` — `.spur/memory/runs/43a5034e-9093-4838-ab4f-d93e5418601c.md`
- Published report: `docs/report/2026-11-08-history-anatomy.md` (gitignored; regenerate, never hand-edit)
- Analyze artifacts: `.spur/run/43a5034e-9093-4838-ab4f-d93e5418601c-history-anatomy-current.json`, `-baseline.json`
- Provenance: `.spur/run/43a5034e-9093-4838-ab4f-d93e5418601c-provenance.json`
- Gates: `.spur/run/43a5034e-9093-4838-ab4f-d93e5418601c-structure-gate.txt`, `-validation.txt`, `-correction-count` (1)
- Path/selector evidence: `.spur/run/43a5034e-9093-4838-ab4f-d93e5418601c-paths.txt`, `-selector.json`
- Final dispatch evidence: `spur workflow trace 43a5034e-9093-4838-ab4f-d93e5418601c --json`; `system_events` rows `agent.invoke.escalated`
- Window predicates: `packages/domain/src/analytics/message-where.ts`, `selector-time-range.ts`, `pairings.ts`; `packages/domain/src/dao/run-dao.ts`; `packages/app/src/services/verified-outcome.ts`
- Provenance/stamp: `packages/app/src/services/history-anatomy.ts`, `history-anatomy-cli.ts`; `config/workflows/history-anatomy.yaml`
- Arithmetic contract/gate: `plugins/sp/skills/history-anatomy/references/operations.md`, `report-contract.md`; `packages/app/src/services/history-anatomy.ts`
- Escalation/timeout: `packages/app/src/services/agent-run-executor.ts`, `packages/app/src/workflow/observability.ts`, `step-reporter.ts`
- Prefix resolution: `packages/app/src/services/workflow-inspect-ops.ts`, `workflow-service.ts`; `packages/domain/src/dao/run-dao.ts`; `apps/cli/src/commands/workflow/trace.ts`
- Related: I81 (reopened `verifying → active` on 2026-11-10); I8; tasks 0674, 0690, 0482, 1260, 1309/1310; ADR-079 (derived cache validity), ADR-051 (public CLI consent), ADR-069 (deterministic work outside shell glue)
- Concurrent ownership audit: one worktree at 2026-11-10; no `wip` tasks. Starting tree had only the untracked 1322 task and the deliberate I81 status change made during this refine.

### History

- 2026-11-10T19:42:14.913Z todo → wip (system)
- 2026-11-10T20:01:04.132Z wip → testing (system)
- 2026-11-10T20:01:23.510Z testing → done (system)

