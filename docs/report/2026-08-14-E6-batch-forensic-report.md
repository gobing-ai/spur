# E6 Batch Execution — Forensic Report

**Date:** 2026-08-14 · **Feature:** E6 — Run-to-session correlation and cost-path repair
**Tasks:** 0557 · 0558 · 0559 (all PASS, done) · **Feature status:** done (shipped on `main` @ `fa41669c`)
**Batch:** `/sp-dev-runall --feature E6 --auto --next --worktree` (inline driver, sequential, stop-the-batch)
**Worktree:** `spur-new-runall-e6-e91f` · branch `sp/runall-e6-e91f` (merged; migration renumbered to 0013)
**Report source:** pi session log `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_019ffeab-7951-7574-8141-4337c0f29b93.jsonl`
**Confidence:** High for main-session timeline (159 model turns, ~$0.75 spend); subagent-internal spend not captured in this log.

---

## Executive Summary

The E6 batch completed with all PASS verdicts and the feature shipped, but took **~2.9h of real compute** for 3 tasks
(12.9h wall clock: 8.1h host clock jump during a quality gate + 1.3h operator latency). Six root causes were identified:
a 30-minute implement timeout on 0558 (resume needed only 2m), a hung review subagent on 0559 (~8m with zero tool calls),
an unreleased ts-libs dependency fix surfacing only at review time (9m release detour + 37m operator decision), a verdict
AC-row id mismatch that failed the feature scenario gate, a migration-number collision with parallel work, and a 16m cold
quality-gate first run.

**Operator scoping (2026-08-14):** performance/subagent-class items (RC1/RC2/RC3/RC6) are **deferred** — the ongoing
`spur agent run` refactor will rework those surfaces. The concrete, independent process items (RC4, RC5, wrap-capture)
are tracked as dedicated tasks 0561–0563. This report is the persistent reference.

---

## 1 · Time / Token / Cost per Step

### Session aggregates

| Metric | Value |
| --- | --- |
| Session wall clock | 12.9h (05:07:58 → 18:01) |
| Real compute (excl. clock jump + operator waits) | **~2.9h** |
| Host clock jump (machine sleep during 0559 gate) | 8.1h |
| Operator latency (pause before `continue` + R5 decision Q) | 1.3h |
| Main-session model turns | 159 |
| Main-session spend | ~$0.75 |
| Subagent spend | not in this log (worker runs on deepseek-v4-flash, own sessions) |

### Per-stage breakdown (wall time = main-session elapsed; $ = main-session model spend in that window)

| Stage | Wall | $ | Notes |
| --- | --- | --- | --- |
| Setup / preflight / worktree create | 3m | 0.062 | Skill reads + feature preflight |
| 0557 implement (subagent) | 28m | 0.003 | Largest single implement; ~30m budget |
| 0557 post-impl + wip transition | 13s | 0.007 | |
| 0557 quality gate (**cold**) | 16m | 0.004 | First spur-check on fresh worktree |
| 0557 review (subagent) | 5m | 0.007 | |
| 0557 verify (subagent) | 4m | 0.007 | |
| 0557 record / done | 22s | 0.011 | |
| 0558 precheck | 13s | 0.008 | |
| **0558 implement attempt 1 (TIMEOUT)** | **30m** | 0.007 | Full `implementTimeoutMs` budget; ~95% done at stop |
| Halt report + marker | 36s | 0.016 | |
| Operator pause (await `continue`) | 39m | 0.004 | Operator-side |
| 0558 resume precheck | 17s | 0.008 | |
| 0558 implement resume (subagent) | 2m | 0.008 | Partial state reused — near-free resume |
| 0558 quality gate (**warm**) | 1m | 0.008 | 16x faster than cold |
| 0558 review (subagent) | 2m | 0.008 | |
| 0558 verify (subagent) | 2m | 0.008 | |
| 0558 record / done | 14s | 0.009 | |
| 0559 implement (subagent) | 24m | 0.008 | |
| 0559 quality gate (CLOCK JUMP) | 8.1h | 0.013 | Host sleep — not real compute |
| **0559 review attempt 1 (HUNG)** | 10m | 0.065 | ~8m zero tool calls; stopped + re-dispatched |
| 0559 review attempt 2 (subagent) | 18m | 0.004 | Fresh run completed |
| 0559 verify v1 | 1m | 0.033 | Surfaces R5 P2 delivery gap |
| R5 release decision (operator Q) | 37m | 0.005 | Operator away |
| ts-libs release + bump | 9m | 0.084 | bump-ver, pre-push lint fix, CI publish, bun update |
| 0559 quality gate re-run (0.4.33) | 5m | 0.010 | |
| 0559 verify v2 (subagent) | 3m | 0.005 | PASS against released dist |
| 0559 record / done | 14s | 0.011 | |
| wrap: doc-sync (subagent) | 5m | 0.011 | |
| wrap: learnings/metrics | 2m | 0.049 | Artifact capture miss → manual rewrite |
| Feature gate fix (R4 verdict surgery + dogfood) | 3m | **0.136** | Most expensive main-session window (deep investigation) |
| Feature transition E6 → done | 20s | 0.013 | |
| Merge check + retain (non-FF collision) | 37s | 0.031 | |

### Cost observations

- The **waiting turns** (dispatch/join subagents, polling) cost ~$0.003–0.008 each — orchestration is cheap.
- The **investigation windows** (feature-gate fix $0.136, ts-libs release $0.084, hung-review handling $0.065,
  wrap rework $0.049) dominate main-session spend — deep context reads while diagnosing.
- Subagent internal spend is not measurable from this log; the real model cost of the batch is dominated by the
  worker runs, not the orchestrator.

---

## 2 · Issues Encountered (Root Causes)

| RC | Severity | Issue | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| RC1 | S1 | 0558 implement exhausted its 30m budget at ~95% complete — partial `retro-correlation.ts` + stub Solution left; resume finished in **2m** | Session 06:05:06→06:35:12 wait; partial untracked files at halt | **Deferred** (perf class) |
| RC2 | S1 | 0559 review subagent hung **~8m with zero tool calls** (deepseek-v4-flash, thinking high); required stop + re-dispatch | Subagent `events.jsonl` only started+trace entries; repeated attention-required flags 15:53→16:03 | **Deferred** (perf class) |
| RC3 | S1 | R5 ts-libs fix committed (`7d17414`) but **unreleased** — `bun.lock` pinned 0.4.32; surfaced as P2 at review → 9m release detour (bump-ver 0.4.33, OIDC CI publish, bun update) + 37m operator decision | Review P2; `npm view` 404 on 0.4.33 pre-release; dist grep confirmed heuristic present in 0.4.32 | **Deferred** (perf class) |
| RC4 | S2 | Verify answer embedded the full Gherkin body in the AC row id → `L4.scenario-unverified` on R4 → post-hoc answer surgery + verdict re-derivation | `.spur/run/0558-verify-answer.txt` row id; verdict.json AC id; feature check finding | **Task 0561** |
| RC5 | S2 | **Migration 0012 collision** — parallel work claimed `0012_spur_cli_history_tool_call_args_raw` (0553) while E6 claimed `0012_spur_cli_history_run_session` (0557) → non-FF merge; renumbered to 0013 | `migrations.ts` both ids; commit `fa41669c chore(e6): ... renumber history_run_session to 0013` | **Task 0562** |
| RC6 | S2 | Cold quality gate **15m51s** vs 1–2m warm (10x) — cold-cache tax on first task | Gate logs 05:39:57→05:55:54 vs 07:16:14→07:17:34 | **Deferred** (perf class) |

### Minor findings (recorded, no dedicated task)

- **Tag trigger miss:** ts-libs `Publish` workflow did not fire on the 0.4.33 tag push; manual `workflow_dispatch` on `main` published the same version (workflow reads `package.json` versions). Friction, not failure.
- **ac-row-dropped parse warnings:** review-table rows leaked into verdict AC tables (0557: 5 rows; 0558: flagged). Verdict remains authoritative; cosmetic noise.
- **Stale line anchors:** `## Testing` L4 warnings — bare `file:line` without `packages/...` prefixes (e.g. `agent-service.test.ts:2840`). Non-blocking.
- **Clock jump:** host sleep inflated the 0559 gate stage to 8.1h wall. Not agent waste; distorts timing if not excluded.

---

## 3 · Performance Improvements (DEFERRED — `spur agent run` refactor will rework these surfaces)

Per operator ruling 2026-08-14, the following are **not** tracked as tasks; revisit after the refactor:

1. **Implement budget sizing / checkpoints (RC1, ~30m/batch):** pre-split >20m tasks at decomposition, or persist a
   mid-work checkpoint so a timeout resumes cheaply instead of burning the full budget. The 0558 resume (2m) proved the
   partial-state carry is already cheap — the loss is the full-budget burn before it.
2. **Subagent hang watchdog (RC2, ~8m/batch):** a dispatched stage subagent with zero tool calls for ~4m after launch
   should be stopped + re-dispatched automatically. The attention-required flag exists but was noticed late.
3. **Dependency-release check at implement acceptance (RC3, ~45m):** verify the *resolved* dependency version actually
   ships the fix before the task leaves implement. The verify-time P2 → release round-trip is the costliest class.
4. **Cold-gate pre-warm (RC6, ~14m first task):** run `spur-check` once at worktree creation; warm gates measured 10x faster.

---

## 4 · Process / Workflow Enhancements (tracked)

Concrete, independent, code-fixable items — **own tasks created**:

| Item | Task | Fix target |
| --- | --- | --- |
| **Verdict AC-row contract (RC4)** | 0561 | `spur task verdict` parser (packages/app) or `sp-dev-verify` answer-file schema — normalize AC row ids so an embedded Gherkin body can never fail the scenario gate |
| **Migration-number collision prevention (RC5)** | 0562 | batch-create / feature-check — allocate or check `_spur_cli_` migration ids so parallel features cannot both claim the same number |
| **Wrap-up capture artifact path (learnings/metrics)** | 0563 | wrapup-pipeline / inline driver — enforce worktree-absolute artifact paths (`answerFile`) so capture lands where the append shell reads it |

Also noted (not task-worthy): HITL latency is operator-side and largely eliminated when RC3-class checks move earlier;
one-writer-per-tree discipline is documented in AGENTS.md and the worktree isolation contained the batch correctly —
the collision cost landed at merge time, not during the batch.

---

## 5 · What Worked Well

- **Worktree isolation confined the batch** — corpus writes stayed in the tree; the operator's parallel 0553/0554 work
  on `main` never corrupted the batch.
- **Partial-state resume was near-free** — 0558 resumed in 2m on the ~95% partial implementation.
- **Strict feature preflight caught nothing blocking, and the bounded feature-sync suppressed redundant syncs**
  (E6 active/verifying transitions applied exactly once per state).
- **The dogfood gate correctly caught E6's self-referential surface** and produced a genuinely useful report
  (`docs/dogfood/2026-08-14-E6-run-to-session-dogfood.md`), including the honest relay-hosted-omp `unresolved` bound.
- **The deterministic verdict derivation** (`spur task verdict --from-answer`) kept verdicts authoritative regardless
  of agent discretion.

---

## 6 · Integration State (post-batch)

- Branch `sp/runall-e6-e91f` @ `4a10fa12` merged into `main` by a follow-up session:
  `fa41669c chore(e6): merge main into runall-e6 and renumber history_run_session to 0013`
  (collision resolved: E6 migration → `0013_spur_cli_history_run_session`).
- Feature E6 → done; verifyall write-back landed (`14bbd8ae`); E5 report-mode work also on main (`19a5d8e8`).
- ts-libs released `@gobing-ai/ts-llm-jsonl-importer@0.4.33` (lockstep, OIDC publish) — `detectProvenance` deleted;
  main also carries `e63ba6d` (`_col` lint fix) and `a626fe5` (format).
- Worktree removed after merge; marker `worktree-runall-e6-e91f.json` remains at `status: retained` (stale — historical only).

---

## 7 · Follow-ups

| WBS | Title | Priority | Status |
| --- | --- | --- | --- |
| 0561 | Harden verdict AC-row id matching (RC4) | P2 | backlog |
| 0562 | Prevent migration-number collisions between parallel features (RC5) | P2 | backlog |
| 0563 | Enforce worktree-absolute artifact paths for wrap-up capture | P3 | backlog |

Deferred (perf/subagent class — see §3): RC1, RC2, RC3, RC6. Revisit after the `spur agent run` refactor.

---

## Appendix A — Session Event Timeline (key markers)

```
05:07:58 session start (pi, ghostty, deepseek-v4-flash)
05:08:45 read skills (sp-spur-dev / execution-batch / flag-glossary / inline-driver)
05:09:39 worktree created (sp/runall-e6-e91f), bun install
05:10:24 run-link 0557 (DF45D6AD-...)
05:11:15 → 05:39:44 0557 implement (subagent 3dff1145)
05:39:57 → 05:55:54 0557 quality gate (cold) PASS
05:55:54 → 06:00:46 0557 review PASS → 06:00:46 → 06:04:31 0557 verify PASS
06:04:47 0557 done
06:05:06 → 06:35:12 0558 implement attempt 1 — TIMEOUT (30m)
06:35:27 recovery hint: /sp:dev-run 0558 --auto --next; worktree retained
06:35:48 → 07:14:26 operator pause
07:14:43 → 07:16:14 0558 implement resume (subagent) — 2m
07:17:34 → 07:19:14 0558 review PASS → 07:19:14 → 07:21:01 0558 verify PASS
07:21:03 0558 done
07:21:15 → 07:45:24 0559 implement (subagent)
07:45:24 → 15:53:54 0559 gate (clock jump / host sleep)
15:53:54 → 16:03:38 0559 review attempt 1 HUNG → stopped
16:03:35 → 16:21:38 0559 review attempt 2 (subagent) — PASS, P2 surfaced
16:21:49 → 16:22:41 R5 dep verification (0.4.32 heuristic confirmed in dist)
16:22:41 → 16:59:28 operator Q: release now / defer / halt → "Release now, then bump"
16:59:33 → 17:08:25 ts-libs release: format commit, bump-ver 0.4.33 (pre-push lint block → _col fix), CI publish (manual dispatch), bun update
17:08:38 → 17:13:28 0559 gate re-run (0.4.33) PASS
17:13:28 → 17:16:26 0559 verify v2 PASS
17:16:36 0559 done
17:16:56 → 17:21:57 wrap doc-sync (subagent) → 17:22-17:23 learnings/metrics (capture miss → manual rewrite)
17:23:32 → 17:26:24 R4 verdict surgery + dogfood report → feature check 0 findings
17:26:25 E6 verifying → done
17:26:44 → 17:27:21 merge check: NON-FF (main advanced 4 commits) → worktree retained
18:00:09 report analysis session begins
```

## Appendix B — Reference Links

- Session log: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-08-14T05-07-58-417Z_019ffeab-7951-7574-8141-4337c0f29b93.jsonl`
- Feature: `docs/features/E6_run-to-session-correlation-and-cost-path-repair.md`
- Dogfood: `docs/dogfood/2026-08-14-E6-run-to-session-dogfood.md`
- Verdict artifacts: `.spur/run/0557|0558|0559-verdict.json`
- ts-libs release: `@gobing-ai/ts-llm-jsonl-importer@0.4.33` (commit `7d17414` fix; `e63ba6d` lint fix)
- Integration: `main` @ `fa41669c`
