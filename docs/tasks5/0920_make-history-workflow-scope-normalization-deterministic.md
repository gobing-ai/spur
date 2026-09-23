---
schema_version: 1
name: Make history workflow scope normalization deterministic
status: done
template: standard
created_at: 2026-09-22T02:56:46.303Z
updated_at: "2026-09-23T22:06:45.029Z"
feature_id: D63
priority: P2
tags:
  - next-generation-workflows
  - proposal-w07
estimate_hours: 6

ac_altitude: task-local
dependencies: []
---

## 0920. Make history workflow scope normalization deterministic

### Background

history-anatomy.yaml dispatches a reviewer agent solely to validate the declared daily/ad-hoc argument grammar in resolve-scope. Its next state already calls the deterministic history-anatomy-cache.mjs `paths` helper, which computes DST-aware daily bounds. Fresh analyze before cache-probe, model enrichment, independent validation, bounded correction and atomic publication remain load-bearing. This task removes only the model grammar hop and delivers D63 R7.

Read-only source-local trace inspection on 2026-09-22 found ten terminal runs for the current history-anatomy definition digest sha256:2e3030ff2a5aa5b54535832f2dcb1fae2c2f832cb984e7de74a7be4b8d7c28eb: four done, six failed, all ten with action events. Seven successful resolve-scope actions had a 51,452 ms median. This is a stage baseline, not a whole-run speed or token claim. The existing D62 promotion mechanism owns graph candidate disposition. Planning reference: docs/plans/2026-09-21-next-generation-spur-workflows.md.

**Refine corrections (2026-09-22)**
- The earlier task claimed a stable selector artifact shape → archived selector.json files have several incompatible shapes and no downstream workflow state reads them → preserve the path as an observation artifact but freeze one minimal v1 shape below; the actual compatibility contract is mode/window/output behavior.
- The earlier Design left the grammar owner open → `history-anatomy-cache.ts` already owns `paths` and DST-aware bounds → extend that command instead of adding a second parser/service.
- A history-specific baseline was described as future work → current-digest trace data already has ten terminal mapped runs and a measured scope-stage median → use that cohort, then recheck at candidate registration.
- modes.md says the default output is the run directory → the executing resolvePaths helper defaults to docs/report/<date>-history-anatomy.md → preserve the executing target and correct that stale guidance in the same slice.

### Requirements

- [x] R1. Move daily/ad-hoc argument validation into the existing `history-anatomy-cache` paths command; preserve the mode, date/window and fail-loud grammar from references/modes.md, the executing helper's output-target default, and one consistent run-scoped selector observation artifact.
- [x] R2. Keep fresh deterministic analysis before the semantic cache probe and retain independent validation, bounded correction and atomic publication.
- [x] R3. Preserve the configured executor choice and the declared reviewer role/capability policy for enrichment, validation and correction; remove only the model-only scope dispatch.
- [x] R4. Evaluate the removed hop against current-definition real-run evidence through the existing candidate process; label unknown token/cost and historical report compatibility honestly.

### Acceptance Criteria

- [x] AC1 — Valid daily/ad-hoc selectors yield equivalent normalized windows/targets without a scope model call; invalid arguments fail by name before analyze or publication; selector observation written only on success. (req: R1) — plugins/sp/scripts/history-anatomy-cache.ts:623,1013; tests `paths grammar validation (0920…)`; bounds math unchanged in resolvePaths (DST rule preserved).
- [x] AC2 — Fresh analyze precedes the semantic cache probe; independent validation, bounded correction and atomic publication untouched (graph diff removes only resolve-scope; cache-probe/validate/correct/publish states byte-identical). (req: R2) — config/workflows/history-anatomy.yaml.
- [x] AC3 — Executor choice (`agent` var + config override), role reviewer, and enrich/validate/correct calls preserved; only the model-only scope dispatch removed. (req: R3) — config/workflows/history-anatomy.yaml:186,223,278 unchanged.
- [x] AC4 — Current-digest baseline (11 terminal real runs, 51,452 ms scope median) recorded and D62 candidate `history-anatomy-scope-inline` registered with deadline 2026-10-07 BEFORE the graph edit (config/workflow-candidates.json:6); tokens/cost labeled unknown in the candidate rationale. Realized comparison (≥5 comparable candidate runs → promote or retire) is deadline-bound by design and owned by `promotion evaluate`, consumed by 0921. (req: R4)
- [x] AC5 — Diagnostics retain validity with fewer unnecessary model calls: modelQueries 4 → 3 recount with provenance (config/pipeline-budgets.json:38); probe/contract cache identity unchanged.
- [x] AC5 — (covers: R7 — Diagnostics retain validity with fewer unnecessary model calls) The removed scope dispatch is the model-call reduction; validity is carried by AC1–AC3 and the measured promotion record. (req: R4)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-23T03:20:58.748Z

Ready decision: the existing `paths` command is the sole grammar and normalized-bound owner. Historical selector.json shapes are inconsistent and unused, so only the path and a new minimal private observation shape are retained. The measured target is stage-level model-call and latency reduction, not unmeasured whole-run or token savings. Existing executor selection and judgment stages remain unchanged.

### Design

Delete the resolve-scope agent.run state and route start directly to resolve-paths. Extend the existing plugins/sp/scripts/history-anatomy-cache.ts `paths` command so one invocation validates `--mode`, `--date`, `--since`, `--until`, `--focus`, `--output` and `--recompute` before atomically writing the existing run-scoped paths env file. Pass the missing focus/recompute arguments from config/workflows/history-anatomy.yaml; on invalid input exit nonzero with every attributable conflicting flag named, leave no usable paths file and route failed. Reuse resolvePaths/dayBounds/zonedDayStart for daily bounds, including 23/25-hour DST days. For ad-hoc, require nonempty focus and two parseable ordered inclusive ISO instants; reject date/recompute. Daily rejects focus/since/until/output and validates a real YYYY-MM-DD date. Keep the current output-target default and historical report format. No new Spur CLI, service, parser package or production YAML.

Write .spur/run/<runId>-selector.json as a private observation artifact with `mode`, `date`, `focus` (string or null), `since`, `until`, and `timezone` after successful validation. Its old files are not consumed and are not migrated; do not treat their inconsistent incidental keys as compatibility promises. `paths` remains the sole source of the normalized bounds passed to analyze/probe. The default target remains docs/report/<date>-history-anatomy.md, as resolvePaths currently implements; fix modes.md's stale run-directory wording. Preserve the current `agent` default and config override behavior, role reviewer, existing enrich/validate/correct calls, session freshness and unsupported-capability failure. Do not interpret open-ended focus text or alter judgment rubrics.

The current-digest stage baseline is seven successful resolve-scope actions with median 51,452 ms; the source-local trace query found ten terminal current-digest runs with action events. Before editing YAML, register the existing D62 candidate with a deadline no later than 14 calendar days after creation. Primary real benefit: remove one model call and reduce the median scope stage by at least 25 seconds on at least five comparable terminal candidate runs with at least 80% mapped action coverage. Reliability floor: every formerly valid daily/ad-hoc selector still produces equivalent normalized bounds/target, invalid selectors fail before analyze/publication, and no cache/validation/publication regression. A replay/static count is a projection; only the candidate runs establish realized stage savings. Unknown cost/tokens stay unknown. Retire if the floor or deadline is missed.

Tests live in plugins/sp/tests/history-anatomy-cache.test.ts and the existing workflow-definition/contract checks: valid daily/default/explicit date, DST, ad-hoc ordering and inclusive bounds, each forbidden combination, invalid date/instant, failure leaving no paths file, installed .mjs parity, cache hit/miss, correction cap and publication refusal. Regenerate the .mjs twin through Superskill and update the owning history-anatomy mode reference only for the changed execution method, not the grammar. 0921 consumes the candidate verdict.

### Plan

- [x] 1. Rechecked current digest (sha256:2e3030ff… unchanged through edit) and cohort: 11 terminal real current-digest runs found (4 done / 7 failed; task background's 2026-09-22 count of 10 predates one newer failed run). Registered candidate `history-anatomy-scope-inline` (deadline 2026-10-07) before touching the graph; `promotion check` PASS. (R4)
- [x] 2. Extended the helper `paths` validation + selector observation (plugins/sp/scripts/history-anatomy-cache.ts:623,1013), removed the resolve-scope model state, and passed focus/recompute/run-id through the existing shell bridge (config/workflows/history-anatomy.yaml:111,327). (R1, R3)
- [x] 3. Grammar/DST/invalid-input failure, no-paths-file-on-failure, selector-on-success, twin parity (plugin-smoke) and fresh analyze/cache/validation/publication preservation covered by new + existing tests (83/0 in plugins/sp; 80/0 across scripts/packages suites). (R1–R3)
- [x] 4. Collapsed by condition — the realized-benefit comparison requires ≥5 attributable real candidate runs on the NEW definition, which do not exist until candidate-window runs complete; promotion/retirement is owned by `promotion evaluate` by the registered deadline 2026-10-07 (D62 process, ADR-076 amendment), with 0921 consuming the verdict. Script twin regenerated through Superskill; modes.md output-target guidance corrected (docs/report/<date>-history-anatomy.md) without grammar changes; unmeasured cost/tokens reported as unknown in the candidate rationale. (R4)

### Solution

- D62 candidate `history-anatomy-scope-inline` registered BEFORE the graph edit (config/workflow-candidates.json:6): deadline 2026-10-07, 11 current-digest real terminal runs recorded as replay inputs, projected agent.run count 3 → 2, stage floor (≥25s off the 51,452 ms resolve-scope median on ≥5 comparable runs) and unknown token/cost named honestly. `promotion check` PASS.
- Grammar moved into the helper: `validateSelector` (plugins/sp/scripts/history-anatomy-cache.ts:623) owns per-mode validation — daily rejects focus/since/until/output and validates a real YYYY-MM-DD (UTC round-trip, leap-aware); ad-hoc requires non-empty focus plus two parseable ordered inclusive ISO instants and rejects date/recompute; unknown mode and bad recompute literals fail by name; every attributable conflicting flag is listed on stderr.
- The `paths` CLI case (plugins/sp/scripts/history-anatomy-cache.ts:1013) validates before writing: invalid input exits 1 and leaves no usable paths env file; success writes the env file and the run-scoped selector observation artifact `.spur/run/<runId>-selector.json` (v1 shape: mode/date/focus/since/until/timezone).
- Graph edit (config/workflows/history-anatomy.yaml:327): resolve-scope model state deleted, start → resolve-paths; the shell bridge now passes `--focus/--recompute/--run-id` (config/workflows/history-anatomy.yaml:111). `workflow validate` True.
- modes.md corrected for the executing target (docs/report/<date>-history-anatomy.md default, plugins/sp/skills/history-anatomy/references/modes.md:29,43) + execution-method note (validation now deterministic in the helper); pipeline-budgets history-anatomy modelQueries 4 → 3 with recount provenance (config/pipeline-budgets.json:38); .mjs twin regenerated through Superskill (`superskill script convert`, 32061 bytes).
- Tests: plugins/sp/tests/history-anatomy-cache.test.ts new describe `paths grammar validation (0920 …)` — real/invalid calendar days, all forbidden daily/ad-hoc combinations, ordering/parse failures, failure leaves no paths file, selector artifact written only on success. 83/83 across the two touched files.
- Plan step 4's realized-benefit comparison is deadline-bound by design: only candidate-window real runs (≥5 comparable terminal) can promote or retire; 0921 consumes `promotion evaluate` by 2026-10-07.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `plugins/sp/scripts/history-anatomy-cache.ts:623-684` — `validateSelector` owns the full per-mode grammar: daily rejects focus/since/until/output naming each flag (:654-661) and validates a real YYYY-MM-DD via `isRealDate` (:612-620, leap/century-safe); ad-hoc requires non-empty focus (:648) + two parseable ordered inclusive instants (:649-668) and rejects date / recompute=true (:645-646); unknown mode and bad recompute fail by name (:634-643). `paths` CLI case validates before writing (:1013-1041): invalid input exits 1 with every attributable error on stderr and no env file; success writes the env file plus `.spur/run/<runId>-selector.json` v1 (mode/date/focus/since/until/timezone, :1044-1063). YAML bridge passes --focus/--recompute/--run-id (`config/workflows/history-anatomy.yaml:108-113`). modes.md grammar preserved + output-target corrected to docs/report/<date>-history-anatomy.md (`plugins/sp/skills/history-anatomy/references/modes.md:29-45`) + execution-method note (:6-8). Tests: `plugins/sp/tests/history-anatomy-cache.test.ts:1319-1483` — grammar, DST-real-date, every forbidden combination, ordering/parse failures, no-paths-file-on-failure, selector-on-success; suite re-run: 83 pass / 0 fail. |
| R2 | MET | Diff is hunk-limited (git show audit): only the resolve-scope state deleted, resolve-paths command +3 flags, start edge merged. analyze still precedes cache-probe (`config/workflows/history-anatomy.yaml:117-137` -> `:139-153`; ADR-079 fresh-digest rule in header); cache-probe, validate, correct, stamp, publish states and their transitions byte-identical; bounds math unchanged (`dayBounds`/`zonedDayStart` :525-549). |
| R3 | MET | Enrich (`config/workflows/history-anatomy.yaml:173-179`), validate (:210-216), correct (:265-271) each retain `agent: ${vars.agent}` (executor choice; config override still injected at workflow-service.ts:765-775 seam), `role: reviewer`, `expectFile`, `timeoutMs`; the independent-validation and bounded-correction (cap 2, shared counter) sequencing untouched; only the model-only resolve-scope dispatch removed. |
| R4 | MET | Candidate `history-anatomy-scope-inline` (`config/workflow-candidates.json:6-31`): createdAt 2026-09-23, deadline 2026-10-07 = exactly +14 days (<= 14-day rule); 11 real terminal current-digest replay inputs — all 11 runIds verified read-only in /Users/robin/xprojects/spur-new/.spur/spur.db: exist, workflow_name=history-anatomy, status 4 done / 7 failed, definitionDigest sha256:2e3030ff…28eb (matches the claimed recount cohort); projected agent.run 3 -> 2 with the 3-state canonical note; >=25s stage floor vs the 51,452ms median on >=5 comparable runs at >=80% mapped coverage; token/cost explicitly labeled unknown in the rationale; `promotion check` PASS. Realized comparison is deadline-bound, owned by `promotion evaluate`, consumed by 0921. |
| R7 — Diagnostics retain validity with fewer unnecessary model calls | MET | (feature-scenario key for this task's evidence above, Verdict: PASS); added for DD-09 traceability by task 0921. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |

### References

- D63 R7; docs/plans/2026-09-21-next-generation-spur-workflows.md; plugins/sp/skills/history-anatomy/references/modes.md; docs/design/workflow-execution-economy.md (promotion contract).
- Current seams: config/workflows/history-anatomy.yaml; plugins/sp/scripts/history-anatomy-cache.ts and generated .mjs; plugins/sp/tests/history-anatomy-cache.test.ts.
- Baseline query: `bun run apps/cli/src/index.ts workflow trace --workflow history-anatomy --last 100 --json`; current definition digest from `workflow show history-anatomy.yaml --format todo --json`. Ten current-digest terminal runs, ten mapped; seven successful resolve-scope actions median 51,452 ms on 2026-09-22.
- At refinement, only the clean /Users/robin/xprojects/spur-new-0915 worktree existed and no task was wip. Use a fresh isolated branch/worktree when implementation begins.

### History

- 2026-09-22T02:58:03.042Z todo → blocked (system)
- 2026-09-23T03:03:04.729Z blocked → todo (system)
- 2026-09-23T17:56:51.171Z todo → wip (system)
- 2026-09-23T18:20:03.848Z wip → testing (system)
- 2026-09-23T18:20:07.487Z testing → done (system)

