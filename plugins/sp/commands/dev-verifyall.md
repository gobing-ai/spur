---
description: Deprecated one-release redirect — use `/sp:dev-verify --all`
requires: [cli:spur, local-fs]
role: reviewer
argument-hint: "--tasks <selector> [--feature <id>] [--agent <inline|auto|name>] [--fix <none|blockers-first|all>] [--focus <lens>] [--bdd] [--auto] [--force] [--next] [--json] [--skip-shippable] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# dev-verifyall (deprecated redirect)

**Deprecated (task 1390, feature H84).** A batch is a **scope**, not a different operation:
`/sp:dev-verify --all` is the authoritative surface, and the `sp:spur-dev` operation (`verifyall`) it
dispatches is unchanged.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--tasks` `<selector>` | Task selector to verify. | required |
| `--feature` `<id>` | Restrict to a feature. | omitted |
| `--agent` `<inline\|auto\|name>` | Who runs each verification. | omit |
| `--fix` `<none\|blockers-first\|all>` | Auto-fix policy on findings. | none |
| `--focus` `<lens>` | Verification lens. | omitted |
| `--bdd` | Run BDD scenarios. | off |
| `--auto` | Skip objective HITL gates. | off |
| `--force` | Re-run even if already verified. | off |
| `--next` | Hand off to the next-router on success. | off |
| `--json` | Emit structured JSON. | off |
| `--skip-shippable` | Compatibility alias for --skip-shipable; skip the shippable gate. | off |
| `--worktree` `[<name>]` | Run the batch in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-verify --all <forwarded arguments>
```

## Implementation

- Dispatch `Skill(skill="sp:spur-dev", args="verifyall <forwarded flags>")`; its inner per-task leg is `verify`.
- The workflow YAML and the operation name are unchanged; only the command surface moved.
