---
description: Deprecated one-release redirect — use `/sp:dev-wrap --all`
requires: [cli:spur, local-fs]
role: coder
argument-hint: "[--since <iso-date>] [--feature <id>] [--status <s>] [--agent <inline|auto|name>] [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# dev-wrapall (deprecated redirect)

**Deprecated (task 1390, feature H84).** A batch is a **scope**, not a different operation:
`/sp:dev-wrap --all` is the authoritative surface, and the `sp:spur-dev` operation (`wrapall`) it
dispatches is unchanged.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--since` `<iso-date>` | Wrap tasks completed since a date. | configured |
| `--feature` `<id>` | Select tasks in a feature (selection only — it no longer advances the feature; follow up with `spur feature sync <id>`). | omitted |
| `--status` `<s>` | Only wrap tasks in a status. | done |
| `--agent` `<inline\|auto\|name>` | Who runs the wrap's model-bearing steps. Wrap is workflow-backed (headless): `omit` and `--agent inline` resolve identically per task 0687 — tier substitution under objective trigger 3 (durable auditable run record required) with a warning naming the substituted executor; `auto` tier-resolves an executor; a name pins that executor into `vars.agent`. | inline |
| `--auto` | Skip objective HITL gates. | off |
| `--merge` | Merge wrap branches. | off |
| `--dry-run` | Render wraps without writing. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

```text
/sp:dev-wrap --all <forwarded arguments>
```

## Implementation

- Run the one implementation the replacement names: `spur workflow run wrapup-pipeline.yaml` over the resolved batch set.
- The workflow YAML and the operation name are unchanged; only the command surface moved. The batch
  lifecycle is [execution-batch.md](../skills/spur-dev/references/execution-batch.md) § wrap.
