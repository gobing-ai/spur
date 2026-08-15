---
name: inline-pipeline-driver
description: "Interactive host-session interpreter for task-pipeline.yaml: execute the existing FSM without a workflow agent subprocess while preserving actions, guards, artifacts, and provenance."
see_also:
  - spur-dev
  - execution-workflow
  - execution-batch
---

# Inline Pipeline Driver

This driver is the interactive control-inversion path granted by ADR-047. It applies only when an
interactive `/sp:dev-run --mode full` or sequential `/sp:dev-runall` invocation omits `--agent` or
passes `--agent inline`. A named executor, `--agent auto`, parallel batch mode, `spur workflow run`,
and `spur agent run` keep the existing subprocess path.

The project runtime definition at `.spur/workflows/task-pipeline.yaml` remains the sole FSM definition.
The driver MUST read that file
at invocation time. It must not copy the state list, actions, guards, or transition order into a
command, skill, script, or second workflow.

## Run setup

1. Resolve `<wbs>`, `--auto`, and any explicit `--vars`; read the YAML and overlay its `vars` defaults
   with those invocation values. An explicit `vars.agent` / `vars.implementAgent` is an executor
   selection and therefore chooses the subprocess workflow path.
2. Allocate a collision-resistant inline run id (`uuidgen`, with a timestamp/pid fallback), create
   `.spur/run/`, and use `.spur/run/<run-id>.log` as the run log.
3. Resolve the host session id from `.spur/context/.session.json`, accepting the normalized hook key
   `session` and the Codex key `session_id` (in that order). If neither is available, allocate
   `host-session-<run-id>` and record that fallback in the log; provenance must never be blank or
   guessed from an executor subprocess.
4. Record lifecycle provenance before entering the FSM:

   ```bash
   spur task run-link <wbs> --source inline-full --run-id <run-id> --json
   ```

   This is required for the normal `testing → done` provenance guard. It is not a guard bypass.

## YAML interpreter

Start at `initialState`. For each current state, execute its `onEnter` actions in declaration order,
then evaluate outgoing transitions in declaration order and take the first passing guard. Stop only
at a declared terminal state or a surfaced HITL pause. The `iterationBound` remains mandatory.

Action semantics come from the YAML and the workflow action contract:

- `shell` — run the expanded command in the project working tree with resolved vars exported as
  environment variables. A non-zero result follows the action's existing failure policy.
- `note` — append the expanded message to the inline run log.
- `file.read.into-var` — read the declared file into the declared run variable before subsequent
  actions/guards.
- `hitl.confirm` — under `profile=auto`, follow the YAML's auto-skip transition. Otherwise pause,
  surface the prompt, and resume from the same state with the operator's answer.
- `agent.run` — execute the action's slash command, native-subagent-first (task 0508). Do not call
  `spur agent run` and do not re-enter `/sp:dev-run --mode full`. Preserve the YAML options: capture
  `answerFile`; assert `expectFile`; enforce `requireDiff` against a pre-action git snapshot,
  including the task-scope guard; honor declared error policy. `timeoutMs` is recorded as not
  applicable because the host session has no independent kill boundary.

**Native-subagent dispatch (R2 eligibility, evaluated before each action):**

1. The invocation is one of the two interactive inline full-pipeline surfaces (`dev-run --mode full`
   or sequential `dev-runall`) with the `--agent` flag **omitted**. Explicit `--agent inline` is the
   zero-dispatch carve-out: every model stage executes in the invoking host session — the
   native-subagent leg below never applies to it.
2. The YAML action kind is `agent.run` and its input is a pure slash command. Shell, note, file,
   guard, and operator-interaction actions remain host-executed.
3. The current state/action has no operator-confirmation action, `pause: true`, approve/taste/ask
   decision, or other operator prompt.
4. The platform exposes a native subagent that shares the working tree and has read, write, shell,
   and Spur task/run-artifact access.

All four pass → dispatch. Any pre-dispatch failure → execute the stage **once** in the host session.
An `agent.run` whose `input` is free-form prose rather than a pure slash command fails condition 2
and is never dispatch-eligible: the driver executes it in the host session and logs it with the
existing host-fallback line `stage <id> executed inline in session <session-id>` — it does not
reformulate the prose into a command, spawn a subagent for it, or silently promote it to dispatch.
No token estimate, stage-size threshold, model heuristic, or configuration switch is added.

**Dispatch and join:** before dispatch, capture the same pre-action git snapshot used by
`requireDiff` enforcement, and resolve `answerFile`/`expectFile` against the worktree root — the
resolved absolute path, not the YAML's relative string, is what the dispatched agent is instructed
to write and what post-join validation reads. Resolving once at the dispatch boundary fixes every
surface at once; a relative path would resolve against whatever cwd the writer process happens to
have. Send only: the stage id, the YAML's exact pure slash command, and
`execution surface already resolved: native subagent; do not dispatch this stage again`. The WBS/path
already carried by the slash command is the handoff — do not paste task/session transcripts or embed
machine-specific session paths. Dispatch exactly one native subagent and wait for it; the inline FSM
must not advance actions or guards concurrently (one writer at a time). After join, validate
`answerFile`, `expectFile`, `requireDiff`, task scope, and the action's error policy from the shared
filesystem — a subagent success message is not evidence. On success append exactly:

```text
stage <id> executed via subagent <agent-id> (host session <session-id>)
```

Host fallback retains exactly `stage <id> executed inline in session <session-id>`. If launch fails
before the subagent starts, log the reason and use host fallback. If a started subagent fails or
leaves invalid artifacts, do **not** replay the stage in the host — follow the YAML error policy so
partial mutations are not duplicated.

**Host-owned interaction:** the host alone executes operator-confirmation actions, owns
`pause: true`, and surfaces approve/taste/ask decisions. A subagent that discovers missing authority
or an operator decision returns a blocker; the host pauses at the current state and presents it. The
subagent cannot approve, infer consent, or recursively invoke the full pipeline.

After every successful inline `agent.run` action append exactly one provenance line (inline or
subagent form above) to `.spur/run/<run-id>.log`, where `<id>` is the current YAML state id. Also
log start/failure and the ignored timeout value so an inline run remains auditable without
fabricating an `AgentRunTracedResult`.

Transition guards are not advisory. Execute the declared guard exactly, in order, with the same
resolved variables and artifacts. `--no-lifecycle` remains bookkeeping only; the YAML's task checks,
verdict gate, record step, and done guard all remain authoritative.

## Batch use

Sequential `/sp:dev-runall` with omit/`inline` runs this driver once per ready WBS, with a fresh run
id and the same frozen/topologically ordered batch plan. Batch inspection, halt/keep-going policy,
and reporting remain in `execution-batch.md`. Parallel mode cannot share one host session safely and
therefore keeps the existing isolated subprocess/worktree path (trigger 4).

## Failure contract

Never silently fall back from this interactive inline path to `agent.default`. If the driver cannot
read the YAML, allocate provenance, execute an action, or evaluate a guard, stop at that state and
report the run id, state id, original error, and the concrete resume/retry command. The working tree
and run artifacts are the recovery input.
