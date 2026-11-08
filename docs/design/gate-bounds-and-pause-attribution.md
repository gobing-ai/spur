---
kind: design
title: "Gate bounds, verdict replay, and host-pause attribution"
status: implemented
created_at: 2026-11-08
updated_at: 2026-11-08
related: [D3, "1319", "1127", "1239", "1240"]
tags: [contract, D3, quality-gate, workflow, verdict]
---

# Gate bounds, verdict replay, and host-pause attribution

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

`--replay` is opt-in, off by default, and does exactly one thing: after the answer lint passes and
the verdict is derived, it re-executes the **test files the verdict rows cite**.

| Rule | Value |
| --- | --- |
| Source of files | backticked `path:line` / `path:start-end` anchors in each derived row's `evidence` (the grammar `spur task migrate-anchors` qualifies), test files only (`*.test.*` / `*.spec.*`) |
| Cap | 5 distinct files, first-cited order |
| Execution | the `test-changed` SDLC binding from the owning workspace (`cd <workspace> && bun test <path>`), which leaves the root coverage threshold out of a focused run |
| Bound | 120 s per file, via `ProcessExecutor` with `timeout` (group-owned) |
| Lock | never under the host-wide gate lock — replay is not a second full gate (1127) |
| Effect | a cited file that is missing, exits non-zero or times out **downgrades a derived PASS to PARTIAL** and adds one finding naming the anchor; a non-PASS is never upgraded |
| Record | the artifact carries `replay: { files, ran, findings }` |

Why this and not a general command replay: the anchors are already machine-parsed, the result is
deterministic, and "the cited test does not pass" is exactly the defect class that survived the
2026-11-07 batch (wrong fixtures, missing cases, coverage-gaming) while the review certified PASS.

## 3. Lint-shape repair inside `review`

`spur task verdict` deletes `.spur/run/<wbs>-verdict-lint.txt` on every invocation and rewrites it
(with `line N: message` rows) only on a lint failure. The `review` state:

1. reads that file (capped at 600 chars) into the `reviewLint` var at the top of `onEnter`, so the
   prompt carries the findings *and* the declared R/AC ids the lint names — empty on the happy path,
   so the prompt pays nothing when nothing is wrong;
2. writes a **run-scoped** retry token `.spur/run/<runId>-review-lint-retry` as the LAST `onEnter`
   step (after the review fold and the operator-answer fold, because deleting the stale
   `-review-cert.md` / `-review-answer.txt` earlier would make a fold read the previous visit's
   verdict), and touches `-review-lint-retried` so the retry happens at most once per run;
3. declares `review → review` after the denial route and before `retry-exhausted`: a lint retry is
   not a repair attempt, so it does not consume the shared `test-fix-attempt` counter.

A second lint failure leaves the token `NONE` and routes to `remediate` exactly as before. Exit codes
are unchanged (lint failure and a real non-PASS both exit 1): changing them would change
`command.gate`'s typed outcome for every caller. The distinguishing signal is the lint file.

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
  per node beside `p50`/`max`/`idle`.
- A run whose status is `paused`/`interrupted` and whose open pause exceeds the stall budget gets a
  **derived** `stalled` flag plus its pause duration; the human trace prints
  `Stalled: paused <n>s — resume: spur workflow continue <runId>`. The persisted status stays
  `paused`, no row is failed, and `workflow clean`'s stale finalization (running/pending only) is
  unchanged — auto-failing a resumable run would destroy the state the hint points at.
- Stall budget resolution: explicit node budget → `SPUR_WORKFLOW_STALL_MS` → 30 min.

## Deferred (upstream, `/Users/robin/xprojects/ts-libs`)

- **D1** `@gobing-ai/ts-runtime` `PipeProcessOptions` has no `timeout`, so the generic `shell`
  action cannot be bounded. The one `shell` step that runs a project command (the implement-exit
  formatter) therefore moved to a bounded `command.gate` instead.
- **D2** `@gobing-ai/ts-dual-workflow-engine` persists `phase_runs` append-only, so a paused phase
  row cannot be closed on resume. Attribution lives in `hostPauses[]` instead.
