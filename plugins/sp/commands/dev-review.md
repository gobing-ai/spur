---
description: "Review code for a task or path — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. Triggers: \"review this\", \"check the code\", \"SECUA review\", \"dev review\", \"audit this\"."
argument-hint: "[<wbs|path>] [--agent <name|auto>] [--focus <dims>] [--fix <none|blockers-first|all>] [--auto] [--next]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Review

Multi-dimensional code review for a task or source path. Runs **three review dimensions** and
merges the findings:

| Dimension | Skill | Question |
|-----------|-------|----------|
| **Functional traceability** | `sp:functional-review` | Did we build what the task asked for? (requirements completeness) |
| **SECUA quality** | `sp:code-verification` (review mode) | Is the code correct, secure, efficient, usable? |
| **Architectural depth** | `sp:code-improvement` | Is the architecture deep / testable / navigable? |

Source-oriented: unlike `/sp:dev-verify` (task-driven, emits a `.spur/run/<wbs>-verdict.json` gate
artifact), `/sp:dev-review` produces severity-ranked findings written to the task's `## Review`
section. It does **not** emit the `VerifyVerdict` gate artifact — use `/sp:dev-verify` for that.

## When to use

- A task's implementation is complete and needs a quality/security/architecture audit.
- The operator says "review this", "check the code", or "audit this."
- A standalone source path needs a multi-dimensional review (no task WBS).
- You want SECUA + architecture + functional findings without the full verify verdict.

For task-driven verification (requirements + AC + SECUA + pipeline gate), use `/sp:dev-verify`.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `<wbs\|path>` | Task WBS number (e.g. `0227`) OR source path/glob (e.g. `src/api/`). Optional positional — defaults to the current task WBS under the pipeline, or `src/` standalone. | pipeline: current task; standalone: `src/` |
| `--agent <name\|auto>` | Spawn the review under a specific agent. Omit → the review runs under the configured default executor (`omp`). **Current-agent execution is not expressible** (subprocess FSM). | `omp` |
| `--focus <dims>` | Review dimensions: `all`, or comma-separated from `functional,security,efficiency,correctness,usability,architecture`. `all` = every dimension. | `all` |
| `--fix <strategy>` | Post-review repair: `none`, `blockers-first`, `all` | `none` |
| `--auto` | Skip confirmations for the review/fix pass (CI / pipeline use) | off |
| `--next` | On PASS, auto-transition `testing → done`; on PARTIAL/FAIL, stop. Pipeline use. | off |

## Dimension Routing

| `--focus` value | Skill invoked |
|-----------------|---------------|
| `functional` | `sp:functional-review` |
| `security`, `efficiency`, `correctness`, `usability` | `sp:code-verification` (review mode, SECUA dims) |
| `architecture` | `sp:code-improvement` |

`--focus all` (default) runs **all six dimensions**: the full SECUA sweep + functional traceability
+ architectural depth. This is the complete `/sp:dev-review` experience.

## Behavior

Thin wrapper: the command routes each requested dimension to its owning skill. Diff scope, analysis,
findings ranking, and write-back are all owned by the skills — the command is a dispatcher.

### Dual-mode (WBS vs path)

- **WBS mode** (`<wbs>` positional): task-driven. Derives the diff scope from the task's last commit
  (same as `sp:code-verification` Step 3). The functional dimension maps the task's `## Requirements`
  `R{n}` items to evidence. Findings are written to the task's `## Review` section via
  `spur task update <wbs> --section Review --from-file`.
- **Path mode** (`<path>` positional): source-oriented. Reviews the given path/glob. The functional
  dimension is skipped (no task to trace against) unless `--focus functional` is explicit AND a task
  WBS is inferable from the path — otherwise architecture + SECUA run only. Findings are emitted as
  advisory output; no task file is written.

### Agent override

`--agent` is a **pipeline** command (per the two-surface contract in
`spur-dev/references/cross-cutting.md` § "Honor `--agent`"). The review runs as a spawned step; the
calling agent cannot block on itself, so "current agent" is **not expressible**. Omit the flag → the
configured default executor (`omp`) runs the review. An explicit `--agent <name>` or
`--agent auto` spawns that agent instead. Documented honestly — no `inherit` token implies otherwise.

## Implementation

The command dispatches each requested dimension to its owning skill. `$ARGUMENTS` passes all flags
through verbatim. The dimension set is derived from `--focus`:

```
# derive the dimension set from --focus (default: all)
dims = parseFocus($ARGUMENTS)  # ['functional','security','efficiency','correctness','usability','architecture']

# dispatch each dimension to its owning skill
if 'functional' in dims:
    Skill(skill="sp:functional-review", args="<wbs> $ARGUMENTS")
if any(secu in dims for secu in ['security','efficiency','correctness','usability']):
    Skill(skill="sp:code-verification", args="review $ARGUMENTS")
if 'architecture' in dims:
    Skill(skill="sp:code-improvement", args="<wbs|path> $ARGUMENTS")
```

In path mode (no WBS), the functional dispatch is skipped — the skill would have no requirements to
trace against.

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the owning skills'
  review modes directly. The command is a dispatcher; the skills are the SSOT.