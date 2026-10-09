---
name: inline-pipeline-driver
description: "Interactive host-session interpreter for Spur state-machine pipelines: execute the existing FSM without a workflow agent subprocess while preserving actions, guards, artifacts, and provenance."
owner: spur-dev-maintainers
retirement-criterion: "The per-task interpreter retires once the engine covers per-task execution for /sp:dev-runall with real terminal runs and the parity check (scripts/commands/inline-pipeline-parity-check.ts) is green (D8 decision D7). Batch orchestration wrapper may remain."
see_also:
  - spur-dev
  - execution-workflow
  - execution-batch
---

# Inline Pipeline Driver

**Installed-copy drift (1046):** Superskill converts `/sp:dev-*` command spellings to
`/sp-dev-*` for Codex. After `superskill install sp`, this adapter-only difference remains;
the interpreter and trace instructions must match. Never hand-edit the installed reference.

**Owner:** `spur-dev-maintainers` (per task 0755 R1). Reach the named owner via the frontmatter; no need to read the originating task.

**Retirement criterion (0755 R5, D8 decision D7):** the per-task interpreter retires once the engine covers per-task execution for `/sp:dev-runall` with real terminal runs **and** the parity check (this doc's documented action/guard set ≡ the resolved action/guard set of every `.spur/workflows/*.yaml`) is green. Recording the criterion is part of this task; acting on it is not — that is a separate A3-gate decision.

## Driver state checklist (re-read this after a compaction)

- **Run id** — the run row `inline-run-setup` persisted (`.spur/run/<run-id>-inline-setup.json`
  sidecar, `.spur/memory/runs/<run-id>.md` + `.state.json`); never re-derive it from the transcript.
- **Markers under `.spur/run/`** — `<run-id>-inline-setup.json` (frozen invocation identity),
  `<run-id>-tree-start.json` (commit-guard fingerprint), `<wbs>-verdict.json` (per-stage verdict),
  `<wbs>-question.md` / `<wbs>-escalation.md` (operator pause), `<run-id>-event-trace.md`.
- **Re-read per state** — this file (Run setup → YAML interpreter → Record & done),
  [structured-trace-emission.md](structured-trace-emission.md) at the first trace event.
- **Authoritative state** — the run record and verdict artifacts, never the host todo list.

## Supported action and guard set (0755 R2 parity contract)

The action and guard kinds this driver implements. The parity check
(`scripts/commands/inline-pipeline-parity-check.ts`) compares this set against
the resolved actions and guards of every `.spur/workflows/*.yaml`; any element present
in one and absent in the other fails the check. Add a new kind here when the driver
implements it; remove the entry when the corresponding kind is dropped from the YAML.

**Actions:** `shell` · `note` · `doctor.probe` · `file.read.into-var` · `hitl.confirm` · `hitl.input` · `agent.run` · `proof.fingerprint` · `run.artifact` · `command.gate` · `decide`

**Guards (transitions):** `always` · `shell` · `action-ok` · `contract-violation`

- `action-ok` — pass iff the prior action on this state/node succeeded (engine builtin).
- `contract-violation` — pass iff the prior `agent.run` result is a named contract violation
  (`data.outcome === 'contract-violation'`, ADR-118); the report carries `contract` and `observed`.

## What this driver is

This driver is the interactive control-inversion path granted by ADR-047. It applies when an
interactive `/sp:dev-run --mode full`, sequential `/sp:dev-runall`, `/sp:dev-idea`, or
`/sp:dev-plan` invocation omits `--agent` or passes `--agent inline`. A named executor,
`--agent auto`, parallel batch mode, `spur workflow run`, and `spur agent run` keep the existing
subprocess path.

The selected project runtime definition — `task-pipeline.yaml` or `idea-pipeline.yaml`, resolved through the
project→registered→shared model (ADR-113) — remains the sole
FSM definition. The driver MUST read that file
at invocation time. It must not copy the state list, actions, guards, or transition order into a
command, skill, script, or second workflow.

**Inline HITL defer semantics (0911):** bundled pipeline human gates ship `decision: {mode:
never}`, so the inline driver always prompts the operator for those gates regardless of
`workflows.hitlDecisionMaker` — the decision policy never answers inline pipeline gates. A local
workflow override (`.spur/workflows/*.yaml`) may declare `mode: evidence`, but the driver does
not claim full inline parity for the DecisionMaker path: evidence-mode auto-answering inside the
inline driver is an explicit non-goal (subprocess runs own that behavior). No hot reload: config
and YAML changes require restarting the invoking process.

## Run setup

**Shared startup contract (task 0814 R1/R3/R4/R6/R7; publish-first 1105 R1).** The order is
load-bearing: publish the **generated plan** first — resolve the selected workflow through the same
project/bundled resolver as execution, run `spur workflow show <resolved-file> --no-logo --format
todo --json`, and publish the `.plan` rows verbatim (the projection reads the definition and executes
nothing, so it is safe before readiness and isolation); run quick deterministic readiness (admission,
not an implementation certificate) next; when `--worktree` is valid, create/adopt and switch to the
execution tree; then bind the published plan to the run's persisted `__definitionDigest` — and only
then read the full YAML for comprehensive/model work. Comprehensive checks stay at their owning
boundaries and run after the plan is visible and after isolation when requested (R7); quick readiness
and plan projection dispatch zero models and execute zero workflow actions (R8). Labels come from the
projection (or `columnLabel` in `packages/app/src/workflow/step-reporter.ts` for the `steps[]`
fallback) — labels are display addresses only, never an execution key.

1. Resolve the command inputs, `--auto`, and any explicit `--vars` — **without reading the selected
   YAML yet**. An explicit non-inline executor selection chooses the subprocess workflow path.
2. Allocate a collision-resistant inline run id (`uuidgen`, with a timestamp/pid fallback), create
   `.spur/run/` for attempt staging and `.spur/memory/runs/` for retained records, and use the two-file run record (task 0927) — append lines to
   `.spur/memory/runs/<run-id>.md` and read machine state from `.spur/memory/runs/<run-id>.state.json`.
   The run id lives in those two files and the persisted run row — never stage it in an ad-hoc
   `*.env` file: the `no-env-files` gate rule flags any `.env` name, so run-scoped staging files
   use `<run-id>-*` names with `.md`/`.json`/`.txt`/`.status` extensions only.
3. **Authoritative run identity (task 0804 R1, fail-closed).** Persist the run row through the
   internal delegate before any stage executes — this is what makes bound `run.artifact` record
   accept the inline run (0785 R3):

   ```bash
   SETUP_SCRIPT=plugins/sp/scripts/inline-run-setup.ts; [ -f config/plugin-scripts.json -a -f "$SETUP_SCRIPT" ] || SETUP_SCRIPT="$(superskill script path sp inline-run-setup.mjs 2>/dev/null)";
   # 0960 R2: record the run's script-resolution identity beside the run row (the same file the
   # pipelines' run-start action writes) so the inline path carries the same provenance.
   RS=plugins/sp/scripts/script-root.ts; [ -f config/plugin-scripts.json -a -f "$RS" ] || RS="$(superskill script path sp script-root.mjs 2>/dev/null)";
   RUNNER=bun; case "$RS" in *.mjs) RUNNER=node ;; esac; [ -f "$RS" ] && "$RUNNER" "$RS" --run-id "$RUN_ID" || echo "script-root failed closed — run 'superskill install sp --marketplace gobing-ai/spur'" >&2
   [ -n "$SETUP_SCRIPT" ] && [ -f "$SETUP_SCRIPT" ] && \
     bun "$SETUP_SCRIPT" --run-id "$RUN_ID" --file <selected-pipeline-yaml> \
     || { echo "inline run setup failed closed — checker not found; run 'superskill install sp --marketplace gobing-ai/spur'" >&2; exit 1; }
   ```

   **Commit fingerprint (1129 R1).** Fingerprint the tree the task commit will land in — before the
   first task write — because Record & done stages through this snapshot, so a concurrent writer's
   file cannot ride into the task commit. The artifact is cwd-relative under `.spur/run/` (gitignored
   per tree), so the snapshot and the commit it guards must name the SAME tree: without `--worktree`
   take it here in the setup window; with `--worktree` take it immediately **after step 7's
   isolation, from the worktree root** (still before the first task write) — a snapshot taken here
   would land in the invoking tree, and the worktree's commit would find none (1129 review N1).

   ```bash
   RUN_ID="<marker-id>"   # the WT-3 marker's id (execution-batch.md), or the run id allocated at setup
   GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)";
   bun "$GUARD" start --run "$RUN_ID"     # <this tree>/.spur/run/$RUN_ID-tree-start.json = { head, dirty[] }
   ```

   The delegate uses the source app service when the SPUR_BIN chain identifies a checkout;
   otherwise it loads the generated application bundle shipped with the plugin. Both setup paths
   obtains the selected definition from the existing CLI `workflow show --format todo --json`
   projection and revalidates its schema/name/digest before preserving its source layer.
   Both paths create-or-attach the row,
   and writes the run-record state `.spur/memory/runs/<run-id>.state.json` plus the `.md` run-start
   header (task 0927; a legacy pre-0927 run keeps its `<run-id>-inline-setup.json` sidecar).
   Seed `__runId` and `__definitionDigest`
   from that state so proof capture and bound registration verify against the persisted identity.
   Bun remains required for SQLite; the Node-runnable installed twin re-enters Bun on PATH.
   A non-zero exit (missing runtime/bundle, invalid projection, missing row identity, changed definition) stops the run —
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
5. **Publish the generated plan (R1, 1105) — the run's first action.** Run `spur workflow show
   <resolved-file> --no-logo --format todo --json` and publish the projection into the host todo list
   before any expensive check:
   - **Annotated workflow (the normal case):** publish every `.plan` row's `text` **verbatim** —
     `A Prepare`, `A1 Quick readiness`, `A2 Prepare Git`, `A3 Publish plan`, `B Implement`, … — in
     plan order. Never hand-write rows, never copy the YAML state table into prose, and never
     renumber: the labels carry identity.
   - **Unannotated workflow (`.plan` is `null`):** publish the flat `steps[]` inventory in
     declaration order with `columnLabel` labels and their `initial` / `terminal` / `failure` /
     `pause` / `loopBack` / `conditional` markers. Never re-derive this list from the YAML.
   - **No workflow plan at all** (skill-only refine/verify batches): keep the existing host
     preparation rows; do not fabricate a workflow YAML.

   Publishing executes nothing, so it safely precedes readiness and isolation, which keep their
   existing order below.
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
   corpus writes, and run artifacts use the confirmed execution tree — **re-selected per call, not
   inherited**: a host shell call starts in an arbitrary directory and carries no cwd from the
   previous call, so every later call runs inside the **Per-call execution-tree pin** protocol
   below (task 1058), which consumes the identity confirmed here.
8. **Bind the published plan to the run digest (R4) — plan row A3.** Validate the step-5 projection
   with `parseWorkflowInventory` and bind it to the run's persisted `__definitionDigest` with
   `assertInventoryIdentity` — a drift or projection failure stops the run before any
   comprehensive/model work, never executing with a misleading plan. The A rows published at step 5
   track this setup order: A1 = quick readiness (step 6), A2 = Git/isolation (step 7), A3 = this
   binding; mark each row completed as its step settles.
9. **Read the selected YAML and overlay its `vars` defaults** with the invocation values. Compare the
   resolved definition identity against the bound `__definitionDigest`; a mismatch is identity drift
   and fails closed (step 8 already caught projection-side drift; this re-checks the same definition
   the interpreter will execute).
   - **Runtime-written vars are re-read, never cached.** A var a later state writes (`proofDigest`,
     `proofDigestNow`, `taskSpecPath`, `featureSpecPath`, `taskPriority`, `mode`, `gateFindings`) is a
     run artifact, not a YAML default: re-resolve it from `.spur/run/`/`.spur/memory/runs/` at every
     state boundary, and never let a host-side copy of the invocation vars shadow it — a stale empty
     `proofDigest` silently fails the bound `run.artifact` equivalence and the `record` proof guard.
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
   - **Stable labels (task 0814 R5; A–Z / 1–9 rule, 1105 R1).** Labels come from the published
     `.plan`: single letters A–Z for top-level rows, digits 1–9 for children under one letter. The
     projection enforces that cap instead of rolling to two-letter labels (`planLetter` throws past
     Z — split into waves or stop; never render `AA`-style addresses). An `on-entry` state is
     inserted as the next digit the moment the host enters it (`insertOnEntry` in
     `packages/app/src/workflow/plan-projection.ts`), appended after its letter's existing children;
     re-entering an already-published loop state keeps its label and appends the re-entry note
     ` — attempt N`. Labels never replace the canonical step id, and are re-derived identically on
     retry/resume against the same definition.
   - **Truthful progress (task 0814 R6; frozen status mapping, 1105 R1).** Publish pending/active
     state before the visible item starts, then update it immediately after the observed item
     completes and before the next item starts. Frozen status mapping: `pending → pending`,
     `active → in_progress`, `completed → completed`,
     `skipped|failed|unattempted|blocked → pending` + ` [<outcome>]` — the four engine-decided
     outcomes stay visible on a pending row, never cleared. Keep completed, skipped, failed, blocked,
     paused, and unattempted outcomes distinct; never mark skipped/conditional work completed merely
     to clear the UI. Re-entry appends ` — attempt N`. If the host has no suitable native todo tool,
     or it fails, use the `renderProgressMarkdown` fallback with the same labels and truth — never a
     fabricated successful tool invocation.
10. For task execution only, record lifecycle provenance before entering the FSM:

   ```bash
   spur task run-link <wbs> --source inline-full --run-id <run-id> --json
   ```

   This is required for the normal `testing → done` provenance guard. Planning pipelines have no
   task lifecycle link and skip this task-specific action.

   **Run it from the task's execution tree.** Every tree has an isolated `.spur` DB, so a link
   recorded from the invoking tree never satisfies a worktree's guard — the exact failure that
   forced audited `--provenance-bypass` on tasks 1029/1030 (E93). Under `--worktree`, enter the
   worktree first and run this command (and every lifecycle-touching command: `task record`,
   `task update <wbs> testing|done`) from the worktree root.

### Host todo update styles (1105 R2)

The same published plan is updated differently per host family. Both styles keep plan order and are
bookkeeping for the one projection — never a second source of truth:

| Host | Tool(s) | Update style |
| --- | --- | --- |
| Claude Code | `TaskCreate` / `TaskUpdate` | per-item — create each item once, then update by id; append inserted (`on-entry`) steps at the end (the label carries identity, so list position is display only) |
| pi | `todo` | per-item — same create-once/update-by-id discipline |
| Codex | `update_plan` | full-list — rewrite the whole list in plan order on every update |
| Gemini | `write_todos` | full-list — rewrite the whole list in plan order |
| OpenCode | `todowrite` | full-list — rewrite the whole list in plan order |
| Grok | `todo_write` | full-list — rewrite the whole list in plan order |
| omp | host todo tool | maps plan letters to `phase` |
| any host without a native tool | `renderProgressMarkdown` | Markdown fallback with the same labels and truth |

Per-item hosts update the one row whose outcome changed; full-list hosts re-render every row from the
current plan state. Both render the frozen status mapping above identically.

### Idea-pipeline quick start (0887 R1/R2)

Minimum files to read for `/sp:dev-idea` inline runs — then drive `idea-pipeline.yaml`:

- `.spur/workflows/idea-pipeline.yaml` (the machine) and this driver.
- `plugins/sp/skills/spur-dev/references/idea-evaluation.md` (report template incl. the mandatory
  `## Requirement inventory`) and `references/ac-style-guide.md` (scenario `# covers:` form).
- `references/dev-operations.md` § idea for the stage-by-stage surface.

**Persist the verbatim idea FIRST.** Before executing the `start` state, write the operator's
idea argument (or `--from-file` contents) **unmodified** to
`.spur/run/<run-id>-idea-input.md`; the run precheck fails when that file is empty or missing,
and every model-bearing stage prompt treats it as the authoritative ask. `--from-file` and the
positional idea are mutually exclusive — exactly one must be present.

Expected artifacts per stage (all run-scoped under `.spur/run/<run-id>-*`):

| Stage | Artifacts |
| ----- | --------- |
| start | `-idea-input.md` (verbatim idea), `-idea-precheck-doctor.status` |
| discovery | `-idea-eval-report.md` (with `## Requirement inventory`), `-idea-needs-design.json` |
| feature-create | `-idea-feature-id.txt`, `-idea-goal.md`, `-idea-scope.md` |
| ac-generate | `-idea-ac-content.md`, `-idea-ac-check.status` |
| system-design | `-idea-design-review.md`, `-idea-design-check.status` |
| decompose | `-idea-task-batch.json`, `-idea-task-order.json` |
| batch-create-run | `-idea-batch-create-result.json`, `-idea-batch-create.done`/`.failed` |
| ready-prepare | `-idea-ready.json` |
| handoff-finalize | `-idea-handoff.md` |

## Per-call execution-tree pin (task 1058)

A host shell tool call may start in an arbitrary directory; no earlier call's `cd` is input to the
next call. During inline run `95522d21` that drift silently landed corpus writes in the invoking
tree instead of the run worktree. Every host-session corpus command — reads, writes, absolute
section-input files and output artifacts — therefore selects the confirmed execution tree **within
the same tool call**, in a self-contained subshell. The identity is never re-derived: it is the
tree path, branch and resolved Spur invocation confirmed at bootstrap isolation (step 7) and, for
batch worktrees, recorded in the WT-3 marker (execution-batch.md). The resolved invocation is
field 4 of the dispatch payload — never a bare `spur`.

Template — every host shell call follows this shape; paths are quoted because trees may contain
spaces:

```bash
(
  cd -- "$SPUR_TREE" || { echo "tree missing: expected $SPUR_TREE" >&2; exit 1; }
  ACTUAL_TREE="$(pwd -P)"
  [ "$ACTUAL_TREE" = "$SPUR_TREE" ] || { echo "tree mismatch: expected $SPUR_TREE, got $ACTUAL_TREE" >&2; exit 1; }
  GIT_TOP="$(git rev-parse --show-toplevel)" || exit 1
  [ "$GIT_TOP" = "$SPUR_TREE" ] || { echo "toplevel mismatch: expected $SPUR_TREE, got $GIT_TOP" >&2; exit 1; }
  ACTUAL_BRANCH="$(git branch --show-current)"
  [ "$ACTUAL_BRANCH" = "$SPUR_BRANCH" ] || { echo "branch mismatch: expected $SPUR_BRANCH, got $ACTUAL_BRANCH" >&2; exit 1; }
  exec <resolved-spur-invocation> task show <wbs> --json   # the already-resolved CLI command
)
```

Rules (R1):

- **Pin reads as well as writes.** `task show`, `feature show`, `workflow show` and `task check`
  use the same subshell — a read from the wrong tree is a wrong answer, not a harmless one.
- **Validate the returned `filePath`.** A pinned `task show --json` must return a `filePath`
  inside the expected configured corpus/tree. Configured task folders may intentionally live
  outside the default `docs/tasks` — check membership in the configured folder set, not one
  literal path.
- **Prove sections with a fresh pinned read.** After a section write, re-run a pinned
  `task show <wbs> --json` and assert the new body there; a heading-only grep is not proof of
  section contents.
- **Resolve section input/output paths before changing tree.** `--section <name> --from-file
  <path>`, `answerFile`/`expectFile` and run artifacts are resolved against the confirmed tree
  (dispatch field 5) before the subshell `cd`s.
- **Fail closed before writing.** A failed `cd` or any identity mismatch exits nonzero naming
  expected vs actual, before the CLI runs — there is no designated exit code; consumers read
  nonzero and the named expected/actual trees. A PWD assertion alone cannot select a tree: `cd`
  first, then verify the physical path and repository identity.
- **Native tool cwd options are additive.** A tool-level cwd/`cd` pin may additionally set the
  call's directory, but never replaces the identity checks above.
- **Dispatch cwd is mandatory when the tool accepts one.** A subagent dispatch whose tool exposes a
  `cwd` (pi `subagent`) passes the execution-tree cwd. Omitted, the child starts in the host tree:
  it can edit main, and the timeout watchdog diffs the wrong tree (H15 2026-10-07: "changed
  tracked files: none" on a worker that changed 5 worktree files).
- **Host-only scope.** Engine `shell` actions already bind `context.workdir`
  (`packages/app/src/workflow/actions/shell.ts:98`) — leave them alone. No service-wide
  `process.chdir`, no new public flag, no helper framework.

The `spur …` command examples in this driver (run setup, workflow inventory, `task run-link`,
fingerprint capture, record/done sequencing) abbreviate the pinned subshell form for readability;
each executes inside the template above with the confirmed tree, branch and resolved invocation
substituted. A dispatched subagent inherits the same duty: its own tool calls may each start in
an arbitrary directory, so every shell call the delegate makes re-pins the execution tree with
the identity supplied in the dispatch payload — never re-derived.

## Chunked implement dispatch contract (cap-limited worker models, task 1066)

Cap-limited worker executors die on monolithic implement briefs: the output cap is consumed by
one giant thinking block before any file action lands. Recognized failure signature —
consecutive implement dispatches end with `stopReason=length` and **zero output** (no tool
call, no file write), optionally with a `contact_supervisor` call mid-death. The trigger is
the observed signature, never a model name: any executor that exhibits it is treated as
cap-limited for the rest of the run.

Before dispatching an `implement` stage to a worker executor:

1. **Chunk the brief.** Split the implement scope into small, independent dispatches ordered
   by dependency (e.g. test cases → doc rewrite → task sections), one bounded objective per
   dispatch. Never pack the whole task plan into one dispatch.
2. **Cap thinking.** Instruct the worker to keep every thinking block under ~150 words and act
   between thoughts; never plan the whole task in one block.
3. **Fallback ladder.** A worker still dying with the signature: re-chunk the remaining scope
   smaller once; still failing → execute the stage host-inline (the driver's inline stage
   fallback) and record the fallback in the run log.

Evidence (2026-10-02, task 1059 implement stage, runall-D63-2ebbd97c): 4/4 single-shot
implement dispatches died `stopReason=length` on a 16k-output-cap worker; the same scope in
three chunked dispatches with the thinking cap succeeded 3/3. See the pitfalls 2026-10-02
entry and `.spur/memory/runs/runall-D63-2ebbd97c.md`.

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

After each executed action settles, record its boundary before the next action, transition guard,
or terminal close. Measure its actual duration and preserve its declared failure policy:

```bash
bun "$SETUP_SCRIPT" --action --run-id "$RUN_ID" --node <state-id> --kind <action-kind> \
  --status <done|failed> --ok <true|false> --duration-ms <measured-ms> [--estimated]
```

`--duration-ms` is the wall clock measured around the action. Pass `--estimated` when you did
**not** time it — for example a duration reconstructed after a subagent returned — so the row is
labelled instead of presented as measured. `--estimated` is valid only with `--action`.

For a multi-action state, `--actions-file` may emit the measured boundaries together before leaving
that state. Follow [Structured trace emission](#structured-trace-emission-adr-117-task-0868) for the
payload, delegated `decide` emission and best-effort failure handling. Never retry a failed batch
or backfill at close; a zero-row done close fails with `NO_ACTION_ROWS`.

Action semantics come from the YAML and the workflow action contract:

- `shell` — run the expanded command in the project working tree with resolved vars exported as
  environment variables. A non-zero result follows the action's existing failure policy.
- `note` — append the expanded message to the inline run log.
- `doctor.probe` — run the declared Spur doctor once, persist its status file, and apply any
  `setVars` result (including a resolved executor) before the next action or state.
  **Role-map mode has no inline surface (task 1088 session finding).** A `doctor.probe` that
  declares `roles` resolves them through `AgentService.resolve`, which is reachable only in-process
  (the engine composition injects the service); no CLI verb exposes it, so the host session cannot
  reproduce `__executor.<role>` pins. The driver therefore probes the host-session agent instead,
  writes that verdict to the declared status file, and records one run-log line naming the
  substitution. Nothing downstream degrades: `__executor.<role>` pins are consumed by the
  subprocess dispatch path, and the inline path executes its stages in the host session without
  reading them. Never fabricate pins to satisfy the shape, and never skip the status file.
- `file.read.into-var` — read the declared file into the declared run variable before subsequent
  actions/guards.
- `hitl.confirm` — under `profile=auto`, follow the YAML's auto-skip transition. Otherwise pause,
  surface the prompt, and resume from the same state with the operator's answer.
  **Host-session rendering:** ask the gate as ONE `AskUserQuestion`
  [decision brief](decision-brief.md), never a typed yes/no. Read the state's evidence (the
  artifacts its prompt names and the recorded `.status` files) and derive the recommendation;
  map options to the `yes` / `no` / `cancel` answers the guards route on, recommended option
  first, each with a one-line reason from that evidence. When a `no` needs operator feedback
  (design-approval's `## Operator feedback`), take it from the operator's notes/"Other" text
  and write it into the named artifact yourself before resuming. Never ask them to edit the file.
- `hitl.input` — pause, surface the declared prompt (the agent's operator question, 0933), and
  resume from the same state with the operator's answer written into the declared var (default
  `__hitlInput`); the subsequent guards route on answer presence exactly as the engine does.
  **Host-session exception (0933 R5):** because a host session can talk to the operator
  directly, do NOT pause the run at `hitl.input` — ask the question in the session, write the
  answer into the declared var, and continue. The same 2-escalation bound applies: after the
  bound the ask routes to `failed` like the engine does.
- `agent.run` — execute the action's input in the host session. Task execution may use the native
  subagent eligibility below; idea/plan never dispatch a native subagent unless the operator
  explicitly requested delegation. Do not call `spur agent run` or re-enter a full pipeline. Preserve the YAML options: capture
  `answerFile`; assert `expectFile`; honor `escalationFile` (a non-empty file after exit 0 means
  the agent paused on an operator question — treat the attempt as succeeded-with-escalation and
  skip `requireDiff` for that attempt only); enforce `requireDiff` against a pre-action git snapshot,
  including the task-scope guard; honor declared error policy. A host-inline action records
  `timeoutMs` as not applicable because the host session has no independent kill boundary; a
  dispatched subagent passes it to the host when the dispatch tool accepts a timeout (see
  § Timeout boundary).
- `run.artifact` — the engine's ledger registration has **no inline execution surface** (0808 R4).
  The inline equivalent is a documented **registration-equivalent convention**: before the record
  state mutates the task, the host validates the same refusal conditions inline — the declared
  artifact exists at the resolved path and is canonical-valid for the run's wbs (for
  `verify-verdict`: verdict `PASS`), `proofBinding: current` is honored against a freshly captured
  proof digest — capture it with `bun "$SETUP_SCRIPT" --fingerprint --task-file <task path>
  [--feature-file <feature path>]`, the same entry point used at Run setup, which prints the engine
  `sha256:<hex>` digest. Run it inside a per-call pin subshell for the confirmed execution tree
  (the cwd feeds the git-tree half of the digest)
  and pass the same `--feature-file` the run folded in — omitting it, or running from elsewhere,
  yields a different digest and the mismatch surfaces later as a refused `run.artifact`
  registration — and the run-scoped review-completion marker exists — then appends one provenance
  line to `.spur/memory/runs/<run-id>.md` naming the equivalence (artifact kind, path, verdict, digest) and
  proceeds to `spur task record`. A failed validation stops at the state and follows the failure
  contract; the step is never silently skipped. Artifact-provenance consumers read that run-log
  line on the inline path — there is no ledger row. The validation also includes **run/definition
  identity agreement from authoritative evidence** (task 0809 R4): the verdict's `proof.runId` and
  `proof.definitionDigest` must agree with the run-record state `.spur/memory/runs/<run-id>.state.json`
  (legacy pre-0927 runs: `<run-id>-inline-setup.json`) and the persisted run row; if that identity
  is absent or conflicts, STOP — recreating a row is
  not a diagnostic operation. The app-service bound-artifact fixture (which writes a real engine
  ledger row) is service-level test evidence for this identity mechanics, not evidence that the
  inline host writes a ledger.

**Native-subagent dispatch (R2 eligibility, evaluated before each action):**

Before dispatching an `implement` stage to a worker executor, apply the chunked implement
dispatch contract (§ Chunked implement dispatch contract): chunk the brief, cap thinking
blocks, and know the fallback ladder before spending a dispatch.

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
5. **Size floor (2026-09-15 subagent-dispatch evaluation).** The task file's frontmatter
   `estimate_hours` — when present — is **above** the dispatch floor of **1 hour**. A task at or
   below the floor is cheaper to execute than to delegate: the stage runs host-inline and the run
   log carries `stage <id> executed inline in session <session-id> (below dispatch floor:
   estimate_hours <n> <= 1)`. The field is authored at decomposition time (batch item
   `estimate_hours` → frontmatter) or set via `spur task update <wbs> --estimate-hours <n>`; a task
   with no `estimate_hours` passes this condition unchanged. The driver reads the frontmatter value
   directly — never estimates size itself.

   **Diffstat arm (verify only, 1033 R1).** When the current state id is `verify`, condition 5
   fails when the triage diffstat file `.spur/run/<wbs>-diffstat.json` exists and shows a
   small, non-sensitive diff: `([.files, .insertions, .deletions] | all(type == "number")) and
   .files <= 3 and (.insertions + .deletions) <= 60 and
   .sensitive == false` (literal thresholds; the driver reads the file with `jq` — it never
   estimates size itself). A missing, unparsable or `sensitive: true` diffstat leaves condition 5
   as above, so the failure mode is more isolation, never less. A missing or null count also leaves
   condition 5 as above. Below the floor on this arm, the
   run log carries `stage verify executed inline in session <session-id> (below dispatch floor:
   diffstat files <f> lines <n>)`. Only `verify` eligibility changes: `implement` and `review`
   keep the estimate floor, and the pipeline state graph is unchanged.

All five pass → dispatch. Any pre-dispatch failure → execute the stage **once** in the host session.
An `agent.run` whose `input` is free-form prose rather than a pure slash command fails condition 2
and is never dispatch-eligible: the driver executes it in the host session and logs it with the
existing host-fallback line `stage <id> executed inline in session <session-id>` — it does not
reformulate the prose into a command, spawn a subagent for it, or silently promote it to dispatch.
Beyond the deterministic `estimate_hours` floor in condition 5, no token estimate, model heuristic,
or configuration switch is added.

**Pre-dispatch permission check (2026-09-15 subagent-dispatch evaluation).** Claude Code exposes no
dry-run permission API, so the contract is **name-capabilities + fail-fast blocker** — never a
permission-probing subsystem. Before dispatching a stage, the driver names the stage's required
capabilities in the dispatch payload: the slash command (field 2), the resolved Spur invocation
(field 4), and any shell actions the YAML action declares. The delegate is instructed to **return a
blocker immediately on the first missing permission** rather than stalling — a worker parked at a
prompt the host cannot see is invisible until join. Record one run-log line per dispatch:

```text
stage <id> permission precheck: ok | <missing capability>
```

Read-only investigation fan-out (`/sp:dev-parallel --mode investigation`) dispatches read-only
worker shapes by construction — see the [pre-dispatch permission
rule](../../parallel-execution/references/fan-out-patterns.md).

**Dispatch and join:** before dispatch, capture the same pre-action git snapshot used by
`requireDiff` enforcement, and resolve `answerFile`/`expectFile` against the worktree root — the
resolved absolute path, not the YAML's relative string, is what the dispatched agent is instructed
to write and what post-join validation reads. Resolving once at the dispatch boundary fixes every
surface at once; a relative path would resolve against whatever cwd the writer process happens to
have.

**Dispatch payload (task 0818 R2).** Send exactly these six fields. The earlier "send only the
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
   `--spur-bin` flag rather than a new mechanism. A delegate's tool calls may each start in an
   arbitrary directory, so every shell call the delegate makes re-pins the execution tree per the
   **Per-call execution-tree pin** protocol using this supplied identity — never an inherited cwd
   and never a re-derivation.
5. The **resolved absolute output path** (`answerFile`/`expectFile`, resolved as above) and the
   **owning stage's artifact contract** — for a verify stage, the compact contract below.
6. **The implement-stage acceptance-evidence requirement** — for the implement stage and any stage
   whose YAML action declares `requireDiff`. A `requireDiff` stage is the one whose delegate writes
   the deliverable, so its handoff carries three components:
   (a) **the task's AC identities verbatim** — the exact `Scenario:` titles / checklist text read by
   the driver from the task file, never paraphrased;
   (b) **required evidence** — the pasted output of the narrow targeted tests the delegate ran, and
   a `file:line` change map written into the task's `## Solution` section;
   (c) the reminder that **a delegate success message is not evidence** — post-join validation reads
   the artifacts and the diff, not the delegate's claims.
   Component (a) is read from the task by the driver; this extends the payload contract and is NOT a
   new YAML key.

Nothing else: no task/session transcripts, no machine-specific session paths. The WBS/path already
carried by the slash command remains the task handoff.

**Delegate hygiene.** A dispatched stage cleans up after itself: temporary artifacts stay inside the
execution tree, and an ad-hoc git worktree created for a comparison is removed before the stage
reports. The G65 batch's implement dispatches left an 867 MB worktree plus a trail of `/tmp` scratch
files that outlived the run (2026-09-15).

**Driver scratch lives with the run (task 1136 R6).** Every driver scratch file — action-batch
JSON, captured stage output, temporary status/answer files — lives under `.spur/run/<run-id>/`,
never `/tmp` or `$TMPDIR`: the OS may reap a temp directory mid-run, and a reaped scratch file
surfaces as an unrelated downstream failure. Run-scoped files directly under `.spur/run/` keep
their existing `<run-id>-*` naming (the `no-env-files` rule still bans `.env` names).

**Declared vars are checked before a shell action runs (task 1136 R6).** Before executing a `shell`
action whose command references a declared workflow var (for example `$qualityGateCmd`), the driver
confirms the var is exported and non-empty; when it is not, the action fails by name —
`shell action requires $qualityGateCmd but it is empty/unset` — and the command never runs. The
check is scoped to vars the workflow declares with a value: legitimately empty optional vars
(`$featureSpecPath` for an orphan task, `$gateFindings` on a green gate) pass unchanged. This turnsa silently empty `$qualityGateCmd` into a named failure instead of a shell that runs nothing.

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
Evidence anchors are repo-root-relative (`packages/app/src/foo.ts:42`); a basename
(`foo.ts:42`) is an unresolved anchor and blocks the done projection (`L4.anchor-unresolved`) —
see `code-verification/references/verdict-schema.md` § Basename-only anchors are unresolved anchors.
```

**AC table shape (0948 R9).** The AC table must be exactly **4 columns** and **cell 3 must hold a
single evidence-type token** from the allowlist above. The token is *isolated* — never merged or
concatenated with another token or with prose (`static-reftest` is a lint failure, not a shorthand
for "static-ref + test"). Evidence detail belongs in cell 4. The verify-answer linter rejects a
merged token, and `spur task verdict` then derives the wrong artifact — this exact shape failed the
0926 verify lint once before it was canonicalized, so it is stated here rather than left implicit in
the header row.

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

**Resume over re-dispatch for worker-role continuation (2026-09-15 subagent-dispatch evaluation).**
Some stages continue the *same* task's work product after a finding: `test-fix` after a failing
`test`, an implement rework after review findings. A cold re-dispatch makes the next worker
re-ingest the task, the diff, and every skill file it already loaded. When the host platform
supports addressing a completed subagent again (Claude Code: send a follow-up message to the same
agent — its context survives completion), the driver SHOULD resume the prior same-task worker
subagent for that continuation stage instead of dispatching a fresh one, carrying the same
six-field payload plus the finding that triggered the continuation. Provenance uses the resumed
form:

```text
stage <id> executed via subagent <agent-id> (resumed; host session <session-id>)
```

The resume rule applies to **worker-role** stages only (implement, test-fix). Reviewer and verify
stages always dispatch **fresh**: their value is independent eyes on the diff, and a resumed worker
grading its own work defeats the stage. A continuation stage also dispatches fresh when no prior
same-task subagent exists (the earlier stage ran host-inline or below the dispatch floor), when a
host-owned gate sat between the stages, or when the platform cannot address completed subagents.

**Implement and test-fix workers never run the full gate (task 1127 R8).** Since 1127 the full gate
takes a host-wide lock (`SPUR_GATE_LOCK_DIR`, default `~/.config/spur/run/full-gate.lock`):
concurrent full-gate runs serialize, and a manual `spur-check` (wrapped via
`scripts/commands/gate-lock.ts`) holds the same lock. A dispatched **implement** or `test-fix` child
that re-ran the full gate would queue behind every other gate on the host and burn its dispatch
timeout waiting instead of working. Both therefore run only the **changed-path matrix**
(`code-implementation/SKILL.md` § Changed-path targeted checks) over the paths they touched —
the matrix, not a hand-picked "targeted tests and a lint pass" — and return. Carry
`--gate-log <path>` through to the child **verbatim**: never paraphrase it into "re-run the named
gate command". That paraphrase is not cosmetic — it dropped this rule in the H15 run (task
Background, seq 232) and sent a worker into the locked gate. The pipeline's next `test` (recheck)
stage re-acquires the lock and delivers the deciding verdict; that deciding run may wait for a live
holder, so a queued worker's effective budget is dispatch timeout minus observed lock queue wait,
not the timeout alone.

**Timeout boundary (task 0727, amended by task 1108):** when the host's dispatch tool accepts a
per-dispatch timeout (pi: subagent `timeoutMs`, default 30 min — pi-subagents `docs/tool-reference.md`
line 97), the driver passes the stage's resolved YAML
`timeoutMs` (implement → `implementTimeoutMs`) and records `host timeout <ms> (yaml timeoutMs)`.
When it does not, a dispatched subagent is governed by
**the host platform's subagent limit, not the YAML timeoutMs**, and the driver records
`host timeout <ms> (platform subagent limit)`. `timeoutMs` stays not-applicable for host-inline
execution only. Either way the driver must
**record the governing timeout boundary and its source before dispatch** in the run log. Rationale:
the operator sets one budget in one place; a host silently imposing its own 30 min default is what
killed the P1 implement dispatches (1096, 1099). If the dispatch reaches that
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
subagent form above) to `.spur/memory/runs/<run-id>.md`, where `<id>` is the current YAML state id. Also
log start/failure and the ignored timeout value so an inline run remains auditable without
fabricating an `AgentRunTracedResult`.

Run-log stamps (task 0727): every appended line is prefixed with an **ISO-8601 UTC** timestamp
(`YYYY-MM-DDTHH:MM:SSZ`, e.g. `2026-08-31T17:51:11Z`); the exact-template provenance lines above
keep their exact content after the stamp prefix. This normalization is contractual:
**bare local-clock stamps are prohibited** — a hand-appended `[stage 12:31]` form mixes timezones
in one file and makes the run unauditable (task 0726).

## Structured trace emission (ADR-117, task 0868)

Read [structured-trace-emission.md](structured-trace-emission.md) when the first trace event is
emitted — the action vocabulary, the emit shape and the parse/close contract.

## Record & done sequencing

Order matters for the `testing → done` hop: the sections must not be hand-written **before** the
verdict artifact exists (tasks 0617, 0619 — the clobbering spiral).

1. **Write the verdict artifact first.** `spur task record --solution-from-diff --transition testing`
   reads `.spur/run/<wbs>-verdict.json` (default attempt output) on every invocation and atomically retains the recorded verdict under `.spur/memory/evidence/`. A missing or malformed artifact
   yields **UNKNOWN**: bare Testing receives a "No requirements recorded" stub, while already-authored
   Testing is preserved. `--solution-from-diff` backfills only a bare Solution. The clobbering above is
   the historical behavior, corrected by the authored-Testing safeguard (tasks 0617, 0619). Creating the
   artifact first (PASS, with requirement rows keyed by scenario title) remains the standard order;
   re-running record after a real verdict arrives refreshes Testing from that verdict.

   ```bash
   # verdict artifact first (shape: {wbs, verdict, requirements:[{id,status,evidence}], checks:[], source})
   # then the record hop; then re-write Testing/Solution if record's backfill is thinner than intended.
   # Both calls are per-call pinned (task 1058): the record hop selects the execution tree inside
   # the same tool call — never through a cwd a previous call happened to leave behind.
   spur task update <wbs> wip --no-lifecycle
   spur task record <wbs> --solution-from-diff --transition testing
   ```

   The engine now preserves an already-authored Testing when the verdict is UNKNOWN (task-service
   `record` fallback-only, mirroring the Review 0593 precedent) — but the order above is still the
   contract for the standard pipeline.
2. **Done-probe before done.** Run the check projected to `done` (`spur task check <wbs> --as done`
   via the `TaskCheckService` probe pattern) — it surfaces `L3.unchecked-checklist` (flip `- [ ]` → `- [x]`)
   and `L3.required-section-placeholder` before the transition, not after.
   **Anchor repair is the YAML implement stage's job, not the driver's** (task 1109 R4):
   `task-pipeline.yaml` runs `$spurBin task migrate-anchors --wbs $wbs --json ; exit 0` after the
   format step and before `test` captures the proof digest, so unique basename anchors are already
   repo-relative by the time this probe runs. The driver does not hand-patch anchors: anything the
   scoped pass leaves (ambiguous basenames, line drift, `L4.anchor-subject-mismatch`) is reported by
   this probe and belongs to the implementer to re-anchor.
3. **Solution change-map anchor rule (L4.anchor-subject-mismatch).** A Solution change-map table must
   list **one `file:line` per row**. A ·-joined paragraph makes every anchor's "subject" the other
   anchors and trips the L4 subject check. Since 0804 R9, subject extraction ignores complete parsed
   citation spans, so a path's underscores no longer manufacture a subject: an underscore path row
   (`docs/help/cmd_example.md:12`) is checked exactly like any other row — cite an **existing file**
   with a **valid line or line range** whose content names the requirement's subject. A real absent
   symbol, nonexistent file or invalid range still reports; never replace a citable row with prose.
4. **Stage through the commit guard (1129 R2/R3/R5).** The per-task commit that follows the record
   hop stages only the files THIS run wrote — `git add -A` and `git add .` are **forbidden** in
   every driver commit step (they staged a concurrent session's files in `a94f9f431` and
   `36f274590`). `check` first and record a non-empty `foreign` list in the run report; `stage`
   exits 2 when it refuses a listed path (foreign) and 3 when a target is unmerged or still carries
   conflict markers — both mean "resolve it, do not commit":

   ```bash
   GUARD=plugins/sp/scripts/commit-guard.ts; [ -f config/plugin-scripts.json -a -f "$GUARD" ] || GUARD="$(superskill script path sp commit-guard.mjs 2>/dev/null)";
   bun "$GUARD" check --run "$RUN_ID"
   bun "$GUARD" stage --run "$RUN_ID" -- <files this run wrote> \
     || { echo "record halt: commit-guard refused a path (foreign, unmerged or conflict-marked); nothing committed" >&2; exit 1; }
   git commit -m "<type>(<scope>): <wbs> <summary>"
   ```

## Runtime interface contracts (from run evidence)

Each item below cost a driver cycle to discover. They are contracts, not tips.

- **`--decide --options-json <file>` takes one option object, never an array.** Shape:
  `{id, decision, params?, evidence? | instructions?, resultFile}`; `evidence` and `instructions` are
  mutually exclusive (`CatalogDecideOptionsSchema`). A JSON array parses as neither dialect and
  surfaces as `decide: invalid options — Invalid input` with no field detail. `resultFile` resolves
  against the confirmed tree's cwd, so pass a worktree-relative path such as
  `.spur/run/<wbs>-triage.decision`.
- **`task-diffstat.ts` reads `wbs` from the environment and writes an artifact.** Resolve it
  through the guarded script-path idiom (source-repo probe, then the installed twin) — never the
  bare unguarded form, which the script-contract check forbids on a shipped surface because it
  shadows the installed twin in a consumer — and invoke it with `wbs` exported; stdout stays empty,
  so assert success on `.spur/run/<wbs>-diffstat.json` and never on command output.
- **The verify answer grammar is exact.** One `Verdict:` line, one `Confidence:` line, then
  `### Per-Requirement Traceability` (`| Req | Status | Evidence |`) and
  `### Acceptance Criteria Verification` (`| AC | Status | Evidence Type | Evidence |`). Requirement
  statuses are `MET | PARTIAL | UNMET`; AC statuses add `N/A`; every AC row id must match a declared
  scenario title verbatim, including its `(req: ...)` suffix. A `MET` row whose evidence hedges
  (`likely`, `probably`, `seems`, `appears`, `possibly`, `presumably`) is rejected as
  `evidence-hedged`, and a level the rows do not earn is rejected as `confidence-unwarranted` or
  `confidence-understated`. `spur task verdict` lints before writing, so a rejected answer leaves no
  artifact and exits non-zero.
- **Harness tooling refuses direct task-file writes.** Resolve a merge conflict in a task file by
  choosing a git side, then applying the corpus delta through `spur task update` (for example
  `--feature <id>`), never by editing the file.
- **A skill body has a byte budget** (20,000 B for `SKILL.md`); procedure detail belongs in
  `references/`. Adding a clause to a SKILL.md can fail `R44 — skill BODY budgets`.
- **`.spur/run/` is volatile** (ADR-131, as amended): its contents are execution scratch. Anything
  that outlives the run cites the durable owner (`.spur/memory/evidence/`, `.spur/memory/runs/`) or
  the tracked Testing section.

## Failure contract

Never silently fall back from this interactive inline path to `agent.default`. If the driver cannot
read the YAML, allocate provenance, execute an action, or evaluate a guard, stop at that state and
report the run id, state id, original error, and the concrete resume/retry command. The working tree
and run artifacts are the recovery input.
