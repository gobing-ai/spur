---
description: Generate changelog from git commits
role: scribe
argument-hint: "[<file>] [--since <tag|commit>] [--until <tag|commit>] [--version <version>]"
allowed-tools: ["Bash", "Read", "Edit"]
---

# Dev Changelog

Implements an inline procedure — see [dev-operations.md](../skills/spur-dev/references/dev-operations.md#8-changelog) for the authoritative reference.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `<file>` | Optional positional target (e.g. `CHANGELOG.md`); the new section is inserted above its newest release. | stdout |
| `--since` `<tag\|commit>` | Start of the commit range. | latest tag |
| `--until` `<tag\|commit>` | End of the commit range. | HEAD |
| `--version` `<version>` | Override the detected release version. | detected |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-changelog [<file>] [--since <tag|commit>] [--until <tag|commit>] [--version <version>]

## Implementation

Follow the inline procedure in [dev-operations.md](../skills/spur-dev/references/dev-operations.md#8-changelog) (changelog). This is a docs-only generator: run no quality gates (lint, tests, `spur-check`, rules, citation checks).

