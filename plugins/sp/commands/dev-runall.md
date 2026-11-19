---
description: Deprecated one-release redirect — use `/sp:dev-run --all`
requires: [cli:spur, local-fs]
role: planner
argument-hint: "--tasks <selector> [--feature <id>] [--mode <sequential|parallel|auto>] [--concurrency <n>] [--keep-going] [--auto] [--agent <inline|auto|name>] [--json] [--wrap] [--wrap-pr] [--next] [--continue] [--worktree [<name>]] [--no-summary] [--defer-gate]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# dev-runall (deprecated redirect)

**Deprecated (task 1390, feature H84).** A batch is a **scope**, not a different operation:
`/sp:dev-run --all` is the authoritative surface, and the `sp:spur-dev` operation (`runall`) it
dispatches is unchanged.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks` `<selector>` | Task selector to run. | required |
| `--feature` `<id>` | Restrict to a feature. | omitted |
| `--mode` `<sequential\|parallel\|auto>` | Batch execution order. `auto` computes the frozen batch's dependency waves and runs parallel only when a wave holds ≥2 independent tasks (see below). | sequential |
| `--keep-going` | Continue past per-task failures (implied by `--auto`). | off |
| `--auto` | Skip objective HITL gates, and treat the batch as unattended: `--auto` implies `--keep-going` (a failed task is `failed`, its in-batch dependents `skipped`, independents keep running). | off |
| `--agent` `<inline\|auto\|name>` | Who runs each task's pipeline stages. Interactive sequential omit/`inline` uses the host-session driver with unified inline semantics (task 0687 — see below). `auto`, a name, parallel mode, and headless invocation use subprocesses; `auto` is resolved **once per batch** — the first run's implement `result.executor` is pinned for every later task, and only a `failed-agent` ending re-resolves it, exactly once (1318 R2/R3). The opt-in `fleet` selector (0942) maps each task run to `executor: 'fleet'` so `agent.run` stages dispatch through the fleet control plane (ADR-126) instead of a subprocess. | omit |
| `--json` | Emit structured JSON. | off |
| `--wrap` | Run the wrap hop **once for the batch** over the `done` subset only (Step 6 of execution-batch.md): `vars.feature` is passed only when every frozen task is `done`/`cancelled`; an empty done subset skips the wrap with a reason. The `--agent` selector is preserved into the `/sp:dev-wrap` handoff when supplied; omission remains omission. Mutually exclusive with `--wrap-pr`. | off |
| `--wrap-pr` | Run the wrap hop **once for the batch** over the `done` subset, commit close-out writes, push the worktree branch to remote origin, and open a Pull Request targeting the base ref (WT-PR). Mutually exclusive with `--wrap`. Requires `--worktree` or a dedicated non-base branch. | off |
| `--next` | Chain-to-completion via the next-router. | off |
| `--continue` | Resume an interrupted batch. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. | off |
| `--no-summary` | Skip the measured execution summary (one row per task run: time, wait, tool calls, total / non-cached tokens) printed after the batch report. | off (summary printed) |
| `--concurrency` `<n>` | Parallel-mode worker bound: at most `<n>` task pipelines run at once (task 0931); a dependent starts only after its in-set dependencies are integrated onto the base ref. No-op in sequential mode (ignored). | 2 |
| `--defer-gate` | Opt-in parallel-batch gate policy (task 1111): each task's `gate` state runs the light tier and writes `DEFERRED`; the batch runs one integrated full gate on the base ref before the feature sync. Requires `--mode parallel`, or `--mode auto` resolved to parallel (dropped with a note otherwise); default off. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-run --all <forwarded arguments>
```

## Implementation

- Before dispatching, translate `--mode <schedule>` to `--schedule <schedule>`, including the
  `--mode=<schedule>` form. Forward all other arguments verbatim.
- Dispatch the batch operation the replacement names — `Skill(skill="sp:spur-dev", args="runall-inline <forwarded flags>")` for interactive sequential omit/`inline`, otherwise `runall` (→ `sp:super-planner`).
- The workflow YAML, the batch driver and the operation name are unchanged; only the command surface moved.
