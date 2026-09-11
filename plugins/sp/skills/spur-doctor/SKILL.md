---
name: spur-doctor
description: "Evaluate spur artifacts from read-only CLI evidence — tasks, features, rules, workflows, agent specs — reflect over sp:history-anatomy findings, and return a proposal table. Diagnoses spur artifacts, not runtime environments (that is spur agent doctor). Triggers: check artifact health, propose evolution, reflect over history findings."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: artifact-composition
  interactions:
    - reviewer
    - inversion
  operations:
    - evaluate
    - reflect
    - propose
  openclaw:
    emoji: "🔬"
see_also:
  - sp:spur-cli
  - sp:spur-composer
  - sp:history-anatomy
  - sp:super-planner
---

# sp:spur-doctor — evaluate spur artifacts and propose changes

One cross-noun method (ADR-114, [spur artifact evolution](../../../../docs/design/spur-artifact-evolution.md)
§2): gather **read-only CLI evidence** about tasks, features, rules, workflows and agent specs,
**reflect** over `sp:history-anatomy` findings, and return a **proposal table**. It diagnoses spur
**artifacts** — definitions, rules, corpus records — not runtime environments: whether an agent
binary, host session or tool install is healthy is `spur agent doctor`'s job, not this skill's.

## Read-only invariant

The doctor **writes nothing and names no mutating verb**. It performs no task, feature, rule or
workflow write — the operator accepts rows and `sp:spur-composer`
([../spur-composer/SKILL.md](../spur-composer/SKILL.md)) applies them. A caller that wants a
record saves the returned table under `docs/reports/`; the doctor creates no artifact store.

- **History enters only through `sp:history-anatomy` findings.** Raw history records stay out
  of scope and are never re-interpreted here; history-anatomy is the only history interpreter.
- **Recurring reflection loops and coordination go to `sp:super-planner`** or a workflow — one
  bounded evaluation pass per invocation.
- **Forbidden surfaces: `spur team` and `spur agent loop`.** Agent specs are read only through
  `spur agent list --specs --json`.

## Evidence per noun

| Noun | Evidence (read-only) |
| --- | --- |
| task | `spur task check <wbs> --json` |
| feature | `spur feature check <id> --json` |
| rule | `spur rule trace --json`, `spur rule validate` |
| workflow | `spur workflow list --json`, `spur workflow validate --json`, `spur workflow trace --json` |
| agent spec | `spur agent list --specs --json`, read and written through `spur agent` with `--specs`, never `spur team` |
| history | A `sp:history-anatomy` report ([../history-anatomy/SKILL.md](../history-anatomy/SKILL.md)), never raw history records |

Step-profile evidence for workflows (per-step durations, idle gaps, cache hits — satellite §10)
lands with the step-profile task that adds its plugin script; until then workflow evidence is the
three read-only verbs above.

Every row of a proposal cites the evidence it rests on. No anchor, no proposal.

## Reflection map over history findings

For each history-anatomy finding (`key`, `category`, `trend`, `ownerSurface`), assign **exactly
one** action class. The first matching row wins:

| # | Finding | Action class |
| --- | --- | --- |
| 1 | `trend` is `resolved` or `improved` | no-op |
| 2 | `category` is `positive` | doc or learning |
| 3 | Automatable, per step 1 of the [placement rule](../../references/environment-lens.md#placement-rule) | rule candidate |
| 4 | `ownerSurface` is a workflow definition | workflow optimization |
| 5 | `ownerSurface` is a doc, skill, reference or steering file | doc or learning |
| 6 | Anything else | task |

The five action classes are closed: **task**, **rule candidate**, **workflow optimization**,
**doc or learning**, **no-op**. The doctor classifies the report's findings and never derives new
ones from raw records — that would make it a second history interpreter.

## Proposal table

Return one row per actionable finding, with exactly these columns:

| Column | Content |
| --- | --- |
| `key` | The finding key, or `<noun>:<id>:<check>` for an artifact finding |
| `evidence` | The CLI output or report section the row rests on |
| `action` | One action class from the reflection map (or the per-noun evaluation) |
| `change` | The proposed change, in one line |
| `apply` | The `spur` verb or composer procedure that lands it |
| `verify` | The evidence to re-run after applying |

Rules:

- The `apply` route is always a `spur` verb or a gated composer step — never a raw file edit this
  skill performs. Shared-workflow rows route through the composition ladder's shared step.
- A `task` row carries the finding `key` in the task body (the history-anatomy handoff route).
- Rows are proposals only. No applied change, diff, or command output claimed as run.

## What this skill is not

- **Not the applier.** `sp:spur-composer` applies accepted rows; this skill performs no
  task/feature/rule/workflow write.
- **Not a runtime doctor.** Environment, binary and session readiness belong to
  `spur agent doctor`; this skill diagnoses spur artifacts from CLI evidence.
- **Not a history interpreter.** Findings come from `sp:history-anatomy` reports, never from raw
  history records.
- **Not a loop.** Recurring evolution passes belong to `sp:super-planner` or a workflow.
