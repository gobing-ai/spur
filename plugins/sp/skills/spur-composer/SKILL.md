---
name: spur-composer
description: "Select, compose and tune spur artifacts — tasks, features, rules, workflows and agent specs. Owns workflow catalog selection, the ephemeral→project→shared ladder, the ADR-115 budgets, trace-driven rule tuning, and applying accepted sp:spur-doctor proposals. Triggers: compose a workflow, tune a rule, apply doctor proposals."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: artifact-composition
  interactions:
    - inversion
    - companion
  operations:
    - select
    - compose
    - tune
    - apply
  openclaw:
    emoji: "🎼"
see_also:
  - sp:spur-cli
  - sp:spur-doctor
  - sp:super-planner
---

# sp:spur-composer — compose, select and tune spur artifacts

One cross-noun method (ADR-114, [spur artifact evolution](../../../../docs/design/spur-artifact-evolution.md)
§2): **select** an existing artifact, **compose** a new one up the ladder, **tune** it against
evidence, and **apply** the proposals the operator accepts from `sp:spur-doctor`. It never judges
its own output and never runs a recurring loop — evaluation is the doctor's job.

## Boundary — read before composing

- **Verbs and flags live in `sp:spur-cli`.** This skill links references; it never restates a verb
  or flag catalog: [../spur-cli/SKILL.md](../spur-cli/SKILL.md).
- **Recurring loops and coordination go to `sp:super-planner`** or a workflow — not here. This skill
  runs one bounded composition or tuning pass per invocation.
- **Forbidden surfaces: `spur team` and `spur agent loop`.** Agent specs are reached only through
  `spur agent create|edit|delete|list --specs`.
- **Writes land only through `spur` verbs** and the ladder's gated file steps (§ below). The shared
  step additionally needs recorded operator consent plus `build:bundle` parity.

## Covered nouns

| Noun | Composition / tuning method | Verb reference |
| --- | --- | --- |
| task | Apply accepted doctor rows via the CLI-gated corpus surface; author variants through the task reference's conventions | [../spur-cli/references/tasks.md](../spur-cli/references/tasks.md) |
| feature | Apply accepted rows through `spur feature update --section --from-file`; keep acceptance criteria in Gherkin | [../spur-cli/references/features.md](../spur-cli/references/features.md) |
| rule | The trace-driven tuning loop (§ Rule tuning loop) | [../spur-cli/references/rules.md](../spur-cli/references/rules.md) · [fine-tuning](../spur-cli/references/rules/fine-tuning.md) |
| workflow | Catalog selection, the composition ladder, and the ADR-115 budgets (§ below) | [../spur-cli/references/workflows.md](../spur-cli/references/workflows.md) · [operations](../spur-cli/references/workflows/operations.md) |
| agent spec | Compose and edit `.spur/agents/<id>.yaml` only through `spur agent create|edit|delete|list --specs` | [../spur-cli/references/agent.md](../spur-cli/references/agent.md) |

Do not drive the planning→execution lifecycle from here — that is `sp:spur-dev`.

## Workflow catalog selection

Run this **before composing anything new**, exactly as the
[find-existing-workflow](../spur-cli/references/workflows/operations.md#sub-procedure-find-existing-workflow)
procedure: the catalog is `spur workflow list --json` across all layers, and each entry's
`description` is its intent.

| Catalog match | Action |
| --- | --- |
| Matches the intent | **Run it as is.** No new artifact. |
| Near match | **Same-name override in the project layer** (`.spur/workflows/<name>.yaml`) — the project layer wins name resolution — and tune from there. |
| No match | **Compose** up the ladder (§ Composition ladder). |

Never glob a folder to enumerate candidates: layers you skip that way are layers a bare name
cannot resolve from.

## Composition ladder

| Step | Location | Gate before use |
| --- | --- | --- |
| ephemeral | A scratch file outside every layer (for example under `.spur/run/`), run by explicit path | `spur workflow validate`, `spur workflow run --dry-run`, a `spur workflow show` preview |
| project | `.spur/workflows/<name>.yaml` | The same gates |
| shared | the spur repository's shipped shared workflow layer (layer id `shared` in `spur workflow list --json`) as `<name>.yaml` | The same gates, **plus recorded operator consent and `build:bundle` parity** |

- `spur workflow validate --json` exits 1 on an error-level composition finding, so a definition
  over a cap cannot climb. Warn-level findings do not block a step.
- Verify each step through the shared
  [validate-and-dry-run](../spur-cli/references/workflows/operations.md#sub-procedure-validate-and-dry-run)
  core. The shared step is a promotion, not a copy: record the operator consent that authorizes it,
  then rebuild the bundle (`bun run --filter @gobing-ai/spur build:bundle`) so the shipped config
  matches.
- In an adopting project the shared layer is the installed package and is read-only — the project
  step is the tuning path there.

## Composition budgets (ADR-115)

The consolidation and cache-window rules are taught once in
[workflow-fit-and-tuning.md](../spur-cli/references/workflows/workflow-fit-and-tuning.md#consolidation-and-cache-windows-adr-115)
and owned by the
[workflow composition contract](../../../../docs/design/workflow-composition-contract.md#composition-budgets-adr-115);
link them, never restate them. While composing or tuning a workflow, apply them with the ADR-115
budgets:

- **Merge adjacent model steps** only when they share a role and an executor **and** no gate, HITL
  state or independence boundary sits between them.
- **Never merge an author step with the review or verify step that certifies it** — those keep
  `freshSession: true`.
- **Run long deterministic work outside `agent.run`** — an in-step tool call that outlasts the
  cache window idles the model and cold-rewrites the prefix.

A new model step in a shared workflow raises its `pipeline-budgets` `modelQueries`; that needs a
recorded decision before the shared step.

## Rule tuning loop

Start from trace evidence, never from a guess:

1. `spur rule trace <runId> --json` — read the per-rule `evaluations` findings and severities.
2. Classify each hit: true positive, false positive, or noise.
3. Tune with the [fine-tuning levers](../spur-cli/references/rules/fine-tuning.md) — severity,
   glob scoping, exemptions, preset composition.
4. `spur rule validate` on the tuned rule files.
5. `spur rule run` on the affected inputs (constitution T11 — affected inputs, not a corpus sweep).
6. Trace again and compare. A tuning with no trace pair behind it is a preference.

## Applying doctor proposals

`sp:spur-doctor` ([../spur-doctor/SKILL.md](../spur-doctor/SKILL.md)) returns a proposal table;
the operator accepts rows; **this skill applies them**:

1. For each accepted row, run its `apply` route — always the `spur` verb or ladder step named in
   the row. Composer never invents a write route.
2. Re-run that row's `verify` evidence and confirm it clears. An accepted row that cannot verify
   is reported as not applied, never waved through.
3. A `task` row carries the history-anatomy finding `key` in the task body — the existing handoff
   route. Keep it.
4. A row that changes a shared workflow goes through the ladder's shared step and its recorded
   consent.

A caller that wants a record saves the accepted table under `docs/reports/`; this skill creates no
artifact store.

## What this skill is not

- **Not the judge.** `sp:spur-doctor` evaluates artifacts and proposes; code review is
  `sp:super-reviewer`.
- **Not a loop.** Recurring evolution loops and multi-agent coordination belong to
  `sp:super-planner` or a workflow definition.
- **Not a catalog.** Verb, flag, output and exit semantics live in the `sp:spur-cli` references
  linked above.
