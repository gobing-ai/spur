# Pipeline Eval Fixtures (task 0595)

Deterministic fixture task set for `scripts/spur-dev.ts eval-pipeline` — the parity
comparator that measures a task pipeline (R1–R7 of task 0595).

## Layout

| Path | Role |
| --- | --- |
| `templates/` | Fixture task bodies (checked in). `fixture-minimal.md` is the single-task set. |
| `tasks/` | Generated fixture task files (runtime, gitignored). Registered in `.spur/config.yaml` as a task folder with `baseCounter: 9499` → fixture WBS is always **95xx**. |
| `scratch/` | Deliverables fixture tasks write (runtime). NOT gitignored: the pipeline implement no-op guard is git-based, so the scratch file must be a visible working-tree change during the run; cleanup deletes it after. |

## Lifecycle (R4 — no corpus pollution)

1. **Create** — the comparator allocates each fixture via
   `spur task create "<title>" --folder tests/fixtures/pipeline-eval/tasks --json`
   (respects the WBS allocator; 95xx range is disjoint from every production folder),
   then fills `Background` / `Requirements` / `Acceptance Criteria` / `Q&A` / `Design` /
   `Plan` sections via `spur task update <wbs> --section <name> --from-file`.
2. **Run** — `spur workflow run <pipeline> --vars '{"wbs":"95xx",...}'` against the
   pipeline under test. Fixtures never enter `docs/tasks*`.
3. **Cleanup** — the comparator deletes `tasks/*.md` and `scratch/*` in a `finally`
   block (also on failure), unless `--keep` is passed to inspect a post-mortem.
   Manual sweep for an aborted run: `rm tests/fixtures/pipeline-eval/tasks/*.md`.

Because cleanup removes the files, `spur task check --corpus` never sees them; an
aborted run leaves at most 95xx files whose removal is the documented sweep above.
