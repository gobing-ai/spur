---
description: Generate conventional commit message(s) from the current change set via one bounded diff capture, optionally commit
role: scribe
argument-hint: "[--commit] [--squash] [--all] [--scope <path>]"
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

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-gitmsg [--commit] [--squash] [--all] [--scope <path>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) (gitmsg).

One diff capture per run — `-U0`, lockfiles excluded, 60 KB cap — is the token contract; never re-read
the diff wider. Neither `--commit` nor `--squash` → messages only. `--commit` → one commit per concern, split automatically,
so the operator is never asked to re-stage and re-run. `--squash` → one commit for everything.
An empty index widens to the whole tree only on a message-only run, and says so; a committing run
stops there and prints the exact `--all` re-run line instead of guessing.
