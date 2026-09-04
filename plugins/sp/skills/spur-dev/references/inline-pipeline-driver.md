---
name: inline-pipeline-driver
description: "Interactive host-session interpreter for Spur state-machine pipelines: execute the existing FSM without a workflow agent subprocess while preserving actions, guards, artifacts, and provenance."
owner: spur-dev-maintainers
retirement-criterion: "The per-task interpreter retires once the engine covers per-task execution for /sp:dev-runall with real terminal runs and the parity check (apps/cli/src/scripts/check-inline-pipeline-parity.ts) is green (D8 decision D7). Batch orchestration wrapper may remain."
see_also:
  - spur-dev
  - execution-workflow
  - execution-batch
---

# Inline Pipeline Driver

**Owner:** `spur-dev-maintainers` (per task 0755 R1). Reach the named owner via the frontmatter; no need to read the originating task.

**Retirement criterion (0755 R5, D8 decision D7):** the per-task interpreter retires once the engine covers per-task execution for `/sp:dev-runall` with real terminal runs **and** the parity check (this doc's documented action/guard set ≡ `.spur/workflows/task-pipeline.yaml`'s resolved action/guard set) is green. Recording the criterion is part of this task; acting on it is not — that is a separate A3-gate decision.

## Supported action and guard set (0755 R2 parity contract)

The action and guard kinds this driver implements. The parity check
(`apps/cli/src/scripts/check-inline-pipeline-parity.ts`) compares this set against
`.spur/workflows/task-pipeline.yaml`'s resolved actions and guards; any element present
in one and absent in the other fails the check. Add a new kind here when the driver
implements it; remove the entry when the corresponding kind is dropped from the YAML.

**Actions:** `shell` · `note` · `doctor.probe` · `file.read.into-var` · `hitl.confirm` · `agent.run` · `proof.fingerprint` · `run.artifact` · `command.gate`

**Guards (transitions):** `always` · `shell`

# Inline Pipeline Driver

This driver is the interactive control-inversion path granted by ADR-047. It applies when an
interactive `/sp:dev-run --mode full`, sequential `/sp:dev-runall`, `/sp:dev-idea`, or
`/sp:dev-plan` invocation omits `--agent` or passes `--agent inline`. A named executor,
`--agent auto`, parallel batch mode, `spur workflow run`, and `spur agent run` keep the existing
subprocess path.

The selected project runtime definition — `task-pipeline.yaml` or `idea-pipeline.yaml`, resolved through the two-tier
project→bundled model (task 0648/0650, never an unbundled runtime path) — remains the sole
FSM definition. The driver MUST read that file
at invocation time. It must not copy the state list, actions, guards, or transition order into a
command, skill, script, or second workflow.

## Run setup

1. Resolve the command inputs, `--auto`, and any explicit `--vars`; read the selected YAML and overlay
   its `vars` defaults with those invocation values. An explicit non-inline executor selection
   chooses the subprocess workflow path.
2. Allocate a collision-resistant inline run id (`uuidgen`, with a timestamp/pid fallback), create
   `.spur/run/`, and use `.spur/run/<run-id>.log` as the run log.
3. Resolve the host session id from `.spur/context/.session.json`, accepting the normalized hook key
   `session` and the Codex key `session_id` (in that order). If neither is available, allocate
   `host-session-<run-id>` and record that fallback in the log; provenance must never be blank or
   guessed from an executor subprocess.
4. Render the two-layer plan into the host todo list (task 0596):
   - **Layer 1** = `spur workflow show <pipeline-yaml> --format todo --json` → its `steps[]`: the
     declared state inventory in declaration order with `initial` / `terminal` / `failure` /
     `pause` / `loopBack` / `conditional` markers. Mark the active state. Never re-derive this
     list from the YAML.
   - **Layer 2** = the active state's `onEnter` actions (`kind` + resolved `input`/`command`), from
     the YAML parsed in step 1, shown only for the active state.
   - **Refresh cadence** = stage boundaries only (when the current state changes after a transition),
     never per action.
   - **Transition reconciliation (task 0727)** = at every stage boundary the host must
     **mark the finished stage completed and the next stage in_progress** in the host todo list.
     This reconciliation is **host-owned and execution-surface-independent**: it fires identically
     whether the stage ran via native subagent, host-inline execution, or the post-dispatch host
     fallback, so a run can never terminate with earlier stages stuck `in_progress` (task 0726
     ended 0/11 with precheck and implement still open).
   - **Source of truth** = the CLI projection for layer 1; the YAML parsed in step 1 for layer 2.
     Never hand-copy or hand-derive the state list into the driver, a command, a skill, or a script.
5. For task execution only, record lifecycle provenance before entering the FSM:

   ```bash
   spur task run-link <wbs> --source inline-full --run-id <run-id> --json
   ```

   This is required for the normal `testing → done` provenance guard. Planning pipelines have no
   task lifecycle link and skip this task-specific action.

## YAML interpreter

Start at `initialState`. For each current state, execute its `onEnter` actions in declaration order,
then evaluate outgoing transitions in declaration order and take the first passing guard. Stop only
at a declared terminal state or a surfaced HITL pause. The `iterationBound` remains mandatory.

Action semantics come from the YAML and the workflow action contract:

- `shell` — run the expanded command in the project working tree with resolved vars exported as
  environment variables. A non-zero result follows the action's existing failure policy.
- `note` — append the expanded message to the inline run log.
- `doctor.probe` — run the declared Spur doctor once, persist its status file, and apply any
  `setVars` result (including a resolved executor) before the next action or state.
- `file.read.into-var` — read the declared file into the declared run variable before subsequent
  actions/guards.
- `hitl.confirm` — under `profile=auto`, follow the YAML's auto-skip transition. Otherwise pause,
  surface the prompt, and resume from the same state with the operator's answer.
- `agent.run` — execute the action's input in the host session. Task execution may use the native
  subagent eligibility below; idea/plan never dispatch a native subagent unless the operator
  explicitly requested delegation. Do not call `spur agent run` or re-enter a full pipeline. Preserve the YAML options: capture
  `answerFile`; assert `expectFile`; enforce `requireDiff` against a pre-action git snapshot,
  including the task-scope guard; honor declared error policy. `timeoutMs` is recorded as not
  applicable because the host session has no independent kill boundary.

**Native-subagent dispatch (R2 eligibility, evaluated before each action):**

1. The invocation is one of the two interactive inline full-pipeline surfaces (`dev-run --mode full`
   or sequential `dev-runall`) and the resolved selector is inline — i.e. `--agent` **omitted**
   (0687 R1 default) or `--agent inline` passed explicitly (0687 R2 generalized from omit-only).
   Explicit inline and omitted resolve identically; a named executor, `auto`, parallel mode,
   `spur workflow run`, and `spur agent run` keep the subprocess path.
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

**Timeout boundary (task 0727):** a dispatched subagent is governed by
**the host platform's subagent limit, not the YAML timeoutMs** — `timeoutMs` stays not-applicable
for host execution only — and before dispatch the driver must
**record the governing timeout boundary and its source before dispatch** in the run log
(e.g. `host timeout <ms> (<platform subagent limit|yaml timeoutMs>)`). If the dispatch reaches that
boundary, **a dispatch timeout is a started-subagent failure**: the no-replay rule above and the
stage's declared YAML error policy govern (implement's default `fail` policy routes the run to
`failed`); it is never a host re-execution. Recovery follows the
[timed-out implement runbook](execution-workflow.md)'s inline-path equivalent:
**resume from the partial tree, never restart the stage inline** — no
`<runId>-implement-partial.md` artifact is written on this path, so the partial working tree
itself is the recovery input.

**Host-owned interaction:** the host alone executes operator-confirmation actions, owns
`pause: true`, and surfaces approve/taste/ask decisions. A subagent that discovers missing authority
or an operator decision returns a blocker; the host pauses at the current state and presents it. The
subagent cannot approve, infer consent, or recursively invoke the full pipeline.

After every successful inline `agent.run` action append exactly one provenance line (inline or
subagent form above) to `.spur/run/<run-id>.log`, where `<id>` is the current YAML state id. Also
log start/failure and the ignored timeout value so an inline run remains auditable without
fabricating an `AgentRunTracedResult`.

Run-log stamps (task 0727): every appended line is prefixed with an **ISO-8601 UTC** timestamp
(`YYYY-MM-DDTHH:MM:SSZ`, e.g. `2026-08-31T17:51:11Z`); the exact-template provenance lines above
keep their exact content after the stamp prefix. This normalization is contractual:
**bare local-clock stamps are prohibited** — a hand-appended `[stage 12:31]` form mixes timezones
in one file and makes the run unauditable (task 0726 mixed both forms).

Transition guards are not advisory. Execute the declared guard exactly, in order, with the same
resolved variables and artifacts. `--no-lifecycle` remains bookkeeping only; the YAML's task checks,
verdict gate, record step, and done guard all remain authoritative.

## Record & done sequencing (dogfood 2026-08-21, feature A3)

Order matters for the `testing → done` hop. The A3 batch hit the same clobbering spiral on two
tasks (0617, 0619) because the sections were hand-written **before** the verdict artifact existed:

1. **Write the verdict artifact first.** `spur task record --solution-from-diff --transition testing`
   reads `.spur/run/<wbs>-verdict.json` (default). With no artifact it emits a **UNKNOWN** verdict and
   **overwrites** a hand-authored `## Testing` with an auto-generated "No requirements recorded" table,
   plus replaces `## Solution` with a bare auto change-map. Creating the artifact first (PASS, with
   requirement rows keyed by scenario title) makes `task record` the compliant path.

   ```bash
   # verdict artifact first (shape: {wbs, verdict, requirements:[{id,status,evidence}], checks:[], source})
   # then the record hop; then re-write Testing/Solution if record's backfill is thinner than intended.
   spur task update <wbs> wip --no-lifecycle
   spur task record <wbs> --solution-from-diff --transition testing
   ```

   The engine now preserves an already-authored Testing when the verdict is UNKNOWN (task-service
   `record` fallback-only, mirroring the Review 0593 precedent) — but the order above is still the
   contract for the standard pipeline.
2. **Done-probe before done.** Run the check projected to `done` (`spur task check <wbs> --as done`
   via the `TaskCheckService` probe pattern) — it surfaces `L3.unchecked-checklist` (flip `- [ ]` → `- [x]`)
   and `L3.required-section-placeholder` before the transition, not after.
3. **Solution change-map anchor rule (L4.anchor-subject-mismatch).** A Solution change-map table must
   list **one `file:line` per row**. A ·-joined paragraph makes every anchor's "subject" the other
   anchors and trips the L4 subject check. Paths containing `_` (e.g. `docs/help/cmd_*.md`,
   `spur-cli-matrix.md`) can **never** match their cited line — the snake_case filename token is
   extracted as the subject and cannot appear in the line content — so drop those rows from the table
   (prose still covers them).

## Failure contract

Never silently fall back from this interactive inline path to `agent.default`. If the driver cannot
read the YAML, allocate provenance, execute an action, or evaluate a guard, stop at that state and
report the run id, state id, original error, and the concrete resume/retry command. The working tree
and run artifacts are the recovery input.
