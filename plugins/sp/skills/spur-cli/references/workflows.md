---
name: spur-cli-workflows
description: "spur-cli noun reference: operate `spur workflow` across its full lifecycle — choose the right execution mode, author state-machine and transition-flow workflows, validate definitions, run them, read run traces, and refine existing flows. Wraps the dual-mode FSM/transition-flow runtime (`@gobing-ai/ts-dual-workflow-engine`)."
see_also:
  - spur-cli
---

# spur workflow — the dual-mode workflow CLI

`spur workflow` runs declarative YAML workflows (powered by `@gobing-ai/ts-dual-workflow-engine`) that
orchestrate a multi-step process — an implement→check→fix loop, an import→validate→transform→write
pipeline, an approval gate. The engine executes **two distinct workflow kinds**, and the first act of
any new workflow is choosing between them. Get the mode right and the rest of authoring follows the
schema; get it wrong and you fight the engine.

Operating a workflow well is a full lifecycle — choose the mode, author the YAML, validate it, run it,
read the trace, and refine. This skill covers all of it.

## Choose the execution mode first

This is the defining decision and has no analogue in `spur rule`. **Every new workflow starts here.**
The engine runs two kinds; they use different schemas, different keys, and a different mental model.
Switching kinds later is a rewrite, not an edit — so decide deliberately and, in `add`, confirm.

```
Is the run defined by ONE "current state" that picks its next state by evaluating
ordered guards, and may loop back on itself (e.g. implement → check → fix → check …)?
        │ yes                                    │ no
        ▼                                        ▼
   state-machine                     Does the run advance through a DAG of nodes,
   (initialState / states[]          each node carrying an action, following edges
    with onEnter|onExit /             forward — fan-out, gates, decisions — and
    top-level transitions[]           rarely looping (e.g. read → validate → write)?
    with guard)                                │ yes
                                               ▼
                                      transition-flow
                                      (initialNode / nodes[] typed
                                       action|gate|parallel|decision with action /
                                       edges[] with condition)
```

**Discriminator table** (lifted from the two JSON schemas — authoritative, not heuristic):

| Question | → `state-machine` | → `transition-flow` |
| -------- | ----------------- | ------------------- |
| Mental model | One current state; guard-driven next-state | DAG of nodes advancing along edges |
| Where actions live | On states: `onEnter` / `onExit` | On nodes: `node.action` |
| Branching | Ordered `transitions[]` + `guard` (first pass wins) | `edges[]` + `condition` (first pass wins); unconditional edges allowed |
| Loops / retries | **Natural** — a transition points back to a prior state | Possible but DAG-oriented; loops are awkward |
| Node typing | none (states are untyped) | `type: action\|gate\|parallel\|decision` |
| Required keys | `name, initialState, states, transitions` | `kind, name, initialNode, nodes, edges` |
| `kind` field | optional (defaults to state-machine) | **required** — `kind: transition-flow` |
| Canonical example | implement→check→fix loop (`.spur/workflows/basic.yaml`) | read→validate→transform→write pipeline |

**Heuristic:** loops / retries / one-active-state → **state-machine**; pipeline / fan-out / action-per-node → **transition-flow**.

When intent is ambiguous, default to **state-machine** (the simpler, default kind) and say so — but
in `add`, surface the recommendation **with its reason and the rejected alternative**, and confirm
before authoring. Full procedure: [workflows/authoring-workflows.md](workflows/authoring-workflows.md).

## When to use

Use this skill to:

- **Author a workflow** — turn a described process into a validated, dry-run-verified YAML definition
  in the right mode. → authoring-workflows.md
- **Validate before trusting** — schema + semantic-check a workflow file (references, terminal
  reachability, template vars) before running it.
- **Run a workflow** — execute a definition and read its run trace (states/nodes entered, transitions
  taken, terminal status).
- **Refine an existing workflow** — fix a stuck guard, add a state/node, retune `iterationBound`,
  re-scope variables / `env.allow`, with the smallest change. → workflows/operations.md
- **Extend the engine** — register a custom action/guard runner or a trust-gated extension module when
  the built-ins (`note`, `shell`, `always`, `action-ok`) fall short. → workflows/validation-and-extension.md

## Operations

The skill's logic divides by **whether the LLM adds value**:

- **Direct CLI** (`validate`, `run`, `list`, `trace`, `continue`, `cancel`, `clean`) — deterministic,
  single-verb commands. Run them straight. A slash-command wrapper would only forward flags and add
  drift; **there is no command for these — use the CLI**. The skill still drives them in natural
  language (interpreting a failed validate, reading a run trace).
- **Agent-driven** (`add`, `refine`) — convert fuzzy human intent into a reliable sequence the CLI
  cannot express as one verb. `add` chooses the mode and authors a new workflow; `refine` tunes an
  existing one. These are the operations worth a slash command, and the skill owns all their logic.
  Full procedures: [workflows/operations.md](workflows/operations.md).

| Operation | Backed by | Input | Output (done-when) |
| --------- | --------- | ----- | ------------------ |
| `validate` | `spur workflow validate` (CLI) | `<file> [--no-schema]` | Schema + semantic verdict |
| `run` | `spur workflow run` (CLI) | `<file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--quiet/--silent/--verbose] [--detail <level>] [--trace-file] [--steer]` | Terminal state reached (sync) or run started (async); trace readable |
| `continue` | `spur workflow continue` (CLI) | `[run-id] [--yes]` | Resume a paused HITL run (omit id → most recent paused) |
| `cancel` | `spur workflow cancel` (CLI) | `<run-id>` | Single non-terminal run marked failed (SIGTERM async worker when live) |
| `clean` | `spur workflow clean` (CLI) | `[--older-than <min>] [--force] [--dry-run]` | Bulk-finalize stale `running`/`pending` runs as failed |
| `list` | `spur workflow list` (CLI) | — | Available workflow **YAML definition files** (not run records) |
| `trace` | `spur workflow trace` (CLI) | `[run-id] [--workflow <n>] [--status <s>] [--since <iso>] [--last <n>] [--follow] [--poll <ms>]` | Run history list or per-run timeline |
| `add` | agent procedure | `"<nl-description>" [--kind <state-machine\|transition-flow>] [--file <path>]` | **Mode chosen (confirmed)** → first reconciled against existing workflows (extend an existing flow rather than duplicate) → YAML authored in real schema shape → **validated AND dry-run** (reaches the expected terminal state) → [add](workflows/operations.md#add) |
| `refine` | agent procedure | `<workflow-file> [--intent "<goal>"] [--dry-run]` | Smallest change meeting the intent, re-validated and re-dry-run; `--dry-run` emits a diff only → [refine](workflows/operations.md#refine) |

`add` and `refine` are not CLI verbs. They compose `validate` + `run` around a generated/edited YAML
definition and both end in the same **validate-and-dry-run** core
([operations.md](workflows/operations.md#sub-procedure-validate-and-dry-run)) so a tuned workflow is
verified exactly like an authored one. They also share the **find-existing-workflow** core
([operations.md](workflows/operations.md#sub-procedure-find-existing-workflow)): `add` runs it up front
(don't duplicate an existing flow), `refine` runs it to locate the target. `add` additionally runs the
**mode-selection gate** before authoring — the one human-in-the-loop step unique to workflows.

## The harness loop (choose → author → validate → dry-run → read trace)

```
choose mode (decision tree above)
        │
        ▼
author YAML — real schema shape for that mode; quote $schema
        │
        ▼
spur workflow validate <file> --json          ← schema + semantic gate
        │
   valid? ──no──▶ read errors → fix the definition → re-validate
        │ yes
        ▼
spur workflow run <file> --dry-run --run-id <throwaway> --json   ← dry-run
        │
   status === 'done' AND finalState === <expected>? ──no──▶ read trace,
        │ yes                                                 fix the offending
        ▼                                                     state/node/guard, re-run
   trust the workflow
```

Two signals, two purposes: `validate` proves the definition is *well-formed and self-consistent*;
`run --dry-run` proves it *walks* — reaching the intended terminal state along the intended path
without executing side-effecting actions. A workflow you have not dry-run is a workflow you do not
trust. Always use `--json` when an agent consumes the result.

### Step 1: Validate

```bash
spur workflow validate ./workflows/approval.yaml --json
spur workflow validate ./workflows/import.yaml --no-schema --json   # skip the $schema ref, keep semantic checks
```

`validate` runs the structural Zod schema **and** semantic invariants (referenced states/nodes exist,
terminal states reachable, template vars resolve). A non-zero exit means **not well-formed** — fix the
definition, not the runner.

### Step 2: Dry-run

```bash
spur workflow run ./workflows/approval.yaml --dry-run --run-id dryrun-$(date +%s) --json
```

Prefer **`--dry-run`** so actions are not executed. Use a throwaway `--run-id` so the dry-run does
not collide with a real run (duplicate ids raise `RunCollisionError`). Read `status` and `finalState`
from the JSON. A failed run returns `status: 'failed'` in the result — it does **not** throw; read
the trace (`spur workflow trace <run-id>`) to find the offending step.

### Step 3: Read the trace and fix

Inspect which states/nodes were entered and which transitions/edges were taken. A run that stalls
short of the expected terminal state points at a guard/condition that never passed, a mistyped target,
or an `iterationBound` exhausted by a runaway loop. Fix the **specific** definition flaw — no drive-by
restructuring — then re-run. Loop until the run reaches the expected terminal state.

### Run output and observability flags

The `run` verb has six output/observability flags beyond the core `--dry-run`/`--async`/`--no-plan`.
All six are ignored under `--json` (machine output stays byte-identical):

```bash
spur workflow run ./workflows/approval.yaml --quiet                # final summary only
spur workflow run ./workflows/approval.yaml --silent               # errors only (non-zero exit on failure)
spur workflow run ./workflows/approval.yaml --verbose              # transitions + correlation diagnostics
spur workflow run ./workflows/approval.yaml --detail minimal       # tersest human output
spur workflow run ./workflows/approval.yaml --trace-file           # persist redacted JSONL trace
spur workflow run ./workflows/approval.yaml --steer                # interactive steering on stdin
```

- **`--quiet`**, **`--silent`**, **`--verbose`** are mutually constraining: `--quiet` and `--verbose`
  are exclusive (exit `2`); `--silent` cannot combine with either (exit `2`).
- **`--detail <level>`** sets human verbosity: `minimal` (state changes only), `invocation` (default;
  per-step headers), `full` (transitions + correlation). `--verbose` is shorthand for `--detail full`.
- **`--trace-file`** appends a redacted, schema-versioned JSONL trace under `.spur/runs/workflow/`
  for post-run analysis - independent of human/JSON output.
- **`--steer`** is synchronous and in-process: it cannot combine with `--json` or `--async` (exit `2`).
  It accepts steering commands on stdin at declared action boundaries for interactive control.

## Command surface

```
spur workflow validate <file> [--no-schema] [--json]
spur workflow run      <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] [--quiet/--silent/--verbose] [--detail <level>] [--trace-file] [--steer] [--json]
spur workflow continue [run-id] [--yes] [--json]
spur workflow cancel   <run-id> [--json]
spur workflow clean    [--older-than <minutes>] [--force] [--dry-run] [--json]
spur workflow list     [--json]
spur workflow trace    [run-id] [--workflow <name>] [--status <s>] [--since <iso>] [--last <n>] [--follow] [--poll <ms>] [--json]
```

| Flag (on `run`) | Effect |
| --------------- | ------ |
| `--vars <json>` | Per-run variable overrides (JSON object). Merged over the workflow's `vars`. Values must be strings. User vars win over injected defaults (`spurBin`). |
| `--dry-run` | Validate and walk transitions **without** executing actions. |
| `--async` | Start in the background and exit with `runId`; monitor via `spur workflow trace <run-id>`. |
| `--no-plan` | Suppress the human run-start plan preview (sync human runs only; ignored under `--json`/`--async`). |
| `--quiet` | Suppress plan and per-step progress; keep the final summary. |
| `--silent` | Suppress all routine output; errors still set a non-zero exit status. |
| `--verbose` | Include transitions and correlation diagnostics in human progress (implies `--detail full`). |
| `--detail <level>` | Human detail level: `minimal`, `invocation` (default), or `full`. |
| `--trace-file` | Append a redacted schema-versioned JSONL trace under `.spur/runs/workflow/`. |
| `--steer` | Accept in-process steering commands on stdin at declared action boundaries (sync only; incompatible with `--json`/`--async`). |

`validate` and `run` exit non-zero on failure (`run` exits non-zero when the final status is not
`done`). `list` prints **workflow definition files** available on disk. For run history use `trace`:

```bash
spur workflow list --json
spur workflow trace --last 10 --json
spur workflow trace <run-id> --json
```

Follow a live run to terminal (human streaming mode):

```bash
spur workflow trace <run-id> --follow            # stream until terminal (default 1000ms poll)
spur workflow trace <run-id> --follow --poll 500 # poll every 500ms
```

- **`--follow`** replays a run timeline and polls persisted state until it becomes terminal. It
  requires a `run-id` (exit `2` without one) and cannot combine with `--json` (exit `2` - it is a
  human streaming mode).
- **`--poll <ms>`** sets the follow polling interval (default `1000`, minimum `50`; exit `2` otherwise).

HITL pause/resume: a run that hits a HITL action pauses; resume with `spur workflow continue [run-id]`
(`--yes` skips confirmation). Cancel one live/paused run with `cancel <run-id>`; bulk-finalize
orphans stuck in `running`/`pending` with `clean` (`--older-than` default 30 minutes, or `--force`).
## Behavior

This skill behaves as an **author** (choose mode → write a correct definition → prove it runs) feeding
a **pipeline** (validate → dry-run → read trace → refine). It also covers tuning existing workflows and
extending the engine with custom actions/guards. It does not execute the orchestrated *work* itself —
the workflow's actions (`shell`, custom runners) do that; this skill builds and operates the workflow.

## Gotchas

1. **`kind` is required for transition-flow, optional for state-machine.** A missing `kind` silently
   parses as state-machine. If you authored flow intent (`nodes`/`edges`) without `kind: transition-flow`,
   validation fails confusingly against the wrong schema. Always set `kind` explicitly for flows.
2. **`$schema` must be quoted** — it starts with `@`, which YAML reserves. Unquoted is a parse error.
   (Same trap as `spur rule`.)
3. **Guard / edge declaration order matters.** The first passing guard (state-machine) or condition
   (transition-flow) wins. Order the specific case before the fallback — e.g. an `action-ok` guard
   before the unconditional retry edge, so a passing check short-circuits (see `.spur/workflows/basic.yaml`).
4. **`env.allow` is an allowlist.** `${env.X}` resolves only if `X` is listed under `env.allow`;
   otherwise it resolves empty. A workflow that "loses" an environment value usually forgot to allow it.
5. **Extensions are fail-closed.** Custom action/guard *modules* require `allowExtensions: true`; a
   declared-but-not-allowed extension throws **before any import** — never silently dropped. Inline
   `host.registerAction`/`registerGuard` need no flag; only the module loader is gated.
6. **A failed run does not throw.** Action/guard failures come back as `WorkflowRunResult` with
   `status: 'failed'`, preserving the run record. Read the trace; don't expect an exception. (Definition
   errors — schema/semantic/missing-state — *do* throw: `WorkflowValidationError` / `FSMError` / `RunCollisionError`.)
7. **Bound your loops.** A state-machine with a retry cycle needs `iterationBound` or it can run away.
   The driver fails the run with `iteration-bound-exceeded` once the bound is crossed.
8. **`onError` is library/runtime-only for now.** The TypeScript engine supports
   `action.onError ?? workflow.defaultOnError ?? runOptions.onError ?? 'fail'`, but the bundled JSON
   schemas used by quoted `$schema` validation do not yet include `onError` / `defaultOnError`.
   Do not author those fields in normal CLI YAML unless you intentionally validate with `--no-schema`
   and own the compatibility tradeoff.

## Additional Resources

- [workflows/operations.md](workflows/operations.md) — the operation procedures (validate/run/list/add/refine),
  the shared find-existing-workflow and validate-and-dry-run cores, and the mode-selection gate. The
  entry point for slash-command delegation.
- [workflows/authoring-workflows.md](workflows/authoring-workflows.md) — author a workflow: mode
  selection in depth, per-mode real YAML shapes, built-in actions/guards, template variables, the
  validate-and-dry-run core, expected-terminal-state assertion.
- [workflows/validation-and-extension.md](workflows/validation-and-extension.md) — validate semantics,
  custom action/guard runners, the trust-gated extension loader, and CLI-vs-library capability gaps.
- `@gobing-ai/ts-dual-workflow-engine` README — authoritative library reference (both drivers,
  RunLifecycle, persistence, the full event map, every built-in capability).
- `.spur/workflows/basic.yaml` — the canonical state-machine implement→check→fix loop; copy real
  shapes from here.

## Platform Notes

### Claude Code
Run `spur workflow` via the Bash tool. During development the CLI entry is a `.ts` file that runs only
under Bun: `bun run apps/cli/src/index.ts workflow validate <file> --json`. The installed `spur` binary
works once built.

### Codex / OpenClaw / OpenCode / Antigravity
Run `spur workflow ...` via the Bash tool; parse `--json` output programmatically. Arguments are passed
directly on the command line.

---

**Template type**: technique
**Purpose**: Operate `spur workflow` across its full lifecycle — choose the execution mode, author, validate, run, and refine dual-mode workflows
