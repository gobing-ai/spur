---
template: standard
schema_version: 1
name: Realign sp:dev-* --next step-chain so refine/run/verify reach done
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-27T00:26:38.054Z
updated_at: "2026-08-18T04:42:46.950Z"
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

| File:line | Change |
|-----------|--------|
| `plugins/sp/commands/dev-run.md:34` | `--next` row rewritten: advances to next step, transitions `todo → wip → testing` through the FSM (guards honored), chains to dev-verify; implies `--mode implement`. |
| `plugins/sp/commands/dev-run.md:70-99` | `--next` chain section replaced — resolve-to-implement, FSM-honoring transitions, review-pending stop + message (was the full-mode usage-error block). |
| `plugins/sp/commands/dev-refine.md:31` | `--next` chains to `/sp:dev-run <wbs> --auto --next` (was `--mode implement`); honors `backlog → todo` guard. |
| `plugins/sp/commands/dev-refine.md:72-77` | Chain workflow step rewritten — no `--no-lifecycle`, review-pending stop. |
| `plugins/sp/commands/dev-verify.md:33` | `--next` row: terminal link acting on the post-`--fix` verdict; `testing → done` `--strict-core` guard honored. |
| `plugins/sp/commands/dev-verify.md:48-66` | `--next` chain section rewritten — post-fix PASS path + review-pending stop. |
| `plugins/sp/skills/spur-dev/references/execution-workflow.md:98-105` | Replaced the "full-mode `--next` is a usage error" block with the chain-link contract. |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:76-94` | §3 verify / §4 run / §5 refine `--next` descriptions updated; `--auto` propagation noted. |
| `plugins/sp/skills/spur-dev/references/cross-cutting.md:62-74` | New subsection: `--no-lifecycle` is pipeline-only; interactive chains honor the FSM. |
| `config/workflows/task-pipeline.yaml:59-70` | Synced from canonical — removed stale `/sp:dev-implement` reference and old inline-grep verdict logic. |

Notes:
- `apps/cli/spur-cli/config/workflows/` is a gitignored build artifact (`build:bundle` regenerates
  it from canonical) — left untouched.
- Runtime-loaded copies (`.spur/workflows/`, resolved via `config.yaml` `workflows.paths`) were
  already identical to canonical — verified via `spur workflow list --json`.

Verification: `bun run lint` clean (376 files, typecheck green); `spur workflow validate` passes for
both task-pipeline and task-lifecycle; 16/16 init+scaffold tests pass.
### Testing
**Verdict: PASS** — all 9 requirements MET. Acceptance gate (`bun run lint`) green.

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — chain coherence (refine→run→verify→done) | MET | `plugins/sp/commands/dev-refine.md:31` → `plugins/sp/commands/dev-run.md:34` → `plugins/sp/commands/dev-verify.md:33`; targets line up |
| R2 — dev-run --next implies --mode implement (no usage error) | MET | `plugins/sp/commands/dev-run.md:34`, `plugins/sp/commands/dev-run.md:81-99` |
| R3 — dev-refine --next chains to dev-run --auto --next | MET | `plugins/sp/commands/dev-refine.md:31`, `plugins/sp/commands/dev-refine.md:75` |
| R4 — chains honor FSM (no --no-lifecycle in transitions) | MET | `plugins/sp/skills/spur-dev/references/cross-cutting.md:65`, `plugins/sp/commands/dev-run.md:81`, `plugins/sp/commands/dev-refine.md:74`, `plugins/sp/commands/dev-verify.md:61` |
| R5 — guard failure stops as review-pending | MET | `plugins/sp/commands/dev-run.md:92`, `plugins/sp/commands/dev-refine.md:76`, `plugins/sp/commands/dev-verify.md:65` |
| R6 — --auto propagates down the chain | MET | `plugins/sp/commands/dev-run.md:84`, `dev-operations.md:84,94` |
| R7 — verify acts on post-fix verdict | MET | `dev-verify.md:33,53,58` |
| R8 — no /sp:dev-implement reference in config/ or .spur/ | MET | grep CLEAN across both trees |
| R9 — SSOT docs updated same commit | MET | `git show 0b0f22a`: execution-workflow.md, dev-operations.md, cross-cutting.md |

Dogfood evidence (live validation during this session):
- The `wip → testing` guard FAILED on a missing `file:line` citation in `## Solution` and stopped the
  task at `wip` — the review-pending behavior R5 specifies. After the Solution was corrected,
  `spur task check 0133` returned exit 0 and the transition proceeded. This proves the guard-honoring
  chain (R4) genuinely blocks a non-compliant task instead of bypassing the gate.

Gate: `bun run lint` — 376 files checked, 0 fixes, all 7 workspaces typecheck exit 0.
### Review

Change surface: 7 markdown docs + 1 workflow YAML (synced from canonical). No executable TypeScript,
no runtime behavior change in `packages/app` or `apps/cli`.

| Priority | Severity | File | Finding | Recommendation |
|----------|----------|------|---------|----------------|
| P1 | blocker | — | None — no security/correctness blocker. | — |
| P2 | major | — | None — no major finding. | — |
| P3 | minor | — | None — no minor finding. | — |
| P4 | nit | — | None — docs are internally consistent with the FSM edges. | — |

SECU dimensions:

- **Security** — no code paths, secrets, input handling, or auth surface touched. The YAML sync
  removed a dead command reference; no new shell/eval surface.
- **Efficiency** — docs-only; no algorithmic or runtime impact.
- **Correctness** — the three `--next` targets form a closed chain; FSM transition names match the
  `task-lifecycle.yaml` edges (`backlog→todo`, `todo→wip→testing`, `testing→done`). Verified against
  the live FSM (illegal `backlog→wip` was correctly rejected during setup).
- **Usability** — the review-pending message and post-fix verdict semantics are documented in both
  the command files and the SSOT references, so an operator and a fresh agent read the same contract.

No P1–P3 findings. The change is a documentation-and-config realignment with no security or
efficiency exposure.
### References

### History
- 2026-06-27T00:47:05.787Z backlog → todo (system)
- 2026-06-27T00:47:07.162Z todo → wip (system)
- 2026-06-27T00:50:50.084Z wip → testing (system)
- 2026-06-27T00:55:00.501Z testing → done (system)
