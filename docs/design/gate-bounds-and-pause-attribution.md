---
kind: design
title: "Gate bounds and host-pause attribution"
status: implemented
created_at: 2026-11-08
updated_at: 2026-11-14
related: [D3, "1319", "1127", "1239", "1240"]
tags: [contract, D3, quality-gate, workflow, verdict]
---

# Gate bounds and host-pause attribution

**Feature:** D3 · **Task:** 1319 · **Status:** implemented in the same commit as this satellite.

Four surfaces gained a bound or a measurement after the 2026-11-06→08 credit-sentry post-mortem
(21 tasks; `.spur/run/batch-20261107T012818Z/batch-report.md`, `action_runs`, `token-ledger.jsonl`).
The failure they share is not slowness — it is *unattributable* slowness: a hung gate, a ten-hour
pause, and a self-certified PASS all looked identical to a healthy run from every Spur surface.

## 1. Gate timeout layering

Three bounds, each owning a different failure:

| Bound | Where | Default | On expiry |
| --- | --- | --- | --- |
| **Per-spawn** `gateTimeoutMs` | `runShellCommand` (`packages/app/src/services/quality-gate.ts`) — the single spawn used by the full attempt, the recheck probe, the light sub-checks and the changed-path read | `900000` (15 min) | `BLOCKED` status token, `gate timeout after <N>ms: <cmd>` + the last 40 log lines into `<wbs>-test-gate.findings`, **no check receipt**, exit 2 |
| **Action backstop** `gateBackstopMs` | `command.gate` `timeoutMs` on the `quality-gate` step (`config/workflows/task-pipeline.yaml`) | `14400000` (4 h) | typed `timeout` outcome; the action writes `BLOCKED`; ts-runtime's process-group ownership reaps descendants |
| **Step budget** `stepTimeoutMs` / `implementTimeoutMs` | unchanged (agent.run budgets) | 30 / 45 min | unchanged |

Invariants:

- **BLOCKED is not FAIL.** Exit 2 marks an *undecided* visit (usage error, lock timeout, deadline).
  Recording it as FAIL would be a lie about the tree, and writing a FAIL receipt keyed to the tree
  would arm the no-progress skip so the same tree could never be re-gated after a transient hang.
- **A malformed bound is a usage error.** `gateTimeoutMs=abc|0|-5` exits 2 naming the variable; it
  never silently falls back to the default, because an operator who tried to bound the gate must not
  end up with an unbounded one.
- **A numeric string is a valid bound** in `command.gate` (`"900000"`). Every `${vars.*}` template
  resolves to a string, so the old `typeof === 'number'` check silently dropped a YAML-declared
  bound — the backstop was a no-op until it coerced.
- **Known ceiling.** `spawnSync` reaches only the direct `sh`; a grandchild survives on the direct
  `spur task gate` path. The pipeline path is group-owned through `ts-runtime`. The upgrade
  (`runBoundedChild`, async gate chain) is recorded as a `ponytail:` comment on `runShellCommand`.

## 2. Verdict evidence replay (`spur task verdict --replay`)

Retired 2026-11-14 with the slim-harness review: the flag, `verdict-replay.ts` and its anchor parser
are removed. The pipeline never passed it (the gate already ran the tests for the tree), and
evidence cells are free prose that nothing parses. `spur task verdict` only derives.

## 3. Lint-shape repair inside `review`

Retired with the slim-harness refactor: `spur task verdict --from-answer` no longer lints the
answer, so there is no lint file, no `reviewLint` var and no `review → review` retry edge. A
non-PASS verdict routes to `remediate` as any other failure.

## 4. Host-pause attribution and the stalled label

A host-executor `agent.run` records `{"pause": true}` in two milliseconds; the work happens in the
operator's session. The resume is the only Spur-owned moment that sees both ends, so it records:

```json
{ "node": "implement", "action": "agent.run", "pausedAt": "...", "resumedAt": "...",
  "hostDurationMs": 36675000, "executor": "host" }
```

appended to run metadata `hostPauses[]` (`packages/app/src/workflow/host-pause.ts`). `pausedAt` is
the paused action row's `started_at` (a row whose `result_json` carries `"pause": true`). Receipts
whose interval is missing, equal or inverted are stamped `startedAt = pausedAt`,
`finishedAt = resumedAt` before persist; a receipt that measured itself is persisted verbatim.

Consumers:

- `spur workflow trace` entries carry `hostPauses`, so `spur workflow profile` prints a `host=` figure
  beside `p50`/`max`/`idle`. Host time is attributed per (node, action) row — a pause recorded on
  `hitl.confirm` never inflates the sibling `agent.run` row of the same node; a legacy record
  without `action` counts as `agent.run`.
- `spur workflow cost --by-state` folds the same `hostPauses[]` into a per-state `host=` figure
  (optional `hostMs`, absent when no pause was measured, so the JSON is unchanged without pauses).
- A run whose status is `paused`/`interrupted` and whose open pause exceeds the stall budget gets a
  **derived** `stalled` flag plus its pause duration; the human trace prints
  `Stalled: paused <n>s — resume: spur workflow continue <runId>`. The persisted status stays
  `paused`, no row is failed, and `workflow clean`'s stale finalization (running/pending only) is
  unchanged — auto-failing a resumable run would destroy the state the hint points at.
- Stall budget resolution: the paused node's own budget → `SPUR_WORKFLOW_STALL_MS` → 30 min. The
  host surface records the node's `timeoutMs` on the pause row (`data.timeoutMs`), and the trace,
  profile and cost readers take it from the last paused action row (`pausedNodeBudgetMs`).
- `spur workflow profile` lists stalled runs (`stalledRuns[]` in JSON, omitted when none) by also
  reading `spur workflow trace --status paused`; `trace --status` therefore accepts
  `done|failed|running|paused|interrupted`. `spur workflow cost` prints stalled lines in text mode
  only: the label is time-dependent, and `cost --json` stays byte-stable.
- `runs.updated_at` is INTEGER epoch ms; the pause-age reader accepts a number or an all-digit
  string, since `Date.parse` on it is NaN and would suppress every label.

## Deferred (upstream, `/Users/robin/xprojects/ts-libs`)

- **D1** `@gobing-ai/ts-runtime` `PipeProcessOptions` has no `timeout`, so the generic `shell`
  action cannot be bounded. The one `shell` step that runs a project command (the implement-exit
  formatter) therefore moved to a bounded `command.gate` instead.
- **D2** `@gobing-ai/ts-dual-workflow-engine` persists `phase_runs` append-only, so a paused phase
  row cannot be closed on resume. Attribution lives in `hostPauses[]` instead.
