# 0912 — Post-delivery workflow baseline and measured task-pipeline pilot decision

**Task:** 0912 (feature I31; evidence for D62 R4/R9/R13/R14) · **Source commit:** `dc109b0e42a4ca042a3dfc6c8f1036e3779f2abe` · **Frozen:** 2026-09-22T01:30:57Z (before querying)
**Provenance:** source-local CLI `bun apps/cli/src/index.ts` v0.3.91 (published `spur` on PATH not used); runners codex-cli 0.155.1 / claude 2.1.278. Evidence: `workflow trace` CLI, read-only SQL over the main-checkout trace DB (`/Users/robin/xprojects/spur-new/.spur/spur.db` — never mutated), `.spur/run/` stage artifacts and verdicts, `task show` receipts, `workflow list --json` resolution layers, installed-plugin diffs. Machine-readable form: `0912-workflow-baseline.json` (same directory). Prior consumed: 0905 sparse baseline; 0903–0909 rechecked **done** this run.
**mutationPolicy honored:** no runtime/source/workflow/config/installed-adapter mutations; no workflow cleanup; no status changes; no live-DB writes.

## Cohort (R1/AC1/AC2) — reproducible, modes and change classes separated

Window: 14 UTC days ending at freeze · complete window (no truncation, no population claims needed) · dedup by persisted run id · lifecycle FSMs (task-lifecycle/feature-lifecycle) and dry runs excluded by rule.
**Cohort: 16 task-pipeline rows in the main-checkout DB.** DB-terminal **6** (2 done, 4 failed) · rows left `running` at freeze **10**. Preparation's capped sample (15 rows: 2/4/9) reconciles with one additional row at freeze.
**Modes (DB-terminal):** engine 1 (done, task 0887) · batch 1 (done, task 0854) · inline 0 · unknown 4 (all failed).
**The inline-mode headline:** 0 inline runs reached a DB-terminal state, yet 5 inline executions carry out-of-DB terminal evidence (verdicts PASS, done-transition receipts, worktree merge records, batch report) — inline terminal evidence lives entirely outside the run-row lifecycle (finding F1). Live corroboration: this very task's run (`inline-0912-6441`, worktree DB) has 0 `action_runs` rows mid-flight.
**Definition digests:** 4 distinct digests inside the window (`485542ce…` Sep 9–14, `1df82541…` Sep 13–15, `20fdc169…` Sep 17–18, `e885c9d9…` Sep 20); a 5th (`91349664…`) is current at freeze. No comparison pools across digest versions.
**Change classes:** code — 0849, 0855, 0887, 0898, 0906 · docs — 0850, 0853, 0854 · batch-verification — G66 · dispatch-error (no task) — 4 failed rows.

## Measured timing and honest gaps (R2/AC2)

- **Complete runs (DB-anchored):** 0887 **5228 s** (engine; 9 structured action rows) · 0854 **14514 s** (batch). Out-of-DB approximations: 0906 ≈3379 s (row insert → terminal commit `09a757a0c`) · 0898 ≈3150 s (row insert → worktree `mergedAt`).
- **0887 stage trace (the only structured one):** implement 169 s → test 12 s (fail, lint-fast-fail) → test-fix #1 **1800 s failed at the timeout bound** → test-fix #2 899 s → recheck 239 s → review 519 s → verify 367 s → record/done 3.4 s. Action sum 4008 s vs 5228 s wall → ≈1220 s inter-action dispatch overhead (n=1 observation).
- **Repair/gates:** 5 repair events total — 0887 (1 gate repetition, 2 test-fix attempts, 1 full-loss timeout) and 0906 (1 gate repetition, 3 recovery events: pre-existing-main-lint gate fail outside the task diff, review provider timeout resume, record-gate retry). Batch runs 0849–0855: test-fix counters all **0** — gates passed first try.
- **Sessions / tokens / USD: null, denominator 0** — 0 of 16 cohort runs have a `history_run_session` link; 4,274 in-window `history_tool_call` rows are unjoinable to cohort runs (E6 gap persists in-window). Aggregate all-history scope: 682,181 rows — never labeled as 14-day results. Economy conclusions are **wall-clock only**.
- Operator interventions: 0 corroborated (0906 event trace); others null (not instrumented). Process exit ≠ workflow terminal ≠ verify PASS kept distinct throughout.

## Adoption comparison (R3/AC3) — no generated adapter was modified

| Surface | Finding |
| --- | --- |
| Definitions today | All 10 workflow definitions resolve **digest-identical** between registered (installed 0.3.91 bundle) and shared (source) layers; `task-pipeline`, `wrapup-pipeline`, `idea-pipeline` byte-identical (cmp exit 0) |
| In-window resolution | `ce44b029` (2026-09-18) actually resolved task-pipeline from the **installed node_modules path** with layer mislabeled `project`; `51a0f9b6` from the shared source path; worktree runs from worktree project layer |
| Installed plugin | `inline-run-setup.ts` **byte-identical**; installed driver doc differs only in 5 cosmetic command-name hunks (`/sp-dev-*` vs `/sp:*`); the `--action`/`--close` emission contract is present in **both** copies |
| Inline driver emission | Contract (ADR-117/0868) documented + scripted, **not executed**: 0/15 inline cohort runs have any `action_runs` row; engine contrast: 2,888 rows over 429 runs |
| Mode adoption (window) | wrapup 26 rows (14 done / 12 failed — highest terminal throughput) · idea 10 rows (1/4/5, all 5 running rows stale) · batch 7 rows · fleet **0 rows** (31 `coordination_runs` rows are pi host processes without run ids — not fleet evidence) |

## Reconciliation: defects, adoption gaps, unknowns (R4/AC4)

**Confirmed defects & adoption gaps (reproduced, P/D62):**
- **F1 — inline runs never close their run rows.** All 10 in-window running rows have `updated_at` within 1 ms of `started_at` (8 exact to the ms; zero meaningful updates since insert); 7 carry out-of-DB terminal proof (0850/0853/0854/0855/0887/0898/0906 verdicts PASS + tasks done; G66 batch report); 3 terminal outcomes remain unknown. `spur workflow clean` would reap live-completed runs as stale. P owns row closure; D62 owns driver adoption.
- **F2 — ADR-117 structured emission is not executed** (0/15 inline runs; this run repeats it live despite the installed script being byte-identical and both doc copies carrying the contract).

**Adoption gaps (E6):** F6 worktree trace fragmentation (batch worktree rows absent from main DB; inferred, labeled) · F7 zero session/cost joins in-window.

**Avoidable overhead candidates (not yet pilot-eligible):** F3 full-loss test-fix timeout (measured once, 1800 s lost; cause unknown — no failing-gate output retained) · F4 gate-measures-tree-not-diff (0906 pre-existing lint fail → fix pass + 239 s recheck; 2 occurrences) · F5 four sub-second `wbs=0000` dispatch rejections (operator rework, ~0 machine cost).

**Unknowns (retained, not relabeled):** terminal outcomes of `5b9072aa` (review-stage receipts only) and `ce44b029` (B8 batch, worktree record still active; its review artifact predates the row start); identity/outcome of `e021bbc1` (no side evidence); G66 digest labeling mismatch (batch report `045f523b…` vs DB row `20fdc169…`); 0887's timeout cause; operator-intervention instrumentation.

## Decision (R5/R6/AC5/AC6): ONE pilot selected; the rest INSUFFICIENT_EVIDENCE

**SELECTED — inline-driver terminal close + structured action emission on task-pipeline** (the ADR-117/D62 R4 contract that already exists on disk, unexecuted).
- **Why eligible:** concrete shared cause (driver path never calls the receipts — 15/15 cohort runs, reproduced live) · observable saved work (structured rows make progress/`ActionRunDao`/E6 joins queryable; stale-reapable completions 10 → 0) · unchanged correctness contracts (pure observability; no gate, graph, status-semantic or mutation-policy change; reviewer isolation and proof invalidation untouched).
- **Benefit target (frozen BEFORE implementation, counts not percentages):** in the pilot window, every newly terminal inline task-pipeline run has ≥1 `action_runs` row per executed action, and every such run row is terminal (`done`/`failed`/`paused`) — zero rows left for `workflow clean` to reap. Baseline to beat: 0/15 inline runs with any action rows; all 8 in-cohort inline/batch rows non-terminal (2 mode-unknown rows excluded).
- **Before/after:** this baseline's documented read-only queries vs identical queries over the pilot window. **Projection label:** all savings are analytical projections from the mechanism; one successful pilot run is not live proof — a live claim requires ≥3 observed terminal inline runs.
- **Regression checks:** `plugins/sp/tests/inline-run-setup.test.ts`; task-local checks + task/feature gates on the pilot run; verify/record gates and reviewer isolation unchanged; no YAML/config/installed-adapter edits.
- **Deadline & rollback:** promote-or-delete review by **2026-10-06** (calendar date set now; not a graph candidate, so no `config/workflow-candidates.json` entry). Rollback: driver stops calling the receipts — no schema/graph/config rollback.

**INSUFFICIENT_EVIDENCE (with smallest experiments):** scoped-gate/test-fix-timeout pilot (F3/F4) — sample 3 code-changing runs with retained failing-gate output and diff-attribution before freezing any target (D62) · any token/USD or percentage claim — pilot-window session joins + history import first (E6) · fleet conclusions — one bounded serve session on a quiet tree (I31 carry-over S5). Graph candidates keep the existing promotion record + calendar deadline; idea/batch/wrap-up migration stays conditional on pilot evidence.

## Limitations, delimitation, next action (R7/AC7)

Single-tree window; worktree-local trace DBs mean cohort counts come from the main-checkout DB only. Inline terminal evidence is artifact-derived; approximate durations are labeled per run. No fleet runs, no session joins, no cost attribution. Verdict mtimes for batch runs are bulk merge-copies (all five 0849–0855 verdicts share one second) — never completion times. Terminal execution denominator: 6 rows; no completion-rate generalization from n≤2 per mode.

**One executable next action (owner D62; P owns the row-closure defect fix):** wire the executing inline driver on ONE controlled task-pipeline run to call `inline-run-setup.ts --action` per boundary and `--close` at terminal, then:

```
sqlite3 -readonly /Users/robin/xprojects/spur-new/.spur/spur.db \
  "select run_id, count(*) from action_runs where run_id='<new-run-id>' group by run_id;"
bun apps/cli/src/index.ts workflow trace --last 20 --json   # recount non-terminal rows
```

**Repeatable check (valid data + deliberate invalid cases):**

```
$ bun run docs/reports/i31/0912-check.ts
CHECK-PASS: 16 runs (done:9 failed:4 nonterminal:3), 4 digests, 7 findings, pilot=SELECT (deadline 2026-10-06), 6 unknowns; denominators, nulls, identity, evidence refs, adoption flags, decision readiness validated
$ bun run docs/reports/i31/0912-check.ts --self-test
SELF-PASS: all deliberate invalid cases detected
```
