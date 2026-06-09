---
name: authoring-workflows
description: Author a workflow — mode selection in depth, per-mode real YAML shapes, built-in actions and guards, template variables, and the validate-and-dry-run verification core.
see_also:
  - spur-workflows
  - operations
---

# Authoring Workflows

How to write a workflow definition that validates and runs. Start with mode, then the schema shape for
that mode, then the actions/guards and template vars, then prove it with validate-and-dry-run.

## Mode selection in depth

The two kinds are not interchangeable. They differ at the schema level:

| | `state-machine` | `transition-flow` |
| --- | --- | --- |
| Unit of progress | a **state** the run currently occupies | a **node** the run advances through |
| Where work happens | `state.onEnter` / `state.onExit` action lists | `node.action` (one action per node) |
| How the next step is chosen | top-level `transitions[]`, each `{from, to, guard?}`; first guard that passes wins | `edges[]`, each `{from, to, condition?}`; first condition that passes wins; an edge with no condition is unconditional |
| Looping | first-class — point a transition back to an earlier state | possible but the model is DAG-forward; loops read awkwardly |
| Node types | none | `type: action \| gate \| parallel \| decision` |
| Terminal | `terminalStates: [...]` | `terminalNodes: [...]` |
| `kind` | optional (default) | **required**: `kind: transition-flow` |

**Decide by the dominant shape of the process:**

- A **loop with retries** — implement → check → fix → check until pass — is a state-machine. One thing
  is active; a guard decides whether to advance or loop back.
- A **pipeline** — read → validate → transform → write, possibly with a gate or fan-out — is a
  transition-flow. Each node does one thing and hands off along an edge.
- When genuinely torn, choose **state-machine** (simpler, the default kind) and record why.

## Per-mode shapes

Copy these real shapes; do not reconstruct from memory. Both quote `$schema` (leading `@` is reserved).

### State-machine

```yaml
$schema: "@gobing-ai/ts-dual-workflow-engine/schemas/state-machine-workflow.schema.json"
kind: state-machine            # optional, but include it for legibility
name: approval
description: Implement → check → fix until the check passes or the bound is exhausted
iterationBound: 2              # bounds any loop; required when a transition points backward
initialState: implement
terminalStates: [done, failed]
vars:
  reviewer: robin              # ${vars.reviewer}
env:
  allow: [APP_ENV]             # only allow-listed names resolve via ${env.APP_ENV}
states:
  - id: implement
    description: Implement the requested task
    onEnter:
      - kind: note
        options:
          message: "Implementing task: ${task}"
  - id: check
    onEnter:
      - kind: shell
        options:
          command: bun run check
  - id: fix
    onEnter:
      - kind: note
        options:
          message: "Please fix the issues found"
  - id: done
  - id: failed
transitions:
  - from: implement
    to: check
  # Declaration order matters: the action-ok guard is tried first, so a passing
  # check short-circuits to done before the unconditional fix edge is considered.
  - from: check
    to: done
    guard: { kind: action-ok }
  - from: check
    to: fix
  - from: fix
    to: check
```

Required keys: `name`, `initialState`, `states`, `transitions`. Each state needs an `id`; `onEnter`/
`onExit` are optional action lists. Each transition needs `from`/`to`; `guard` and `trigger` are
optional (a transition with no guard is unconditional).

### Transition-flow

```yaml
$schema: "@gobing-ai/ts-dual-workflow-engine/schemas/transition-flow-workflow.schema.json"
kind: transition-flow          # REQUIRED — a missing kind parses as state-machine
name: import-file
description: Read → validate → done pipeline
initialNode: read
terminalNodes: [done]
vars:
  file: events.jsonl           # ${vars.file}
nodes:
  - id: read
    type: action
    action:
      kind: note
      options:
        message: "reading ${vars.file}"
  - id: validate
    type: gate
  - id: done
edges:
  - from: read
    to: validate
  - from: validate
    to: done
    condition: { kind: always }
```

Required keys: `kind` (`transition-flow`), `name`, `initialNode`, `nodes`, `edges`. Each node needs an
`id`; `type` (`action`/`gate`/`parallel`/`decision`) and `action` are optional. Each edge needs
`from`/`to`; `condition` is optional (no condition = unconditional edge).

## Built-in actions and guards

The default host (`createDefaultWorkflowEngineHost()`) registers these. Anything else needs a custom
runner (see [validation-and-extension.md](validation-and-extension.md)).

| Capability | Kind | Use |
| ---------- | ---- | --- |
| Action | `note` | Record a message in the run's result data; the safe no-op for shaping/dry-running |
| Action | `shell` | Run a shell command via the runtime `ProcessExecutor`; the action "succeeds" or "fails" by exit code |
| Guard | `always` | Unconditional pass — the default edge condition / fallback transition |
| Guard | `action-ok` | Pass iff the prior action on this state/node succeeded — the basis of the check→done short-circuit |

Order matters for both guards and conditions: **the first that passes wins.** Put the discriminating
guard (`action-ok`) before the unconditional fallback (`always` / no-guard edge).

## Template variables

Actions receive resolved templates. Available substitutions:

| Template | Source |
| -------- | ------ |
| `${vars.NAME}` | Workflow `vars` merged with per-run `vars` (run overrides win) |
| `${env.NAME}` | Environment values **explicitly listed in `env.allow`** (else empty) |
| `${runId}` / `${run}` | Current run id |
| `${workflow}` / `${task}` | Workflow name |
| `${state}` / `${node}` | Current state or node id |
| `${iteration}` | Current transition count |
| `${runtime}` | Execution mode (`state-machine` or `transition-flow`) |

`env.allow` is an allowlist: a `${env.X}` whose `X` is not listed resolves to empty, not an error — a
common silent surprise. Add the name to `env.allow` for it to resolve.

## Error policy (`onError`)

`onError` is a current **library/runtime capability**, not a normal quoted-`$schema` YAML authoring
field. The TypeScript schema accepts it and the drivers resolve it at three levels with precedence
`action.onError ?? workflow.defaultOnError ?? runOptions.onError ?? 'fail'`, but the bundled JSON
schemas used by `spur workflow validate <file> --json` when `$schema` is present do not yet list
`onError` / `defaultOnError`.

- **`fail`** — the run halts immediately with `status: 'failed'` on the first action error.
- **`continue`** — logs a non-fatal warning and advances to the next guard/edge evaluation. A node
  with no outbound edges that fails under `continue` still terminates as `done`.

For CLI-authored YAML, keep the default fail-fast behavior and model best-effort behavior explicitly
with guards/branches until the JSON schemas catch up. Use YAML-level `onError` only when you
intentionally validate with `--no-schema` and own the compatibility tradeoff.

## The validate-and-dry-run core

Authoring is not done until the workflow is proven. The core (full steps in
[operations.md](operations.md#sub-procedure-validate-and-dry-run)):

1. `spur workflow validate <file> --json` — schema + semantic. Fix until clean.
2. `spur workflow run <file> --run-id dryrun-<unique> --json` — expect `status: 'done'` and
   `finalState === <expected>`. Use a fresh `--run-id` (duplicates raise `RunCollisionError`).
3. Read the trace; on a stall or wrong terminal, fix the specific guard/target/bound and re-run.

A `shell` action runs for real during the dry-run — keep it idempotent and side-effect-light while
verifying shape, or stand in a `note` action until the path is proven, then swap the real command in.

## Authoring checklist

- [ ] Mode chosen deliberately (loop → state-machine; pipeline → transition-flow); recorded the reason.
- [ ] `kind: transition-flow` set for flows; `$schema` quoted.
- [ ] Initial + terminal states/nodes declared; every transition/edge target exists.
- [ ] Guards/conditions ordered so the specific case precedes the fallback.
- [ ] `iterationBound` set for any loop; `env.allow` lists every `${env.X}` used.
- [ ] Validates clean AND dry-run reaches the expected terminal state.
