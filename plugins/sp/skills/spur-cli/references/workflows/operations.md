---
name: operations
description: Named operation procedures (validate/run/list/trace/continue/cancel/clean/add/refine), the mode-selection gate, and the shared find-existing-workflow and validate-and-dry-run cores that back the spur workflow slash commands.
see_also:
  - spur-cli
---

# Operations

The skill's operations as discrete procedures. The deterministic ones (`validate`, `run`, `list`,
`trace`, `continue`, `cancel`, `clean`) are direct CLI verbs — documented briefly here for completeness,
but you run them straight (no slash command). The agent-driven ones (`add`, `refine`) convert fuzzy
intent into a reliable sequence and are what the slash commands delegate to; their full steps live below.

A workflow you have not watched run is a workflow you do not trust. So both `add` and `refine` end in
the same verification core ([validate-and-dry-run](#sub-procedure-validate-and-dry-run)) — that shared
core is why a tuned workflow is re-checked exactly like a freshly authored one. `add` and `refine` also
share the [find-existing-workflow](#sub-procedure-find-existing-workflow) core so the workflow catalog
never diverges no matter which operation touches it. `add` additionally runs the
[mode-selection gate](#sub-procedure-mode-selection-gate) — the one decision unique to this skill.

## Workflow location convention

Authored workflows default to a project-local directory, grouped by purpose:

```
.spur/workflows/<name>.yaml          # project workflows (the convention)
```

A `--file <path>` argument overrides the default. Keep one workflow per file, named for what it does
(`approval.yaml`, `import-file.yaml`), not for its mode. The canonical example
(`basic.yaml`) lives here; copy real schema shapes from it rather than from a
half-remembered snippet.

## Sub-procedure: mode-selection gate

The decision unique to workflows — run this **before authoring anything new**. The two kinds use
different schemas and a different mental model; switching later is a rewrite. Inputs: the described
process (one or two sentences). Steps:

1. **Classify the process shape** against the discriminators (SKILL.md → "Choose the execution mode
   first"):

   | Signal in the description | → mode |
   | ------------------------- | ------ |
   | "loop until", "retry", "keep checking", one thing active at a time, can go back a step | **state-machine** |
   | "then", "pipeline", "for each", fan-out, gate/decision, action-per-step, mostly forward | **transition-flow** |
   | Genuinely ambiguous | **state-machine** (the simpler default) — and say so |

2. **Honor an explicit `--kind`** — if the caller passed `--kind`, use it; skip to step 4 and just
   record the rationale for the record.
3. **Recommend + confirm** — surface the recommended mode, the **reason** (which discriminator
   decided it), and the **rejected alternative** (what the other mode would have implied). Require
   confirmation before authoring. This is the human-in-the-loop gate; do not silently pick a mode the
   user did not see.
4. **Lock the mode** — for transition-flow, the YAML **must** set `kind: transition-flow` (a missing
   `kind` parses as state-machine and fails confusingly). For state-machine, `kind` is optional but
   include it for legibility.

Output contract: `{ mode, reason, rejectedAlternative }` + the confirmed mode to author in.

## Sub-procedure: find-existing-workflow

Reconciliation core — run this **before authoring anything**. Authoring without checking the existing
workflows breeds redundant, diverged definitions (two near-identical approval flows, an import flow
re-implemented under a new name). Inputs: the clarified process intent. Steps:

1. **Enumerate existing workflows** — list `.spur/workflows/*.yaml` (and any `--file`-adjacent
   directory); read each one's `name`, `kind`, and the states/nodes it defines so matches are found by
   *substance*, not just by filename.
2. **Classify the strongest match** against the new intent:

   | Match | Meaning | Action |
   | ----- | ------- | ------ |
   | Same process, same shape | A workflow already does this | **STOP — do not add.** It exists; if behavior is off, hand to [refine](#refine). |
   | Same process, extra steps needed | An existing flow is close but missing a state/node/branch | **EXTEND** via [refine](#refine) — add to the existing flow, don't fork it. |
   | Adjacent / overlapping concern | A related flow exists but the new intent is distinct | **ADD new** — the genuinely new branch. |
   | No real match | New process | **ADD new.** |

3. **Recommend + confirm** — report the strongest match, the classification, and the recommended
   action (extend-via-refine / add-new). Require confirmation before authoring. Never silently
   duplicate an existing workflow, and never silently edit one the user did not name.

Output contract: `{ match: workflow-name|none, classification, recommendation, evidence }` + the
confirmed action to take.

## Sub-procedure: validate-and-dry-run

The shared verification core. Inputs: a workflow file path + the expected terminal state. Steps:

1. **Validate** — `spur workflow validate <file> --json`. Runs the structural Zod schema **and**
   semantic invariants (referenced states/nodes exist, terminal reachable, `${...}` templates resolve).
   On error, surface root-cause + fix (see [validate](#validate--list-direct-cli)); stop until clean.
   The most common errors are an unquoted `$schema` (`@` is YAML-reserved) and a missing
   `kind: transition-flow` on a flow definition.
2. **Dry-run** — `spur workflow run <file> --dry-run --run-id dryrun-<unique> --json`. Use a throwaway, unique
   `--run-id` (a duplicate raises `RunCollisionError`). **`status` is authoritative for pass/fail**
   (`done` = success, `failed` = failure; CLI exit is non-zero unless `status === 'done'`). Then
   assert `finalState === <expected>` to confirm *which* terminal was reached. A `status: 'failed'`
   (including a declared failure terminal such as `failed`/`cancelled`) or a wrong success
   `finalState` means the workflow does not behave as intended — read the trace.
3. **Read the trace** — confirm the run entered the intended states/nodes and took the intended
   transitions/edges. A run that stalls short of the expected terminal points at a guard/condition that
   never passed, a mistyped target, or an exhausted `iterationBound`. Fix the **specific** definition
   flaw, never restructure to mask it.
4. **Report** — `{ valid, ranToExpectedTerminal, tracePath }`. The workflow is verified only when the
   definition validates AND the dry-run reaches the expected terminal state.

> A `shell` action runs real commands during the dry-run. Keep authored-workflow shell actions
> idempotent and side-effect-light, or stub them with a `note` action while verifying shape, then
> swap the real command in once the path is proven. Never point a dry-run at a destructive command.

## validate / list / trace / continue / cancel / clean (direct CLI)

Deterministic single-verb CLI calls. Run them straight; the skill interprets results when asked.

- `spur workflow validate <file> [--no-schema] --json` — structural schema + semantic check. Classify
  any error as **schema** (violates the state-machine/transition-flow JSON schema — often an unquoted
  `$schema`, or a flow missing `kind: transition-flow`) vs. **semantic** (a transition references a
  state that doesn't exist, a terminal state is unreachable, a `${vars.x}` with no matching var, an
  `${env.X}` not in `env.allow`). The `validate-and-dry-run` core calls this as step 1. `--no-schema`
  skips only the `$schema` ref resolution, keeping the structural + semantic checks.
- `spur workflow list --json` — available **workflow YAML definition files** on disk (not run history).
- `spur workflow trace [run-id] [--workflow <n>] [--status <s>] [--since <iso>] [--last <n>] --json` —
  persisted run history (list filters) or a single-run timeline when `run-id` is given. Use this to
  inspect prior outcomes; do **not** use `list` for that.
- `spur workflow continue [run-id] [--yes] --json` — resume a paused HITL run (omit id → most recent
  paused).
- `spur workflow cancel <run-id> --json` — mark one non-terminal run failed (SIGTERM async worker
  process group when live).
- `spur workflow clean [--older-than <min>] [--force] [--dry-run] --json` — bulk-finalize stale
  `running`/`pending` runs (default age threshold 30 minutes; `--force` ignores age).

## run (direct CLI — dry-run / execution / async)

`spur workflow run` is a direct CLI verb; there is no slash command for it. The skill drives it as the
dry-run step of the harness loop, and operators run it directly to execute a real workflow. Procedure:

1. `spur workflow run <file> [--run-id <id>] [--vars <json>] [--dry-run] [--async] [--no-plan] --json`.
2. Sync path: **`status` is authoritative for pass/fail** (`done` | `failed` | `paused` | …).
   Exit code is non-zero unless `status === 'done'`. Read `finalState` only to identify which
   terminal was reached (e.g. `failed` vs `cancelled` after a failure-terminal finalize). Do not
   treat `status: 'done'` + a failure-named `finalState` as success — declared `failureStates`
   finalize as `status: 'failed'` (0425).
3. `--dry-run`: walk transitions without executing actions (preferred for the authoring harness loop).
4. `--async`: spawn a detached worker, exit immediately with `runId`; monitor via
   `spur workflow trace <run-id>`. Cancel with `spur workflow cancel <run-id>`.
5. On `failed`, read the run trace (states/nodes entered, transitions taken) to locate the offending
   step — a failed action, a declared failure terminal, a guard with no passing transition, or an
   exhausted `iterationBound`.
6. A failed run is data, not an exception — the run record is preserved. Fix the definition (for the
   dry-run loop) or the environment/action (for a real run), then re-run with a fresh `--run-id`.

Output contract (sync): `status` (authoritative pass/fail) + `finalState` + parsed trace + the
offending-step diagnosis on failure. Async: `{ runId, status: 'started', workflowName }`.

## add

Turn a described process into a validated, dry-run-verified workflow in the right mode. Procedure:

1. **Clarify intent** — restate the process as one or two sentences: the steps, the success terminal,
   the loop/branch points. If ambiguous (which step retries? what ends it?), state the interpretation
   taken.
2. **Fit gate** — run the three-part test in
   [workflow-fit-and-tuning.md](workflow-fit-and-tuning.md#the-three-part-test) *before* the mode
   gate: the process earns a workflow only if it replays, branches on a machine-checkable predicate,
   and needs a durable per-run record. Fewer than three → recommend a descriptive procedure /
   checklist instead and stop; do not author YAML the process will not use.
3. **Mode-selection gate** — run [mode-selection gate](#sub-procedure-mode-selection-gate). This is
   mandatory and gating: surface the recommended mode with its reason and the rejected alternative,
   and **confirm before authoring**. Honor an explicit `--kind`.
4. **Reconcile against existing workflows** — run [find-existing-workflow](#sub-procedure-find-existing-workflow).
   If the process is already covered, **stop and hand to refine (or extend the existing flow) on
   confirmation** — do not author a redundant workflow. Only the "no real match" / "add-new" branch
   proceeds to author below.
5. **Author the YAML** — use the **real schema shape** for the chosen mode
   ([authoring-workflows.md → Per-mode shapes](authoring-workflows.md#per-mode-shapes)). Set `name`,
   `description` (the WHY), the initial + terminal states/nodes, the steps with their actions, the
   transitions/edges with guards/conditions in the right declaration order, `iterationBound` for any
   loop, `env.allow` for any `${env.X}`, and a quoted `$schema`. For transition-flow, set
   `kind: transition-flow`.
   Keep each node inside the simplicity budget
   ([workflow-fit-and-tuning.md](workflow-fit-and-tuning.md#3-node-simplicity-budget)): `shell`
   commands at or under 5 non-comment units, `agent.run` inputs referencing a slash command rather
   than carrying a raw prompt, guards a single predicate.
6. **Place the file** — default `.spur/workflows/<name>.yaml` (a `--file` arg overrides), named for
   what the workflow does.
7. **Verify** — run the [validate-and-dry-run core](#sub-procedure-validate-and-dry-run) with the
   expected terminal state. Not done until the definition validates AND the dry-run reaches it.

Output contract: YAML workflow content + chosen mode + reason + destination path + validate result +
dry-run result (status, finalState, expected). Done only when validate passes AND the dry-run reaches
the expected terminal state.

## refine

Adjust an existing workflow with the smallest change that meets the intent. Procedure:

1. **Locate the target** — if a workflow file is named, load it. If the user describes a *process*
   instead ("the approval flow never reaches done"), run
   [find-existing-workflow](#sub-procedure-find-existing-workflow) to resolve which file they mean
   before editing. Read its current shape and mode.
2. **Identify the dimension** from `--intent`:
   - stuck run (never reaches terminal) → a guard/condition that never passes, a wrong transition
     target, or an exhausted `iterationBound`
   - missing step → add a state/node + its transition/edge in the correct declaration order
   - runaway loop → set or raise `iterationBound`
   - missing variable/env → add to `vars` or `env.allow`
   - too slow / unreadable trace (not a correctness bug) → the
     [optimize procedure](workflow-fit-and-tuning.md#optimize--refine-an-accepted-workflow-in-place),
     backed by a before/after `spur workflow trace <run-id> --json` pair
   - the whole file is the wrong surface (all nodes raw `agent.run`, no branching, edited more than
     run) → not a refine: the
     [demote procedure](workflow-fit-and-tuning.md#demote--workflow--descriptive-procedure)
   See [authoring-workflows.md](authoring-workflows.md) for each mechanism's real shape. **Do not
   switch mode** in a refine — a mode change is a rewrite; hand it back to `add`.
3. **Apply the smallest change.** Preserve declaration order semantics (the first passing
   guard/condition wins). Add a one-line rationale comment for any non-obvious choice such as an
   `iterationBound`. No drive-by restructuring.
4. **Preview if `--dry-run`** — emit a unified diff of the YAML change and stop (no write). This is a
   skill-level output; the CLI has no dry-run for edits.
5. **Verify** — run the [validate-and-dry-run core](#sub-procedure-validate-and-dry-run). A refine that
   fixes a stuck run must prove it: the run that previously stalled now reaches the expected terminal.

Output contract: diff of the change + validate result + dry-run result (status, finalState, expected).
With `--dry-run`, the diff only.
