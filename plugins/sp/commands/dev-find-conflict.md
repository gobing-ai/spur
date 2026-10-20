---
description: "Authority-aware semantic audit across source, task files, feature files, and project authority files — discover conflicts, resolve claim-specific authority, collect reproducible evidence, and route confirmed repairs through owner surfaces. Triggers: find conflict, conflict audit, semantic conflict, authority mismatch, stale projection."
role: reviewer
argument-hint: "[--tasks <selector> | --feature <id>[,<id>] | --scope <path>[,<path>]] [--pillar <source|tasks|features|authority|all>] [--mode <adaptive|full>] [--resolve] [--auto] [--agent <inline|auto|name>] [--json]"
allowed-tools: ["Bash", "Read", "Write", "Grep", "Glob", "Skill"]
---

# Dev Find Conflict

Wraps the **sp:conflict-finding** skill — a prompt-first, authority-aware indexed audit across the four
pillars (source code, task files, feature files, project authority files) with confirmed,
owner-routed remediation.

## Argument Flags

| Flag                                                   | Description                                                                                                                              | Default         |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| `--tasks <selector>`                                   | Audit a task set — batch selector grammar ([execution-batch.md § Step 1](../skills/spur-dev/references/execution-batch.md#step-1--selector-resolution-r1)): comma WBS list or `feature:<id>`. Resolved once and frozen; the tasks seed one audit (below).                        | —               |
| `--feature <id>[,<id>]`                                | Sugar for the union of the `feature:<id>` sets plus the feature records themselves — resolved once, frozen, audited as one seed set.                                                                                                                                  | —               |
| `--scope <path>[,<path>]`                              | Audit the tracked files under one or more paths: paths must exist (exit 2 otherwise), are normalized, duplicates dropped and nested paths collapse to the ancestor (`--scope apps,apps/cli` → `apps`).                                                                 | —               |
| `[<wbs\|path>]`                                        | **Deprecated positional alias** (one release): a `^\d{4}$` token with a resolvable task → `--tasks <wbs>`; an existing path → `--scope <path>`; otherwise exit 2. Prints a deprecation warning naming the replacement.                                                 | —               |
| `--pillar` `<source\|tasks\|features\|authority\|all>` | Limit the internal audit to one pillar; the minimum authorities needed to judge it still load.                                           | all             |
| `--mode` `<adaptive\|full>`                            | Scan protocol — adaptive reuses fresh indexed context and discloses skipped areas; full forces a cold comprehensive scan.                | adaptive        |
| `--resolve`                                            | Enable the proposal, confirmation, and owner-routed remediation workflow. Its absence guarantees no source/corpus/numbered-doc mutation. | off             |
| `--auto`                                               | Under `--resolve`, pre-approve the eligible repair set instead of pausing at the confirmation gate (see the skill's Step 10). Authority decisions still pause. Requires `--resolve` (exit 2 otherwise).                                                            | off             |
| `--agent` `<inline\|auto\|name>`                       | Who runs the model-bearing analysis.                                                                                                     | omit           |
| `--json`                                               | Emit the same result envelope as Markdown as JSON.                                                                                       | off             |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```
/sp:dev-find-conflict
/sp:dev-find-conflict --scope docs/00_ADR.md
/sp:dev-find-conflict --pillar authority
/sp:dev-find-conflict --tasks 0486,0487 --pillar tasks --mode full
/sp:dev-find-conflict --feature H11,H12 --resolve
/sp:dev-find-conflict --scope apps/cli,docs/design --resolve --auto --json
```

Target selection: **at most one** of `--tasks`, `--feature`, `--scope` per invocation — more than
one (a positional beside an explicit selector counts as a second kind) → exit 2 naming the
conflicting selectors. None → the whole project (the audit's natural default, unlike `dev-review`).
The target set is resolved once and frozen through the shared batch resolver — no find-conflict
parser; status pseudo-lists and `ready` are rejected (they select work to do, not artifacts to
audit). The frozen objects seed **one** audit, not one audit per object, so conflicts *between*
selected objects (two tasks, a task and a feature) stay visible.

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
