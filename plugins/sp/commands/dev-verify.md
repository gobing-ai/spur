---
description: Verify a task against its requirements — traceability check producing a PASS/PARTIAL/FAIL verdict with per-requirement evidence
argument-hint: "<wbs> [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next]"
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
| `--fix <strategy>` | Post-verdict repair: `none`, `blockers-first` (UNMET only), `all` (UNMET + PARTIAL + major findings) | `none` |
| `--focus <lens>` | SECU dimensions: `all`, `security`, `efficiency`, `correctness`, `usability`, or comma-separated | `all` |
| `--bdd` | Map `## Acceptance Criteria` scenarios to tests and fold into the verdict | off |
| `--auto` | Skip confirmations (CI / pipeline use) | off |
| `--force` | Bypass the terminal-status guard — verify even a `done`/`cancelled` task | off |
| `--next` | On PASS verdict, auto-transition `testing → done`. On PARTIAL/FAIL, stop — do not advance. | off |

## Behavior

Thin wrapper: status guard, change-scope detection, requirements traceability, SECU review, verdict
aggregation, findings write-back, verdict-artifact emission, and the optional `--fix` pass are all
owned by the skill.

## `--next` chain

When `--next` is set and the verdict is PASS:

1. Transition: `spur task update <wbs> done`
2. Stop — end of the chain (no further command to invoke)

When the verdict is PARTIAL or FAIL: stop — surface the verdict, leave task at current status, do NOT transition to done.

`--next` is the terminal step in the refine → run → verify → done chain.

## Implementation

Delegates to **sp:code-verification** skill (verify mode):

```
Skill(skill="sp:code-verification", args="verify $ARGUMENTS")
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the
  `sp:code-verification` skill's verify mode directly.
