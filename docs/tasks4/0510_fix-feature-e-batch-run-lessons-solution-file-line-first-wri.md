---
template: meta
schema_version: 1
name: "Fix feature-E batch run lessons: Solution file:line first-write, feature Scope hygiene, gate-adjacent test coverage, release trigger verification, host cache-read growth"
description: ""
status: backlog
type: meta
profile: standard
feature_id: H1
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-11T15:09:56.354Z"
updated_at: "2026-08-11T15:28:19.997Z"
---

## 0510. Fix feature-E batch run lessons: Solution file:line first-write, feature Scope hygiene, gate-adjacent test coverage, release trigger verification, host cache-read growth

### Background
The feature E batch (`/sp:dev-runall --feature E --auto --next --agent inline`, tasks 0506-0508) completed with all PASS verdicts in ~70 minutes of active work, but post-run forensic analysis of the live OMP session (`2026-08-11T06-37-01-363Z_*.jsonl`) surfaced five reusable lessons.

The session cost $2.38 total — 95% ($2.27) from cache-read tokens (79.4M) against only 577K fresh input and 126K output tokens. Assistant (LLM) response time was 55.4 min across 285 messages; tool execution was 17.3 min, dominated by bash (138 calls, 16.9 min, one 472s blocking workflow trace). Two quality-gate re-runs and two poll loops (~5 min combined) were avoidable.

Root causes: the implement agent's first Solution write omitted required `file:line` citations (one `wip → testing` guard denial); a grouping feature reached its done-transition with an L3 Scope gap (two `verifying → done` guard denials); the 0507 targeted test pass missed `apps/cli` fixtures, causing a red full gate; the ts-libs tag push did not auto-trigger the Publish workflow (recovered by delete+re-push); and long host-session context drives the cache-read cost.
### Requirements
- [ ] R1. Enforce Solution `file:line` citations at first write: the implement operation's section authoring must include at least one `file:line` citation on the first `spur task update --section Solution` (L3.solution-file-line), so the `wip → testing` guard never denies a fresh Solution.
- [ ] R2. Surface L3 Scope gaps on grouping features before the done transition: feature check / sync should flag a missing in-scope/out-of-scope delineation at `feature check` time (or batch-create), not only when the `verifying → done` guard runs.
- [ ] R3. Make the pre-gate targeted pass gate-adjacent: the targeted test set for a task touching CLI/domain/app must include `apps/cli/tests/**`, package typechecks (`bun run --filter … typecheck`), and the flag/parity suites before the first full `spur-check` gate run.
- [ ] R4. Verify release trigger after tag push: after `git push origin --tags` for a ts-libs lockstep release, confirm the Publish workflow run exists (`gh run list`) before any npm poll; re-push the aggregate tag if the event was missed.
- [ ] R5. Bound host-context cache-read growth: prefer native-subagent dispatch (0508) for eligible pipeline stages and avoid re-reading large task/artifact files in the host session; target cache-read tokens per batch run.
### Acceptance Criteria
Scenario: R1 — A fresh Solution write is never guard-denied
  Given the implement operation authors `## Solution` for the first time
  When it writes via `spur task update --section Solution --from-file`
  Then the body contains at least one `file:line` citation
  And `spur task check <wbs>` passes without L3.solution-file-line

Scenario: R2 — Grouping features surface Scope gaps early
  Given a feature with no in-scope/out-of-scope delineation in its Scope section
  When `spur feature check <id>` runs
  Then the L3 Scope finding is reported (error or warning)
  And the `verifying → done` sync never surprises an operator with a pre-existing Scope gap

Scenario: R3 — The targeted pass covers gate-adjacent surfaces
  Given a task's changes touch apps/cli or packages/domain|app
  When the pre-gate targeted test set runs
  Then it includes the affected package tests, CLI tests, and per-package typechecks
  And the first full `spur-check` gate run is green (or fails only on genuine code findings)

Scenario: R4 — A missed publish trigger is detected before npm polling
  Given a lockstep ts-libs release tag was pushed
  When the release flow checks workflow runs
  Then a Publish run for the aggregate tag exists (or the tag is re-pushed once)
  And no sleep-poll loop exceeds one bounded `gh run watch`-style call

Scenario: R5 — Host-context cache cost is bounded
  Given a multi-task batch runs inline in one host session
  When per-task pipeline stages are eligible
  Then eligible model stages dispatch to a native subagent (0508)
  And the batch's cache-read token volume shows no unbounded growth per additional task
### Q&A
**Q: Why is the Solution file:line rule a task and not a hook?**
A: The CLI already enforces it at `spur task check` (L3.solution-file-line) and the pipeline's record step backfills from `git diff --name-only` as a safety net. The gap is the implement agent's first-write habit, so the fix is guidance in the implement operation, not a new gate.

**Q: Why catch Scope gaps at feature check rather than creation?**
A: Grouping features (feature E, `tags: [group]`) are often created before scope is known and carry placeholder Scope. `feature check` already has the L3 Scope rule — the ask is to surface it as an error early enough that batch-create/planning flags it, instead of the done-transition guard being the first enforcement point.

**Q: Why include CLI tests in the targeted pass?**
A: The 0507 red gate was caused by a missed `apps/cli/tests/commands/history.test.ts` fixture after a `ForensicTotals` shape change — the targeted pass ran domain/app/plugin tests only, so the typecheck error surfaced only in the full gate, forcing a second 50s gate run plus a full re-run.

**Q: How much did the two red gates cost?**
A: ~100s of gate time plus two full 4845-test suite re-runs (~50s each) and the intervening diagnosis — roughly 5 minutes of the 70-minute batch, all avoidable with gate-adjacent targeted coverage.

**Q: Is the cache-read cost avoidable?**
A: Partially. 95% of the $2.38 session cost is cache-read, inherent to a long host session re-sending context. The 0508 native-subagent-first contract moves eligible stages off the host context, which is the structural lever; per-run discipline (not re-reading large task files, targeting reads) is the behavioral one.

**Q: Why verify the publish trigger instead of just polling npm?**
A: The 0.4.26 tag push did not create a Publish workflow run; ~90s of npm polling passed before we inspected runs and re-pushed. Checking `gh run list` immediately after the push turns a silent event miss into a 5-second detection.
### Design
| # | Evidence (session log) | Root cause | Fix target | Expected impact |
| --- | --- | --- | --- | --- |
| R1 | `GuardDeniedError ... denied transition from "wip" to "testing"` on 0506; `[ERR] L3 Solution: Solution must contain at least one file:line citation` | First `## Solution` write used `| File | Change |` headers without file:line anchors | Implement operation (`sp:code-implementation`) authoring guidance + check in the inline driver's implement step | Zero fresh-Solution guard denials |
| R2 | 2x `denied transition from "verifying" to "done"` for feature E; `[ERR] L3 Scope: Scope should delineate in-scope / out-of-scope items` | Grouping feature created 2026-06-12 with one-line Scope; L3 rule enforced only at the done guard | `spur feature check` error severity for missing Scope delineation (or planning-half check at batch-create) | Scope gaps surfaced at creation/planning, not at done |
| R3 | 0507 gate red: `apps/cli/tests/commands/history.test.ts ... missing ForensicTotals fields`; only domain/app/plugin tests ran in the targeted pass | Targeted pass omitted CLI tests + typechecks | Pre-gate targeted checklist in execution-workflow § targeted-test-first | One gate run per task (green path) |
| R4 | `git push origin --tags` produced no Publish run; npm polled 92s; delete+re-push `@gobing-ai/ts-libs-v0.4.26` created the run | GitHub event miss on the tag push | Release checklist: `gh run list` immediately after push | 5s detection instead of 90s+ polling |
| R5 | usage: input 577K / output 126K / cacheRead 79.4M tokens; cost $2.27 of $2.38 cache-read | Long host session re-sends context; 0508 not yet live during the batch | Native-subagent dispatch per 0508 + read-targeting discipline | Bounded cache-read per task in multi-task batches |
### Plan
- [ ] P1 (R1) Add file:line-first-write guidance to the implement operation reference and a first-write self-check; extend any existing Solution section test.
- [ ] P2 (R2) Verify `spur feature check` severity for Scope delineation on grouping features; align planning-half gates (batch-create/feature-create) to surface it early.
- [ ] P3 (R3) Update the targeted-test-first checklist in `execution-workflow.md` and the implement operation to include CLI tests + per-package typechecks for cross-package changes.
- [ ] P4 (R4) Document the release-trigger verification step (`gh run list` after tag push) in the ts-libs release path / relevant skill.
- [ ] P5 (R5) Track cache-read per batch after 0508 lands; confirm native-subagent dispatch reduces host-context growth in a follow-up batch.
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Session: `~/.omp/agent/sessions/-xprojects-spur-new/2026-08-11T06-37-01-363Z_019fef89-ec33-7000-9c2a-4188283f5631.jsonl` (951 lines, 06:38-15:06Z)
- Batch: `/sp:dev-runall --feature E --auto --next --agent inline` (tasks 0506-0508, all PASS; wrap run `6512937e`)
- Guard evidence: 0506 `wip → testing` denial (L3.solution-file-line); feature E `verifying → done` denials (L3 Scope)
- Release: `@gobing-ai/ts-llm-jsonl-importer@0.4.26` (commit `f817429`, tag `@gobing-ai/ts-libs-v0.4.26`; publish run created only after re-push)
- Pipeline: `.spur/workflows/task-pipeline.yaml` (test hop = `bun run format && bun run spur-check`)
### History
