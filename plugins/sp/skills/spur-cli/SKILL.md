---
name: spur-cli
description: "The CLI facade for the `spur` command surface — one reference per noun (task/feature/rule/workflow): verbs, flags, `--json` shapes, exit codes, the CLI-gated write contract. NOT for driving the lifecycle (that is the spine, sp:spur-dev). Triggers: \"spur task\", \"spur feature\", \"spur rule\", \"spur workflow\", \"create a task\", \"task check\", \"batch-create\", or looking up any spur CLI verb or convention."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - reference
    - companion
  nouns:
    - task
    - feature
    - rule
    - workflow
  openclaw:
    emoji: "🧰"
---

# spur-cli — the CLI facade for the Spur command surface

`spur-cli` is the single reference for operating the **`spur` command-line surface**. Each `spur`
noun (`task`, `feature`, `rule`, `workflow`) has one reference file that documents *what each verb
is, how to use it well, its flags, `--json` shapes, and exit codes*. This skill is a **facade /
dispatch reference** — it tells you which verb does what and routes you to the noun's detail. It is
**not** an orchestrator and contains **no competency logic**: the skill knows *how to invoke*; the
CLI knows *what is valid*; the **spine** (`sp:spur-dev`) knows *how to drive the lifecycle*.

## Noun routing

Pick the noun, read its reference. Each Tier A reference owns that noun's full verb catalog and conventions.

| Tier | Noun | Operate | Reference |
|------|------|---------|-----------|
| **Tier A** | **task** | Task corpus: create (variants), `deps` mutation, canonical `sections` (`init`/`add`/`list`), status lifecycle, `record`/`verdict` artifacts, `run-link`, `check --json` matrix | [references/tasks.md](references/tasks.md) |
| **Tier A** | **feature** | Feature tree: author with hierarchical IDs (DD-14), acceptance criteria (Gherkin), status lifecycle, move subtrees, `check --json` | [references/features.md](references/features.md) |
| **Tier A** | **rule** | Constraint quality gate: run presets, author rules, fine-tune, validate rule files/presets, extend engine | [references/rules.md](references/rules.md) |
| **Tier A** | **workflow** | Dual-mode workflow runtime: author state-machine / transition-flow workflows, validate, run, read traces | [references/workflows.md](references/workflows.md) |
| **Tier B** | **init** / **status** | Project initialization validation probes & layout classification; status overview | [references/init.md](references/init.md) (`spur status`) |
| **Tier B** | **agent** / **history** / **message** / **team** / **migrate** / **serve** | Long-tail nouns — read `spur <noun> --help` for specific flags | Last-resort `--help` |

**Execute-First Contract:** Load `sp:spur-cli` references first to execute Tier A commands directly without calling `spur --help`. Use `spur <noun> --help` only as a last resort for version skew, unlisted long-tail flags, or parity assertion failures.

Each noun's per-topic detail lives one level deeper under `references/<noun>/` (e.g.
`references/tasks/verbs.md`, `references/tasks/section-editing.md`, `references/features/acceptance-criteria.md`,
`references/rules/operations.md`, `references/workflows/authoring-workflows.md`).

## When to use

Use this skill to:

- **Look up a `spur` verb** — what it does, its flags, its `--json` shape, its exit codes.
- **Operate the corpus directly** — create/edit/list tasks and features, run a rule preset, validate
  or run a workflow, from the command line.
- **Author within a noun** — write a rule, author a workflow, write acceptance criteria — following
  the noun reference's conventions.

Do **not** use this skill for:

- **Driving the planning→execution lifecycle** — intake → feature → decomposition → batch-create →
  pipeline run is the spine, **`sp:spur-dev`**. This facade documents the verbs that spine dispatches.
- **Gate-level constraint *design* across the catalog** — that lives in the `rule` reference's
  authoring/fine-tuning topics, reached through this facade.

## Convention — extending the facade

Every `spur` noun is reachable here and nowhere else. **Adding a new noun adds exactly one reference
file** (`references/<noun>.md`), plus an optional `references/<noun>/` subdir for its per-topic
detail, plus one row in the Noun-routing table above. Do not create a separate `spur-<noun>` skill —
the whole point of this facade is that the CLI surface has a single, scalable home.

## What this skill is NOT

- **Not the spine.** Driving a task through `task-pipeline.yaml`, HITL surfacing, decomposition, and
  the planning loop is `sp:spur-dev` (the spine). This facade is the verb reference the
  spine and the operator both consult.
- **Not validation logic.** This skill says *run `check` / `validate`*; the rules those verbs enforce
  live in the CLI (`task check`, `feature check`, `rule run`, `workflow validate`), never restated as
  prose checks here.
- **Not a competency.** Design, implementation, testing, and review are competency skills, not CLI
  verbs — they are not documented here.

## See also

- **[references/init.md](references/init.md)** — post-scaffold init validation: the Phase 1.5
  functional-validation probes and the Phase 1.6 rule-glob adaptation (`LLM-as-judge` layout
  classification, local-layer shadow writes) that run after `spur init` and before doc
  customization (`/sp:spur-init`).
- **`sp:spur-dev`** — the spine that dispatches these verbs into the planning +
  execution lifecycle. Use it to *drive* work; use this facade to *look up or operate a verb*.
- **`sp:expert-spur`** — the subagent that loads this facade for multi-step, multi-noun corpus work
  in its own context window.

## Platform Notes

### Claude Code

`spur` CLI via the Bash tool; every verb supports `--json` for machine consumption. Invoke this skill
directly via `Skill(skill="sp:spur-cli", args="<noun> <verb> …")` to look up or operate a verb.

### Codex / OpenClaw / OpenCode / Antigravity

Run the `spur` CLI via the Bash tool and parse `--json` output. This facade is the SSOT for the verb
surface; commands and subagents are thin wrappers over it.
