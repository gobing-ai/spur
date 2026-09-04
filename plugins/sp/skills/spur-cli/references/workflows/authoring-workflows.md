---
name: authoring-workflows
description: Author a workflow — mode selection in depth, per-mode real YAML shapes, built-in actions and guards, template variables, and the validate-and-dry-run verification core.
see_also:
  - spur-cli
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
failureStates: [failed]          # optional; ⊆ terminalStates → status failed (0425)
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
| Guard | `action-ok` | Pass iff the prior action on this state/node succeeded — useful for a single hard shell check |

Order matters for both guards and conditions: **the first that passes wins.** Put the discriminating
guard before the unconditional fallback (`always` / no-guard edge). For multi-condition gates (doctor
+ task check, quality gate + attempt cap), prefer a **soft probe** shell that writes PASS|FAIL and
always exits 0, then branch with ordered status-file guards — see shipped `basic.yaml` /
`task-pipeline.yaml` (more reliable than `action-ok` alone when more than one condition decides the edge).

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

### Shell commands take vars by name, never by template

**In a `shell` command — action *or* transition guard — reference a var as `$NAME`, not
`${vars.NAME}`.**

| Where | Spelling | Why |
| ----- | -------- | --- |
| `shell` action `command:` | `$NAME` | Value arrives as process env |
| `shell` guard `command:` | `$NAME` | Same |
| Everything else (`agent.run` `input:`, `note` `message:`, `description:`, paths in non-shell options) | `${vars.NAME}` | Engine template resolution; never shell-interpreted |

`${vars.NAME}` in a shell command is resolved by the engine **into the command string** before the
shell runs, so any backtick, `$(…)`, or quote in the value is parsed as shell code. That was a live
arbitrary-execution defect in both actions (task 0432) and guards (task 0435) — and in a guard it is
especially quiet, because the injected side effect fires while the comparison still returns an
ordinary boolean. Spur's runners hand resolved vars to the subprocess as environment instead, and a
shell variable expansion is never re-parsed for metacharacters, so `$NAME` is always data.

```yaml
# WRONG — value becomes part of the command
command: 'test "${vars.profile}" = auto'
# RIGHT — value arrives as env
command: 'test "$profile" = auto'
```

This only works where Spur's runners are registered (`registerSpurBuiltins`, and the lifecycle
adapter's host). A bare `createDefaultWorkflowEngineHost()` keeps the engine's env-less runners,
where `$NAME` would expand to empty — register the Spur runners on any new host.

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
2. `spur workflow run <file> --run-id dryrun-<unique> --json` — **`status` is authoritative for
   pass/fail** (`done` success / `failed` failure); then assert `finalState === <expected>`.
   Use a fresh `--run-id` (duplicates raise `RunCollisionError`).
3. Read the trace; on a stall or wrong terminal, fix the specific guard/target/bound and re-run.

A `shell` action runs for real during the dry-run — keep it idempotent and side-effect-light while
verifying shape, or stand in a `note` action until the path is proven, then swap the real command in.

## Authoring checklist

- [ ] Fit gate cleared before the mode gate — replay + machine-checkable branch + durable record
      ([workflow-fit-and-tuning.md](workflow-fit-and-tuning.md#1-fit-gate--workflow-or-prose)).
- [ ] Mode chosen deliberately (loop → state-machine; pipeline → transition-flow); recorded the reason.
- [ ] `kind: transition-flow` set for flows; `$schema` quoted.
- [ ] Initial + terminal states/nodes declared; every transition/edge target exists.
- [ ] Guards/conditions ordered so the specific case precedes the fallback.
- [ ] `iterationBound` set for any loop; `env.allow` lists every `${env.X}` used.
- [ ] Every node inside the simplicity budget — `shell` at or under 5 non-comment units,
      `agent.run` input referencing a command rather than a raw prompt, guards a single predicate
      ([workflow-fit-and-tuning.md](workflow-fit-and-tuning.md#3-node-simplicity-budget)).
- [ ] Validates clean AND dry-run reaches the expected terminal state.

## Optional version literal (task 0756)

Both dialects accept an optional root `version` field. The literal is **behavior-neutral** — it
exists as an identity tag, not a routing key. The contract:

- **Absent** → reported as `unversioned`. The default for all 11 shipped definitions.
- **Present, non-empty string** → reported as `explicit(<literal>)`. The literal is wrapped in
  parentheses verbatim — no parsing, no ordering, no compatibility check.
- **Present, empty string (`version: ""`)** → **rejected** with a diagnostic naming the empty
  value. The rejection lives in the resolve/preflight seam
  (`packages/app/src/workflow/workflow-resolver.ts`), not in the dialect JSON schemas: those carry
  `minLength: 1` for editors and Ajv consumers, but the load path validates against the engine's
  Zod schema, which has no minimum. Move the check upstream once
  `@gobing-ai/ts-dual-workflow-engine` ships `z.string().min(1)` on the root version.

The literal folds into the definition digest (`packages/app/src/workflow/composition-baseline.ts`),
so a version-only edit changes the digest with zero behavior change. `show` and `trace` do **not**
surface the literal by default — the digest stays the rendered run identity (D8 decision D5).

**No registry, no semver parser, no compatibility engine.** A future-major requirement needs
objective evidence: a consumer that branches on version, or a real drift incident the digest
diagnostic could not disambiguate. Neither exists today.
