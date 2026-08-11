---
name: cross-cutting
description: "Extracted section: cross-cutting write rules shared by both halves — every-write-is-CLI-gated, the section-editing body-only workflow, the section-status matrix, and check-before-write. These mechanics apply to all planning and execution writes."
see_also:
  - spur-dev
---

# Cross-cutting Rules

These mechanics apply to **every** write in both the planning and execution halves. The skill
knows *how to think*; the CLI knows *what is valid* — every mutation passes through a CLI verb
that validates before writing.

**Split from `glossary.md`:** this file owns **process rules** (how writes happen, what the Iron
Laws are, what `--auto` does). [glossary.md](glossary.md) owns **term definitions** (what a word
like *spine*, *gate*, or *verdict* means). A rule below may use a glossary term by name; it does
not redefine it.

## Inline-default execution surface

> **This section is the single source of truth for `--agent` value semantics, the executor
> precedence chain, and the `implementAgent` override.** Every other reference (flag-glossary,
> execution-workflow, execution-batch, dev-operations, cmd_agent, cmd_workflow) links here and
> does not restate the contract. The value table below is authoritative; parity with it is
> enforced by `validate-flag-contracts.ts` (C3a/C3b).


### The one rule

> **`--agent <value>` names *who* does the model-bearing work. The execution surface is derived from
> that choice, never declared separately:** if the named executor is the agent already running this
> session, the work happens inline; otherwise it dispatches a subprocess.

That is the whole contract. `--agent` answers *who*, not *where* — "where" is arithmetic on the
answer. Everything below is a consequence of that sentence, not an additional rule.

**Default: execute the backing skill directly in the current coding-agent session.** Do not invoke
`spur agent run` when no escalation trigger applies and the operator did not select subprocess via
the `--agent` selector. Omitting `--agent` is exactly `--agent inline`; the explicit value is useful
in scripts and audit output but does not change the default.

| Value | Who does the work | Derived surface |
|---|---|---|
| `inline` (default when omitted) | Whoever is running this session (interactive) or `agent.default` (headless) | Interactive: inline — host-controlled, eligible model stages may use a native subagent (0508); headless: subprocess of `agent.default` |
| `auto` | Tier-resolved from the stage's `min_tier` + `fallback` | Subprocess — a tier-resolved executor pins a specific agent/model, which the host session cannot supply |
| `<name>` (coding agent or configured executor) | That executor | Inline when it resolves to the current session's agent; subprocess otherwise |

The previous `--inline` and `--subprocess` flags (feature H82, task 0413) are collapsed into this
single selector: `--inline` → `--agent inline`, `--subprocess` → `--agent auto`. The old two-flag
form is no longer part of the command surface.

This is a prompt-runtime rule owned by the command wrapper and its backing skill, not a branch in
`AgentService`: the current coding agent is already executing the command, so inline means continuing
in that session. Threading an `inline` option through `AiRunner` would still start a subprocess and
would therefore be a false implementation. On a headless surface (`spur agent run` / workflow
`agent.run`) `inline` is **not** rejected (ADR-047): it resolves exactly like omitting the flag to a
subprocess of `agent.default`.

### Objective triggers override the answer

The one rule resolves operator *intent*. A trigger is a detected *requirement* the chosen executor
cannot satisfy, so it wins regardless:

| Trigger | Subprocess condition | Required report |
| --- | --- | --- |
| **Different model or coding agent required** | The requested `--agent <name>` / model cannot be supplied by the host session. | `trigger 1: different model or coding agent required` |
| **Headless or unattended step** | No live coding-agent session can own the step (scheduled, detached, async worker). | `trigger 2: headless or unattended step` |
| **Durable auditable run record required** | The caller requires a persisted cost/trace/exit-code record. | `trigger 3: durable auditable run record required` |
| **Workspace or credential isolation required** | The work must not share the host workspace or credentials. | `trigger 4: workspace or credential isolation required` |

A trigger selects subprocess even when `--agent inline` was supplied, and the applied trigger must be
named in the dispatch or result. When the operator selected a non-current executor and no objective trigger
applies, report `operator override` rather than inventing one of the four. The trigger vocabulary and
evidence standard are owned by
[dispatch-surface.md](../../parallel-execution/references/dispatch-surface.md). If none can be named
and the selector resolves to the current agent, stay inline.

Never hardcode an agent: forward the operator's selector; when none was provided, let
`spur agent run` resolve its configured default.

### Consequence: where the selector is delivered

The one rule says *who*. How the selector reaches that executor depends on where the model-bearing
work lives in the command:

**Single-skill dispatch** — the command's own backing skill is the model-bearing work. Invoke
`spur agent run` exactly once. Strip the outer `--agent` selector from the command placed in the
child prompt; pass it to the outer `spur agent run --agent <value>` instead. Tell the child that the
surface is already resolved and name the trigger / `operator override`. A command already executing
inside that subprocess boundary runs its backing skill in that process; it must not spawn another
`spur agent run` for the same trigger. This prevents recursive dispatch.

**Pipeline wrappers (`dev-run`, `dev-runall`)** — the orchestrator is a loop; its *stages* do the
model-bearing work. Interactive omit/`inline` therefore uses the
[inline pipeline driver](inline-pipeline-driver.md): it reads `task-pipeline.yaml`, executes each
`agent.run` input through the backing skill in the host session, and preserves every shell action
and guard. `auto` or a named executor is merged into per-task `vars.agent` and
`vars.implementAgent`, and the workflow's `agent.run` steps run under that subprocess executor (see
`execution-batch.md` § 3.2). The loop itself continues in the current session.

This is **the same rule, not an exception**: `--agent` names who does the thinking, and in a pipeline
the thinking happens in the stages. Selecting an executor for a loop that runs no prompts would be
meaningless.

**Interactive task pipelines invert control into the host session (ADR-047 amendment).**
`dev-run --mode full` and sequential `dev-runall` with omit/`inline` interpret the existing
`task-pipeline.yaml` in the host session; they do not launch `spur workflow run` and never redirect
silently to `agent.default`. Interactive inline is **host-controlled and non-subprocess**, but no
longer guarantees host-context execution for every model stage (task 0508): an eligible `agent.run`
stage — pure-slash input, non-interactive state, native subagent with shared-worktree
read/write/shell capability — dispatches **once** to that native subagent and joins before the
driver continues; any pre-dispatch eligibility failure falls back to one host execution, and a
failure after dispatch follows the stage's error policy with no automatic host replay. Operator
confirmation actions, `pause: true`, and approve/taste/ask decisions stay host-owned. Each inline
model stage appends `stage <id> executed inline in session <session-id>` to its run log; a
subagent-dispatched stage appends `stage <id> executed via subagent <agent-id> (host session
<session-id>)` instead. `dev-plan` remains a workflow subprocess, as do `dev-run`/`dev-runall` with
`--agent auto` or a name, parallel batches, and every headless `spur workflow run` / `spur agent
run`. `dev-run --mode implement` continues to run its single competency in-session under omit/`inline`.

### Executor precedence chain (R7)

For workflow-pipeline `agent.run` steps on the explicit/headless subprocess surface, the executor is
resolved in this order; first match wins:

1. **`--agent` / explicit `--vars '{"agent":"<value>"}'`** — the operator's selector, merged into
   `vars.agent` by the command wrapper. This is the highest-precedence input.
2. **`agent.default`** from `.spur/config.yaml` (project layer, then `~/.config/spur/config.yaml`) —
   `spur workflow run` injects it as the `agent` var when `vars.agent` was not set by the caller.
3. **YAML literal `agent:` in the pipeline file** — the last-resort fallback declared in the
   workflow YAML (e.g. `agent: "omp"` in `task-pipeline.yaml`). This fires only when no
   `agent.default` is configured anywhere.

`--agent auto` tier-resolves an executor (stage `model_policy` → `agent.default` → tier priority)
**before** merging, so it enters the chain at step 1 already resolved to a concrete name.
On a headless workflow surface, `--agent inline` resolves like omit to `agent.default`. Interactive
task wrappers consume omit/`inline` before this chain and use the host driver. Omitting the flag on a
headless surface forwards nothing, so the spawned step resolves to `agent.default` (step 2) or the
YAML literal (step 3).

### Implement-only executor override (R6)

`task-pipeline.yaml` declares a separate `implementAgent` var. The `implement` state's `agent.run`
step reads `${vars.implementAgent}` instead of `${vars.agent}`, so an operator can pin the
implement hop to one executor while review/verify/test-fix hops keep the default agent:

```bash
# Pin implement to a specific executor; other hops keep agent.default / YAML literal
--vars '{"implementAgent":"omp-zai"}'
```

All other `agent.run` steps (test-fix, review, verify) read `${vars.agent}`. `implementAgent`
applies **only** to the implement hop. **The `--agent` flag forwards into BOTH `agent` and
`implementAgent`** at the execution-batch boundary (§3.2), so a pinned `--agent X` reaches every
hop including implement. To pin ONLY implement to a different executor while other hops keep the
default, pass `--vars '{"implementAgent":"..."}'` separately (task 0483 R2).

### Executor exhaustion is survivable, not a pin-away problem (task 0482 R1/R5)

Every executor can exhaust its provider quota — **including `omp`/Claude**, which enforces its own
5-hour rolling limits. No executor is exempt from hard limits, so "pick a safe executor to pin" is
not durable guidance: pinning one converts a recoverable failure into a rarer, unhandled one. The
pipeline survives exhaustion automatically — a dispatch that fails with a 429/quota body is
classified as `resource-exhaustion` and escalates to the stage's next eligible tier, **even when the
run started from a pinned executor**. The pin chooses where a run *starts*; it does not disable
recovery (0482 R1). To confirm recovery is wired, watch the run log for
`Escalating: <executor> (tier <t>) failed with resource-exhaustion; retrying on <executor>` — that
line, not quota state, is the signal that the fallback ladder fired.

Do not read provider quota from `spur agent doctor`. The doctor resolves provider keys from
`${PROVIDER}_API_KEY` env vars and cannot see an agent-owned credential store (e.g. omp's models
config), so its row degrades to `status: usable · auth: no · model: unknown` for GLM-style executors
and is useless as a preflight gate. Exhaustion is detected mid-run by the escalation classifier, not
by any preflight probe.

### Explicit subprocess surfaces are unchanged

Direct `spur agent run` invocations are always subprocess execution. A workflow launched through
`spur workflow run` executes `agent.run` actions as subprocesses. Those surfaces already express an
explicit process boundary and retain their existing resolution, output, timeout, and trace
contracts. The interactive task wrapper does not change the YAML or engine; it reads the YAML as
SSOT and interprets the actions in-session before any workflow subprocess exists. It records inline
provenance without fabricating an `AgentRunTracedResult`.
`spur agent run` itself resolves omit/`inline` to `agent.default` and `--agent auto` tier-resolves —
the unified `--agent` selector on the dev command surface does not change the CLI's resolution.

### Inline trade-off

Inline avoids process startup and preserves the host session's context and tools. Relative to
subprocess dispatch it provides **no isolated workspace**, **no per-stage subprocess action
record**, **no independent timeout or abort boundary**, and **no tier-selected executor**: the
executor is the current coding agent. Interactive task pipelines retain a run log, run-link, and
session provenance through the inline driver. If process isolation or an independently killable
stage is required, select the subprocess path (`--agent auto` or `--agent <name>`).

## Every write is CLI-gated

Never edit a task or feature file directly. Every mutation goes through:

| Intent | CLI verb |
|--------|----------|
| Create a task | `spur task create` |
| Change status | `spur task update <wbs> <status>` |
| Edit a section | `spur task update <wbs> --section <name> --from-file <path>` |
| Record verify results | `spur task record <wbs> [--solution-from-diff] [--transition <status>]` |
| Create a feature | `spur feature create` |
| Batch create tasks | `spur task batch-create --file <json>` |

## Status transitions in `--next` chains honor the FSM

The interactive `--next` step-chain (`dev-refine → dev-run → dev-verify → done`) moves a task's
status with `spur task update <wbs> <status>` **without `--no-lifecycle`**, so the lifecycle guards
run: `wip → testing` invokes `spur task check`, `testing → done` invokes
`spur task check --strict-core`. A guard failure **stops the chain as review-pending** — leave the
task at its current status, surface the blocking finding, do not advance. This is the gate that
keeps a malformed task out of `testing`/`done`.

`--no-lifecycle` is **bookkeeping, not a guard bypass**: `task-pipeline.yaml` suppresses
lifecycle-*run* creation because it is already a run and a nested one would orphan. The structural
gate still runs — `→ testing` and `→ done` invoke `spur task check` regardless of the flag.

> **Behavior corrected 2026-08-07.** `--no-lifecycle` previously suppressed enforcement as a side
> effect of suppressing the run record, because the FSM guards live inside the lifecycle workflow.
> Combined with `--force-done` (which waives the verify **verdict** only) it left nothing: a task
> walked `wip → done` carrying L3 errors. Neither flag leaks alone. The CLI now runs the gate
> inline whenever the FSM guard will not. **was: `--no-lifecycle` skipped the check entirely.**

### Bounding context compaction in `--next` chains

Long `--next` chains that run several tasks in **one session** accumulate cross-task context (each
task's full tool transcript, diff, and re-ingested files) and trigger repeated LLM context
compactions. Each compaction is a context rebuild the model must re-ingest and re-reason over; on a
three-task chain this clustered 4 compactions in a single 2.9h run (task 0436 forensics). The
compaction mechanism is an LLM-window property, not a harness bug — the lever is to bound how much
one session accumulates, not to fight the window.

**Guidance for multi-task chains:**

1. **Prefer one `/sp:dev-run <wbs>` per session.** Each invocation starts a fresh context window,
   so a chain of independent tasks naturally bounds compaction. This is the v1, lowest-blast-radius
   change — split the chain by invoking each task separately.
2. **If `--next` chaining must stay in-session**, accept at most one compaction per long session
   and emit a **compact per-task handoff** — a short `local://`-style note carrying only the
   next task's goal + the completed task's done-set (not its full transcript) — so the session does
   not re-accumulate the finished task's context.
3. **Do not re-run full verification for already-done tasks** in a chain (see
   [targeted-test-first](#targeted-test-first-verification-loop)). Re-running the full suite per
   task is the other dominant session-cost driver.

**Target:** a three-task chain completes with **≤1 compaction** instead of 4. This is operator
guidance in the reference, not a codified hook — auto-splitting `--next` is a possible follow-up
but loses in-session continuity for later gates, so it is deliberately not done here.

## Section-editing workflow

The dominant agent write pattern (hot path 2):

1. Generate the new section content to a temp file.
2. `spur task update <wbs> --section <name> --from-file <temp>` — the CLI writes it.
3. Remove the temp file.

This is the only sanctioned path for LLM-generated content to enter the corpus. The CLI
validates the section against the status-section matrix before writing.

**Body-only format** (avoids the corruption class fixed in task 0115):

- **Body-only:** the temp file is the section *body* only — no `## SectionName` heading line.
  The CLI adds the canonical heading (`### SectionName` for tasks). If the temp file starts with
  a heading matching the section name the CLI strips it, but write body-only from the start.
- **No same-level sub-headings:** never use `###` sub-headings inside a task section body (e.g.
  `### AC1 — …`). They sit at the canonical section level and would become phantom sections on
  re-parse; the CLI now strips them with a stderr warning, but write clean. Use bullet lists,
  tables, or `**bold**` labels for sub-structure instead.
- **Never suppress stderr:** run `spur task update` without `2>/dev/null`. Stderr carries the
  diagnostic (including the strip warnings above); suppressing it turns a fixable error into a
  silent exit-1 that wastes a round-trip.

## The section-status matrix

`spur task check <wbs> --json` returns the required and optional sections for the task's
current status. Agents ask "what does this task need now?" with zero tokens by reading the
`--json` output — no need to load and parse the matrix YAML.

## Check before write

Before editing any task file, run `spur task check <wbs>` to see what sections exist, what
is missing, and what format rules apply. The check is the single validation surface:
frontmatter schema, section-status matrix, section format rules, feature traceability.

After writing a section, run `spur task check <wbs>` again to confirm the write introduced no
structural issues (phantom sections, matrix violations) before moving on.

## What belongs in a task file

**A task file is work to be done, not a question to be answered.** Every surface that creates tasks
is bound by this — decomposition, wayfinder, issue-finding, brainstorm exits, review findings,
dogfood follow-ups.

The test is one question: **can an implementer execute this to completion without the operator in the
loop?**

- **Yes → it is a task.** It has a definite outcome, and `### Requirements` states observable results
  that `spur task check` and verify can be judged against. Writing code, extending tests, running a
  measurement, producing a documented inventory, migrating data — all tasks, whether or not they ship
  production code.
- **No, it needs the operator's judgment → it is not a task.** "Decide X", "choose between A and B",
  "what should the contract be" are decision briefs. They are resolved in conversation with the
  operator, and the *answer* is recorded where the decision belongs — the feature body, an ADR
  (`docs/00_ADR.md`), or the design doc. A task may then be created for the work the answer implies.

**Why this is a rule and not a preference.** A decision filed as a task sits in `spur task list` and
in a feature's Tasks table looking like queued work. It gets handed to an implementing agent, which
either stalls or invents the decision and calls it done. It also inflates task counts, which is how
an over-decomposed batch hides. The corpus is a work queue; a question in it is a queue defect.

**Open questions do not live in task files either.** `### Q&A` records decisions that are *closed* —
"we chose X because Y", "deferred with reason Z". If a task's `### Q&A` or `### Design` still contains
an unanswered question at the point of handoff, the task is not ready: close the question with the
operator first, or state the assumption explicitly and proceed. An implementer must never have to
guess which of two designs was intended.

## Task sizing: cohesion before hours

Applies to **every** surface that authors more than one task in a sitting — decomposition,
wayfinder charting, issue-finding, brainstorm exits, dogfood follow-ups, review findings. Ceremony
cost is **per task** (precheck, implement, test, review, approve, verify, record, done, plus a
verdict artifact), so an over-split batch pays that cost repeatedly for a diff the reviewer reads
once.

Before creating a set of tasks, apply the two dimensions in order:

1. **Cohesion — is the split legitimate at all?** Candidates that would edit the same file surface,
   or that must be read together to be judged, are **one task** — even when each would be a
   respectable size alone. Merge them.
2. **Hours — is the resulting cohesive task too large?** Only once cohesion permits the split do the
   hour knobs bound it. Above `force_decompose_above_hours`, size overrides cohesion.

Sharpness is not sufficient justification for a separate task. A question can be sharp, need real
work, and still belong to a sibling's session.

Full treatment, the worked example, and the tunable knobs:
[`../../spec-decomposition/references/decomposition.md`](../../spec-decomposition/references/decomposition.md).

## One writer per working tree (task 0487 R5/R6)

**One agent session writes a given working tree at a time.** Two sessions in the same tree do not
merge — they overwrite. Nothing detects it: the second writer's edit simply reappears after the
first reverts it, and the symptom reads as a model regression. During the 0486 drive a background
Codex session (PID 4087) re-applied a reverted change three times before a live-process check found
it, costing ~10 minutes of misdiagnosis.

- **Parallel agent work uses git worktree isolation** — one branch and one tree per agent, merged
  back through the WT-4 sequence above. Not two agents, one checkout.
- **Suspect a second writer** when an edit you just made is gone, or a reverted change returns.
  Check for live agent processes before blaming the model.

**Commit per task.** Start each task on a tree clean of other tasks' implementations. A dirty tree
mixes two tasks' evidence into one diff — 0486's run launched on top of 0485's uncommitted work
across nine files, forcing a commit-0485-first detour mid-pipeline, and the mixed diff is what the
implement stage then conflated. The pipeline precheck prints a WARNING with the file list when the
tree has uncommitted non-corpus changes; treat it as a stop-and-commit, not noise. It warns rather
than blocks because a legitimately in-progress tree is the operator's call.

## Iron Laws

Seven non-negotiable invariants for the spur-dev lifecycle. These are laws, not guidelines — a
violation is a defect in the run, not a style choice. Every competency skill and the spine consume
them; they live here because they cross every phase boundary.

1. **NEVER skip the verification gate.** A task is not done until `spur task check <wbs> --strict-core`
   returns PASS and every AC scenario has a corresponding verify command that exited 0. "I tested it
   manually" is not verification evidence.
2. **NEVER write to task/feature corpus outside the `spur` CLI.** Direct file edits to
   `docs/tasks2/*.md` or `docs/features/*.md` are forbidden. The only exception is working memory
   under `.spur/memory/`. Every other mutation goes through `spur task` / `spur feature` so the
   schema, matrix, and traceability guards run.
3. **NEVER mark a task done without a PASS verdict.** `testing → done` requires
   `spur task check --strict-core` PASS and a recorded verdict. PARTIAL or FAIL verdicts leave the
   task at `testing` and surface to the operator.
4. **NEVER proceed past a failed gate without explicit operator approval.** A failed
   `feature-check`, `batch-create`, `precheck`, `review`, or `verify` stops the run. The operator
   decides whether to fix-forward, rework, or abort — the agent does not auto-retry past a failure.
5. **NEVER suppress gate failures with `--no-verify`, `--force`, or new `biome-ignore` /
   `eslint-disable` suppressions.** Suppression is a silent bypass. If a gate fails, fix the root
   cause. A suppression added solely to silence a gate is a defect, not a fix.
6. **NEVER create a standalone PM skill or command.** Product-management judgment lives in
   `product-planning.md` as a lens applied during intake and decomposition. No `sp:product-management`
   skill, no `/sp:prd-*` commands, no `sp:super-pm` agent — unless a later task proves a stable,
   distinct routing value (ADR-022).
7. **NEVER claim completion without fresh verification evidence.** "Tests pass" must be backed by
   the actual `bun run test` tail pasted into the record. "Lint clean" must be backed by
   `bun run lint` output. Stale evidence from a prior run is not evidence — re-run the gate and
   paste the current output.

## Verification Before Completion

A universal honesty gate that applies to **every** completion claim, not only the pipeline verdict:
**no "done / passing / fixed / works / ready" claim without fresh verification evidence** — the
command *and* its output, run **this turn**. Iron Law 7 states the invariant for the corpus record;
this section generalizes it to every claim an agent makes, in any skill, at any phase.

**The rule.** Before you write or say a task or step is complete, working, or fixed:

1. Run the check that proves it (the test, the build, the lint, the actual command).
2. Paste the command and its real output (or the relevant tail) into your report.
3. Only then make the claim — and phrase it against the pasted evidence, not against your expectation.

"I ran it earlier" is stale. "It should pass" is a prediction, not a result. A subagent's "success"
line is a claim to re-verify, not evidence to forward. Re-run and paste.

**Red Flags — an unverified claim is usually hiding behind one of these:**

| Red flag | What it usually means |
|---|---|
| "This should work" / "this will pass" / "probably fine" | You are predicting, not reporting. Run it and paste the result. |
| Expressing satisfaction ("great, that's done!") before any check ran | Relief is not evidence — the check has not been run this turn. |
| Forwarding a subagent's "success" without re-running its gate | You are trusting a claim, not verifying it. Re-run the check yourself. |
| "Tests pass" with no pasted command + output | Unbacked. Stale or imagined green is the default failure mode. |
| Marking done while any check was skipped, `.skip`'d, or commented out | A skipped check is an unknown, and "done with unknowns" is not done (fail loud). |
| "I fixed it" from a single non-reproduced success | One lucky run is not a fix. Reproduce, fix, then re-verify. |

This rule is behavioral, not CLI-enforced — the competency skills carry it into their own steps: the
verify step (`sp:code-verification`) enforces it hardest, and the implement (`sp:code-implementation`)
and test (`sp:code-testing`) steps apply it before claiming their work complete.

### Targeted-test-first verification loop

The verification loop must run the **narrow** test before any full-suite gate, so iterating on a
failing test does not re-run the entire workspace on every attempt. This is the single biggest
verification-loop cost driver (task 0436 forensics: 12 `bun test` + 4 full `spur-check` runs while
iterating one task).

**The rule.** When a test fails and you are iterating to green:

1. Run the narrow target first: `bun test <file> --test-name-pattern <test>`.
2. Loop on that narrow target until green.
3. **Then** run the single full `spur-check` (or `bun run check`) as the final gate.

**Dependency-aware selection (task 0510 R3).** "Narrow" is not "whatever file I touched" — a change
to a shared surface must also verify its downstream consumers. Pick the targeted tests and
typechecks from the **changed-path matrix** in `code-implementation/SKILL.md` (§ Changed-path
targeted checks): domain changes run affected domain + app/CLI consumer tests and
domain/app/CLI typechecks; app changes run affected app + CLI tests and app/CLI typechecks; CLI
changes run affected CLI tests and the CLI typecheck; shared plugin flag/command contract changes
run their focused structure/parity tests. Run only the applicable rows, then stop — the full
project check is still the pipeline's single final gate, never a per-iteration re-run.

Do not re-run the full suite per iteration, and do not `spur-check` before you have a green narrow
target. **Target:** full `spur-check` runs ≤2 per task (one during iteration, one final) instead of
4 across a chain.

## Auto-Decision Principles

Seven principles governing `--auto` mode. `--auto` sets `profile=auto` in the workflow vars; the
principles determine which gates route around HITL and which still pause.

1. **Schema-valid → auto-approve.** If the input passes local schema validation
   (`task-batch.schema.json`, BDD validator, frontmatter schema), the gate is entered without
   pausing. The schema is the contract; schema-valid means structurally sound.
2. **Gate-passed → auto-continue.** If `spur task check`, `spur feature check`, or
   `spur workflow validate` exits 0, the run continues to the next state without surfacing.
3. **Tests-green → auto-continue.** If `bun run lint` and `bun run test` exit 0, the verify step
   continues. A red test suite is a hard stop, not an auto-retry.
4. **Verdict-PASS → auto-continue.** If the verify step produces a PASS verdict, the run advances
   to `record` and `done`. PARTIAL or FAIL verdicts surface to the operator regardless of `--auto`.
5. **Taste-decision → surface to human.** Architecture approval, naming, UX shape, and
   "is this the right abstraction" decisions are taste gates. `--auto` does not auto-resolve them.
6. **Irreversible action → surface to human.** Branch deletion, force-push, schema migration,
   `spur feature update <id> cancelled`, and any `--merge` / `--force` action pauses regardless of
   `--auto`. Irreversible is irreversible.

   **Exception — the worktree batch success path (`execution-batch.md` § WT-4).** The
   `--worktree --auto` full-batch success sequence — `git merge --ff-only "$BRANCH"`, `git worktree
   remove`, `git branch -d "$BRANCH"` — does **not** pause, even though it performs a merge and a
   branch deletion. This is the single carve-out from Principle #6, and it is safe by construction:
   `git merge --ff-only` refuses rather than rewriting history when the base ref has moved, and
   `git branch -d` (lowercase) refuses to delete a branch that is not fully merged. Both fail closed,
   so no work can be lost — the property #6 exists to protect. When FF is impossible, WT-4 falls
   through to the WT-5 retention path, which leaves the worktree and branch intact. Every other
   branch-deletion, `--merge` / `--force`, force-push, and schema-migration action continues to
   pause regardless of `--auto`.
7. **Error → stop.** Any unexpected error (CLI crash, schema parse failure, missing file) stops the
   run. `--auto` is not a license to power through errors; it is a license to skip *objective* HITL
   pauses, not to ignore failures.

### The `--auto` routing contract

`--auto` sets `profile=auto`. The workflow YAML transitions must **route around** an auto-resolvable
HITL state **before entry** — the workflow engine does NOT auto-dismiss `hitl.confirm` states. This
is the critical contract: `--auto` is not "auto-click yes on every gate"; it is "use the transition
graph to skip gates whose objective preconditions are already met."

Concretely: an `idea-pipeline.yaml` with `profile=auto` transitions from `feature-check` directly
to `decompose` when the feature-check exits 0, never entering a `hitl.confirm` state for
`feature-check`. But `design-approval` (a taste gate) still enters `hitl.confirm` and pauses,
because there is no objective precondition that can route around it.

**Without `--auto`** (the default), all gates surface to the human — including objective gates.
The operator approves every state transition interactively. This is the safe default; `--auto` is
opt-in for trusted, low-risk runs.

## Pipeline Alignment

The system has multiple pipelines, each owning exactly one lifecycle phase. This section documents
the phase-ownership model, the no-nesting principle, and lifecycle guard respect — the structural
invariants that keep the pipeline set coherent as new ones are added.

### Pipeline phase table

| Pipeline | Lifecycle phase | Entry point | Terminal states |
|---|---|---|---|
| `idea-pipeline.yaml` | Ideation (vague idea → feature + AC + task batch) | `/sp:dev-idea` | `handoff`, `cancelled` |
| `planning-pipeline.yaml` | Design (known slug/task → design handoff) | `/sp:dev-plan` | `handoff`, `cancelled` |
| `task-pipeline.yaml` | Execution (one task → done) | `/sp:dev-run` | `done`, `failed` |
| `wrapup-pipeline.yaml` | Wrap-up (completed tasks → learning + metrics + doc-sync) | `/sp:dev-wrap`, `/sp:dev-wrapall` | `done`, `skipped` |
| `feature-dev.yaml` | Umbrella (brainstorm → plan → execute → feature-verify) | `/sp:dev-runall --feature <id>` (or `--tasks feature:<id>`) | `done`, `failed` |
| `basic.yaml` | Simple (generic implement/check/fix loop) | direct `spur workflow run` | `done`, `failed` |
| `feature-lifecycle.yaml` | Feature status FSM (entity lifecycle, not a phase pipeline) | `spur feature update` | `done`, `cancelled` |
| `task-lifecycle.yaml` | Task status FSM (entity lifecycle, not a phase pipeline) | `spur task update` | `done`, `cancelled` |

The two `*-lifecycle.yaml` workflows are entity FSMs, not phase pipelines. They guard persistent
entity state transitions; phase pipelines orchestrate work and may invoke lifecycle verbs but do
not replace them.

### No-nesting principle

A pipeline may invoke another workflow through a command wrapper or `spur workflow run` **only at a
phase boundary** — it must NOT inline another pipeline's state graph. Concretely:

- `feature-dev.yaml`'s `execute-tasks` state may invoke `task-pipeline.yaml` per task via
  `spur workflow run` (phase boundary: design → execution).
- `idea-pipeline.yaml`'s `handoff` state may output a command for the operator to run
  `task-pipeline.yaml` (phase boundary: ideation → execution).
- `task-pipeline.yaml`'s `implement` state must NOT contain a nested state machine for
  `code-implementation` — it dispatches the competency skill via `agent.run`, not by inlining
  another workflow's states.

Nesting state graphs couples pipelines at the implementation level, making the set unmaintainable
and breaking the "orchestration is configuration" principle (ADR-022). The no-nesting rule is the
structural invariant validated by Phase 3's `idea-pipeline.yaml` design.

### Lifecycle guard respect

New pipelines respect existing lifecycle guards — no new `*-lifecycle.yaml` workflows. Persistent
entity lifecycle legality remains in `feature-lifecycle.yaml` and `task-lifecycle.yaml`. New
pipelines advance entity status only through `spur` CLI verbs, which run the lifecycle guards:

- `task-pipeline.yaml` transitions a task `wip → testing → done` via `spur task update <wbs> <status>`
  (without `--no-lifecycle`), so `task-lifecycle.yaml` guards run.
- `wrapup-pipeline.yaml` does NOT mutate task status — it consumes completed tasks. If it advances
  a feature, it does so via `spur feature update <id> <status>`, running `feature-lifecycle.yaml`
  guards.
- `idea-pipeline.yaml` creates features and tasks via `spur feature create` and
  `spur task batch-create`, which run the lifecycle creation guards.

A new pipeline that needs to mutate entity status must do so through the CLI verb, never by
writing the file directly. This is the seam between phase orchestration (pipelines) and entity
legality (lifecycle FSMs).

## Learning Log Convention

Working learnings are captured in `.spur/memory/learnings.md` — a markdown scratchpad, NOT a
CLI-gated corpus artifact. The `wrapup-pipeline.yaml` `learning-capture` step writes to it.

**Format:**

```markdown
## <YYYY-MM-DD> — Task <WBS>

- **Convention discovered:** <what the agent learned about the project>
- **Error hit and resolved:** <what went wrong, how it was fixed>
- **Pattern that worked:** <approach worth repeating>
- **Gotcha:** <what to watch for in future tasks>
```

**Rules:**

- **Not CLI-gated.** The file is written directly by the wrap-up pipeline's `learning-capture`
  agent.run step. It does not go through `spur task update` or `spur feature update`.
- **Not a validated corpus.** The file is a working scratchpad. High-value learnings are promoted
  to `docs/99_PROJECT_CONSTITUTION.md §8` (lessons) by the `doc-sync` step (via `sp:doc-evolve`),
  not by the learning-capture step itself.
- **Append-only within a session.** New entries are appended; existing entries are not rewritten.
- **Grouped by date and task.** Each entry has a date and task WBS header so the operator can
  trace a learning back to its source task.
- **Operator-readable.** Markdown, not JSON. The operator can read and grep this file directly
  without parsing.

## Session Checkpoint Convention

Long-running pipelines write resumable checkpoints to `.spur/memory/sessions/` so an interrupted
run can be resumed. The convention is documented here; the actual checkpoint write/read actions
in pipeline YAMLs are added in Phase 4 (task 0171).

**Format:** Markdown file with YAML frontmatter:

```yaml
---
session_id: "2026-07-01-0167"
workflow: "task-pipeline"
run_id: "wf_..."
task_wbs: "0167"
feature_id: "I"
phase: "verify"
last_gate: "review-approved"
timestamp: "2026-07-01T18:30:00Z"
next_action: "run verification"
---

## Session Notes

<free-form markdown: what was done, what's pending, any blockers>
```

**Write checkpoints after:**

- Every HITL gate decision (approved/rejected/deferred).
- Every phase transition in `planning-pipeline`, `task-pipeline`, `feature-dev`, `idea-pipeline`,
  and `wrapup-pipeline`.
- Every terminal state (`done`, `failed`, `cancelled`, `skipped`).

**Read checkpoints when:**

- `/sp:dev-run --continue` or `/sp:dev-runall --continue` is used.
- The operator asks to resume a task or feature.
- A workflow run is paused and later continued (`spur workflow continue <run-id>`).

**Rules:**

- **Not CLI-gated.** Checkpoint files are written directly by the pipeline's checkpoint action
  (a `shell` step that writes to `.spur/memory/sessions/<session-id>.md`). They do not go through
  `spur task update`.
- **Not a validated corpus.** Checkpoints are working memory. They are overwritten when a session
  resumes and re-checkpoints. They are NOT authoritative task state — the task file is.
- **One file per session.** The `session_id` is `<date>-<wbs-or-feature>`. A resumed session
  overwrites the same file.
- **Operator-readable.** The YAML frontmatter is machine-parseable; the body is free-form markdown
  for the operator to scan.

## Design Approval Gate

The Design Approval Gate is the taste gate between system design and decomposition in the
`idea-pipeline.yaml`. It is a HARD gate — no downstream state proceeds without design approval.

**Two layers:**

1. **Brainstorm design summary (always recorded).** The `discovery` state's `sp:brainstorm` dispatch
   always records a design summary in the brainstorm artifact. This is the "nothing is too simple"
   pattern (Phase 1, task 0168 R3) — even trivial ideas get a one-paragraph summary. The summary is
   the contract between ideation and execution.

2. **System design approval (taste gate, conditional).** When `system-design` runs (determined by
   the `needs_design` signal), the `design-approval` state pauses for the operator to approve the
   architecture. This is a taste gate, NOT an objective gate — `--auto` does NOT auto-approve it.

**Auto-mode behavior:**

- `--auto` routes around taste HITL states BEFORE entry only when the matching pre-clear vars are
  true. CLI **`--approve-taste`** (idea + plan) sets `design_approved=true` and, on the idea path,
  also `idea_approved=true`. Aliases: `--design-approved` / `--idea-approved` set one var each.
- Without explicit prior approval, `--auto` still pauses at idea-eval and design-approval — taste
  gates are not auto-clicked (Auto-Decision Principle #5).
- The brainstorm design summary is ALWAYS recorded, regardless of `--auto` — `--auto` does not
  bypass the "nothing is too simple" pattern.

**The `needs_design` signal routing:**

The signal is emitted by the `discovery` state's brainstorm dispatch and written to
`.spur/run/idea-needs-design.json`. The `feature-check` state's transition guards read it to
determine routing:

| `design` var | `needs_design` signal | Route |
|---|---|---|
| `skip` | (ignored) | `decompose` (skip system-design; brainstorm summary still recorded) |
| `auto` | `true` | `system-design` -> `design-approval` -> `decompose` |
| `auto` | `false` | `decompose` (skip system-design) |
| `auto` | (missing) | `system-design` (ties lean design) |

There is no `design=force` / `--design` path. See [brainstorm/SKILL.md](../../brainstorm/SKILL.md) §
"Design Approval Gate" for the brainstorm-side contract (6 patterns + `needs_design` criteria).
