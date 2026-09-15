# Spur artifact composition and evolution (feature I21)

**Area:** workflow layers for `spur workflow list` and name resolution; the `sp:spur-composer` and
`sp:spur-doctor` skills; the `sp:expert-spur` boundary.
**Decisions:** ADR-113 (workflow layers), ADR-114 (spur-* skill family), ADR-115 (composition
budgets, §10). Surface shapes stay with
their owners: [CLI contracts](cli-contracts.md) (`workflow list` and `show`) and
[configuration contracts](configuration-contracts.md) (`workflows.paths`, runtime resolution).

## 1. Workflow layers (ADR-113)

| Order | Layer id | Folder | Listed when |
| --- | --- | --- | --- |
| 1 | `project` | `<cwd>/.spur/workflows` | Always, even when the folder is missing or empty |
| 2 | `registered` | Each `workflows.paths` entry as an absolute path, in config order (global config, then project config) | It is not the project or shared folder and is not already listed |
| 3 | `shared` | The installed package's `config/workflows` (`bundledConfigRoot()/workflows`) | The package tree resolves; not in the compiled-binary case |

- One application function returns this ordered list. `WorkflowService.list` scans it, and bare-name
  resolution probes it in the same order, so `list` shows exactly the folders a name can resolve
  from. A listed name is resolved across those layers before shared filename aliases; `show`
  uses the same resolver, including registered-only names. Explicit file paths still resolve
  first and keep the `project` label.
- Dedupe compares normalized absolute paths, after `bundled:` expansion and without a trailing
  slash. The legacy entries `.spur/workflows/`, `bundled:workflows` and an absolute package path
  collapse into the project or shared layer, so existing configs keep working.
- A layer id names the tier and `path` names the folder, so several layers may carry the id
  `registered`. An entry's `source` is the id of the layer the file came from.
- The seeded `~/.config/spur/workflows` copy is not a layer unless it is registered. The `global`
  mirror that `list` used to scan (`~/.config/spur/<path>`) is removed.
- Persisted `definitionSource.layer` takes `project`, `registered` or `shared`. Readers map the
  legacy value `bundled` to `shared`, so an inline run started before the rename still resumes.
- Rule layers keep their own vocabulary, including `bundled`. Rules are per-project samples and are
  out of scope.

## 2. Roles (ADR-114)

| Surface | Owns | Never |
| --- | --- | --- |
| `sp:spur-cli` | Verb, flag, output and exit semantics per noun, plus the per-noun procedures (ADR-054) | Cross-noun method |
| `sp:spur-dev` | The planning → execution lifecycle | Composition or evaluation method |
| `sp:spur-composer` | Select, compose, tune and promote artifacts; apply accepted proposals | Judge its own output; run recurring loops |
| `sp:spur-doctor` | Evaluate artifacts from CLI evidence; reflect over history findings; propose changes | Any task, feature, rule or workflow write |
| `sp:expert-spur` | One bounded corpus campaign per dispatch, over the three skills above | Lifecycle, batches, recurring loops, coordination dispatch, `spur agent loop` |
| `sp:super-planner` | Batches, recurring evolution loops, multi-agent coordination | Corpus method |

Composer and doctor link the `sp:spur-cli` references for verbs and existing per-noun procedures;
they never restate a verb or flag catalog. They cover tasks, features, rules, workflows and agent
specs; doctor also reads history.

## 3. Doctor evidence per noun

| Noun | Evidence (read-only) |
| --- | --- |
| task | `spur task check <wbs> --json` |
| feature | `spur feature check <id> --json` |
| rule | `spur rule trace --json`, `spur rule validate` |
| workflow | `spur workflow list --json`, `spur workflow validate --json`, `spur workflow trace --json`, the step profile (§10) |
| agent spec | `spur agent list --specs --json` (§9) |
| history | A `sp:history-anatomy` report, never raw history records |

## 4. Reflection map

Doctor reads each history-anatomy finding (`key`, `category`, `trend`, `ownerSurface`) and assigns
exactly one action class. The first matching row wins.

| # | Finding | Action class |
| --- | --- | --- |
| 1 | `trend` is `resolved` or `improved` | no-op |
| 2 | `category` is `positive` | doc or learning |
| 3 | Automatable, per step 1 of the [placement rule](../../plugins/sp/references/environment-lens.md#placement-rule) | rule candidate |
| 4 | `ownerSurface` is a workflow definition | workflow optimization |
| 5 | `ownerSurface` is a doc, skill, reference or steering file | doc or learning |
| 6 | Anything else | task |

History-anatomy stays the only history interpreter. Doctor classifies its findings and never
derives new ones from raw records.

## 5. Proposal and apply

Doctor returns a proposal table and writes nothing:

| Column | Content |
| --- | --- |
| `key` | The finding key, or `<noun>:<id>:<check>` for an artifact finding |
| `evidence` | The CLI output or report section the row rests on |
| `action` | One action class from §4 |
| `change` | The proposed change, in one line |
| `apply` | The `spur` verb or procedure that lands it |
| `verify` | The evidence to re-run afterwards |

The operator accepts rows. Composer applies each accepted row through its `apply` route, then
re-runs its `verify` evidence. A task row carries the finding `key` in its body, as the
history-anatomy handoff route requires. There is no new artifact store: a caller that wants a
record saves the table under `docs/reports/`.

## 6. Workflow catalog and selection

- The catalog is `spur workflow list --json` across all layers. Each entry carries the definition's
  top-level `description` as its intent, or `null` when there is none.
- Selection: run a catalog match as is. Tune a near match with a same-name override in the project
  layer, which wins by §1. Take a request with no match up the ladder in §7.
- Parity: a test fails when a `config/workflows/*.yaml` definition has no non-empty `description`.
- The `sp:spur-cli` find-existing-workflow procedure reads `spur workflow list --json` instead of
  globbing `.spur/workflows`.

## 7. Composition ladder

| Step | Location | Gate before use |
| --- | --- | --- |
| ephemeral | A scratch file outside every layer (for example under `.spur/run/`), run by explicit path | `spur workflow validate`, `spur workflow run --dry-run`, a `spur workflow show` preview |
| project | `.spur/workflows/<name>.yaml` | The same gates |
| shared | `config/workflows/<name>.yaml` in the spur repository | The same gates, plus recorded operator consent and `build:bundle` parity |

`spur workflow validate` exits 1 on an error-level composition finding (§10), so a definition over a
composition cap cannot climb the ladder. Warn-level findings do not block a step.

In an adopting project the shared layer is the installed package and is read-only, so the project
step is the tuning path. Pipeline promotion inside the spur repository also keeps the stricter
gates of the [workflow composition contract](workflow-composition-contract.md#exit-and-promotion-gates).

## 8. Rule tuning loop

`spur rule trace --json` → classify each hit as a true positive, false positive or noise → tune with
the [fine-tuning levers](../../plugins/sp/skills/spur-cli/references/rules/fine-tuning.md) →
`spur rule validate` → `spur rule run` on the affected inputs → trace again. Tuning starts from
trace evidence, never from a guess.

## 9. Agent specs and team retirement

Agent specs (`.spur/agents/<id>.yaml`) stay in scope. They are the occupant identity of the
inter-agent control plane (`OccupantRef.specId`, [inter-agent control plane](inter-agent-control-plane.md)
§2), addressed by `spur agent run --spec`, `spur agent wait` and `spur message`, so they outlive the
`team` noun (removed at the G64 cutover, 2026-09-14). Specs are materialized from the fleet declaration
at serve start; composer and doctor read them only through `spur agent list --specs`.

## 10. Composition budgets and step evidence (ADR-115)

Composer composes to the budgets and doctor judges by them. The numbers and posture live in
[surface governance](harness-surface-governance.md) §1, the rules in the
[workflow composition contract](workflow-composition-contract.md#composition-budgets-adr-115).
Plugin readers learn both from the `sp:spur-cli` reference
`references/workflows/workflow-fit-and-tuning.md`.

**Doctor's workflow evidence.**

- `spur workflow validate --json`: composition findings by `level`.
- The step profile: the plugin script `plugins/sp/scripts/workflow-step-profile` (ADR-065
  entrypoint contract) reads `spur workflow trace --json` for a workflow's last N completed runs and
  returns, per node and action kind: run count, p50 and max `durationMs`, p50 idle gap before the
  step, session mode (`fresh` or `resumed`) and `cacheHit` p50 with its coverage. Only executors
  that report token usage yield cache evidence; a missing value is unknown, never zero.

**Flags and proposals.** Each flag becomes a §5 proposal row with action class *workflow
optimization* (§4 row 4). W is the cache window, 300 s by default.

| Evidence | Flag | Proposed change |
| --- | --- | --- |
| Validate finding, `level: error` | always | Extract to an owner from the closed fix vocabulary |
| Validate finding, `level: warn` | always | Extract, or record a stays-shell reason inside the warn band |
| Deterministic step | `step-over-window` — p50 > W | Split it, or move the slow work out of the step |
| Resumed `agent.run` | `resume-after-idle` — p50 idle gap before it > W | `freshSession: true` with the prior artifact as handoff |
| Resumed `agent.run` | `resume-cold-cache` — `cacheHit` p50 < 0.5, with evidence | The same, or move a long in-step tool call to a deterministic step |
| `agent.run` | `agent-run-over-2w` — p50 > 2W | Split at an artifact seam, or no-op when none exists |

A proposal that changes a shared workflow goes through the §7 shared step and its recorded consent.
