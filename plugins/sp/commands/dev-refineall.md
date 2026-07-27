---
description: Refine a batch of tasks via structured Q&A — resolve a set (feature or selector), refine each in dependency-correct order, emit a batch report
argument-hint: "--feature <id> | --tasks <selector> [--focus <mode>] [--description <text>] [--agent <name|auto>] [--auto] [--keep-going] [--status <s>] [--json] [--next]"
allowed-tools: ["Bash", "Read", "Skill", "AskUserQuestion"]
---

# Dev Refineall

Wraps the **sp:spur-dev** skill. Batch counterpart of `/sp:dev-refine` — same per-task refine
operation, applied to a resolved set (typically every task under a feature).

## Usage

```
/sp:dev-refineall --feature <id> [shared refine flags…]
/sp:dev-refineall --tasks <selector> [shared refine flags…]
```

| Flag | Effect |
|------|--------|
| `--feature <id>` | Sugar for `--tasks feature:<id>` — refine all tasks under the feature (default status filter applies). |
| `--tasks <selector>` | Shared batch selector grammar (explicit WBS list, `feature:<id>`, `ready`, or status pseudo-list). See `sp:spur-dev` → `execution-batch.md` Step 1. |
| `--focus <mode>` | Passed through to each per-task refine (`all`, `requirements`, `background`, `constraints`, `acceptance`, `quick`). |
| `--description <text>` | Optional context passed through to each refine. |
| `--agent <name\|auto>` | Per-task refine agent override (inline synthesis default when omitted). |
| `--auto` | Per-task: skip interactive Q&A (synthesis / SKIP gate only). **Strongly recommended** for batch — interactive Q&A per task does not scale. |
| `--keep-going` | On refine failure, skip that task's in-batch dependents and continue independents (default: halt). |
| `--status <s>` | Optional status filter when resolving `--feature` / status-free selectors (default: `backlog,todo` — tasks that still need planning-side fill). Repeat or comma-list. |
| `--json` | Emit the batch report as JSON. |
| `--next` | Pass-through: after each successful refine, chain that task into `/sp:dev-run <wbs> --auto --next`. **Dangerous on large features** (becomes a de-facto runall). Prefer refine-only, then `/sp:dev-runall --feature <id>`. |

## Implementation

- Batch orchestration: `Skill(skill="sp:spur-dev", args="refineall $ARGUMENTS")`
- Per-task refine (inner): `Skill(skill="sp:spur-dev", args="refine <wbs> $SHARED_FLAGS")`

## Behavior (summary)

1. **Resolve + freeze** the task set (`--feature` → `feature:<id>`; shared selector grammar).
2. **Filter** by `--status` (default `backlog,todo`); report excluded WBS with reason.
3. **Topo-sort** by `dependencies[]` (Kahn, WBS-ascending tie-break; cycle aborts before any refine).
4. For each task in order: run single-task **refine** (pre-synthesis SKIP gate under `--auto` still applies).
5. **Failure policy:** stop-the-batch (default) or `--keep-going` subtree skip.
6. **Emit** a batch report (per-task `refined` | `SKIP` | `failed` | `skipped` | `not-attempted` | `blocked`).

Full procedure and report shape: `plugins/sp/skills/spur-dev/references/dev-operations.md` § refineall.
