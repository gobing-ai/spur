# Task 1133 — run time breakdown and root cause (run-1133-c3f1, 2026-10-08/09)

Durable record of the "why did this one task cost so long" investigation, produced by the
`/sp:dev-review-session --triage` review of the 2026-10-09 landing session. Times are UTC with the
operator-local PDT value in parentheses (PDT = UTC−7).

| Item | Value |
| --- | --- |
| Task | 1133 — verify the claimed confidence level is earned by the verdict |
| Run | `run-1133-c3f1` (`task-pipeline` v5, `state-machine`, terminated `done`) |
| Worktree / branch | `/Users/robin/xprojects/spur-new-1133-c3f1` / `sp/run-1133-c3f1` |
| Branch base → tip | `15adfeac` → `c279b8712` (re-committed after a reset onto `cce4fda3a`) |
| Changed size | 37 lines production + 153 lines test + 251-line task file + 22-line skill reference |
| Run window | 2026-10-08T22:45:32Z → 2026-10-09T06:36:46Z = **7 h 51 m 14 s** (15:45:32 → 23:36:46 PDT) |
| Landed | `258985f0b` (merge, 2026-10-09 09:29 PDT); worktree + both branches removed 09:35 PDT |
| Data sources | `.spur/spur.db` (`runs`, `action_runs`), `.spur/context/token-ledger.jsonl`, `.spur/run/1133-*`, `docs/tasks5/1133_*` |

Working copies of the tables and the aggregator script live in run scratch
(`.spur/run/1133-time-breakdown.md`, `.spur/run/1133-time-breakdown.py`); this file is the durable
copy. Reproduce the tables with
`python3 .spur/run/1133-time-breakdown.py run-1133-c3f1 2026-10-08T22:30 2026-10-09T07:00`.

## 1. What the engine recorded (per pipeline node)

`action_runs` rows for the run, every one of them `{"provenance":"host-reported","estimated":true}` —
the driving agent supplied `--duration-ms`; no engine clock measured them.

| Node | Kind | Recorded | Window (UTC) |
| --- | --- | --- | --- |
| implement | agent | 7 m 00 s | 22:41:02 → 22:48:02 |
| test | command.gate | 7 m 11 s | 23:45:37 → 23:52:48 |
| triage | decide | 0 s | 23:53:13 |
| review | agent | **4 h 01 m 40 s** | 02:32:19 → 06:33:59 |
| record | command.gate | 1.4 s | 06:36:44 → 06:36:45 |
| done | command.gate | 1.2 s | 06:36:44 → 06:36:46 |

Sum = 4 h 16 m of the 7 h 51 m run. **3 h 35 m carries no node row at all.** `precheck`, `approve`
(HITL) and `verify` — three of the pipeline's declared nodes — have no row for this run. The
`implement` row even begins 4 m 30 s before the run's own `runs.started_at` (22:41:02Z vs
22:45:32Z), which is only possible because the number is the caller's claim, not a measurement.

## 2. Where the wall clock actually went

Activity from the tool-call ledger (1 425 calls in the window; a ≥2 min break between calls counts as
"quiet"):

| Phase | Wall | Active | Quiet | Calls | Node-recorded |
| --- | --- | --- | --- | --- | --- |
| implement (agent) | 7.0 m | 6.6 m | 0.4 m | 84 | 7.0 m |
| *(no node row)* | 57.6 m | 9.7 m | 47.9 m | 78 | — |
| test (command.gate) | 7.2 m | 0.0 m | 7.2 m | 0 | 7.2 m |
| *(no node row)* | 0.4 m | 0.0 m | 0.4 m | 0 | — |
| triage (decide) | 0.0 m | 0.0 m | 0.0 m | 0 | 0.0 m |
| *(no node row)* | 159.1 m | 41.5 m | 117.6 m | 566 | — |
| review (agent) | 241.7 m | 35.5 m | 206.1 m | 586 | 241.7 m |
| *(no node row)* | 2.8 m | 2.5 m | 0.2 m | 35 | — |
| record + done | 0.0 m | 0.0 m | 0.0 m | 0 | 0.0 m |
| **Total** | **475.7 m** | **95.8 m** | **380.0 m** | **1 425** | 255.9 m |

**20 % active, 80 % quiet.** The eight quiet stretches ≥ 8 min account for 5 h 30 m by themselves:

| Quiet | Window (UTC) | Lands inside |
| --- | --- | --- |
| 128.2 m | 04:25:58 → 06:34:08 | review |
| 66.4 m | 01:12:12 → 02:18:35 | no node row |
| 31.5 m | 22:50:24 → 23:21:55 | no node row |
| 28.1 m | 03:28:19 → 03:56:23 | review |
| 26.0 m | 02:55:33 → 03:21:33 | review |
| 24.1 m | 23:29:15 → 23:53:22 | no node row |
| 16.9 m | 00:20:25 → 00:37:16 | no node row |
| 9.7 m | 01:00:17 → 01:10:00 | no node row |

Two caveats on "quiet": (a) the `test` row's 7.2 m is genuinely blocking compute — the measured gate
receipt says 356.5 s — so quiet ≠ wasted everywhere; (b) a quiet stretch *may* hide another blocking
gate run, but only one receipt exists for this task, so the review-internal gate (10 582 tests) is
unmeasured.

The work was also concentrated where no node row exists: the two unnamed stretches hold 644 calls and
`review` holds 586 — **1 152 of 1 425 calls (81 %) happen outside any named pipeline node**. Tool mix
there is exploration, not gates: `grep` 173 + `sed` 105 + `git` 79 in the 159 m stretch; `grep` 117 +
skill-file reads 98 + `git` 69 in `review`.

Task status history shows the same blind spot: `backlog → todo` at 22:45:22Z, then nothing until
`todo → testing` at 06:36:37Z and `testing → done` at 06:36:45Z — **7 h 51 m of work recorded as
`todo`, then two transitions inside 8 seconds.**

## 3. Measured compute (the only non-estimated numbers)

| Gate run | Tests | Test portion | Source |
| --- | --- | --- | --- |
| During review | 10 582 | ~5.5 m (not measured) | `docs/tasks5/1133_*.md` → Review |
| After the re-base (receipt persists) | 10 636 | 334.12 s | `.spur/run/1133-test-gate.log`, `1133-check-receipt.json` (`gateRuntimeMs` 356 448) |
| After landing | 10 649 | 342.62 s | `bun run spur-check` in the 2026-10-09 landing session |

The full-repo gate costs 356.5 s per invocation, and 1142 records five gate runs plus a post-rebase
run for this task (~32 m). The repeated-gate cost is already owned by task **1142**.

## 4. Post-run rework and the unlanded tail

| When (PDT) | Event |
| --- | --- |
| 23:36:37 / 23:36:45 / 23:36:46 | task → `testing`, task → `done`, run closed |
| 23:36:50 | first commit `0c6a27ae2` on the **old** base `15adfeac` (later kept as `backup-1133-0c6a27ae2`) |
| ~23:37–00:00 | branch reset onto `main` `cce4fda3a` |
| 00:00:40 | re-commit `c279b8712` on the new base |
| 00:06:44 | gate re-run PASS, verdict re-captured (digest `339de91c…` → `99f94e55…`) |
| 00:06:44 → 09:27 | worktree unlanded, no WT-3 marker, no registry entry, corpus already says `done` — **9 h 20 m of dwell** |
| 09:29 / 09:35 | landed as `258985f0b`, worktree + branches removed |

The run record states the cause in its own words:
`.spur/memory/runs/run-1133-c3f1.md` — *"re-captured after the branch rebased onto a newer main;
git-tree half of the digest moved, gate re-run PASS"*.

## 5. Is 1133 an outlier? Yes, on `review`

`action_runs` over the 14 days to 2026-10-09, all `task-pipeline` runs:

| Node | rows | avg | max |
| --- | --- | --- | --- |
| review | 202 | 4.1 m | **241.7 m** (= this run) |
| implement | 550 | 5.0 m | 89.5 m |
| recheck | 4 | 5.9 m | 12.4 m |
| test | 474 | 1.4 m | 30.0 m |
| verify | 288 | 2.1 m | 30.0 m |

Wall clock of the eight most recent runs: 1.26 / 2.0 / 1.6 / **7.85 (1133)** / 8.03 / 2.48 / 3.6 / 0.99 h.

## 6. Root causes and where they are owned

| # | Root cause | Evidence | Owner |
| --- | --- | --- | --- |
| RC1 | Wall clock is operator/model latency, not pipeline work: 380 of 476 minutes had no tool activity, and the 4 h `review` contains a single 2 h 08 m gap with 35 m of active time | §2 table; ledger quiet stretches | policy candidate (report-only — one observation is not a policy); its **attribution** half is filed under 1136 R10 |
| RC2 | The run cannot report its own time: every duration is caller-supplied, three declared nodes emitted no row, and 2 h 39 m of the run belongs to no node | §1 table; `result_json` provenance on all six rows | **1136 R9, R10** (filed by this review) |
| RC3 | Base drift invalidates finished verification: the proof digest binds the whole git tree, so a `main` that moved after the run closed forced a re-commit, a fresh verdict and another 356 s gate for identical content | run record log line; digest `339de91c…` → `99f94e55…`; §4 table | intra-run half: 1135 R4; cross-run/landing half: **1136 R11** (filed by this review) |
| RC4 | Full-repo gate cost paid repeatedly (356.5 s per run, ≥5 runs ≈ 32 m for this task) | §3 table | **1142** (already owned, with fuller numbers) |
| RC5 | Nothing signals "finished but unlanded": no WT-3 marker, no registry entry, corpus `done`, branch absent from `main`; the pre-removal check reported `ok — 13 evidence file(s) persisted, nothing abandoned` while the run's own directory was never carried | §4 table; `persist-out-check` output; `carryRunRecordDir` silent `ENOENT` return (`packages/app/src/services/inline-run-setup.ts:983`) | **1136 R11, R12** (filed by this review) |
| RC6 | Repo-wide rule drift is charged to whichever task touches the tree (`every-export-has-tsdoc` failed on unrelated `apps/web/src/lib/rpc-client.ts`) | `## Review` finding 5 in the task file | detection owned by 1142 R1/R3; repair-on-`main` remains a candidate, not a policy |

## 7. Limits of this analysis

- `review`'s internal time cannot be decomposed: no substep rows exist, and no per-run agent-session
  directory was carried into the invoking tree (persist-out reported `persisted: 1`; the record pair
  `.spur/memory/runs/run-1133-c3f1.{md,state.json}`, the 13 `.spur/run/1133-*` files and the verdict
  are all that survived — `.spur/memory/runs/run-1133-c3f1/` does not exist).
- The "active/quiet" split comes from the tool-call ledger, which is written by the host session: a
  blocking subprocess (a gate run, a long test) looks exactly like an absent operator. Only gate time
  covered by a receipt is separately measured.
- The 4 h `review` figure is a caller estimate, not a measurement (RC2).
