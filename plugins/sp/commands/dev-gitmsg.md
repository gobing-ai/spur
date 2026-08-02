---
description: Generate conventional commit message(s) from staged changes via per-file summarization, optionally commit
argument-hint: "[--commit] [--squash] [--scope <path>]"
allowed-tools: ["Bash", "Read"]
---

# Dev Gitmsg

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--commit` | Stage and commit with the generated message. | off |
| `--squash` | Squash staged changes into one commit. | off |
| `--scope` `<path>` | Scope the diff to a path. | cwd |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-gitmsg [--commit] [--squash] [--scope <path>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#9-gitmsg) (gitmsg).

