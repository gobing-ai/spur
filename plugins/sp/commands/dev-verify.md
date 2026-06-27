---
description: Verify a task against its requirements — traceability check producing a PASS/PARTIAL/FAIL verdict with per-requirement evidence
argument-hint: "<wbs> [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Verify

Wraps the **sp:code-verification** skill (verify mode).

Verify that a task's implementation satisfies its requirements and acceptance criteria. Maps each
requirement to implementation evidence, runs a SECU code review, and produces a **PASS / PARTIAL /
FAIL** verdict. Findings are written back to the task's `## Testing` and `## Review` sections, and
the verdict artifact (`.spur/run/<wbs>-verdict.json`) is emitted for the pipeline completion gate.

## When to use

- The pipeline's verify phase needs to certify a task before `done`.
- Re-auditing a completed task (`--force` bypasses the terminal-status guard).
- The operator says "verify this" or "check the requirements."

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `wbs` | Task WBS number (required, positional) | (required) |
| `--agent <name\|auto>` | Spawn the verification under a specific agent. Omit (the default) → the verify pass runs under the configured default executor (`omp`). **Current-agent execution is not expressible** (subprocess FSM). | (configured default — `omp`) |
| `--fix <strategy>` | Post-verdict repair: `none`, `blockers-first` (UNMET only), `all` (UNMET + PARTIAL + major findings) | `none` |
| `--focus <lens>` | SECU dimensions: `all`, `security`, `efficiency`, `correctness`, `usability`, or comma-separated | `all` |
| `--bdd` | Map `## Acceptance Criteria` scenarios to tests and fold into the verdict | off |
| `--auto` | Skip confirmations (CI / pipeline use) | off |
| `--force` | Bypass the terminal-status guard — verify even a `done`/`cancelled` task | off |
| `--next` | Terminal chain link. On the (post-`--fix`) PASS verdict, transition `testing → done` through the FSM (`--strict-core` guard honored). On PARTIAL/FAIL or guard failure, stop as review-pending. | off |

## Behavior

Thin wrapper: status guard, change-scope detection, requirements traceability, SECU review, verdict
aggregation, findings write-back, verdict-artifact emission, and the optional `--fix` pass are all
owned by the skill.

### Agent override

`--agent` is a **pipeline** command (per the two-surface contract in
[cross-cutting.md](../skills/spur-dev/references/cross-cutting.md) § "Honor `--agent`"). The verify pass
runs as a spawned step; the calling agent cannot block on itself, so "current agent" is **not
expressible**. Omit the flag → the configured default executor (`omp`) runs the verification. An
explicit `--agent <name>` or `--agent auto` spawns that agent instead.

## `--next` chain — the terminal link

`--next` makes verify the last step in the `refine → run → verify → done` chain.

When `--fix` is set, `--next` acts on the **post-fix** verdict: the fix pass repairs findings, the
skill re-verifies (Step 10's bounded loop), and the **re-verified** verdict drives the transition.
A `--fix all` that turns a FAIL into a PASS therefore reaches `done`; a residual UNMET after the
bounded retry does not.

When the (post-fix) verdict is **PASS**:

1. Transition: `spur task update <wbs> done` — the `testing → done` guard runs
   `spur task check <wbs> --strict-core`. **No `--no-lifecycle`:** the guard is the final
   defense-in-depth check before `done`.
2. Stop — end of the chain (no further command to invoke).

When the verdict is **PARTIAL/FAIL**, or the `testing → done` guard fails: stop as review-pending —
surface the verdict (or the guard's blocking finding), leave the task at its current status, do NOT
transition to `done`.

## Implementation

Delegates to **sp:code-verification** skill (verify mode). `$ARGUMENTS` passes all flags including `--agent` through verbatim:

```
Skill(skill="sp:code-verification", args="verify $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's verify mode directly.
