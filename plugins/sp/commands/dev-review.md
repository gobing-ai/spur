---
description: "Review code for a task or path — multi-dimensional review across functional traceability, SECUA quality, and architectural depth. With --triage: fix small findings directly, then file the rest as implement-ready tasks. Triggers: \"review this\", \"check the code\", \"SECUA review\", \"dev review\", \"audit this\", \"triage review findings\"."
role: reviewer
argument-hint: "[<wbs|path>] [--agent <inline|auto|name>] [--focus <dims>] [--triage] [--worktree [<name>]]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev Review

Wraps the **sp:functional-review**, **sp:code-verification**, and **sp:code-improvement** skills.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `[<wbs\|path>]` | Task WBS or source path to review. | cwd |
| `--agent` `<inline\|auto\|name>` | Who runs the model-bearing review. | omit |
| `--focus` `<dims>` | Review dimensions (functional / SECUA / architecture). | all |
| `--triage` | After the review: fix small findings directly, file the rest as one or more implement-ready tasks. | off (report-only) |
| `--worktree` `[<name>]` | Run the triage in an isolated git worktree; FF-merge on success, retain on failure. Bare `--worktree` creates a fresh tree; `--worktree <name>` adopts an existing worktree by name/path/branch. Requires `--triage`. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-review [<wbs|path>] [--agent <inline|auto|name>] [--focus <dims>] [--triage] [--worktree [<name>]]
/sp:dev-review scripts --triage
/sp:dev-review 0962 --triage --worktree
```

Put the target first: a bare token after `--worktree` is read as the worktree name.

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- WBS mode (`<wbs>`): `Skill(skill="sp:functional-review", args="<wbs> $ARGUMENTS")` + `Skill(skill="sp:code-verification", args="review $ARGUMENTS")` + `Skill(skill="sp:code-improvement", args="<wbs> $ARGUMENTS")` (functional traceability + SECUA framework + architectural depth; the three skills return review fragments and the coordinator (`sp:super-reviewer`) writes the combined `## Review` — F92 0593 R1)
- Path mode (`<path>`): `Skill(skill="sp:code-verification", args="review $ARGUMENTS")` + `Skill(skill="sp:code-improvement", args="<path> $ARGUMENTS")` (advisory SECUA quality + architectural depth; performs no task mutation)
- `--triage`: after the review returns, run the triage protocol in [dev-operations.md § 2. review](../skills/spur-dev/references/dev-operations.md#2-review) **inline in this session** — the review skills and `sp:super-reviewer` stay report-only.
- Without `--worktree`, every write lands in the current working tree on the current branch: no branch creation, no checkout, no commit.
- `--worktree [<name>]`: the [execution-batch.md § Worktree isolation](../skills/spur-dev/references/execution-batch.md#worktree-isolation---worktree-name) lifecycle as a run of one (marker `command` = `dev-review`, `selector` = the target). Rejected without `--triage`.
  While it runs, fixes and filed tasks land in the worktree copy; the main tree shows them only after the FF-merge.
- `--fix`: Deprecated (still accepted: no-op + warning; route remediation to `--triage` or `/sp:dev-verify --fix`). **`--next` removed** (feature H8, 2026-07-31) — it was a deprecated no-op; route progression to `/sp:dev-next`. **was: `--next` deprecated no-op.**
