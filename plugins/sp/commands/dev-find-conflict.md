---
description: "Authority-aware semantic audit across source, task files, feature files, and project authority files — discover conflicts, resolve claim-specific authority, collect reproducible evidence, and route confirmed repairs through owner surfaces. Triggers: find conflict, conflict audit, semantic conflict, authority mismatch, stale projection."
argument-hint: "[<scope>] [--pillar <source|tasks|features|authority|all>] [--mode <adaptive|full>] [--resolve] [--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Conflict

Wraps the **sp:conflict-finding** skill — a prompt-first, authority-aware indexed audit across the four
pillars (source code, task files, feature files, project authority files) with confirmed,
owner-routed remediation.

## Argument Flags

| Flag                                                   | Description                                                                                                                              | Default         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `<scope>`                                              | Optional path, WBS, feature ID, symbol, command, config key, or free-form subject to scope the audit.                                    | current project |
| `--pillar` `<source\|tasks\|features\|authority\|all>` | Limit the internal audit to one pillar; the minimum authorities needed to judge it still load.                                           | all             |
| `--mode` `<adaptive\|full>`                            | Scan protocol — adaptive reuses fresh indexed context and discloses skipped areas; full forces a cold comprehensive scan.                | adaptive        |
| `--resolve`                                            | Enable the proposal, confirmation, and owner-routed remediation workflow. Its absence guarantees no source/corpus/numbered-doc mutation. | off             |
| `--agent` `<inline\|auto\|name>`                       | Who runs the model-bearing analysis.                                                                                                     | inline          |
| `--json`                                               | Emit the same result envelope as Markdown as JSON.                                                                                       | off             |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-conflict
/sp:dev-find-conflict docs/00_ADR.md
/sp:dev-find-conflict --pillar authority
/sp:dev-find-conflict --pillar tasks --mode full
/sp:dev-find-conflict 0486 --resolve
/sp:dev-find-conflict "command surface" --json
```

Audit mode is read-only with respect to source, corpus, and numbered documentation. Findings are
presented before any repair. Approved repairs route through the artifact owner's existing harness
surface (`spur task` / `spur feature`, `sp:doc-evolve`, the Spur development lifecycle, or
Superskill capability lifecycle) — never direct writes.

**See also:** skill `sp:conflict-finding` (SSOT), `sp:doc-evolve`, `sp:spur-cli`,
`sp:code-verification`.

## Implementation

Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface), then invoke the conflict-finding skill, forwarding all arguments:

```
Skill(skill="sp:conflict-finding", args="$ARGUMENTS")
```
