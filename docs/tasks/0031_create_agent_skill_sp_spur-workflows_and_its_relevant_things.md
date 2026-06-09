---
name: "create agent skill sp:spur-workflows and its relevant things"
description: "create agent skill sp:spur-workflows and its relevant things"
status: Done
created_at: 2026-06-09T20:05:07.448Z
updated_at: 2026-06-09T20:32:31.612Z
folder: docs/tasks
type: task
feature-id: ""
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: done
  testing: done
---

## 0031. "create agent skill sp:spur-workflows and its relevant things"

### Background
To  help to use the Spur's workflow engine better, we need to create a new agent skill `sp:spur-workflows` that leverage the workflow engine's capabilities and its relevant things like we did with the `sp:spur-rules` agent skill and its relevant things.

Ideally, we can add the following:
- plugins/sp/skills/spur-workflows
- relevant slash commands like:
  - plugins/sp/commands/workflow-add.md
  - plugins/sp/commands/workflow-refine.md
  - plugins/sp/commands/workflow-scan.md : TBD, whether we need this one
- relevant subagent: plugins/sp/agents/expert-workflows.md

For the slash commands, we need to discuss whether above are necessary and enough. If needed, we can add more slash commands or get rid of some of them.

For the source code side, you can refer to folder `~/xprojects/ts-libs/packages/dual-workflow-engine`. You can also refer to the document here: ~/xprojects/ts-libs/packages/dual-workflow-engine/README.md

### Requirements
- harden the requirements first, figure out what kind of slash commands we need then.
- Implement the fat agent skill in `plugins/sp/skills/spur-workflows`
- Implement these thin wrapper slash commands for the workflow engine
- Implement these thin wrapper subagents for the workflow engine


### Q&A

**Q1. Which slash commands do we actually need? Is `workflow-scan` warranted?**
No `workflow-scan`. `scan` exists in the rules family because constraints are *discovered from
recurring anti-patterns* — a meaningful survey of code smells. Workflows are not discovered from
smells; they are *designed* from a process. There is no "recurring workflow pattern in the code" to
survey. Drop `scan`. Ship two agent-driven commands: `/sp:workflow-add` and `/sp:workflow-refine`.

**Q2. Do we wrap `validate` / `run` / `list`?**
No. These are deterministic single-verb CLI commands (`spur workflow validate|run|list`). The rules
family's own design rule applies: a wrapper that only forwards flags adds drift. The skill drives
them in natural language (interpreting a failed validate, reading a run trace), but they are invoked
straight from the CLI — no slash command.

**Q3. What is the defining difference from `spur-rules`?**
**Mode selection.** Every new workflow first requires choosing between two execution kinds:
`state-machine` and `transition-flow`. This choice has no analogue in the rules family and must be a
**first-class, upfront artifact in `SKILL.md`** — a decision tree + table the agent consults before
authoring anything. (See Design §2.) This is the single most important piece of authoring knowledge.

**Q4. What replaces the rules "validate-and-smoke-test" verification core?**
A workflow analogue: **validate-and-dry-run**. A rule is verified by "fires on a known-bad fixture,
quiet on a known-good one". A workflow is verified by "schema-validates, then a throwaway run reaches
the *expected* terminal state and exercises the intended path". Different core, not a rename.

**Q5. Mode-selection is irreversible-ish — should `add` ask the user?**
Yes. Mode is a structural commitment (different schema, different keys, different mental model;
switching later is a rewrite). `add` must surface the recommended mode **with its reason** and the
chosen-against alternative, and confirm before authoring. This is the one human-in-the-loop gate
unique to workflows.

### Design

#### 1. Deliverables (mirrors `spur-rules`, minus `scan`)

| Artifact | Path | Mirrors |
|----------|------|---------|
| Fat skill | `plugins/sp/skills/spur-workflows/SKILL.md` | `spur-rules/SKILL.md` |
| Reference: operations | `…/spur-workflows/references/operations.md` | rules `operations.md` |
| Reference: authoring | `…/spur-workflows/references/authoring-workflows.md` | rules `authoring-rules.md` |
| Reference: validate+extend | `…/spur-workflows/references/validation-and-extension.md` | rules same |
| Command | `plugins/sp/commands/workflow-add.md` | `rule-add.md` |
| Command | `plugins/sp/commands/workflow-refine.md` | `rule-refine.md` |
| Subagent | `plugins/sp/agents/expert-workflows.md` | `expert-rules.md` |

No `workflow-scan.md`. No wrappers for `validate`/`run`/`list`.

#### 2. The mode-selection decision artifact (the defining difference)

`SKILL.md` leads (right after the intro) with a **"Choose the execution mode first"** section: a
decision tree backed by a table whose discriminators come straight from the two JSON schemas.

**Decision tree:**

```
Is the run defined by ONE "current state" that picks its next state by evaluating
ordered guards, possibly looping back on itself (e.g. implement→check→fix→check…)?
        │ yes                                   │ no
        ▼                                       ▼
   state-machine                    Does the run advance through a DAG of nodes,
   (initialState / states[]         each node carrying an action, following edges
    with onEnter|onExit /            forward (fan-out / gates / decisions), rarely
    top-level transitions[]          looping (e.g. read→validate→transform→write)?
    with guard)                              │ yes
                                             ▼
                                    transition-flow
                                    (initialNode / nodes[] typed
                                     action|gate|parallel|decision with action /
                                     edges[] with condition)
```

**Discriminator table (schema-grounded):**

| Question | → state-machine | → transition-flow |
|----------|-----------------|-------------------|
| Mental model | One current state, guard-driven next-state | DAG of nodes advancing along edges |
| Where actions live | On states: `onEnter` / `onExit` | On nodes: `node.action` |
| Branching mechanism | Ordered `transitions[]` with `guard` (first pass wins) | `edges[]` with `condition` (first pass wins); unconditional edges allowed |
| Loops / retries | Natural — a transition points back to a prior state | Possible but DAG-oriented; loops are awkward |
| Node typing | none (states are untyped) | `type: action\|gate\|parallel\|decision` |
| Required keys | `name, initialState, states, transitions` | `kind, name, initialNode, nodes, edges` |
| `kind` field | optional (default) | **required** (`transition-flow`) |
| Canonical example | implement→check→fix loop (`config/workflows/basic.yaml`) | read→validate→transform→write pipeline |
| Pick it when | state + retry/loop semantics dominate | linear/branching pipeline, action-per-node |

Heuristic one-liner for the skill: **loops/retries → state-machine; pipelines/fan-out → transition-flow.**

#### 3. Operations table (skill owns all logic)

| Operation | Backed by | Done-when |
|-----------|-----------|-----------|
| `validate` | `spur workflow validate <file>` (CLI) | schema + semantic verdict |
| `run` | `spur workflow run <file> [--run-id]` (CLI) | terminal state reached; trace read |
| `list` | `spur workflow list` (CLI) | persisted runs listed |
| `add` | agent procedure | **mode chosen (confirmed)** → YAML authored → validate-and-dry-run green |
| `refine` | agent procedure | smallest change meeting intent → re-validated + re-dry-run |

`add`/`refine` share two cores: **find-existing-workflow** (don't duplicate an existing workflow —
extend/refine instead) and **validate-and-dry-run** (the verification core in §Q4).

#### 4. The harness loop (author → validate → dry-run → read trace)

```
choose mode (tree §2)
        ▼
author YAML (real schema shape for that mode; quote $schema)
        ▼
spur workflow validate <file> --json     ← schema + semantic gate
        ▼  valid?
spur workflow run <file> --run-id <throwaway> --json   ← dry-run
        ▼  status === 'done' AND finalState === expected?
   yes → trust it    no → read trace, fix the offending state/node/guard, re-run
```

#### 5. Gotchas to capture in `SKILL.md`

1. `$schema` must be **quoted** — leading `@` is YAML-reserved (same trap as rules).
2. **`kind` is required for transition-flow**, optional (defaulted) for state-machine — a missing
   `kind` silently parses as state-machine and fails confusingly against flow intent.
3. **Guard/edge declaration order matters** — the first passing guard/condition wins; order
   `action-ok` before fallbacks (see `basic.yaml`).
4. `env.allow` is an **allowlist** — `${env.X}` resolves only if `X` is listed; otherwise empty.
5. **Extensions are fail-closed** — custom action/guard modules require `allowExtensions: true`;
   declared-but-not-allowed throws before import. Never silently dropped.
6. A failed run returns `status: 'failed'` in the result (does not throw) — read the trace, don't
   expect an exception.
7. `iterationBound` guards loops — an FSM with a retry cycle needs a bound or it can run away.

### Solution

Implement **Approach 1** (symmetry with `spur-rules`, minus `scan`), with mode-selection promoted to
a first-class upfront artifact in `SKILL.md` (Design §2). The skill is fat (owns mode-selection,
authoring per mode, both verification cores, extension trust-gate); the two commands and the subagent
are thin wrappers that delegate all logic to `sp:spur-workflows`. Verification core is
**validate-and-dry-run**, not the rules "fires-on-bad". Schema discriminators are lifted directly from
`schemas/{state-machine,transition-flow}-workflow.schema.json` so the decision table is authoritative,
not hand-waved.

### Plan

1. **`SKILL.md`** — frontmatter (name `spur-workflows`, triggers, platforms) → intro → **"Choose the
   execution mode first"** (tree + table, Design §2) → operations table (§3) → harness loop (§4) →
   command surface (`validate`/`run`/`list` CLI) → gotchas (§5) → references map → platform notes.
2. **`references/authoring-workflows.md`** — per-mode real YAML shapes, action/guard `kind`s
   (`note`/`shell`/`always`/`action-ok`), template vars (`${vars.*}`, `${env.*}`, builtins), the
   **validate-and-dry-run** core, expected-terminal-state assertion.
3. **`references/validation-and-extension.md`** — `spur workflow validate` semantics, custom
   action/guard runners, the trust-gated extension loader (`allowExtensions`, `..` rejection).
4. **`references/operations.md`** — `add`/`refine` procedures + the shared `find-existing-workflow`
   and `validate-and-dry-run` cores + the mode-confirmation gate. Entry point for command delegation.
5. **`commands/workflow-add.md`** — thin wrapper, `Skill(skill="sp:spur-workflows", args="add $ARGUMENTS")`;
   args: `"<description>" [--kind <state-machine|transition-flow>] [--file <path>]`. Default `--kind`
   = agent-recommended (confirmed).
6. **`commands/workflow-refine.md`** — thin wrapper, `refine $ARGUMENTS`; args:
   `<workflow-file> [--intent "<goal>"] [--dry-run]`.
7. **`agents/expert-workflows.md`** — mirror `expert-rules.md`: router + sequencer, delegates to the
   skill, owns the mode-confirmation and validate-and-dry-run gates. `skills: [sp:spur-workflows]`.
8. **Verify** — `spur workflow validate config/workflows/basic.yaml` still passes; author one
   transition-flow example and validate it; confirm no repo gate touches `plugins/` (markdown).


### Review

Implemented Approach 1 as planned. All seven files created mirroring the `spur-rules` family's
structure, frontmatter, and voice, with the workflow-specific divergences:

- **Mode-selection is first-class** in `SKILL.md` — a decision tree + schema-grounded discriminator
  table sit immediately after the intro ("Choose the execution mode first"), before any operation.
- **`add` runs a mode-selection gate** (recommend mode + reason + rejected alternative, confirm) —
  the one human-in-the-loop step unique to workflows. Codified in `operations.md`.
- **Verification core = validate-and-dry-run** (validates, then a throwaway run reaches the *expected*
  terminal state) — genuinely different from the rules "fires-on-bad / quiet-on-good" core.
- **No `workflow-scan`** (workflows are designed, not discovered from smells); **no wrappers for
  `validate`/`run`/`list`** (deterministic CLI verbs — wrapping adds drift).

No source code touched — pure plugin markdown. Biome ignores `plugins/**` (verified: 0 files
processed), so the repo gate has nothing to act on. Plugin files are auto-discovered by directory
convention via `.claude-plugin/marketplace.json → ./plugins/sp`; no manifest edit needed.

### Testing

Schema claims verified end-to-end against the live `spur workflow` CLI (`bun run apps/cli/src/index.ts`):

- **State-machine** — `spur workflow validate config/workflows/basic.yaml --json` → `valid: true`
  (the canonical implement→check→fix loop; `action-ok` short-circuit confirmed by the existing file).
- **Transition-flow** — authored the exact `import-file.yaml` example documented in
  `authoring-workflows.md`; `validate` → `valid: true`; `run --run-id dryrun-… --json` → `status:
  done, finalState: done`. Confirms `kind: transition-flow` required, `nodes`/`edges`/`condition`
  shape, and `${vars.file}` resolution.

`git status` shows only the intended new files.

### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |
| Skill | `plugins/sp/skills/spur-workflows/SKILL.md` | Lord Robb | 2026-06-09 |
| Reference | `plugins/sp/skills/spur-workflows/references/operations.md` | Lord Robb | 2026-06-09 |
| Reference | `plugins/sp/skills/spur-workflows/references/authoring-workflows.md` | Lord Robb | 2026-06-09 |
| Reference | `plugins/sp/skills/spur-workflows/references/validation-and-extension.md` | Lord Robb | 2026-06-09 |
| Command | `plugins/sp/commands/workflow-add.md` | Lord Robb | 2026-06-09 |
| Command | `plugins/sp/commands/workflow-refine.md` | Lord Robb | 2026-06-09 |
| Subagent | `plugins/sp/agents/expert-workflows.md` | Lord Robb | 2026-06-09 |

### References

- `@gobing-ai/ts-dual-workflow-engine` README + `schemas/{state-machine,transition-flow}-workflow.schema.json`
- `plugins/sp/skills/spur-rules/**` (the family this mirrors)
- `config/workflows/basic.yaml` (canonical state-machine example)

### Verification — 2026-06-09 (`rd3-dev-verify 0031 --auto --fix all --force`)

**Verdict:** PASS after fix
**Scope:** `plugins/sp/skills/spur-workflows/**`, `plugins/sp/commands/workflow-{add,refine}.md`,
`plugins/sp/agents/expert-workflows.md`, task file
**Gate:** `bun run lint` PASS; `bun run test` PASS (384 tests); `bun run test-cf` PASS; `bun run build` PASS

#### Review Findings

| # | Title | Dimension | Location | Recommendation | Status |
|---|-------|-----------|----------|----------------|--------|
| 1 | `onError` documented as normal YAML despite JSON schema rejection | Correctness | `plugins/sp/skills/spur-workflows/references/authoring-workflows.md:156` | Treat `onError` / `defaultOnError` as library/runtime-only until bundled JSON schemas include those fields; do not recommend them for quoted-`$schema` CLI YAML. | Fixed |

#### Requirements Traceability

- [x] **R1** harden requirements and decide commands → **MET** | Q&A rejects `workflow-scan` and direct wrappers for `validate`/`run`/`list`; keeps only `workflow-add` and `workflow-refine`.
- [x] **R2** implement fat skill in `plugins/sp/skills/spur-workflows` → **MET** | `SKILL.md` plus three references cover mode selection, authoring, operations, validation, and extension boundaries.
- [x] **R3** implement thin wrapper slash commands → **MET** | `workflow-add.md` and `workflow-refine.md` delegate to `sp:spur-workflows`; no deterministic CLI wrappers added.
- [x] **R4** implement thin wrapper subagent → **MET** | `expert-workflows.md` delegates lifecycle logic to `sp:spur-workflows` and owns routing/sequencing only.

Verification probes:

- `bun run apps/cli/src/index.ts workflow validate config/workflows/basic.yaml --json` → `valid: true`
- Temporary transition-flow fixture matching `authoring-workflows.md` → `validate: valid true`; `run: status done, finalState done`
- Temporary `onError` fixture → normal `$schema` validation rejects `onError` / `defaultOnError`; `--no-schema` accepts it. Docs updated to reflect this compatibility boundary.
