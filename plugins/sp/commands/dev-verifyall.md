---
description: Verify a batch of tasks against their requirements and Acceptance Criteria — batch traceability check producing per-task verdicts and a summary report
argument-hint: "--tasks <selector> [--feature <id>] [--agent <name|auto>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Skill"]
---

# Dev Verifyall

Wraps the **sp:spur-dev** skill (verifyall operation) and dispatches to `sp:code-verification` (verify mode) for each task in the resolved set.

Verify that a batch of tasks' implementations satisfy their requirements and acceptance criteria. For each task in the set it maps requirements and AC to evidence, runs SECUA review, produces a **PASS / PARTIAL / FAIL** verdict, writes findings back to the task, and emits the verdict artifact. After processing the whole batch it produces a consolidated **summary report** with counts, a per-task table, and an overall batch verdict.

## When to use

- After implementing (or running) a feature's tasks, batch-verify them before marking the feature done.
- Re-audit a set of completed tasks for a feature (`--force`).
- The operator says "verify the batch", "verify all for feature M1", or "batch verify these tasks".

Use `/sp:dev-verify <wbs>` for a single task.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--tasks <selector>` | The task set to verify. See selector grammar (supports explicit list, status, `feature:<id>`, `ready`). | (required unless `--feature`) |
| `--feature <id>` | Convenience for all tasks under the feature (`--tasks feature:<id>`). If `--tasks` is also supplied, `--tasks` wins. | (none) |
| `--agent <name\|auto>` | Agent override for each per-task verify (see dev-verify for pipeline vs standalone semantics). | (configured default) |
| `--fix <strategy>` | Post-verdict repair per task: `none`, `blockers-first`, `all` | `none` |
| `--focus <lens>` | SECUA dimensions applied to each task | `all` |
| `--bdd` | Strict BDD lens for each task's AC | off |
| `--auto` | Skip confirmations for the whole batch (CI / pipeline use) | off |
| `--force` | Bypass terminal-status guard for every task in the set | off |
| `--json` | Emit the summary report as JSON instead of markdown | off |

### Selector grammar (same as dev-runall)

See the selector grammar in `dev-runall.md` (explicit WBS, `feature:<id>`, status, `ready`, etc.). The `--feature <id>` flag is sugar that expands to `--tasks feature:<id>` when `--tasks` is not present.

## Behavior

The command resolves the set once (frozen), then for each task in the set (topologically ordered when dependencies are relevant) performs the equivalent of a single `/sp:dev-verify` invocation with the supplied flags.

For every task it:

- Applies the status guard (unless `--force`).
- Performs requirements traceability + AC evaluation + SECUA review.
- Writes `## Testing` (and evidence) via `spur task update`.
- Emits `.spur/run/<wbs>-verdict.json`.
- Records the individual verdict.

After the last task it emits a **batch summary report** (markdown by default; JSON when `--json`).

### Summary report shape (markdown)

```markdown
## Verify Batch Summary

**Feature / Set:** M1 (or explicit selector)
**Total tasks:** 12
**PASS:** 9
**PARTIAL:** 2
**FAIL:** 1

| WBS | Task | Verdict | Key Findings |
|-----|------|---------|--------------|
| 0259 | ... | PASS | - |
| 0260 | ... | PARTIAL | R2: missing error handling (file:line) |
| 0262 | ... | FAIL | AC "Processes tab..." : UNMET (no attach action) |

**Overall batch verdict:** PARTIAL

Per-task artifacts:
- .spur/run/0259-verdict.json
- ...
```

### Overall batch verdict rule

- Any FAIL → FAIL
- Any PARTIAL (and no FAIL) → PARTIAL
- All PASS → PASS

The report also lists any tasks that were skipped by the status guard (unless `--force`).

### Agent override & pipeline surface

Same two-surface contract as single `dev-verify`. When invoked from a pipeline context the `--agent` is forwarded per-task; when used standalone the inline Skill runs in the current session unless `--agent` is supplied.

## Implementation

Delegates to **sp:spur-dev** skill's `verifyall` operation. The operation resolves the selector (including `--feature` sugar), iterates the frozen set (respecting topo order where relevant), dispatches per-task verification to `sp:code-verification` (verify mode), aggregates verdicts, writes per-task artifacts, and emits the summary report.

```
Skill(skill="sp:spur-dev", args="verifyall $ARGUMENTS")
```

Per-task delegation inside the operation is equivalent to:

```
Skill(skill="sp:code-verification", args="verify <wbs> $SHARED_FLAGS")
```

## Summary report contract (for machines)

When `--json`, the output contains at minimum:

```json
{
  "set": "feature:M1" | "explicit list" | "...",
  "total": 12,
  "pass": 9,
  "partial": 2,
  "fail": 1,
  "overall": "PARTIAL",
  "items": [
    { "wbs": "0259", "name": "...", "verdict": "PASS", "artifact": ".spur/run/0259-verdict.json" },
    ...
  ],
  "skipped": []
}
```

## Platform Notes

- **Claude Code:** native — `Skill()` delegation and `$ARGUMENTS` work directly.
- **Other platforms:** `Skill()` and `$ARGUMENTS` are Claude-specific. Invoke the `sp:spur-dev` `verifyall` operation (or equivalent batch loop over `sp:code-verification` verify) directly and synthesize the summary report.

## See Also

- `/sp:dev-verify` — single-task version.
- `dev-runall` — the canonical batch selector + `--feature` pattern this command reuses.
- `sp:code-verification` (verify mode) and `sp:functional-review` — the per-task engines.
- `spur-dev/references/dev-operations.md` — authoritative operation table (includes verifyall).
- `spur-dev/references/execution-batch.md` — selector resolution and batch driver patterns (reused for the set).