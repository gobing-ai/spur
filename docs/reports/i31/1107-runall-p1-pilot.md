# 1107 — runall-P1-20261006-02 pilot evidence (D62 scoped-gate + budget adoption input)

**Task:** 1107 (feature H15) · **Report written:** 2026-10-07 (UTC) · **Subject batch:** `runall-P1-20261006-02` (P1 tasks 1095–1099, 2026-10-06/07 UTC)
**Companion baseline:** `docs/reports/i31/0912-workflow-baseline.md` (Frozen 2026-09-22) — this report feeds the `:55` pilot criterion and adds no rows to it.
**Source labels used throughout:** `durable` (git history / task History), `transcript` (pi session JSONL, path + line), `projection` (analytical, not observed).

## Summary — verdict first

**Verdict: `partial — INSUFFICIENT_EVIDENCE retained`.**

The batch supplies the *run count* the `0912-workflow-baseline.md:55` criterion asks for (five code-changing runs, 1095–1099, all landed), but not the two retention elements: no failing-gate **output** from the batch survives anywhere durable (the gates ran inside worktrees that were removed after merge), and the batch's gates measured the whole tree, not the task diff, so there is no **diff attribution**. Unmet elements are named in [Criterion mapping](#criterion-mapping-against-0912-workflow-baselinemd55).

What the batch *does* establish is a source-labeled performance sample: a serial phase (1095→1096) followed by a parallel worktree phase (1097–1099), one integrated repository gate at `10367 pass / 0 fail` across 606 files, and two implement-stage timeouts whose kill strings identify the **host subagent limit** as the governing bound — the finding consumed by 1108.

## Timeline

All rows `durable` unless labeled otherwise.

| Phase | WBS | `todo → wip` (UTC) | terminal (UTC) | Commit | Merge | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| base | — | — | — | `6a2cb7c` (2026-10-07T01:28:16Z) | — | batch branch `batch-p1-20261006-1832` cut from this tip |
| serial | 1095 | 2026-10-07T02:52:53Z | 2026-10-07T03:52:39Z | `c59d9312c` (2026-10-07T05:39:01Z) | — | decision lifecycle events |
| serial | 1096 | 2026-10-07T04:37:51Z | 2026-10-07T05:38:24Z | `93f19a02f` (2026-10-07T05:39:02Z) | — | decision reliability reporting |
| parallel | 1097 | *no wip row* | 2026-10-07T06:33:03Z | `e36a1636a` | `bfe4db572` | idea-pipeline signal rescue |
| parallel | 1098 | *no wip row* | 2026-10-07T06:26:00Z | `3d4024c6e` | `414b62302` | anatomy verdict rescue |
| parallel | 1099 | *no wip row* | 2026-10-07T07:01:41Z | `4f682cb96` | `c3542bd32` | evidence-mode operator gates |
| wrap | — | — | — | `01b2ca063` (2026-10-07T07:02:11Z) | — | corpus close, anchor repairs, doc-sync |
| land | — | — | — | — | `90a435a0f` (2026-10-07T07:03:46Z) | merge of `main` (I13 + 1100 design) into the batch |

Sources: `git show -s --format='%h %cI' <sha>` for every SHA; `spur task show <wbs> --json` History for the status rows. `wip`/`terminal` are exact task-History timestamps.

**Serial vs parallel (commit topology — `durable`).** `6a2cb7c` → `c59d9312c` (1095) → `93f19a02f` (1096) is a linear chain: the first two tasks were serial commits on the batch branch, with no merge commit of their own. From `93f19a02f`, three commits branch as first-parent-equal children — `e36a1636a` (1097), `3d4024c6e` (1098), `4f682cb96` (1099) all name `93f19a02f` as their parent — and each is folded back by its own merge commit: `414b62302` (1098), `bfe4db572` (1097), `c3542bd32` (1099). That is the parallel phase, visible in the graph without relying on timing.

**Corroboration (`transcript`).** The three later tasks' terminal timestamps (06:26Z, 06:33Z, 07:01Z) overlap, and two background-worker completion events land 31 minutes apart inside that window (transcript line 594 at 06:19:38Z for 1097; line 672 at 06:50:41Z for 1099).

**Observation O1 (durable, cause unverified).** The three parallel-phase tasks carry only `todo → testing → done` in their committed History; no `wip` row survived the merge. The serial tasks have one. The cause is not established here — a worktree-local lifecycle write that did not travel with the merge is consistent with the shape, but this report does not assert it.

## Gate economy — observed, then the projection labelled

Per-slice `bun run spur-check` gates ran **inside each worktree**, not once for the batch. What the transcript retains (`transcript`):

| Slice | Gate result | When | Source |
| --- | --- | --- | --- |
| 1095 | `10333 pass / 0 fail` — gate still red on a **coverage threshold** (new `decision-events.ts`, functions 88.89%) → bounded test-fix hop | 2026-10-07T02:59:50Z | transcript line 173 |
| 1096 | `10350 pass / 2 fail` mid-isolation; the run's test count is 10352 | 2026-10-07T05:01:44Z | transcript lines 399, 401 |
| 1097 | `10356 pass / 0 fail` | 2026-10-07T06:19:38Z | transcript line 594 |
| 1099 | `10361 pass / 0 fail` | 2026-10-07T06:50:41Z | transcript lines 672, 781 |
| **integrated** | **`10367 pass / 0 fail` · 43370 expect() calls · 10367 tests across 606 files · [388.07s]** | 2026-10-07T07:00:12Z | transcript line 687 (restated line 691) |

The task brief's "1096 10352/0 (367 s)" is **not** what the transcript shows at that point: 10352 is the test *count* of the run that still carried 2 failures. Do not restate it as a clean slice.

**`projection`:** quoting the integrated gate's 388 s against a hypothetical sum of per-slice gate durations, and calling the difference a "~28 min saved by one integrated gate", is an analytical projection — the per-slice gates did run and their durations were never summed from durable data. 388 s is `transcript`; the saving is `projection`.

## Verify chain

- **1095** — verify required a repair loop before PASS; the session review records it as "~25-min verify fix loop" (transcript line 865). The 25-minute figure is a `transcript` approximation, not a measured stage row — no `action_runs` rows exist for this batch (the ADR-117 emission gap the baseline's F2 records).
- **1096** — PASS **after** an AC2 evidence-type rewrite of the verify answer (the AC table needed the declared identities and an isolated evidence-type token). Transcript lines 211–223 show the diagnosis and the rewritten Per-Requirement/AC rows.
- **1097, 1098, 1099** — PASS (transcript line 781: "verified (PASS ×5)").
- **Briefs.** `verify-answer-contract.md` was written to the driver's `.spur/run/` at 2026-10-07T05:04:48Z (transcript line 409); `implement-context.md` at 05:05:07Z (transcript line 411). Both landed **mid-1096**, which is why the brief's "1096–1099 four consecutive first-attempt PASS" does not hold: 1096 needed the AC2 patch, and the contracts that later made the answer shape first-try were introduced while 1096 was still running.

## Timeout attribution (R5) — the host limit, not `implementTimeoutMs`

Two implement-stage timeouts fired in the batch. Both kill strings are host-side subagent notifications, not workflow action failures:

- `Subagent timed out after 1800000ms` — transcript line 418, a `customType: subagent-notify` message (the 30-minute default kill that killed 1096/1099 workers mid-gate).
- `Subagent timed out after 2700000ms` — transcript line 618, the same message shape at the raised 45-minute budget (1099 resumed after it).

The governing bound is therefore **the host platform's subagent limit**, exactly as `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612` (task 0727) states: on the host-inline path the YAML `timeoutMs` is recorded as not-applicable because the host session has no independent kill boundary. The numeric coincidence with the YAML `implementTimeoutMs` default (1800000 ms = 30 min) is arithmetic, not causation — the same kill text appears at 2700000 ms, which is a host value the run set explicitly. The fix — raising the shipped default to 45 minutes and passing the YAML budget to the host dispatch where the host accepts one — is owned by **1108**.

## Criterion mapping against `0912-workflow-baseline.md:55`

Criterion text (`0912-workflow-baseline.md:55`), verbatim: *"scoped-gate/test-fix-timeout pilot (F3/F4) — sample 3 code-changing runs with retained failing-gate output and diff-attribution before freezing any target (D62)"*. The F3/F4 definitions this experiment targets are at `0912-workflow-baseline.md:42`.

| Criterion element | Evidence from this batch | Met? |
| --- | --- | --- |
| Sample ≥ 3 code-changing runs | 5: `feat(decision)` `c59d9312c` (1095), `feat(decision)` `93f19a02f` (1096), `feat(idea)` `e36a1636a` (1097), `feat(workflow)` `3d4024c6e` (1098), `feat(workflow)` `4f682cb96` (1099) — all merged, all `durable` | **met** |
| Retained failing-gate **output** | The batch's red gates are retained only as transcript *summaries* (line 173: coverage-threshold red; line 401: 2 failures). The gate logs themselves (`<wbs>-test-gate.log`, `.findings`) lived in `.spur/run/` inside the per-task worktrees, which were removed after merge — nothing durable survives | **not met** |
| Diff attribution | The batch gates invoked the full-tree `bun run spur-check`; no gate measured or reported per-task diff scope, and no `task-diffstat` artifact was produced for these tasks. This is F4 itself, observed again — not a new disqualification | **not met** |
| F3 full-loss test-fix timeout characterized | Improved but not closed: the kill strings identify the **host** limit (above), which is a more precise cause than the baseline's "cause unknown", but the *lost-work* shape (how much of a stage's work survives a kill) was not measured in this batch | **partial** |

**Verdict token: `partial — INSUFFICIENT_EVIDENCE retained`.** Unmet elements: retained failing-gate output; diff attribution. The `0912-workflow-baseline.md` F3/F4 rows stay as frozen; the addendum below records this mapping without altering them.

**Consequence for 1111:** because the verdict is `partial`, `deferQualityGate` stays **opt-in and labelled a pilot** — it is not evidence-frozen as a default.

## Root-cause list — the five session fixes and their owners

| # | Session fix | Mechanism | Owner |
| --- | --- | --- | --- |
| 1 | 45-minute implement budget instead of the 30-minute default | explicit `timeoutMs: 2700000` on every dispatch/resume (transcript line 781) plus the host-dispatch timeout pass-through | **1108** |
| 2 | Anchor qualification after implement | `test.ts:99 → :126` line-drift repair during the parallel phase; unique basename anchors kept reaching the done gate | **1109** |
| 3 | Verify-answer contract + implement briefs written into `.spur/run/` | the two briefs at 05:04:48Z / 05:05:07Z, folded into the shipped skills | **1110** |
| 4 | Integrated quality gate per batch instead of per-slice reruns | one full gate at batch integration (transcript line 687) | **1111** (`deferQualityGate`) |
| 5 | Parallel worktree fan-out | three concurrent implement workers, one worktree each, merged by rebase + FF (transcript lines 594, 672) | **not productized here** — `--mode parallel` already exists (0931); what this batch did *not* ship is the deferred-gate policy that makes the fan-out cheap, which is 1111 |

## Limitations

No `action_runs` rows exist for this batch, so every duration here is either a task-History timestamp (`durable`), an in-transcript observation (`transcript`), or a projection. Wall-clock totals are **not** derived from conversation timing — the batch's own session review refused to do so (transcript line 781: `session-timeline.mjs` returned `available:false` on pi transcripts), and this report does the same. Session joins, token/USD attribution, and worktree-local trace-DB rows are out of scope (the baseline's F6/E6 gaps) and were not reconstructed.

## References

- Baseline and criterion: `docs/reports/i31/0912-workflow-baseline.md:42`, `docs/reports/i31/0912-workflow-baseline.md:55`
- Timeout boundary: `plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md:600-612`
- D62 feature record: `docs/features/D62_workflow-execution-economy-contract-first-stages-inline-traceability-and-graph-retirement.md`
- Transcript: `~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/2026-10-07T01-27-51-768Z_01a113f9-5cd7-7195-8e4d-b6e7c7643917.jsonl` (cited by line number above)
- Consumers: 1108 (budget default), 1109 (anchor qualification), 1110 (shipped briefs), 1111 (deferred gate, reads the R3 verdict)
