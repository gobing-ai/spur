---
schema_version: 1
name: Make history workflow scope normalization deterministic
status: todo
template: standard
created_at: 2026-09-22T02:56:46.303Z
updated_at: "2026-09-23T03:22:36.397Z"
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

- [ ] R1. Move daily/ad-hoc argument validation into the existing `history-anatomy-cache` paths command; preserve the mode, date/window and fail-loud grammar from references/modes.md, the executing helper's output-target default, and one consistent run-scoped selector observation artifact.
- [ ] R2. Keep fresh deterministic analysis before the semantic cache probe and retain independent validation, bounded correction and atomic publication.
- [ ] R3. Preserve the configured executor choice and the declared reviewer role/capability policy for enrichment, validation and correction; remove only the model-only scope dispatch.
- [ ] R4. Evaluate the removed hop against current-definition real-run evidence through the existing candidate process; label unknown token/cost and historical report compatibility honestly.

### Acceptance Criteria

- [ ] AC1 — Valid daily/ad-hoc selectors yield equivalent normalized windows/targets without a scope model call; invalid arguments fail by name before analyze or publication, and a consistent selector observation file is written only on success. (req: R1)
- [ ] AC2 — Cache-hit/miss and invalid-enrichment fixtures preserve fresh analysis, independent validation, correction limits and atomic publication. (req: R2)
- [ ] AC3 — Configured executor choices and unsupported-capability failures retain the current declared policy for remaining reviewer work. (req: R3)
- [ ] AC4 — Current-digest baseline and at least five comparable real candidate runs establish or refute the predeclared stage benefit and safety floor; absent tokens/cost stay unknown and the candidate is resolved by deadline. (req: R4)
- [ ] AC5 — Diagnostics retain validity with fewer unnecessary model calls (req: R1)

Feature-level traceability: this task delivers D63 scenario R7; AC1–AC4 give task-local regression evidence.

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

- [ ] 1. Recheck the cited current digest/run cohort and modes.md; register one D62 candidate with the frozen stage benefit, safety floor and calendar deadline before editing the graph. (R4)
- [ ] 2. Extend the existing helper `paths` validation and selector output, then remove the resolve-scope model state and pass all declared arguments through the existing shell bridge. (R1, R3)
- [ ] 3. Test grammar/DST/invalid-input failure and fresh analyze/cache/independent validation/correction/publication behavior in source and installed helper layouts. (R1–R3)
- [ ] 4. Compare at least five attributable real candidate runs, promote or retire by deadline, regenerate the script twin and update affected history guidance; report unmeasured cost/tokens as unknown. (R4)

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- D63 R7; docs/plans/2026-09-21-next-generation-spur-workflows.md; plugins/sp/skills/history-anatomy/references/modes.md; docs/design/workflow-execution-economy.md (promotion contract).
- Current seams: config/workflows/history-anatomy.yaml; plugins/sp/scripts/history-anatomy-cache.ts and generated .mjs; plugins/sp/tests/history-anatomy-cache.test.ts.
- Baseline query: `bun run apps/cli/src/index.ts workflow trace --workflow history-anatomy --last 100 --json`; current definition digest from `workflow show history-anatomy.yaml --format todo --json`. Ten current-digest terminal runs, ten mapped; seven successful resolve-scope actions median 51,452 ms on 2026-09-22.
- At refinement, only the clean /Users/robin/xprojects/spur-new-0915 worktree existed and no task was wip. Use a fresh isolated branch/worktree when implementation begins.

### History

- 2026-09-22T02:58:03.042Z todo → blocked (system)
- 2026-09-23T03:03:04.729Z blocked → todo (system)

