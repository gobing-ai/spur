# Task 1077 — remaining blocker on the kill/resume leg (8 of 9 steps green)

State at hand-off: `scaffold`, `create-task`, `start-loops`, `dispatch-to-done`, `orchestrator-reply`,
`guest-join`, `trace`, `teardown` pass; `kill-redispatch` does not. Every claim below has its evidence.

## Finding K1 — the orchestrator does not dispatch a task created after its loops started

- **Observed:** step 6 creates the `e2e:hang` task, prepares it (AC + Design so `task check --as wip`
  passes — verified), tags it `fleet:auto`, promotes it to `todo`, and then polls for its turn. Over
  240 s of polling **with a real CLI nudge to the planner on every poll** (`spur message send --to
  <planner> "tick for <wbs>"`), the coder's inbox contains **no** `fleet:task:<hangWbs>:1` row and the
  task stays `todo` (evidence: kept scratch `stub-prompts.jsonl`, `message inbox --agent <coder>`).
- **Contrast:** the same task created *before* the loops start (the done task) is dispatched on the
  first tick with a keyed attempt, every run.
- **Consequence for the harness:** the kill leg cannot rely on the strategy to dispatch a
  late-created task, so it currently falls back to an operator-path dispatch.

## Finding K2 — a run for an operator-dispatched (unkeyed) turn never finalizes when the member is killed

- **Observed:** with the operator-path dispatch (`message send --to <coder> "/sp:dev-run <wbs> --auto"`)
  the stub receives the turn, hangs, is killed, the loop is restarted (before the receipt poll, so the
  restart's reconcile can run) — and `message inbox --json` still reports the row's `runStatus` as
  `running` for the whole 90 s budget.
- **Contrast:** the *keyed* strategy dispatch finalizes as `errored` after the same kill (observed in
  earlier runs: `killed run=… status=errored … delivery=delivered`), which is why the keyed path is the
  only one that can carry the kill/resume assertion today.
- **Interpretation (MEDIUM confidence, not proven):** run-row finalization on kill ties to the keyed
  `fleet:task:` correlation; an unkeyed operator message leaves the row `running` until something else
  reconciles it.

## What this means for the task

Task 1077's AC — "the inbox-only fleet is proven end to end" — is **not met**, so the task stays
`todo`; the receipt records the failing step honestly rather than a proof. The two findings above are
the substance the harness produced: its job is to prove or refute end-to-end behaviour, and it refuted
one leg with reproducible evidence. Fixing them is product work in the strategy/run-finalization path
(not harness work), which is why it is recorded here instead of being papered over.

---

## Correction — 2026-10-06 (task 1091)

The two findings above are **dropped as framed**. They are superseded by task 1091
(`docs/tasks*/1091_*`); this note is appended rather than rewriting the history.

- **K1 is refuted by its own premise.** The orchestrator loop wakes on `task.created` and
  `task.updated` (`WAKE_EVENT_NAMES`, `packages/app/src/services/agent-loop-service.ts`) and on the
  `--poll` backstop. Every kept run shows the late task *evaluated* on each tick — early runs held it
  `not-ready`, later ones `no-idle-instance` with `unresolved-deliveries … (1 ambiguous)`. The
  "not dispatched" symptom was N1 below, not a missing wake.
- **K2's mechanism is different from the record.** An unkeyed operator message to a `persistent`
  member goes through the stdin path, which by the 0831 "acceptance is delivery" contract writes **no
  `coordination_runs` row** — so `runStatus` is `null`, never `running`, and a poll for a terminal
  `runStatus` could not succeed by construction. `DeliveryReconciler.reconcile()` only fails exhausted
  queued rows, so the restart was never the thing that marked it interrupted.
- **The real gaps, fixed by 1091:** **N1** — one ambiguous *unkeyed* delivery held GTD dispatch for the
  whole project (the gate now counts only `fleet:task:*` keyed rows and names the blocking ids);
  **N2** — a run left `running` by an ungraceful member death (SIGKILL/crash) was never finalized, so
  the instance never returned to the idle set (the member loop now reaps its own spec's orphans before
  its first drain and emits `agent.invoke.exit`); **H** — the harness dispatched through the operator
  path and measured a receipt that path never writes (it now drives the hang task through the strategy
  alone and SIGKILLs the loop).
- **Evidence:** the `kill-redispatch` leg passes with `docs/reports/fleet-e2e-receipt.json` reporting
  all nine steps; the receipt's `kill-redispatch` row names attempt-1 `fleet:task:<wbs>:1`, the
  SIGKILLed run finalized `errored` with `completed_at`, and the strategy's own
  `fleet:task:<wbs>:2` re-dispatch.
