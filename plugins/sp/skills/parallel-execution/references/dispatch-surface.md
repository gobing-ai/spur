---
name: dispatch-surface
description: "Decision rule for choosing the native subagent versus `spur agent run` when dispatching work to another agent. Trigger-keyed, not preference-stated."
see_also:
  - parallel-execution
  - fan-out-patterns
  - result-synthesis
---

# Dispatch Surface: Native Subagent vs `spur agent run`

This is the SSOT for **which execution surface carries a dispatch** to another agent. It owns
*one axis only* - in-session native subagent versus out-of-process `spur agent run`. It does not
own which model tier runs the work; that is ADR-033's `model_policy` (see [Composition with
ADR-033](#composition-with-adr-033)).

The `parallel-execution` skill already owns the dispatch *disciplines* (file-handoffs over pasted
context, per-role model selection, durable ledgers, never pre-judge the reviewer). Choosing the
surface a dispatch travels over is the same competency, so the rule lives here alongside them.

## The default

**Use the native subagent when the host platform provides one.**

Native subagents (Claude Code `Skill()`/`Task`, Codex, OpenCode, etc.) are cheaper to spawn, share
the session's tooling and working directory, and compose with the orchestrating agent's context.
On a platform that provides them, `spur agent run` is the exception, not the default.

## Escalation triggers to `spur agent run`

Escalate off the native subagent **only** when one of these observable conditions holds. Each is
checkable without operator judgment - if you cannot point to concrete evidence of one, stay on the
native subagent.

| # | Trigger | What it means | Example evidence |
| --- | --------- | --------------- | ------------------ |
| 1 | **Different model or coding agent required** | The step needs a model or a coding agent the host session cannot provide (`--model`, `--agent`). | "verify on o3" where the host is Claude Code; "run this through omp" from a non-omp host. |
| 2 | **Headless or unattended step** | The step must run without a live session - scheduled, detached, or driven by a non-interactive caller. | A batch launched by `spur workflow run --async` with no operator attached. |
| 3 | **Durable auditable run record required** | The dispatch must produce a persisted run record (cost ledger, trace, exit code) for after-the-fact audit. | `spur agent run` writes `.spur/run/` artifacts; a native subagent does not. |
| 4 | **Workspace or credential isolation required** | The step must run in a separate workspace, worktree, or credential scope from the orchestrating session. | A destructive step isolated to a throwaway worktree; a step that must not inherit the session's `cwd` secrets. |

## The naming requirement

**When you escalate to `spur agent run`, name which trigger applied - in the dispatch, in the
report, or in the batch ledger.** "Used `spur agent run` because trigger 3 (durable auditable
record)" is a complete statement; "used `spur agent run`" is not.

This is what makes the choice auditable after the fact. A blanket "prefer subagents when possible"
is unfalsifiable - an agent can rationalize either surface under it, which is how
`parallel-execution/SKILL.md` drifted to telling Claude Code to fan out through `spur agent run`
on the one platform that ships native subagents. Naming one of four checkable conditions makes a
wrong choice visible in the transcript.

## Composition with ADR-033

[ADR-033](../../../../../docs/00_ADR.md) owns **model-tier selection** through the stage registry's
`model_policy` (`min_tier` + ordered `fallback` chain, keyed on the canonical `stage_id`). This
reference owns **execution-surface selection**. The two axes are orthogonal and vary independently:

- A `cheap`-floor step (e.g. the `scribe` role) can run in-session on a native subagent.
- A capable-band step (a role at or above `reviewer`, per [`roles.md`](../../../references/roles.md)) can run headless through `spur agent run`.

Do not fold surface choice into `model_policy` - that would couple two axes that vary independently
and put prompt-layer routing policy into a domain-layer registry. This reference decides *which
surface carries the work*; ADR-033 decides *which tier runs on it*. Read both; apply each to its
own axis.

## The sandbox reliability tax on `spur agent run`

`spur agent run` runs the target agent as an external process. Under a sandboxed Bash session it
can fail outright when the external agent writes its own storage outside the sandbox's allowlist.

**Reproduced during H6 intake:**

```text
$ spur agent run "..." --agent omp
SQLiteError: attempt to write a readonly database (SQLITE_READONLY)
  at .../pi-coding-agent/dist/cli.js:2825
```

The cause: omp writes its `AgentStorage` SQLite DB under `$HOME/node_modules/`, a path the
sandboxed Bash session holds read-only. The same failure took down the idea-pipeline's `discovery`
step (exit code 3, ~1.5s) - the step never reached the agent's logic; it died on storage init.

This is **not** a reason to abandon `spur agent run` - triggers 1-4 still justify it. It is a
reason to (a) prefer the native subagent when no trigger applies, and (b) when a trigger does
apply, ensure the run executes in a context that can write the target agent's storage (a
non-sandboxed shell, or a workspace that owns the storage path). The upstream fix lives in
pi-coding-agent's storage-path resolution; it is out of scope here and recorded as motivating
evidence only.

## Composition with the inline pipeline driver (task 0508)

The interactive inline driver (`cross-cutting.md` § Inline-default execution surface) applies this
reference's default — native subagent first — to sequential `task-pipeline.yaml` `agent.run`
stages. Eligibility there is the same observable test (pure-slash action, non-interactive state,
native subagent with shared-worktree capability); the inline driver remains the authority for
provenance, artifact validation, and no-replay guarantees. This reference stays the authority for
the native-subagent versus `spur agent run` choice everywhere else.

## Role propagation across fan-out (task 0551, feature I4)

When a run dispatches subagents, the **effective role** each subagent resolves through follows one
rule: **a declared role wins; absent a declaration, the subagent inherits the dispatcher's.**
Propagation is recorded, never implied: the resolution envelope carries `roleOrigin:
'declared' | 'inherited'` per dispatched subagent (R3), so a wrong inheritance is observable
without reading the dispatcher's source. The role travels on the existing `--agent` selector —
no new flag (feature I4 § Notes).

Mechanism: `AgentService` stamps the dispatcher's resolved role into every spawned subprocess
environment as `SPUR_ROLE` (`RolePropagatingProcessExecutor`,
`packages/app/src/services/agent-service.ts`). A child `spur agent run` reads it at resolution;
a subagent that declares its own role (role selector, workflow `role:` step, explicit
`--agent <role>`) resolves through that role's tier and records `roleOrigin: 'declared'`; one
that declares nothing and carries no explicit `--stage` resolves through the inherited role's
tier and records `roleOrigin: 'inherited'` (an explicit `--stage` routes through stage policy
before the inherited branch — direct CLI only, the workflow action exposes no stage option).
Nested fan-out applies the rule recursively by construction — a grandchild reads
its parent's `SPUR_ROLE`, which the parent already set. An unknown inherited role (stale env)
warns once and falls through to `agent.default`/priority — inheritance never hard-fails a
dispatch (task 0536 R3 precedent).

**Dispatch-path inventory (R4)** — every path that shells out to `spur agent run` applies the
rule at the source, so no per-path shim is needed:

| Path | Where it dispatches | Rule coverage |
| --- | --- | --- |
| `spur agent run` (CLI) | `AgentService.run` → resolution → child process | Declared wins; absent inherits via `SPUR_ROLE`; envelope carries `roleOrigin` |
| Workflow `agent.run` step | `AgentRunActionRunner` → `AgentService.runTraced` | Step `role:` is **mandatory** (0538 R2, `agent-run.ts` fails a role-less step before dispatch) — always a declaration (`roleOrigin: 'declared'`); inheritance applies at the next fan-out boundary the step's subagent itself dispatches |
| `spur agent loop` | `AgentService.run` per drained iteration | Same resolution path as `spur agent run`; inherits its own `SPUR_ROLE` |
| `spur team` supervisor → member | spawns `spur agent loop` | Member inherits the supervisor's `SPUR_ROLE` (recursive by construction) |
| Native subagent fan-out (this skill's default) | in-session `Task()`/`Skill()` | In-session subagents share the host session; when they themselves dispatch, the host's role is already in the session env — the rule holds at the next `spur agent run` boundary |
| `plugins/sp/evals/run-eval.ts` | `spawnSync('spur agent run', …)` per scenario | Out of scope: a top-level eval harness, not a fan-out — no dispatcher role exists to inherit; each scenario is an independent top-level run (documented, no shim) |

The inventory is recorded in `docs/04_DESIGN.md` § `spur agent run` envelope (`roleOrigin`).
Paths that shell out to `spur agent run` without the rule would silently drop or double-attribute
a role; this table is the check that none do.

## See also

- **`parallel-execution`** SKILL.md - the dispatch disciplines this rule sits beside.
- **[fan-out-patterns.md](fan-out-patterns.md)** - the four fan-out shapes; surface choice is
  orthogonal to pattern choice.
- **[result-synthesis.md](result-synthesis.md)** - merging parallel outputs; applies regardless of
  which surface carried each dispatch.
- **ADR-033** - model-tier routing via the stage registry; this rule composes with it, never
  duplicates it.
