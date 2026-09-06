---
name: workflow-fit-and-tuning
description: Decide whether a process should be a spur workflow at all, tune an accepted one for latency and observability, keep its nodes inside the simplicity budget, and refactor across the boundary — promote a descriptive procedure into YAML, demote a YAML back to prose, or optimize one in place.
see_also:
  - spur-cli
  - operations
  - authoring-workflows
---

# Workflow Fit & Tuning

Three questions that sit **before and around** the mode gate:

1. **Fit** — should this be a `spur workflow` at all, or a descriptive procedure / checklist?
2. **Tuning** — given it is one, how is it configured for low latency and legible traces?
3. **Refactor** — how do you move a process across that boundary in either direction?

**Polaris:** get things done with high efficiency, low latency, and observability. A workflow that
does not beat prose on all three is prose with a YAML tax.

---

## 1. Fit gate — workflow or prose?

Run this **before** the [mode-selection gate](operations.md#sub-procedure-mode-selection-gate). The
mode gate answers *which kind of workflow*; it presumes an answer to *whether* — and that
presumption is the more expensive one to get wrong.

### What each side actually buys

| | `spur workflow` YAML | Descriptive procedure (skill reference, slash command, checklist) |
| --- | --- | --- |
| Buys you | Durable run record, resumable HITL pause, bounded retry loops, machine-readable terminal status, `trace`/`--follow`, `cancel`/`clean`, unattended `--async` | Judgment at every step, zero authoring ceremony, edits are one-line, no subprocess per step |
| Costs you | Authoring + `validate`/`dry-run` upkeep, one subprocess per action node, indirection an agent must read through, a definition that rots when the surface moves | Nothing is replayable, nothing is recorded, "what happened on that run" is unanswerable |
| Fails at | Steps whose outcome only a reader can judge | Anything that must run the same way twice, unattended |

### The three-part test

A process earns a workflow only when **all three** hold:

- **Replay** — it runs repeatedly, unattended, or across different operators.
- **Branch** — at least one step routes on a *machine-checkable* predicate (exit code, JSON field,
  file present), and the run may retry or gate on it.
- **Record** — someone will later need to answer "what happened on run X" from persisted evidence.

Three yes → author the workflow. Two → borderline: prefer prose plus one shell script, and revisit
when the run count justifies it. One or zero → **descriptive procedure**; say so and stop.

### Signals

| Signal in the described process | Read as |
| --- | --- |
| "Retry until the gate passes", "loop until clean" | workflow — bounded loop is the engine's job |
| "Pause for approval, continue later / in another session" | workflow — HITL resume needs a run record |
| "Every night", "for each task in the batch", unattended | workflow — replay + record |
| "Then check whether it looks right and decide" | prose — the predicate is judgment, not an exit code |
| "It depends what the diff says" | prose — the branch has no machine-checkable condition |
| Runs once, then the situation has changed | prose — a checklist, not a definition |
| One operator, in-session, watching each step | prose — the trace has no second reader |

### The two anti-patterns

- **Prose wearing YAML.** Every node is an `agent.run` with a raw prompt, edges are all
  unconditional. The engine adds a process spawn per node and contributes no branching, no gate, no
  retry. This is the ADR-069 R2 measure firing on *every* node — the advisory is telling you the
  whole file is misplaced, not that eight prompts need polish. Demote it.
- **YAML wearing prose.** A skill reference that says "then run the checks, and if they fail fix and
  re-run, up to three times" — a bounded retry loop written as a paragraph an agent re-interprets
  every session, with no record of how many attempts actually happened. Promote it.

### Hybrid is the usual answer

The boundary runs *through* most processes, not around them. Keep judgment in the skill or slash
command; put the deterministic gate loop in the workflow; let the workflow's judgment steps call the
command by name. That is the ADR-043 preference restated as an architecture: **the workflow selects
and orders capabilities, it does not contain them** (ADR-069).

---

## 2. Tuning — latency, efficiency, observability

### Cost model — know what you are spending

| Node / element | Real cost | Consequence for design |
| --- | --- | --- |
| `agent.run` action | A full agent session: seconds to minutes, plus tokens | **The dominant cost.** Count them; every one you remove is the largest single win available |
| `shell` action | One `sh -c` subprocess, milliseconds | Cheap individually — but each node is also a persisted transition round-trip |
| Guard (`kind: shell`) | One subprocess **per evaluation**, re-run on every loop iteration | A loop with a bound of 5 pays its guards 5 times |
| Loop `iterationBound` | Worst case = bound x per-iteration cost | It is a **latency ceiling**, not only a runaway safety net |
| HITL pause | Unbounded wall-clock (waits on a human) | Never put one inside a loop body |

### Latency checklist

- [ ] **Fewest `agent.run` nodes that still do the work.** Two adjacent judgment steps with no gate
      between them are one judgment step.
- [ ] **Soft status-file probe over repeated probing.** Run the expensive check once in an action
      that always exits 0 and writes its verdict to a run-scoped file; branch with ordered cheap
      guards that read that file. One subprocess instead of one per branch — the `basic.yaml` and
      `task-pipeline.yaml` quality-gate idiom.
- [ ] **Order guards cheapest-discriminating-first.** The first passing guard wins, so a `test -f`
      ahead of a `spur … --json` parse skips the expensive call on the common path.
- [ ] **No guard recomputes what a prior node already wrote to disk.**
- [ ] **`iterationBound` from the budget, not from optimism.** Set it to the observed maximum plus
      one; a bound of 10 on a 40-second gate is a seven-minute worst case nobody chose.
- [ ] **Fan out only genuinely independent branches** (`type: parallel`, transition-flow). Serial
      nodes with no data dependency are pure dead latency.
- [ ] **`--async` when the caller does not need the terminal state inline**, then follow with
      `spur workflow trace <run-id> --follow`.

### Observability is an authoring decision, not a run flag

The flags (`--detail`, `--verbose`, `--trace-file`, `--follow`, `--output`) are catalogued in
[../workflows.md](../workflows.md); they only expose what the definition already made legible.

- [ ] **Name states/nodes after the outcome they establish, not the tool they invoke.**
      `quality-gate-passed` reads at 3am; `run-script-2` does not.
- [ ] **`description` carries the WHY** of the workflow; a one-line comment carries the why of any
      non-obvious guard order or `iterationBound`.
- [ ] **Every gate writes a machine-readable verdict to a run-scoped file.** It is the guard's input
      *and* the post-mortem's evidence — one artifact, two consumers.
- [ ] **Declare `failureStates`** so a failed run reports `status: 'failed'` instead of finalizing as
      a `done` run that landed somewhere bad (the 0425 reader contract).
- [ ] **`env.allow` lists exactly what is used** — no more; an over-broad allowlist is an
      undocumented dependency.
- [ ] **While tuning:** `--detail full` plus `--trace-file`, and compare traces. **In production:**
      default detail, retained run log.

---

## 3. Node simplicity budget

Simplicity is the operating constraint, and it is already measurable — `spur workflow validate`
reports it. Do not invent a second threshold; author to the one that is frozen (ADR-069, task 0614).

| Element | Budget | What breaching it means |
| --- | --- | --- |
| `shell` action `command` | **<= 5** non-comment units (split on newline and `;`) | >= 6 flags the composition advisory: the program holds reusable behavior that wants an owner |
| `agent.run` action `input` | A **slash command or skill invocation** | A raw prose prompt flags: the operation belongs behind a centralized command (ADR-043). Prompt length sets severity only |
| Transition guard | **One** boolean predicate | Guards are exempt from the shell measure by design. A guard needing five lines is a probe node in disguise — make it one |
| Node count | Every node earns its transition round-trip | A node that always runs immediately after another, with no guard between them, is one node |

**When a node breaches the budget, do not reformat to dodge the measure.** Joining five lines with
`&&` moves the complexity, not the ownership. Pick one of the four remaining owners from
`docs/design/workflow-shell-ownership.md`: public `spur` verb (consent-gated), application service,
least-privilege built-in action kind, or workflow-relative external extension. (0775 retired the
recorded stays-shell exception along with the suppression snapshot.)

**Advisory posture is binding.** Composition findings never block a run, never change a `validate`
exit status, and are never a reason to hot-edit an executing pipeline. Surface them; fix on operator
acceptance.

---

## 4. Refactor — moving across the boundary

Three named directions. All three end in the shared
[validate-and-dry-run core](operations.md#sub-procedure-validate-and-dry-run) when a YAML definition
survives the change.

### promote — descriptive procedure → workflow

Use only when the [fit gate](#the-three-part-test) clears all three parts. Steps:

1. **Split the prose into spine and judgment.** The spine is every step whose outcome is
   machine-checkable. Everything else stays judgment and does *not* become a node's inline prompt.
2. **Name the terminals** — the success terminal, and every failure terminal that deserves its own
   name. Declare them in `failureStates`.
3. **Run the [mode-selection gate](operations.md#sub-procedure-mode-selection-gate)** — the spine's
   shape decides it: retry loop → state-machine; forward pipeline → transition-flow.
4. **Author one node per spine step.** Each judgment step becomes an `agent.run` whose `input`
   *references the existing slash command or skill* — never a copy of the prose. If no such command
   exists, create it first; a promotion that inlines prompts has produced anti-pattern one.
5. **Verify** with validate-and-dry-run against the expected terminal.
6. **Rewrite the descriptive doc as the entry point** — it now explains the WHY and delegates to
   `spur workflow run`, rather than restating the steps. Two copies of the procedure is the drift
   the promotion was supposed to end.

### demote — workflow → descriptive procedure

Triggers (any two are sufficient; the first alone is sufficient):

- Every node is an `agent.run` with a raw prompt and every edge is unconditional.
- The definition has been edited more often than it has been run.
- The graph is a straight line — no guard, no gate, no loop.
- The run count over its lifetime is in the single digits and not growing.
- Its `iterationBound` has never been reached because nothing ever loops.

Steps:

1. **Check for live dependents** — `spur workflow trace --workflow <name> --last 20 --json` for
   recent runs, and grep the shipped surfaces for the filename. A definition another command invokes
   is not demoted unilaterally.
2. **Return each node's work to its owner** — judgment nodes to the command or skill they should
   have been calling; a genuinely useful shell sequence to one script under its owning surface.
3. **Rewrite the entry surface as the procedure**, in the order the graph ran.
4. **Delete the YAML** in the same change. (0775 retired the composition-baseline entries that
   used to be deleted alongside it; the live definition is the only artifact left.)
5. **Record the demotion** and its trigger, so the next author does not re-promote it by reflex.

### optimize — refine an accepted workflow in place

A [refine](operations.md#refine) whose `--intent` is latency or legibility rather than correctness.
Dimensions, highest leverage first:

1. **Remove or merge `agent.run` nodes** — the dominant cost, always the first pass.
2. **Collapse probe-then-branch into a soft status-file probe** with ordered guards.
3. **Reorder guards** cheapest-discriminating-first.
4. **Lower `iterationBound`** to the observed maximum plus one.
5. **Merge nodes that always run together** with no guard between them.
6. **Move any `>= 6`-unit shell program to a recorded owner** (never by reformatting).
7. **Rename states/nodes to outcomes** and add the missing `failureStates`.

**Measure, do not estimate.** Capture `spur workflow trace <run-id> --json` before and after and
compare wall-clock per state and the transition sequence. An optimization with no trace pair behind
it is a preference. Rules that still bind: the smallest change that meets the intent, no mode
switch inside a refine (that is a rewrite — hand it to `add`), and never edit a workflow that is
currently executing.

---

## Checklist

- [ ] Fit gate run **before** the mode gate; the prose-vs-workflow verdict stated with its reason.
- [ ] All three of replay / branch / record hold, or the answer was a descriptive procedure.
- [ ] Judgment steps reference an existing command; none inline a raw prompt.
- [ ] `agent.run` node count is the minimum the branching requires.
- [ ] `iterationBound` chosen from a latency budget; guards ordered cheapest-first.
- [ ] States/nodes named for outcomes; `failureStates` declared; gates write a verdict file.
- [ ] Every `shell` action within the <= 5-unit budget, or carrying a recorded owner/disposition.
- [ ] Refactors verified through validate-and-dry-run; optimizations backed by a before/after trace.
