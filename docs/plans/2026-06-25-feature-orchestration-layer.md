# Plan: Feature-Orchestration Layer for the `sp:dev-*` Workflow

**Date:** 2026-06-25
**Status:** Draft for approval
**Motivation:** Writing `docs/help/how_to_use_dev_slash_commands_for_daily_software_development.md`
exposed that the per-command infrastructure is solid, but the **chaining/orchestration across the
planning→execution boundary is incomplete**. Every gap shares one root cause: there is no
first-class notion of *"drive a **feature** (not a single task) to done."*

---

## The four gaps (all at command seams)

| # | Gap | Symptom in the how-to | Root cause |
|---|-----|------------------------|------------|
| 1 | No feature-level execution loop | Doc says "for each task, refine → run" — a manual loop | Workflows can't iterate a dynamic task list |
| 2 | `dev-brainstorm --feature` → `dev-plan` is manual | `--feature` *prints* the next command; doesn't chain | Planning half has no `--next` (execution half does) |
| 3 | Two overlapping front doors (`brainstorm` vs `plan`) | Doc invents a "shape of the idea" heuristic to disambiguate | No single planning entry point |
| 4 | No feature-level resume/status | Doc can't show "pick up where you left off" | No dev-workflow view of "3 of 5 tasks done" |

Gaps 1 + 4 are the same missing primitive: **feature-level orchestration.** Gap 2 is a small
`--next` addition. Gap 3 resolves once `brainstorm --feature` cleanly delegates to `plan`.

---

## Decisions taken (operator, 2026-06-25)

- **`feature-dev.yaml` = Option A:** it drives the *whole feature* — plan once, then loop all tasks
  to done, then feature-verify. Not a single-task loop (that contradicts its name and duplicates
  `task-pipeline.yaml`).
- **Scope = all three gaps, properly planned** (this document) before code.

---

## Infrastructure findings (verified against the live CLI/engine)

- **Engine has no native "for-each" over a dynamic list.** State-machine action kinds available:
  `agent.run`, `shell`, `rule.check`, `hitl.confirm`, `note`, `action`, `state`, guards `always`/
  `action-ok`. No loop/map primitive. The transition-flow engine variant is unused today and also
  isn't a list-iterator.
- **`spur task list` has NO `--feature` filter** — only `--status`, `--parent`, `--phase`. But
  `task list --json` includes each task's `frontmatter` (so `feature_id` is present and
  client-filterable via `jq`).
- **No `task run-all` / feature-execute verb** exists.

**Implication:** the feature loop is delivered today by **delegation, not engine iteration** — a
single `agent.run` step instructs the agent to execute every task under the feature, and the agent
drives `task-pipeline.yaml` per task internally. This mirrors how `dev-run --mode full` already
delegates the inner work loop. A clean `task list --feature <id>` primitive makes the delegation
target unambiguous.

---

## Proposed work (3 slices, in dependency order)

### Slice 1 — Close the planning chain (gap 2). *Small, no CLI change.*

Add `--next` to `dev-brainstorm`'s `--feature` exit: after `feature check` passes, auto-invoke
`/sp:dev-plan --feature <ID>`. Mirrors the execution half's `--next` convention exactly.

- **Touch:** `plugins/sp/commands/dev-brainstorm.md`, `dev-operations.md §12`.
- **No engine/CLI code.** Doc/command-spec only.

### Slice 2 — Feature-level execution loop (gaps 1 + 4). *The core.*

**2a. CLI primitive (the clean target for delegation):**
Add `spur task list --feature <id>` (server-side filter on `feature_id`). Small DAO/CLI change in
`packages/domain` + `apps/cli`. Enables `--feature <id> --status todo --json` to enumerate the
feature's pending work.
- **ADR:** new dated entry — additive flag on an existing verb (low blast radius).
- **Sync:** `04_DESIGN §7.1` task-command table + `AGENTS.md` listing, same commit.

**2b. Rewrite `feature-dev.yaml` to the feature envelope (Option A):**
```
brainstorm(--feature) → plan(decompose) → execute-tasks(loop, delegated) → feature-verify → done
                                                                              │ fail
                                                                              ▼
                                                                            failed
```
- `execute-tasks` = one `agent.run` step: *"Run every `todo` task under feature ${featureId} to
  done via the task-pipeline; stop and report on the first non-PASS verdict."* The agent uses
  `spur task list --feature ${featureId} --status todo --json` to enumerate, then drives
  `task-pipeline.yaml` per task.
- `feature-verify` = `shell` guard `spur feature check ${featureId} --strict` (AC validated,
  traceability clean, all tasks done) before certifying `done`.
- Vars: `featureId` (not `wbs`), `agent`, `profile`. Validate with `spur workflow validate`.
- **Sync to symlink:** `.spur/workflows/` is a symlink to `config/workflows/` — one edit covers both.

**2c. Feature status surface (gap 4):**
`spur feature show <id> --json` already returns feature data; pair it with `task list --feature <id>`
(from 2a) for a "3 of 5 done" view. **Decision needed:** is a dedicated `spur feature progress <id>`
verb worth it, or is `feature show` + `task list --feature` enough? *Recommendation: no new verb —
compose the two existing ones; revisit only if the board/launcher (deferred, ADR-021.b) needs it.*

### Slice 3 — One front door (gap 3). *Smallest, do last.*

Make `dev-plan` the canonical planning entry; `dev-brainstorm --feature` delegates to it (already
true after Slice 1). Update the how-to to drop the "shape of the idea" heuristic in favor of: *use
`dev-brainstorm` when you want the interview; it routes to `dev-plan` for you.* Keep `--task` as the
explicit single-item shortcut.
- **Touch:** the help doc, `dev-operations.md`, `dev-brainstorm.md` See-Also.

---

## What this is NOT (scope guards)

- **No new engine code.** The loop is delegation, not a new `for-each` action kind (would be
  speculative engine work, R2; ADR-022 keeps orchestration as configuration).
- **No board/launcher work** — that's deferred (ADR-021.b); the status surface here is CLI-only.
- **No `task migrate` / corpus changes.**

---

## Verification gate (per slice)

1. `spur workflow validate` clean for every touched workflow.
2. `bun run lint` (Biome + tsc) clean; for Slice 2a, `bun run test` covers the new DAO filter.
3. `04_DESIGN §7.1` + `AGENTS.md` in sync in the same commit as any CLI change.
4. The how-to doc updated to match (the doc is the acceptance test — its hand-waving should vanish).

---

## Open questions for approval

1. **Slice 2c:** new `feature progress` verb, or compose `feature show` + `task list --feature`?
   (Recommend: compose, no new verb.)
2. **Sequencing:** ship Slice 1 immediately (doc-only, zero risk), then 2a→2b→3 as one feature
   branch? Or all together?
3. **`feature-dev.yaml` vars default:** keep `agent: "omp"` (matching task-pipeline), or leave the
   agent unset and require `--vars`?
