---
description: Generate conventional commit message(s) from the current change set via one bounded gather call, optionally commit
role: scribe
argument-hint: "[--commit] [--squash] [--all] [--scope <path>] [--check <cmd>]"
allowed-tools: ["Bash", "Read"]
---

# Dev Gitmsg

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--commit` | Commit the change set — one commit per concern. | off |
| `--squash` | Collapse every concern into one message and one commit; implies `--commit`. | off |
| `--all` | Widen the change set past the index to every change in the tree — unstaged **and untracked**. | off |
| `--scope` `<path>` | Path filter on the change set; always wins over change-set auto-discovery. | the whole change set |
| `--check` `<cmd>` | Run `<cmd>` (e.g. `"spur self exec check"`) once before committing; non-zero → commit nothing. The example is `check`, not the `autofix` + `check` that `gate` maps to: a pre-commit check must not rewrite the tree. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-gitmsg [--commit] [--squash] [--all] [--scope <path>] [--check <cmd>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) (gitmsg).

One gather call per run (per-file-capped `-U0` diff including untracked content, recent subjects for
scope vocabulary, secret and partial-staging guards — git + shell only), then at most one commit call.
Never re-read the diff wider. Neither `--commit` nor `--squash` → messages only. `--commit` → one
commit per concern, split automatically, so the operator is never asked to re-stage and re-run.
`--squash` → one commit for everything. An empty index widens to the whole tree only on a
message-only run, and says so; a committing run stops there and prints the exact `--all` re-run line
instead of guessing.
No quality gate (`spur self exec autofix|check|lint`, typecheck, tests) runs unless `--check <cmd>`
names one — then it runs once, before any commit, and a failure commits nothing. Gate → auto-fix →
commit is `/sp:dev-gtd --no-push`.
