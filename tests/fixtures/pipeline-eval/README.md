# Pipeline Eval Fixtures (task 0595)

Deterministic fixture task set for `scripts/spur-dev.ts eval-pipeline` — the parity
comparator that measures a task pipeline (R1–R7 of task 0595).

## Layout

| Path | Role |
| --- | --- |
| `templates/` | Fixture task bodies (checked in). `fixture-minimal.md` is the single-task set. |
| `.spur/tmp/eval-pipeline-*/worktree` | One disposable detached Git worktree per pipeline invocation. It contains the run-local config, task folder, database/run artifacts, and scratch tree. |

## Lifecycle (R4 — no corpus pollution)

1. **Create** — the comparator creates an isolated detached Git worktree and writes a
   worktree-local task config with `baseCounter: 9499`. The real source-local `spur task
   create --json` / `task update` commands then allocate deterministic **95xx** WBS values
   and fill the template sections. This floor exists only inside that disposable project;
   normal project allocation reads only the repository's production folders.
2. **Run** — `spur workflow run <pipeline> --vars '{"wbs":"95xx",...}'` executes from the
   worktree. Pipeline task lookup, Git diff guards, task files, scratch, `.spur/run`, and the
   database are all private to that run. Concurrent evals cannot overwrite or clean one another.
3. **Cleanup** — the comparator removes only its own worktree in a `finally` block, including
   after a failed run. `--keep` retains the worktree and prints its absolute path for post-mortem
   inspection; remove it later with `git worktree remove --force <reported-path>`.

No fixture task or scratch file is written under the repository's configured task folders or
the shared `tests/fixtures/pipeline-eval/scratch` path, so an eval run cannot affect the normal
task corpus or another eval run.
