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
