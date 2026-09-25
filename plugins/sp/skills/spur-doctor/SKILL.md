---
name: spur-doctor
description: "Evaluate spur artifacts and plan/design Markdown from read-only evidence, reflect over sp:history-anatomy findings, and return a proposal table. Diagnoses artifacts, not runtime environments (that is spur agent doctor). Triggers: check artifact health, propose evolution, review legacy documents."
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
§2): gather **read-only evidence** about tasks, features, rules, workflows, agent specs, and
plan/design Markdown; **reflect** over `sp:history-anatomy` findings; and return a
**proposal table**. It diagnoses spur artifacts — definitions, rules, corpus records and documents —
not runtime environments: whether an agent
binary, host session or tool install is healthy is `spur agent doctor`'s job, not this skill's.

## Read-only invariant

The doctor **writes nothing and names no mutating verb**. It performs no task, feature, rule,
workflow or document write. The operator accepts rows; `sp:spur-composer`
([../spur-composer/SKILL.md](../spur-composer/SKILL.md)) applies corpus rows, while a document
author applies plan/design rows using the
[spur-dev authoring guide](../spur-dev/references/document-authoring.md). A caller that wants a
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
| plan/design Markdown | The file itself, the project constitution, the relevant spur-dev template, and inbound index/links; no new CLI needed |

Every row of a proposal cites the evidence it rests on. No anchor, no proposal.

## Legacy plan and design review

Enumerate `docs/plans/*.md` and `docs/design/*.md` with `rg --files` and sort the paths. Include
every Markdown path in the review; JSON and other files are outside this contract. For a large set,
the caller may split the frozen list into bounded path groups and combine their coverage lists.
Read each file and the project constitution before judging it. Report scanned paths and counts of
proposals and no-ops, so an omitted file is visible.

Compare each plan with the [plan template](../spur-dev/templates/plan.md) and each design with the
[design template](../spur-dev/templates/design.md), using the
[authoring guide](../spur-dev/references/document-authoring.md) for meaning. Look for missing or
unsupported `kind`, title, status, dates or material related links; unclear purpose or evidence in
a plan;
unclear current/proposed status, boundaries, contracts, invariants or compatibility in a design;
and a missing `04_DESIGN.md` pointer for a design satellite. These are **review prompts**, not
format errors. Keep specialized sections required by a producing workflow.

Propose only evidence-backed, useful edits. A proposal names the exact file and heading or
frontmatter field, cites a line and the governing rule, and says what can be inferred and what
needs an operator answer. Preserve filenames, anchors, original dates, decisions and historical
status. Do not silently promote a proposal to current behavior, invent metadata, or rewrite a
whole file to fit a template. A conforming or intentionally specialized file is a no-op.

The `apply` cell for a document row points to the spur-dev authoring guide; the author edits an
accepted row in place, then runs `sp:doc-evolve` sync-check for affected key documents and verifies
links, headings, frontmatter and the `04` index when applicable. No bulk conversion or strict
validator is required for old files.

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
| `evidence` | CLI output, report section, or document path and line the row rests on |
| `action` | One action class from the reflection map (or the per-noun evaluation) |
| `change` | The proposed change, in one line |
| `apply` | The `spur`/composer route for corpus rows or the spur-dev authoring guide for document rows |
| `verify` | The evidence to re-run after applying |

Rules:

- Corpus `apply` routes use a `spur` verb or gated composer step; document rows use the spur-dev
  authoring guide. The doctor itself never edits either surface. Shared-workflow rows route
  through the composition ladder's shared step.
- A `task` row carries the finding `key` in the task body (the history-anatomy handoff route).
- Rows are proposals only. No applied change, diff, or command output claimed as run.

## What this skill is not

- **Not the applier.** `sp:spur-composer` applies accepted corpus rows and document authors apply
  accepted document rows; this skill performs no write.
- **Not a runtime doctor.** Environment, binary and session readiness belong to
  `spur agent doctor`; this skill diagnoses artifacts from read-only evidence.
- **Not a history interpreter.** Findings come from `sp:history-anatomy` reports, never from raw
  history records.
- **Not a loop.** Recurring evolution passes belong to `sp:super-planner` or a workflow.
