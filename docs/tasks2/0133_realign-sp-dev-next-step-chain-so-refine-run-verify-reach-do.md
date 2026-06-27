---
template: standard
schema_version: 1
name: "Realign sp:dev-* --next step-chain so refine/run/verify reach done"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-27T00:26:38.054Z"
updated_at: 2026-06-27T00:45:42.170Z
---

## 0133. Realign sp:dev-* --next step-chain so refine/run/verify reach done

### Background
The `/sp:dev-*` execution-half commands were intended to support a linear "run-to-done" step
chain so an operator can drive a single task to `done` with one command per step:

```
/sp:dev-refine <wbs> --auto --next
/sp:dev-run    <wbs> --auto --next
/sp:dev-verify <wbs> --auto --next --focus all --fix all --force
```

`--next` means **advance this task to its next pipeline step** (not jump to another task).
Several `--next` failures and contract drifts have surfaced across dogfood runs.

Root causes found during review:

- **dev-run `--next` is rejected in full mode** (the default), so `/sp:dev-run <wbs> --auto --next`
  errors out as typed — the headline chain link is broken.
- **dev-refine `--next` chains to `/sp:dev-run --mode implement`**, a thin implement→verify path
  that skips the test/review pipeline semantics.
- **The chains bypass the lifecycle FSM** with `--no-lifecycle`, so the `wip→testing`
  (`spur task check`) and `testing→done` (`--strict-core`) guards never run — a malformed task can
  reach `done` silently. The intended behavior is: guard failure = stop, surface "review pending",
  leave status unchanged.
- **`--auto` chain-forwarding is ad hoc** — hardcoded in one command, conditional in another.
- **Three divergent tracked copies** of `task-pipeline.yaml` / `task-lifecycle.yaml` exist.
  `.spur/workflows/` (runtime-loaded) and `config/workflows/` (canonical) agree, but
  `.spur/config/workflows/` and `apps/cli/spur-cli/config/workflows/` are stale and reference the
  deleted `/sp:dev-implement` command (merged into `/sp:dev-run --mode implement`, commit d5a512f).
### Requirements

The resolved `--next` step-chain contract (operator decisions, 2026-06-26):

- R1 — `--next` advances the task to its **next pipeline step**, handing off to the command that
  owns that step, until the task reaches `done` or a step fails / hits a review-pending gate.
- R2 — `/sp:dev-run <wbs> --auto --next` in the default full mode **auto-implies `--mode implement`**
  (full-mode `--next` is no longer a usage error). The single implement step runs, then chains to
  `/sp:dev-verify <wbs> --auto --next`.
- R3 — `/sp:dev-refine <wbs> --auto --next` chains to `/sp:dev-run <wbs> --auto --next` (which
  self-resolves to the implement step), not the explicit `--mode implement` thin chain.
- R4 — Interactive `--next` chains **honor the lifecycle FSM guards** — they call
  `spur task update <wbs> <status>` WITHOUT `--no-lifecycle`. The `wip→testing` guard
  (`spur task check`) and `testing→done` guard (`--strict-core`) actually run.
- R5 — On any guard failure, the chain **stops as review-pending**: leave the task at its current
  status, surface the blocking reason (missing sections / failed check), do NOT advance.
- R6 — `--auto` **propagates** down the entire `--next` chain (uniform rule, not per-command).
- R7 — `/sp:dev-verify <wbs> --next` acts on the **post-`--fix`** verdict: when `--fix` repairs and
  the re-verify is PASS, transition `testing → done`; PARTIAL/FAIL → stop.
- R8 — The stale tracked YAML copies under `.spur/config/workflows/` and
  `apps/cli/spur-cli/config/workflows/` are removed or regenerated; no copy references the deleted
  `/sp:dev-implement` command.
- R9 — `dev-operations.md`, `execution-workflow.md`, and `cross-cutting.md` are updated to match the
  command contracts in the same change (docs-as-SSOT, no drift).

Acceptance: the three headline chains each drive a single task to `done` (or stop cleanly at a
guard) with no usage errors and no FSM bypass. The verification gate (`bun run lint` + `bun run test`)
stays green.

### Acceptance Criteria

```gherkin
Feature: Realign sp:dev-* --next step-chain so refine/run/verify reach done

  Scenario: Basic acceptance
    Given a precondition
    When an action is taken
    Then an expected result occurs
```

- [ ] Acceptance checklist item

### Plan

- [ ] Implementation step

### Solution
Realigned the `--next` step-chain contract across the four execution-half commands and their two
SSOT reference docs, and removed the stale YAML drift.

| File | Change |
|------|--------|
| `plugins/sp/commands/dev-run.md` | `--next` no longer a full-mode usage error — it now **resolves the mode to `implement`**, transitions `todo → wip → testing` through the FSM (guards honored, no `--no-lifecycle`), and chains to `/sp:dev-verify --auto --next`. Added the review-pending stop + message. |
| `plugins/sp/commands/dev-refine.md` | `--next` chains to `/sp:dev-run <wbs> --auto --next` (was `--mode implement`); `backlog → todo` honors the FSM guard; review-pending stop on failure. |
| `plugins/sp/commands/dev-verify.md` | `--next` documented as terminal link acting on the **post-`--fix`** verdict; `testing → done` honors the `--strict-core` guard; review-pending stop on PARTIAL/FAIL/guard-fail. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md` | Replaced the "full-mode `--next` is a usage error" block with the resolve-to-implement chain-link contract. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md` | §3 verify, §4 run, §5 refine `--next` descriptions updated to match the command contracts; `--auto` propagation noted. |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md` | Added "Status transitions in `--next` chains honor the FSM" — `--no-lifecycle` is pipeline-only; never add it to an interactive chain transition. |
| `.spur/config/workflows/task-pipeline.yaml` | Synced from canonical `config/workflows/` — removed the stale `/sp:dev-implement` reference (dead command, merged into `--mode implement` in d5a512f) and the old inline-grep verdict logic. |

Notes:
- The `apps/cli/spur-cli/config/workflows/` copy is a **gitignored build artifact** (`build:bundle`
  regenerates it from canonical) — left untouched.
- The runtime-loaded copies (`.spur/workflows/`, resolved via `config.yaml` `workflows.paths`) were
  already identical to canonical — verified via `spur workflow list --json`.

Verification: `bun run lint` clean (376 files, typecheck green); `spur workflow validate` passes for
both task-pipeline and task-lifecycle; 16/16 init+scaffold tests pass.
### Testing

### Review

### References

### History
