---
description: Generate changelog from git commits
role: scribe
argument-hint: "[--since <tag|commit>] [--until <tag|commit>] [--version <version>]"
allowed-tools: ["Bash", "Read"]
---

# Dev Changelog

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#8-changelog) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--since` `<tag\|commit>` | Start of the commit range. | latest tag |
| `--until` `<tag\|commit>` | End of the commit range. | HEAD |
| `--version` `<version>` | Override the detected release version. | detected |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-changelog [--since <tag|commit>] [--until <tag|commit>] [--version <version>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#8-changelog) (changelog).

