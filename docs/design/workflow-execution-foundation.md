---
kind: design
title: "Workflow execution foundation — one interpreter and executor-agnostic agent.run dispatch"
status: proposed
created_at: 2026-10-17
updated_at: 2026-10-17
related: [D65, A92, "1231", "1232", "1233", "1234", "1235", "1236", "1237", "1238", "1239", "1240", "1241", "1242"]
tags: [contract, workflow, execution, design, D65]
---

# Workflow execution foundation — one interpreter and executor-agnostic agent.run dispatch

**Area:** the engine/dispatch boundary: who interprets workflow YAML, how an `agent.run` stage
reaches its executor, what a completed stage leaves behind as evidence, and which leases serialize
expensive work. Non-UI surface contract (CLI verbs, action kinds, receipt schema, lease rules).
**Status:** proposed. This satellite is the single owner of the contracts feature D65 implements;
tasks 1232–1242 cite it instead of restating mechanics. Text marked *current* describes the tree as
of 2026-10-17; text marked *proposed* is the target state those tasks land.
**Authority:** derived; [ADR-140](../../docs/00_ADR.md) (one workflow interpreter, Proposed) is the
decision of record, with the [ADR-051](../../docs/00_ADR.md) 2026-10-17 noun-verb amendment
(public command shape), ADR-126 A4 (fleet receipt semantics), ADR-127 (per-task worktree
isolation), ADR-134 (decision catalog), ADR-139/feature A92 (`spur self exec` action map) and
ADR-118 (named contract violations). On conflict `00_ADR.md` wins (constitution §4.1).

---

## 1. Issue and scope

Two interpreters execute the same workflow YAML: the engine (`spur workflow run` /
`spur workflow continue`) and the host-session inline driver
([inline-pipeline-driver](../../plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md)),
which re-implements guards, transitions and deterministic actions by hand. Measured over 32 run
summaries (2550 min), driver overhead was 815 min (32%) and the test-fix loop (~450 min) exceeded
implement (356 min); the slow runs spent ~230k input tokens per driver turn re-executing engine
mechanics (ADR-140 Why). The proof chain built to audit that duplicate reached `verifiedOutcome` on
4 of 274 tasks in 30 days.

In scope: the work-item/dispatch contract for every executor, the receipt shape, the builtin
catalogue for deterministic steps, operator gates as decision points, engine-owned leases, engine
traces and gate time in run summaries, and the coexistence window while workflows migrate.
Out of scope: `task-lifecycle.yaml` and `feature-lifecycle.yaml` (post-commit reactions),
grandfathered nested CLI groups (ADR-051 amendment), and fleet-only workflow catalogues (ADR-126).

## 2. Context and constraints

- **Current dispatch.** `agent.run` resolves an executor inside
  `AgentRunActionRunner` and, for fleet, at
  [agent-run.ts:687](../../packages/app/src/workflow/actions/agent-run.ts) (`context.vars.executor === 'fleet'`),
  falling back to the traditional subprocess path with a recorded `executorFallback` reason. Host
  execution exists only as the inline driver — outside the engine.
- **Current pause machinery.** `hitl.input` pauses a run and resumes it through
  `spur workflow continue --answer-text`
  ([continue.ts:68](../../apps/cli/src/commands/workflow/continue.ts)); the resume is claimed with a
  CAS on run status, so a second `continue` on a non-paused run is refused rather than re-executing.
  A host executor is the same pause with a structured payload, not a new run state.
- **Current deterministic steps.** `command.gate`
  ([command-gate.ts](../../packages/app/src/workflow/actions/command-gate.ts)) already runs an
  executable with a declared artifact check; `task-pipeline.yaml` uses it for the wip and record
  transitions ([task-pipeline.yaml:344](../../config/workflows/task-pipeline.yaml),
  [:924](../../config/workflows/task-pipeline.yaml)). `spur self exec <action>` (A92/ADR-139)
  resolves this repo's project commands from builder config.
- **Current gates.** `hitl.confirm` / `hitl.input` carry an optional `decision:` block
  (`DecisionMode = 'legacy' | 'never' | 'evidence'`,
  [decision-hitl-responder.ts:18](../../packages/app/src/workflow/decision-hitl-responder.ts));
  bundled pipelines ship `mode: never` so the inline driver always prompts.
- **Current observability gap.** Gate time renders from the run's check receipt
  ([run-summary-render.ts:198](../../packages/app/src/workflow/run-summary-render.ts)), but the
  stage table still hardcodes `gate: { ms: null, reason: 'no matching check receipt' }`
  ([run-summary.ts:598](../../packages/app/src/workflow/run-summary.ts)).
- **Constraints.** No new run state machine, no new workflow catalogue per executor (ADR-126), no
  new public nested command group (ADR-051 amendment), workflow YAML never names a surface, and
  gates read only deterministic evidence (ADR-138, invariant).

## 3. Solution

**One interpreter (proposed).** The engine evaluates every guard, transition and deterministic
action for every surface. A host session does not interpret YAML; it runs a three-move loop —
`run` → perform the returned work item → `continue`. The inline driver becomes a thin transport for
that loop and, once every shipped workflow is migrated, is deleted with the rest of the inline
bookkeeping surface (task 1242).

### 3.1 Work item and dispatch

`agent.run` builds a **work item** and hands it to the resolved executor. The item is a value, not a
convention: the same shape carries the host pause payload, the subprocess invocation and the fleet
inbox message, so a stage that passes the self-contained lint (§4.4) runs unchanged on any of them.

Executor resolution order (proposed), all inside `AgentRunActionRunner` beside the existing fleet
branch:

| `vars.executor` | Executor | Completion evidence |
| --- | --- | --- |
| `host` | run pauses; the work item is the pause payload | work-item receipt written by the host, consumed by `spur workflow continue` |
| `fleet` | ADR-126 inbox message + `coordination_runs` row | fleet receipt linked to the inbox message |
| `subprocess` / absent | `spur agent run` child process | subprocess receipt from the child's terminal state |

`host` is a **var**, not a flag: `--agent inline` and omission (ADR-087) keep resolving to the host
surface exactly as they do today, and headless callers keep the ADR-087 tier substitution. Adding a
public flag would be an ADR-051 consent item; this contract deliberately does not need one.

### 3.2 Host pause and resume

An `agent.run` resolved to `host` suspends the run with the engine's existing pause primitive and
returns the work item in `spur workflow run|continue --json`. The run is `paused` with
`pause: { kind: 'input', workItem }`. The host performs the work — natively, or through its native
subagent per the ADR-047 0508 amendment — writes the receipt, and calls
`spur workflow continue <run-id> --answer-text <receipt-path>`. The CAS claim makes that resume
idempotent: repeating the call with the same receipt changes nothing and is refused as
not-paused, which is the observable idempotency R1 of D65 asserts.

### 3.3 Builtins

The engine register stays one table
([builtins.ts](../../packages/app/src/workflow/builtins.ts)). Deterministic steps are typed builtins
that call existing services rather than new verbs:

| Builtin | Wraps | Replaces |
| --- | --- | --- |
| `command.gate` | `spur task gate`, `spur task update`, `spur self exec <action>`, `spur workflow commit-guard` | ad-hoc shell steps for those verbs |
| decision (`decide`) | the `spur decision` catalog (ADR-134) | inline judge prompts on routing |

**No new action kinds.** Task 1234 settled the open question in favour of reuse: `command.gate`
already executes without a shell, types its outcome, retries, and writes a `resultFile`, so a
separate `gate` kind would duplicate it and a separate `corpus.transition` kind would duplicate
`spur task update`. Corpus transitions therefore run as `command.gate` over the lifecycle verb, and
the graph still refuses an illegal hop through that verb's own exit code.

**Typed outcomes.** `command.gate` maps exit status to `PASS` (0), `FAIL` (1) and `BLOCKED`
(anything else — usage error, signal, timeout), writes the token to its `resultFile`, and puts
`{status, exitCode, attempts, stdout, stderr, resultFile}` in `data`, which is persisted in
`action_runs.result_json` so the outcome is visible in the trace.

**Tree-hash receipt.** The gate keys a PASS receipt by the git tree it computes itself
(`captureGateGitTree`: `git read-tree HEAD` → `git add -A` excluding the task/feature corpus →
`git write-tree` on a throwaway index). Reuse requires PASS, full tier, the same tree and the same
WBS; a caller-supplied digest no longer exists on either the action or the verb, so a corpus edit
cannot silently invalidate a code PASS and a code edit cannot ride one.

A further kind would be an ADR-051 consent item.

### 3.4 Operator gates as decision points

Gates are decision points: interactively the operator responder answers, under `profile=auto` the
configured maker answers with the catalog fallback when the maker degrades, and the trace records
the answer with its source (`operator` / `maker` / `catalog-fallback`). Gate mode per profile:

| Profile | `hitl.*` gate mode | Answering surface |
| --- | --- | --- |
| interactive (`standard`) | `never` — always prompt | operator responder |
| `auto` | `evidence` / catalog mode | configured decision maker, catalog default on degrade |

The inline driver never auto-answers; `mode: evidence` inside an inline-driven workflow is a
declared non-goal until that workflow migrates.

### 3.5 Leases

Expensive or exclusive work is serialized by the engine, not by driver prose:

| Lease | Scope | Holder / stale rule |
| --- | --- | --- |
| Full gate | **host-wide**, not per tree — task 1127 measured 43 of 64 gates overlapping across sessions *and* worktrees on one host | holder = `{runId, pid, worktree}`; released on terminal/cancel; stale when the pid is dead, then taken over with a `stale-takeover` trace line |
| Per-task worktree | one task run, ADR-127 | owner is the run; retained on failure (WT-5 semantics) |
| Fleet occupancy | one fleet member, ADR-126 | member-pinned wait; occupancy released by the member's receipt |

A run that cannot take the gate lease either waits (bounded) or stops naming the holder; it never
runs a gate beside another holder.

### 3.6 Observability

Every executed action emits an engine action trace carrying the run id, under every executor
(`action_runs` today). Run summaries read gate time from **this run's** check receipt
(`gateFromReceipt`, [run-summary-render.ts:198](../../packages/app/src/workflow/run-summary-render.ts))
and stop hardcoding `null` at [run-summary.ts:598](../../packages/app/src/workflow/run-summary.ts).
The proof-digest columns go away with the chain (ADR-140 item 7).

### 3.7 Coexistence window

Migrated workflows run on the engine; unmigrated ones keep the inline driver. The driver's parity
check survives only while the window is open; task 1242 deletes `spur workflow inline *`, the parity
script, its contract test and the ADR-071 proof machinery after `idea-pipeline`, `wrapup-pipeline`
and `pr-review` migrate (task 1241).

## 4. Contract and compatibility

### 4.1 Work item

```jsonc
{
  "runId": "<workflow run id>",
  "state": "<state or node id>",
  "skill": "<skill to load, or null>",
  "prompt": "<fully materialized stage prompt>",
  "inputs": [{ "path": "<repo-relative path>", "kind": "task|feature|artifact|var" }],
  "expectFiles": ["<repo-relative path the stage must write>"],
  "ownedSections": ["Solution", "Testing", "Review"]
}
```

Invariants: `runId` is the engine's own id (never re-derived by the executor); `prompt` plus
`inputs` are sufficient for a fresh session (§4.4); `expectFiles` and `ownedSections` are disjoint
write claims — a stage that owns a task section does not also list that task file in
`expectFiles`.

### 4.2 Receipt

One shape for all three executors:

```jsonc
{
  "runId": "<workflow run id>",
  "state": "<state or node id>",
  "executor": "host|subprocess|fleet",
  "outcome": "done|failed|not-started|outcome-unknown|contract-violation",
  "startedAt": "<iso-8601>",
  "finishedAt": "<iso-8601>|null",
  "files": ["<repo-relative paths actually written>"],
  "reason": "<human-readable terminal reason|null>",
  "contract": "<named contract id, only for contract-violation>"
}
```

ADR-126 A4 rules bind all three executors:

- a wait timeout is `outcome-unknown`, **never** failure;
- re-dispatch happens only on a definite `failed` or `not-started` outcome;
- a `contract-violation` outcome (ADR-118) is terminal for that action and reports `contract` plus
  the observed shape;
- the receipt is durable: the run's evidence is the receipt, not the executor's stdout.

### 4.3 Host pause payload

`spur workflow run|continue --json` on a host-resolved `agent.run` returns
`{ runId, status: "paused", pause: { kind: "input", workItem } }`. `spur workflow continue <run-id>
--answer-text <receipt-path>` accepts exactly one work-item receipt for the paused state:

- first call → run advances, receipt persisted, trace records `executor: host`;
- repeat call with the same receipt → refused as not-paused, no state change (idempotent);
- unknown/mismatched `runId` or `state` → refused, run stays paused.

### 4.4 Self-contained stage lint

`spur workflow validate` runs `collectSelfContainedStageViolations` beside
`collectHitlDecisionViolations`
([composition-lint.ts:345](../../packages/app/src/workflow/composition-lint.ts)):

1. every `agent.run` declares `expectFile(s)` **or** `ownedSections` — or the `requireDiff` guard,
   which is the same observable completion for a stage whose product is the diff (task 1233 landed
   all three); a stage with none of them has no observable completion;
2. every `.spur/run/` path the stage prompt names is either produced by an earlier state's action
   (a static scan of predecessor shell / `command.gate` args and `expectFile(s)`) or declared in
   the stage's own `inputs` — an undeclared artifact is a finding naming the stage and the path.
   Templated paths (`${vars.x}`) normalize to one template and match only the same template, never
   a wildcard. Repository-relative inputs are NOT scanned yet: a pure-over-definition collector
   cannot tell an existing versioned file from a missing one, so those declarations land with the
   task-pipeline and idea/wrapup migrations;
3. no stage reads host conversation state: a prompt depending on "the previous stage said …" is a
   finding, because the work item is all a fresh session receives.

Findings are **validation errors**, not a `--strict`-only tier: the task contract requires a
violating workflow to exit nonzero from plain `spur workflow validate`, and adding a severity flag
would be a new public surface. A shipped workflow that legitimately cannot pass yet carries a
reviewed allowance in `SELF_CONTAINED_STAGE_ALLOWANCES` — keyed `<workflow name>::<state id>` with
its exact normalized paths and the task that removes it. The list is an editor-reviewed exception
set, not a generated snapshot: adding a stage or a path still fails.

### 4.5 Gate decision modes

Declared per `hitl.*` gate via the existing `decision:` option; the profile table in §3.4 is the
mapping. A workflow that declares `mode: never` prompts the operator under every profile — the
inline default. `--auto` at the command layer maps to `profile=auto` and therefore to the maker
path, and each command's `--auto` gate table remains the user-facing promise.

### 4.6 Leases

Acquire/release around the builtin, never around the whole run: the gate lease covers one gate
visit, the worktree lease one task run, the fleet occupancy one dispatch. Holder identity is
`{runId, pid, worktree}`. A stale holder (dead pid) is taken over with a trace line recording both
ids; a live holder is waited on with a bound, then the waiter stops naming the holder.

**Full-gate lock (landed, task 1235).** One claim per host, stored as a `mkdir` + `wx` marker under
`$SPUR_GATE_LOCK_DIR` (default `~/.config/spur/run/full-gate.lock` — outside every tree, so sibling
checkouts and worktrees share it). The marker holds `{pid, startedAt, wbs, runId, cwd}`.

| Env | Meaning |
| --- | --- |
| `SPUR_GATE_LOCK=off` | disable the lock entirely |
| `SPUR_GATE_LOCK_DIR` | claim directory; the test preload points every in-process run at a per-process dir |
| `SPUR_GATE_LOCK_POLL_MS` | wait poll interval (default 5000); the waiter **sleeps** between polls — a hot loop starves the gate it waits for |
| `SPUR_GATE_LOCK_TIMEOUT_MS` | bound on the wait (default 2 h, `0` = unbounded); expiry exits 2 (BLOCKED, never a gate verdict) naming the holder |
| `SPUR_GATE_LOCK_TOKEN` | re-entry: accepted only when it equals the **current** holder's marker; a stale or foreign token waits like any stranger |

Locked tiers: `run` and `recheck` — recheck re-executes the same full command, so leaving it
outside re-admits the contention the lock exists to serialize (task 1127 R4, ADR-140 item 6).
Lockless: `light`, `deferred`, `status`, and the short circuits (receipt reuse, no-progress skip,
recheck probe). Release runs in a `finally`, so failure and throw release too; a cancelled process
leaves a dead-pid claim the next gate reclaims. An unclaimed non-empty directory is reported, never
destroyed.

### 4.7 CLI surface changes

Every item is an existing verb, or a flat `spur <noun> <verb>` needing operator consent:

| Surface | Change | Consent |
| --- | --- | --- |
| `spur workflow run`, `spur workflow continue` | return/consume the work item and its receipt in `--json`; `--answer-text` unchanged | existing verbs, additive payload |
| `spur workflow validate` | self-contained-stage lint findings (§4.4) | existing verb |
| `spur workflow commit-guard start\|check\|stage` | grandfathered nested group (ADR-051 amendment); unchanged in D65, used as a builtin | none |
| `spur task gate <wbs> <mode>`, `spur task update`, `spur task record` | unchanged; invoked by builtins | none |
| `spur self exec <action>` | unchanged; the project-command builtin path (A92/ADR-139) | none |
| `spur decision run\|show\|list\|status` | unchanged; gate answering reads the catalog | none |
| `spur workflow inline *` | **removed** after migration (task 1242) | removal flagged here; it is the ADR-140 consequence |
| new verb, if any | must be a flat `spur <noun> <verb>` and is a new consent request | required |

No D65 task adds a nested command group; the six grandfathered groups in the ADR-051 amendment are
the closed list (D65 R15).

### 4.8 Compatibility and migration

- Unmigrated workflows keep working through the inline driver during the window; their stage
  contracts are unchanged.
- `agent.run` gains an executor dimension; YAML does not change shape, so a definition valid before
  migration stays valid after the self-contained lint (modulo findings it should have had).
- The gate receipt is keyed by git tree hash: a PASS receipt is reused while the tree hash is
  unchanged and invalidated when it moves (D65 R11). The proof-digest artifacts are retired; old
  artifacts are not read.
- Task-corpus evidence (verdict artifacts, `.spur/run/<wbs>-*.json`) keeps its filenames so
  `spur task record` and run summaries keep resolving prior runs.

## 5. Tradeoffs and open questions

- **Chosen:** one interpreter plus a value-work-item dispatch. Cost: engine work concentrates in
  `packages/app/src/workflow`, and a host-executor bug stalls every surface at once. Benefit: the
  32% driver overhead has exactly one place to be removed, and fleet support stops being a parallel
  catalogue.
- **Rejected:** hardening inline/engine parity (the parity checking was itself the overhead);
  running every stage as a subprocess (loses host context and the operator's native subagent);
  a fleet-only workflow catalogue (ADR-126).
- **Open:** whether `command.gate` covers the corpus transition cleanly or a `corpus.transition`
  builtin is needed (task 1234 decides; a new kind is an ADR-051 consent item). Whether the host
  executor needs a public opt-out flag once `--agent inline` maps to it (deferred: no flag is added
  until an operator asks, ADR-140 item 2).
- **Risk:** the host pause makes a run long-lived; a crashed host leaves a `paused` run whose
  staleness classification (`spur workflow continue` staleness threshold) must not be mistaken for
  an abandoned run.
