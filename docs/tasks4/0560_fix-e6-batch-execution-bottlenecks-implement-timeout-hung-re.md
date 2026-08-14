---
template: meta
schema_version: 1
name: "Fix E6 batch execution bottlenecks: implement timeout, hung review subagent, dependency-release timing"
description: ""
status: cancelled
type: meta
profile: standard
feature_id: null
parent_wbs: null
priority: P1
tags: ["meta"]
dependencies: []
ac_numbering: task-local
created_at: "2026-08-14T18:03:34.112Z"
updated_at: "2026-08-14T18:16:11.156Z"
---

## 0560. Fix E6 batch execution bottlenecks: implement timeout, hung review subagent, dependency-release timing

### Background
The E6 batch (tasks 0557/0558/0559) completed with all PASS verdicts and feature E6 shipped, but took ~2.9h of real compute for 3 tasks (12.9h wall including an 8.1h host clock jump and 1.3h operator latency). Forensic analysis of the pi session log (~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_*.jsonl, 159 model turns, ~$0.75 main-session spend) identified 6 root causes: a 30-minute implement timeout on 0558 (the resume only needed 2m), a hung review subagent on 0559 (~8m with zero tool calls), an unreleased ts-libs dependency fix surfacing only at review time (9m release detour + 37m operator decision), a verdict AC-row id mismatch that failed the feature scenario gate, a migration-number collision with parallel work, and a 16m cold quality-gate first run.
### Requirements
- [ ] R1. Implement budget sizing — large tasks (est. >20m) should be pre-split at decomposition or run with a raised implementTimeoutMs; a timed-out implement must persist a mid-work checkpoint the resume can reuse. Target: no full-budget implement timeout in the next batch.
- [ ] R2. Subagent hang watchdog — a dispatched stage subagent with zero tool calls for N minutes (N=4) after launch should be stopped and re-dispatched automatically. Target: hung-stage detection within 5m (was ~10m).
- [ ] R3. Dependency-release check at implement time — implement acceptance must verify the pinned dependency actually ships the fix (bun.lock resolved version vs the code fix commit) before the task leaves implement. Target: zero R5-class delivery gaps surfacing at review/verify.
- [ ] R4. Verdict AC-row id hardening — the answer-file parser (or verify guidance) must normalize AC row ids so an embedded Gherkin body can never fail the scenario gate. Target: zero L4.scenario-unverified caused by row-id mismatch.
- [ ] R5. Migration-number collision prevention — allocate or check migration ids at batch-create/feature-check time so parallel features cannot both claim 0012_spur_cli_*. Target: no collision in the next parallel batch.
### Acceptance Criteria
```gherkin
Scenario: implement no longer exhausts its budget
  Given a task estimated over 20m of implement work
  When the implement stage runs
  Then it completes within its budget or persists a reusable checkpoint
  And the batch report shows no full-budget timeout

Scenario: hung stage subagents are detected quickly
  Given a dispatched stage subagent that makes no tool calls
  When it remains idle for 4 minutes
  Then the batch driver stops it and re-dispatches
  And the wasted window is under 5 minutes

Scenario: dependency fixes are shipped before review
  Given an implementation that requires a ts-libs fix
  When the task reaches implement acceptance
  Then the resolved dependency version is verified to contain the fix
  And no delivery gap surfaces at review or verify

Scenario: verdict rows always match scenario titles
  Given a verify answer with an AC row id containing extra text
  When the verdict is derived
  Then the scenario gate still matches the row
  And no post-hoc answer surgery is required

Scenario: parallel features cannot collide on migration numbers
  Given two features planned concurrently
  When both add incremental migrations
  Then the migration ids are distinct
  And no merge-time renumbering is required
```
### Q&A
Q: Why is the implement budget the top fix? A: The 0558 timeout burned the full 30m budget with ~95% of the work done; the resume then finished in 2m. Budget sizing or mid-work checkpoints convert a full-budget loss into a cheap resume.
Q: Why a tool-call watchdog instead of a longer subagent timeout? A: The hung 0559 review made zero tool calls for ~8m — it was a dead model call, not slow work. A no-tool-call rule catches that class in minutes; a timeout extension would just wait longer.
Q: Hook vs guidance for R3? A: Guidance in sp-code-implementation acceptance (check the resolved version ships the fix) is the primary fix; a rule or precheck could enforce it later if it recurs.
Q: How much time does this save? A: R1+R2 ≈ 35-40m per batch with a large/hung task; R3 ≈ 10-45m (detour + operator decision); R4 ≈ 3m; R5 avoids merge-time rework (unbounded).
Q: Should these be one task or split? A: One meta task with independent requirements so they can be picked off separately; R1/R2 are pipeline/driver level, R3/R4 are verification contract, R5 is planning-time.
Q: Where does the operator latency fit? A: The 37m R5 decision wait is not agent waste — it is surfaced here only to justify moving release checks earlier so the question never needs asking.
### Design
Per-fix evidence and target location:
- R1: 0558 implement ATTEMPT 1 = 30m full budget, ~95% complete at timeout; resume = 2m. Target: sp-spec-decomposition granularity standard (pre-split >20m tasks) + task-pipeline implement comment on mid-work checkpoint; runtime workflow .spur/workflows/task-pipeline.yaml.
- R2: 0559 review attempt1 = 10m window (08:00 dead before stop), zero tool calls, deepseek-v4-flash. Target: inline-pipeline-driver native-subagent dispatch (add no-tool-call watchdog) — skills/sp-spur-dev/references/inline-pipeline-driver.md.
- R3: R5 ts-libs fix 7d17414 committed but unreleased; bun.lock pinned 0.4.32; surfaced at review (P2) → release detour 9m + operator Q 37m. Target: sp-code-implementation acceptance checklist.
- R4: 0558 verdict AC row id embedded full Gherkin body "(Given ... / And ...)" → scenario gate mismatch → post-hoc answer surgery. Target: spur task verdict parser (packages/app) or sp-dev-verify answer schema.
- R5: parallel features both claimed 0012_spur_cli_* (history_tool_call_args_raw vs history_run_session) → merge renumber to 0013. Target: batch-create / feature-check migration-id allocation.
### Plan
- [ ] 1. Implement R1 (decomposition guidance + checkpoint)
- [ ] 2. Implement R2 (subagent hang watchdog)
- [ ] 3. Implement R3 (dependency-release acceptance check)
- [ ] 4. Implement R4 (verdict AC-row id hardening)
- [ ] 5. Implement R5 (migration-id collision prevention)
- [ ] 6. Verify batch (spur task check + batch report evidence)
### Solution

<!-- Filled during implementation: changed files/sections and concise rationale. -->

### Testing

<!-- Filled during verification: commands/checks run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-08-14T18:16:11.156Z backlog → cancelled (system)
### Notes

RC1 (S1, 30m): 0558 implement exhausted implementTimeoutMs mid-work; partial retro-correlation.ts + stub Solution left; resume reused the partial state in 2m. Evidence: session log 06:05:06-06:35:12 wait; git status showed untracked partial files at 06:35:12.
RC2 (S1, ~10m): 0559 review subagent made zero tool calls for ~8m (deepseek-v4-flash, thinking high); stopped and re-dispatched; fresh run completed in ~6m. Evidence: subagent events.jsonl had only started+trace entries; no tool activity 16:03:35→... (attention-required flags).
RC3 (S1, ~45m): R5 dependency fix unreleased; detected at review (P2 "gate blocked"); required operator decision (37m) + release (bump-ver 0.4.33, pre-push lint fix, CI publish, bun update, gate re-run). Evidence: review output P2; ts-libs commit 7d17414; bun.lock 0.4.32→0.4.33.
RC4 (S2, ~3m): verify answer AC row id embedded the Gherkin body; spur task verdict preserved it; feature check L4.scenario-unverified for R4; fixed by editing the answer file and re-deriving. Evidence: .spur/run/0558-verify-answer.txt; verdict.json AC id.
RC5 (S2, integration debt): parallel 0553 work claimed 0012_spur_cli_history_tool_call_args_raw; E6 claimed 0012_spur_cli_history_run_session; merge renumbered to 0013 (commit fa41669c). Evidence: migrations.ts both ids; git log.
RC6 (S2, 16m): first quality gate (cold worktree, cold caches) took 15m51s; warm gates 1-2m. Target: pre-warm at worktree creation or accept as cold-start tax.
Clock note: the 0559 gate stage showed 8.1h wall — host clock jump/sleep, not compute; excluded from compute estimates.
What worked: worktree isolation confined the batch; partial-state resume was cheap; the strict feature preflight and the bounded feature-sync suppressed redundant syncs.

