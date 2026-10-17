---
description: "Local-first PR review — status, a local branch-diff review, and validated fixes; --codex opts into the GitHub Codex review spine."
role: reviewer
argument-hint: "[status|review|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline|auto|name>] [<focus>]"
allowed-tools: ["Bash", "Read", "Skill"]
---

# Dev PR Review

Wraps the **sp:pr-reviewing** skill. The default `status` mode is a read-only snapshot of the
branch, its base and the pull request; `review` runs a **local** review of the branch diff unless
`--codex` opts into the GitHub `@codex review` spine; `fix` triages findings from either reviewer
and commits the verified ones. The invoking agent orchestrates.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<mode>` | `status\|review\|fix` — status: read-only branch + PR state; review: local branch-diff review (or the GitHub Codex spine with `--codex`); fix: validate, fix and commit findings from either reviewer. | status |
| `--codex` | `review` only — route through the GitHub Codex spine (`pr-review.yaml`) instead of the local `/sp:dev-review`. | off |
| `--force` | `review --codex` only — request a fresh review of the current HEAD even when it was already reviewed (`mode=rerun`). | off |
| `--no-wait` | `review --codex` only — post the request and return `pending` without polling (`mode=submit`). | off |
| `--base <branch>` | Base branch for the branch report, the `pr-check` diff and a newly created PR. | existing PR base, else repo default |
| `--agent <inline\|auto\|name>` | Who performs the model-bearing triage/fix. Omit uses the current agent, `inline` forbids dispatch, `auto` resolves the declared role, and a name pins that executor. This does not change the deterministic route. | omit |
| `<focus>` | Remaining free text — extra review focus for the local review or the Codex request (e.g. `security boundaries and transaction idempotency`). | none |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-pr-review [status|review|fix] [--codex] [--force] [--no-wait] [--base <branch>] [--agent <inline|auto|name>] [review focus]
```

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Delegate everything: `Skill(skill="sp:pr-reviewing", args="$ARGUMENTS")`. The skill owns mode
  routing, the local `/sp:dev-review` dispatch, the Codex spine and finding triage/fix. On the
  Codex path `pr-review.yaml` is the SSOT for state order and guards, and the four flat
  `spur builder pr-<verb>` verbs are the deterministic git/gh core every spine step shells out to.
- Retired modes print one notice line and run their replacement: `full` → `review --codex`;
  `submit` → `review --codex --no-wait`; `rerun` → `review --codex --force`; `collect` → `status`.
  `rules` prints that `AGENTS.md` review-rule authoring belongs to `cc:cc-magents` (the `cc` plugin)
  and exits without running a review.
- Never force-push, rewrite history, close or integrate the PR, or discard unrelated changes.
  `review` without `--codex` makes no GitHub writes. `fix` pre-authorizes one focused commit for the
  verified findings — stop if unrelated uncommitted changes make safe separation or committing
  ambiguous.
