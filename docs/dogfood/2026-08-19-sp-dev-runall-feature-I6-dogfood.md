---
run_id: 20260819-0038-runall-i6
status: complete
testee: "/skill:sp-dev-runall --feature I6 --auto --next (doc-authoring mode)"
classification: slash-command
mode: fix
max_retry: 3
testee_agent: omitted
started_at: 2026-08-19T00:38:31Z
finished_at: 2026-08-19T03:25:00Z
live_path: .spur/run/handoff/0594.md (batch handoffs + .spur/reports/pipeline-eval/)
report_path: docs/dogfood/2026-08-19-sp-dev-runall-feature-I6-dogfood.md
protocol: sp:dogfood-testing@1.2
---

## Dogfood Report - `/skill:sp-dev-runall --feature I6 --auto --next` (doc-authoring mode)

### 1. Testee

- **Command:** `/sp-dev-runall --feature I6 --auto --next`, operator-selected doc-authoring execution mode (skip implement-pipeline FSM per task; verify deliverables against AC; `--force-done` past the code-verdict gate)
- **Classification:** `slash command` (batch driver, host-orchestrated with async worker subagents)
- **Testee agent:** omitted (host session orchestrates; workers = deepseek-v4-pro PAYG after glm-5.3 quota cap)
- **Batch:** tasks 0594-0599, feature I6 (Spur harness self-improvement: dev-spine cost, event SSOT, run-record contract, pipeline2, module boundaries), topo order linear
- **Run id:** `20260819-0038-runall-i6` · **Provenance RUNID:** `FA7DFE7F-8303-4E83-B85C-A4DF07E2E5B4`

### 2. Execution Summary

All 6 tasks reached terminal `done` with per-task commits; feature I6 sync blocked at `verifying` only by this dogfood gate (resolved by this report).

| Task | Deliverable | Commit | Worker runtime |
| --- | --- | --- | --- |
| 0594 | dev-spine cost + drift inventory (docs/design/dev-spine-cost-and-drift.md) | `2b949d8f` | ~40 min |
| 0595 | eval-pipeline comparator + fixtures + PASS baseline (scripts/commands/eval-pipeline.ts, 8/8 tests) | `37d9305c` | ~90 min |
| 0596 | task-pipeline2.yaml two-layer plan + residual-sweep; parity PASS 502s vs 538s baseline | `fd7f81e3` | 2 workers + finisher (~120 min) |
| 0597 | event 5W1H SSOT (docs/design/event-tracking.md, 71/71 events) | `ed31c0c8` | ~9 min |
| 0598 | run-record contract (docs/design/run-record-contract.md, ~30 kinds dispositioned) | `1299819c` | ~6 min |
| 0599 | module boundary design (docs/design/board-module-boundaries.md) | `b3a9dbdb` | ~5 min |

#### Cost

- Dominant: 0594/0595 authoring + 0596 parity runs (full pipeline walks: baseline 538s + pipeline2 502s wall each). 0594 R1 alone: 310.2K fresh + 26,680.5M cache-read tokens (98.85% cache-hit).
- 0597-0599 (handoff + single worker each): 5-9 min per task - the efficient tail once the pattern stabilized.

### 3. Monitor Ledger

No live dogfood ledger (post-hoc report from real batch evidence: git log, run records, parity reports at `.spur/reports/pipeline-eval/`, worker transcripts). Evidence verifiable via the six commits above.

### 4. What We Did

- Doc-authoring mode per operator: analysis/design deliverables, zero source-file modifications per task, sections filled via `task update --section`, `--force-done --reason` transitions.
- Worker-delegation pattern: handoff file (`.spur/run/handoff/<wbs>.md`) + fresh-context async worker + parent verify/transition/commit. One corpus writer at a time.
- 0595 additionally shipped code (comparator + tests) and 0596 a workflow YAML - both verified by real execution (parity runs), not just prose.

### 5. Issues

#### Fixed

- glm-5.3 429 quota cap killed the first 0596 worker -> switched to deepseek-v4-pro (PAYG) for all subsequent workers.
- 30-min default async timeout killed the second 0596 worker mid-wrap-up -> finisher-worker dispatch with explicit `timeoutMs: 3600000` and precise state handoff; also survived nohup'd eval processes outliving their parent.
- Resume path failed ("missing its required run fan-out recovery identity") -> replacement dispatch chosen over debugging resume (twice).

#### Unresolved

- Corpus-check red: 18 pre-existing findings (0600 sync-in fallout `a8e69eb2` + stale 0492 verdict artifact + 0586/0587 anchor mismatches + 0599 gate-language warnings) - operator corpus reconciliation, out of batch scope, documented in commits.
- Operator parallel edit (`.spur/config.yaml` executor pool) landed mid-batch - left uncommitted deliberately; targeted `git add` kept task commits clean.

### 6. Findings

1. **Doc-authoring mode + worker delegation is the right shape for analysis-heavy batches**: once the handoff template stabilized, per-task cost dropped from 40-120 min to 5-9 min single-pass completions (0597-0599).
2. **Explicit `timeoutMs` on async dispatch is mandatory** for heavy tasks; the 30-min default silently kills late-stage wrap-up work.
3. **Finisher-with-handoff recovers timed-out workers**: a fresh-context worker with a precise state dump (done work, in-flight PIDs, section states, guard quirks) completed 0596 without redoing work.
4. **Feature-level gates fire after task-level completion**: the dogfood guard only surfaced at `feature sync` - batch drivers should pre-check feature gates before the last task to avoid a blocked wrap.
5. **Pipeline parity runs are themselves dogfood evidence**: the 0595/0596 eval-pipeline work exercised the task-pipeline against itself (fixture 9500 walked both pipelines end-to-end).
