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
- **Forbidden surface: `spur agent loop`** (supervisor-internal). Agent specs are read only through
  `spur agent list --specs --json`.

## Evidence per noun

| Noun | Evidence (read-only) |
| --- | --- |
| task | `spur task check <wbs> --json` |
| feature | `spur feature check <id> --json` |
| rule | `spur rule trace --json`, `spur rule validate` |
| workflow | `spur workflow validate --json` (findings by `level`), `node "$(superskill script path sp workflow-step-profile.mjs)" <workflow> --json` |
| agent spec | `spur agent list --specs --json` |
| history | A `sp:history-anatomy` report ([../history-anatomy/SKILL.md](../history-anatomy/SKILL.md)), never raw history records |

Every row of a proposal cites the evidence it rests on. No anchor, no proposal.

## Workflow step profile and cache-window flags

The step profile (`plugins/sp/scripts/workflow-step-profile`, ADR-065 plugin entrypoint) reads
`spur workflow trace` for a workflow's last N completed, non-dry runs. Per node and action kind it
reports run count, executions, p50 and max `durationMs`, p50 idle gap before the step, session mode
(`fresh`, `resumed` or `mixed`) and `cacheHit` p50 with its coverage — satellite §10 step evidence.

```bash
node "$(superskill script path sp workflow-step-profile.mjs)" <workflow> --json
```

`W` is the cache window, **300** seconds by default (satellite §10). The script computes every flag
arithmetically; doctor maps the flag ids to proposals and never re-derives numbers from prose. Each
flag and each composition finding becomes one proposal row with action class **workflow
optimization**, and the change comes from the §10 table:

| Evidence | Flag | Proposed change |
| --- | --- | --- |
| Validate finding, `level: error` | always | Extract to an owner from the closed fix vocabulary |
| Validate finding, `level: warn` | always | Extract, or record a stays-shell reason inside the warn band |
| Deterministic step | `step-over-window` — p50 > W | Split it, or move the slow work out of the step |
| Resumed `agent.run` | `resume-after-idle` — p50 idle gap before it > W | `freshSession: true` with the prior artifact as handoff |
| Resumed `agent.run` | `resume-cold-cache` — `cacheHit` p50 < 0.5, with evidence | The same, or move a long in-step tool call to a deterministic step |
| `agent.run` | `agent-run-over-2w` — p50 > 2W | Split at an artifact seam, or no-op when none exists |

- The two validate finding rows classify by `level` alone and carry no flag id.
- A row with `cacheHit.known: 0` raises no cache flag. Its cache evidence is **unknown, never a zero
  hit rate**, and doctor reports it as unknown rather than as a 0% hit.
- A proposal that changes a shared workflow goes through §7 of the composition ladder
  ([spur-composer](../spur-composer/SKILL.md)), including its recorded operator consent.

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
