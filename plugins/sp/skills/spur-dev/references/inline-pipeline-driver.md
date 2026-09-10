---
name: inline-pipeline-driver
description: "Interactive host-session interpreter for Spur state-machine pipelines: execute the existing FSM without a workflow agent subprocess while preserving actions, guards, artifacts, and provenance."
owner: spur-dev-maintainers
retirement-criterion: "The per-task interpreter retires once the engine covers per-task execution for /sp:dev-runall with real terminal runs and the parity check (plugins/sp/scripts/inline-pipeline-parity-check.ts) is green (D8 decision D7). Batch orchestration wrapper may remain."
see_also:
  - spur-dev
  - execution-workflow
  - execution-batch
---

# Inline Pipeline Driver

**Owner:** `spur-dev-maintainers` (per task 0755 R1). Reach the named owner via the frontmatter; no need to read the originating task.

**Retirement criterion (0755 R5, D8 decision D7):** the per-task interpreter retires once the engine covers per-task execution for `/sp:dev-runall` with real terminal runs **and** the parity check (this doc's documented action/guard set ≡ the resolved action/guard set of every `.spur/workflows/*.yaml`) is green. Recording the criterion is part of this task; acting on it is not — that is a separate A3-gate decision.

## Supported action and guard set (0755 R2 parity contract)

The action and guard kinds this driver implements. The parity check
(`plugins/sp/scripts/inline-pipeline-parity-check.ts`) compares this set against
the resolved actions and guards of every `.spur/workflows/*.yaml`; any element present
in one and absent in the other fails the check. Add a new kind here when the driver
implements it; remove the entry when the corresponding kind is dropped from the YAML.

**Actions:** `shell` · `note` · `doctor.probe` · `file.read.into-var` · `hitl.confirm` · `agent.run` · `proof.fingerprint` · `run.artifact` · `command.gate`

**Guards (transitions):** `always` · `shell`

## What this driver is

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

**Shared startup contract (task 0814 R1/R3/R4/R6/R7).** The order is load-bearing: publish a compact
**bootstrap checklist** immediately (host-preparation rows, never copied workflow states); run quick
deterministic readiness (admission, not an implementation certificate) before any isolation; when
`--worktree` is valid, create/adopt and switch to the execution tree; then publish the **workflow
inventory** (the CLI todo projection) — and only then read the full YAML for comprehensive/model work.
Comprehensive checks stay at their owning boundaries and run after the plan is visible and after
isolation when requested (R7); quick readiness and plan projection dispatch zero models and execute
zero workflow actions (R8). Use the stable label helpers
(`columnLabel` / `buildStepLabels` / `labelChild` in `packages/app/src/workflow/step-reporter.ts`) for
the human/native presentation layer — labels are display addresses only, never an execution key.

1. Resolve the command inputs, `--auto`, and any explicit `--vars` — **without reading the selected
   YAML yet**. An explicit non-inline executor selection chooses the subprocess workflow path.
2. Allocate a collision-resistant inline run id (`uuidgen`, with a timestamp/pid fallback), create
   `.spur/run/`, and use `.spur/run/<run-id>.log` as the run log.
3. **Authoritative run identity (task 0804 R1, fail-closed).** Persist the run row through the
   internal delegate before any stage executes — this is what makes bound `run.artifact` record
   accept the inline run (0785 R3):

   ```bash
   SETUP_SCRIPT="plugins/sp/scripts/inline-run-setup.ts";
   [ -f "$SETUP_SCRIPT" ] || SETUP_SCRIPT="$(superskill script path sp inline-run-setup.ts 2>/dev/null)";
   [ -n "$SETUP_SCRIPT" ] && [ -f "$SETUP_SCRIPT" ] && \
     bun "$SETUP_SCRIPT" --run-id "$RUN_ID" --file <selected-pipeline-yaml> \
     || { echo "inline run setup failed closed — checker not found; run 'superskill install sp'" >&2; exit 1; }
   ```

   The delegate resolves the app service from the SPUR_BIN chain, creates-or-attaches the row,
   and writes `.spur/run/<run-id>-inline-setup.json`. Seed `__runId` and `__definitionDigest`
   from that file so proof capture and bound registration verify against the persisted identity.
   A non-zero exit (missing row identity, changed definition, bundle-only install) stops the run —
   never continue unbound and never fabricate a PASS. (The delegate persists the authoritative
   RUN row only — the 0808 inline record is the registration-equivalent convention below, not a
   setup-time artifact-ledger insert.)

   **Frozen invocation identity (task 0809 R4).** The definition parsed and hashed at setup is
   the definition for the ENTIRE run: keep one invocation-time parsed definition and never
   re-resolve or reseed `__definitionDigest` at record because a workflow YAML changed. Two
   digests serve different purposes: `proof.digest` is the freshly captured current-input
   fingerprint; `proof.definitionDigest` identifies the workflow actually interpreted (the setup
   identity). A source-only edit of a TRACKED workflow YAML before capture is part of current
   input proof — the Git fingerprint covers tracked working-tree files, and ignored/external
   workflow files are NOT part of it (their executed identity remains the setup digest).
   Post-capture changes to fingerprinted inputs invalidate that proof and take the normal
   certification loop — stale post-capture evidence is refused, never reconciled. If execution
   must switch to a different definition, or the executed identity cannot be established: stop
   before record, preserve the run log and evidence, and start a FRESH inline run with a fresh
   run id and fresh gate/review/verify certification. Never mutate old run/proof identities,
   manufacture a paused engine snapshot, or call `continuePaused` for a running inline row;
   task text, Git attribution and `--auto` are not consent to stamp `resumeDefinitionDigest` —
   explicit consent for actual paused engine runs stays owned by task 0784.
4. Resolve the host session id from `.spur/context/.session.json`, accepting the normalized hook key
   `session` and the Codex key `session_id` (in that order). If neither is available, allocate
   `host-session-<run-id>` and record that fallback in the log; provenance must never be blank or
   guessed from an executor subprocess.
5. **Publish the bootstrap checklist (R1).** Render host-preparation rows into the host todo list
   before any expensive check: `A, Quick readiness`, `B, Prepare Git`, `C, Publish workflow plan`,
   `D, Comprehensive checking`. These are host preparation, never copied workflow states; they are
   not silently reassigned to unrelated workflow states when the workflow view later appears.
6. **Quick deterministic readiness (R2), before isolation.** Evaluate `quickReadiness` from
   `plugins/sp/scripts/batch-preflight.ts` with the operation, status, filtered-set size, the
   matrix-selected required/present sections, and content-policy findings. Record the outcome
   (runnable / needs-refinement / blocked / skipped / invalid) in the run log. Admission decision
   only — no model, no full tests/lint, no live-data probe, no feature mutation, no corpus-wide
   relational check.
7. **Isolation (R3), only when `--worktree` is valid.** After quick readiness and the required Git
   safety checks succeed, create/adopt and `cd` into the execution tree; confirm absolute cwd,
   branch, base SHA, and ownership. An invalid/empty target, unsupported mode, ambiguous ownership,
   or stale target stops without creating a tree or discarding work. All subsequent tools, agents,
   corpus writes, and run artifacts use the confirmed execution tree.
8. **Publish the workflow inventory (R4), BEFORE reading the YAML.** Resolve the selected workflow
   through the same project/bundled resolver as execution and run
   `spur workflow show <resolved-file> --no-logo --format todo --json`. Validate the projection with
   `parseWorkflowInventory` and bind it to the run's persisted `__definitionDigest` with
   `assertInventoryIdentity` — a drift or projection failure stops the run before any
   comprehensive/model work, never executing with a misleading plan.
   - **Layer 1** = that projection's `steps[]`: the declared state inventory in declaration order
     with `initial` / `terminal` / `failure` / `pause` / `loopBack` / `conditional` markers. Mark
     the active state. Never re-derive this list from the YAML.
9. **Read the selected YAML and overlay its `vars` defaults** with the invocation values. Compare the
   resolved definition identity against the bound `__definitionDigest`; a mismatch is identity drift
   and fails closed (step 8 already caught projection-side drift; this re-checks the same definition
   the interpreter will execute).
   - **Layer 2** = the active state's `onEnter` actions (`kind` + resolved `input`/`command`), from
     the YAML read here, shown only for the active state.
   - **Refresh cadence** = stage boundaries only (when the current state changes after a transition),
     never per action.
   - **Transition reconciliation (task 0727)** = at every stage boundary the host must
     **mark the finished stage completed and the next stage in_progress** in the host todo list.
     This reconciliation is **host-owned and execution-surface-independent**: it fires identically
     whether the stage ran via native subagent, host-inline execution, or the post-dispatch host
     fallback, so a run can never terminate with earlier stages stuck `in_progress` (task 0726
     ended 0/11 with precheck and implement still open).
   - **Source of truth** = the CLI projection for layer 1; the YAML read here for layer 2.
     Never hand-copy or hand-derive the state list into the driver, a command, a skill, or a script.
   - **Stable labels (task 0814 R5).** Top-level declaration indexes map to A, B, … Z, AA, AB …;
     visible children restart numbering under their parent (A1, A2, B1 …). Labels never replace the
     canonical step id, and are re-derived identically on retry/resume against the same definition.
   - **Truthful progress (task 0814 R6).** Publish pending/active state before the visible item
     starts, then update it immediately after the observed item completes and before the next item
     starts. Keep completed, skipped, failed, blocked, paused, and unattempted outcomes distinct;
     never mark skipped/conditional work completed merely to clear the UI. If the host has no
     suitable native todo tool, or it fails, use an explicit Markdown fallback with the same labels
     and truth — never a fabricated successful tool invocation.
10. For task execution only, record lifecycle provenance before entering the FSM:

   ```bash
   spur task run-link <wbs> --source inline-full --run-id <run-id> --json
   ```

   This is required for the normal `testing → done` provenance guard. Planning pipelines have no
   task lifecycle link and skip this task-specific action.

## Comprehensive-check retention and evidence (R7/R8)

**R7 — comprehensive checks stay at their owning boundaries.** Quick readiness and plan projection are
admission and visibility, not a substitute for the owning gates. After the plan is visible and after
isolation when requested, retain the full task/feature integrity, size, evidence-channel,
provenance, capability, dependency, quality, review, and verification gates exactly where their
owners declare them. Prefer deterministic checks; invoke semantic model work only for an identified
unresolved requirement/design/evidence question and record its reason in the run log. Reuse a
cached observation only while its relevant inputs (task content, effective status, matrix, dependency
snapshot, cwd) remain unchanged; refresh after branch/tree changes, task writes, dependency
completion, or resume. Never run a shadow copy of a workflow precheck state in the host — if a
workflow defines a precheck state, its result updates that state, not a host-side duplicate.

**R8 — matched before/after evidence, no invented claims.** Record a timestamped event trace under
`.spur/run/<run-id>-event-trace.md` (render via `renderEventTrace` in
`packages/app/src/workflow/workflow-inventory.ts`) naming event ordering, time-to-first-visible
checklist, time-to-workflow-inventory, confirmed execution cwd, and CLI/process/model invocation
counts. Quick readiness and plan projection must dispatch zero models and execute zero workflow
actions — record that as observed. Record unavailable measurements as `unknown`; never present a
simulated run as a real verified outcome. Event order and provenance are evidence; wall-clock/token
savings are observations, never fabricated pass conditions.

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
- `run.artifact` — the engine's ledger registration has **no inline execution surface** (0808 R4).
  The inline equivalent is a documented **registration-equivalent convention**: before the record
  state mutates the task, the host validates the same refusal conditions inline — the declared
  artifact exists at the resolved path and is canonical-valid for the run's wbs (for
  `verify-verdict`: verdict `PASS`), `proofBinding: current` is honored against a freshly captured
  proof digest, and the run-scoped review-completion marker exists — then appends one provenance
  line to `.spur/run/<run-id>.log` naming the equivalence (artifact kind, path, verdict, digest) and
  proceeds to `spur task record`. A failed validation stops at the state and follows the failure
  contract; the step is never silently skipped. Artifact-provenance consumers read that run-log
  line on the inline path — there is no ledger row. The validation also includes **run/definition
  identity agreement from authoritative evidence** (task 0809 R4): the verdict's `proof.runId` and
  `proof.definitionDigest` must agree with the setup artifact `.spur/run/<run-id>-inline-setup.json`
  and the persisted run row; if that identity is absent or conflicts, STOP — recreating a row is
  not a diagnostic operation. The app-service bound-artifact fixture (which writes a real engine
  ledger row) is service-level test evidence for this identity mechanics, not evidence that the
  inline host writes a ledger.

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
have.

**Dispatch payload (task 0818 R2).** Send exactly these five fields. The earlier "send only the
stage id, the slash command, and the no-recursion notice" restriction is **deliberately replaced**:
the execution-tree cwd, the Spur invocation, and the output path are all already resolved at this
boundary, and a delegate left to re-derive them re-derives them against its own cwd and PATH.

1. The stage id.
2. The YAML's **exact** pure slash command — unchanged, never reformulated.
3. `execution surface already resolved: native subagent; do not dispatch this stage again`.
4. The **confirmed execution-tree cwd** (absolute) and the **resolved absolute Spur invocation** —
   `vars.spurBin`, i.e. `resolveSpurBin()`'s `<runtime> <mainModule>` form
   (`apps/cli/src/workflow/resolve-spur-bin.ts`). The delegate MUST run every Spur command through
   that invocation and MUST NOT rely on a bare `spur`: a competing `spur` earlier on the delegate's
   PATH otherwise wins. Setting `SPUR_BIN` alone does **not** change bare-command resolution — only
   using the supplied invocation does. Spur-owned scripted calls take it through the existing
   `--spur-bin` flag rather than a new mechanism.
5. The **resolved absolute output path** (`answerFile`/`expectFile`, resolved as above) and the
   **owning stage's artifact contract** — for a verify stage, the compact contract below.

Nothing else: no task/session transcripts, no machine-specific session paths. The WBS/path already
carried by the slash command remains the task handoff.

**Verify-stage artifact contract.** A verify handoff names
[`code-verification/references/verdict-schema.md`](../../code-verification/references/verdict-schema.md)
as the canonical answer schema and carries this compact form verbatim:

```text
Verdict: PASS|PARTIAL|FAIL                    top-level, one line
| Req | Status | Evidence |                   Status = MET | PARTIAL | UNMET
                                              (N/A and PASS are NOT valid requirement statuses)
| AC | Status | Evidence Type | Evidence |    Status = MET | PARTIAL | UNMET | N/A (justified)
Evidence Type = test | command | static-ref | manual-review | llm-judge | n/a
AC rows use the task's exact AC identities (verbatim `Scenario:` titles / checklist text).
A behavioral AC marked MET requires executable evidence (test | command);
static-ref or llm-judge alone cannot carry it.
```

**Review-stage artifact contract.** A review handoff carries the Review output contract owned by
`plugins/sp/agents/super-reviewer.md` — native `P1 (blocker)` / `P2 (major)` / `P3 (minor)` /
`P4 (advisory)` priority cells and section-relative headings — **not** the verify answer schema.

This is an invocation and handoff fix, not a runtime PATH-injection subsystem: it makes no guarantee
about arbitrary bare commands in host shells or agent-generated shells.

Dispatch exactly one native subagent and wait for it; the inline FSM
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
   anchors and trips the L4 subject check. Since 0804 R9, subject extraction ignores complete parsed
   citation spans, so a path's underscores no longer manufacture a subject: an underscore path row
   (`docs/help/cmd_example.md:12`) is checked exactly like any other row — cite an **existing file**
   with a **valid line or line range** whose content names the requirement's subject. A real absent
   symbol, nonexistent file or invalid range still reports; never replace a citable row with prose.

## Failure contract

Never silently fall back from this interactive inline path to `agent.default`. If the driver cannot
read the YAML, allocate provenance, execute an action, or evaluate a guard, stop at that state and
report the run id, state id, original error, and the concrete resume/retry command. The working tree
and run artifacts are the recovery input.
