---
description: Wrap up a batch of completed tasks — learnings, metrics, doc-sync, feature transition, optional branch cleanup
role: coder
argument-hint: "[--since <iso-date>] [--feature <id>] [--status <s>] [--agent <inline|auto|name>] [--auto] [--merge] [--dry-run]"
allowed-tools: ["Bash", "Read", "AskUserQuestion"]
---

# Dev Wrapall

Wraps the **wrapup-pipeline.yaml** workflow.

## Argument Flags

| Flag | Description | Default |
| --- | --- | --- |
| `--since` `<iso-date>` | Wrap tasks completed since a date. | configured |
| `--feature` `<id>` | Wrap tasks in a feature. | omitted |
| `--status` `<s>` | Only wrap tasks in a status. | done |
| `--agent` `<inline\|auto\|name>` | Who runs the wrap's model-bearing steps. Wrap is workflow-backed (headless): `omit` and `--agent inline` resolve identically per task 0687 — tier substitution under objective trigger 3 (durable auditable run record required) with a warning naming the substituted executor; `auto` tier-resolves an executor; a name pins that executor into `vars.agent`. | inline |
| `--auto` | Skip objective HITL gates. | off |
| `--merge` | Merge wrap branches. | off |
| `--dry-run` | Render wraps without writing. | off |

For shared semantics, see the [flag glossary](../skills/spur-dev/references/flag-glossary.md).

## Usage

/sp:dev-wrapall [--since <iso-date>] [--feature <id>] [--status <s>] [--agent <inline|auto|name>] [--auto] [--merge] [--dry-run]

## Implementation

- Apply the [inline-default execution-surface contract](../skills/spur-dev/references/cross-cutting.md#inline-default-execution-surface).
- Wrap stays **workflow-backed** — `spur workflow run wrapup-pipeline.yaml` is the only implementation; there is no inline wrap driver.
- Resolve the executor **before** launching the workflow:
  - `--agent <name>` → pass the name unchanged into `vars.agent`.
  - `--agent auto` → tier-resolve a concrete executor first, then merge it into `vars.agent`.
  - omit and explicit `--agent inline` resolve identically (task 0687): tier substitution plus one warning naming the resolved executor (headless surface).
- Emit a pre-dispatch notice naming the override before `spur workflow run`, exactly:
  `execution surface: subprocess`, `reason: trigger 3 — durable auditable run record required`, `requested agent: inline|auto|<name>` (explicit `inline` substitutes tier resolution and warns), `executor: <substituted-name>|<resolved-name>`.
- The wrap workflow still creates its durable run record — the notice reports the override, it does not change the workflow.

```bash
AGENT=… # omit≡inline → tier-substituted executor + warning; auto tier-resolved; <name> unchanged
echo "execution surface: subprocess; reason: trigger 3 — durable auditable run record required; requested agent: <inline|auto|name>; executor: $AGENT"
VARS=$(jq -nc --arg tasks "$TASKS" --arg feature "$FEATURE" --arg agent "$AGENT" --arg profile "$PROFILE" --arg merge "$MERGE" \
  '{tasks:$tasks, feature:$feature, agent:$agent, profile:$profile, merge:$merge}')
spur workflow run wrapup-pipeline.yaml --vars "$VARS" [--dry-run]
```

The executor resolution is described in the bullets above; the snippet's `AGENT` variable carries
the resolved name (omit ≡ explicit `inline`; both tier-substitute with a warning).
