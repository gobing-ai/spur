# How to Use the `sp:dev-*` Slash Commands for Daily Software Development

This guide shows how the `sp:dev-*` slash commands compose into one workflow that takes a **vague
idea** all the way to a **verified, working prototype** — without you hand-writing task files,
remembering which CLI verb gates what, or babysitting each step.

> **Audience.** You drive a coding agent (Claude Code, Codex, Gemini CLI, …) inside a Spur project.
> The `sp` plugin is installed and `spur` is on your PATH. If you are new to the underlying CLI,
> read [How to Use Spur for Daily Software Development](./how_to_use_spur_for_daily_software_development.md)
> first — this doc is the slash-command layer on top of it.

---

## The mental model

Spur splits development into a **planning half** (turn intent into validated, decomposed work) and an
**execution half** (turn a task into shipped, verified code). Every command delegates the *deterministic*
step to a `spur` CLI verb that **validates before it writes** — so an agent's bad output is rejected
with findings, never silently committed to your corpus.

```
  IDEA ──────────────── PLANNING HALF ─────────────────►  TASKS ──── EXECUTION HALF ────►  PROTOTYPE
 (vague)                                                (validated)                        (verified)

  /sp:dev-brainstorm ─→ /sp:dev-plan ─→ /sp:dev-refine ─→ /sp:dev-run ─→ /sp:dev-verify ─→ done
   (decision tree,        (feature →      (fill AC/        (implement     (BDD + SECU
    options, AC)           task batch)     Design/Plan)     + test         verdict)
                                                            + review)
```

Two artifacts gate the planning half: **`spur feature check`** (your acceptance criteria are valid
BDD) and **`spur task batch-create`** (your decomposition is well-formed). Two gates protect the
execution half: a **HITL approval** on the design and a **PASS/PARTIAL/FAIL verdict** before `done`.

---

## The command map

| Command | Phase | What it does | Backed by |
|---------|-------|--------------|-----------|
| `/sp:dev-brainstorm` | Plan | Grilling interview → options with trade-offs → land an artifact (`--task` or `--feature`) | `sp:brainstorm` |
| `/sp:dev-plan` | Plan | Feature → BDD AC → `feature check` gate → decompose → `batch-create` gate → optional design doc (`--design`/`--auto`) | `sp:spur-dev` (planning) |
| `/sp:dev-refine` | Plan→Exec | Fill a task's AC / Design / Plan just-in-time via Q&A | `sp:spur-dev` |
| `/sp:dev-run` | Exec | Run a task: full pipeline, or `--mode implement` for just the code | `sp:spur-dev` (execution) |
| `/sp:dev-unit` | Exec | Generate/extend tests; measure coverage | `sp:spur-dev` |
| `/sp:dev-review` | Exec | SECU code review (security/efficiency/correctness/usability) | `sp:code-verification` |
| `/sp:dev-verify` | Exec | Map requirements → evidence; emit a PASS/PARTIAL/FAIL verdict | `sp:code-verification` |
| `/sp:dev-fixall` | Exec | Loop a validation command until it passes (lint/type/test) | inline |
| `/sp:dev-gitmsg` | Exec | Draft a Conventional-Commits message from the diff | inline |
| `/sp:dev-changelog` | Exec | Generate a changelog from commit history | inline |
| `/sp:dev-handover` | Any | Write an honest handover doc when blocked | inline |
| `/sp:dev-dogfood` | Any | Drive a command/skill/CLI end-to-end, fix-within-budget, emit a structured report | `sp:dogfood-testing` |

> The single source of truth for every operation (purpose, inputs, behavior) is
> [`plugins/sp/skills/spur-dev/references/dev-operations.md`](../../plugins/sp/skills/spur-dev/references/dev-operations.md).

---

## Two paths from idea to prototype

Both paths start at the same command — `/sp:dev-brainstorm`. The only choice is **altitude**: is the
idea a *capability* (many tasks → `--feature`) or a *single deliverable* (one task → `--task`)?

### Path A — the feature-first path (an idea that is a *capability*)

Use this when the idea is a whole feature/epic: "users should be able to reset their password,"
"add audit logging across the app." It produces a feature with acceptance criteria, then **many**
tasks derived from it.

```bash
# 1. Idea → validated feature with BDD AC → decomposed task batch, in one command.
#    The grilling interview maps the decision space; --feature authors the AC and loops
#    `spur feature check` until valid; --next then auto-invokes /sp:dev-plan to decompose.
/sp:dev-brainstorm "Users can reset their password via email" --feature --next

# 2. Drive the WHOLE feature to done — every task, looped automatically.
#    feature-dev.yaml enumerates the feature's tasks (spur task list --feature) and runs
#    each through the task-pipeline, then strict-checks the feature before certifying done.
spur workflow run config/workflows/feature-dev.yaml --vars '{"featureId":"B3"}'
```

Prefer to drive tasks one at a time instead of the feature workflow? After step 1, run each task's
chain by hand: `/sp:dev-refine 0042 --auto --next` (fills the spec, then auto-chains
implement → verify → done).

> **One front door.** `dev-brainstorm` is the entry when you want the interview; `--feature --next`
> routes you through `dev-plan` automatically — you don't choose between them. Use `dev-plan`
> *directly* only when a feature already exists and just needs decomposition. `--feature` (capability)
> and `--task` (single deliverable) are **mutually exclusive** — pick by altitude, not by command.

### Path B — the fast lane (an idea that is *one deliverable*)

Use this when the idea is a single unit of work: "fix the flaky retry in the uploader," "add a
`--dry-run` flag to the import command." No feature ceremony — straight to a task.

```bash
# 1. Capture the idea as one task (skip the interview if it's already clear).
/sp:dev-brainstorm "Add --dry-run to the import command" --skip-discovery --task

# 2. Refine and execute in one chain.
/sp:dev-refine 0058 --auto --next
```

> **Note.** The old `/sp:dev-new-task` command was retired — `dev-brainstorm --skip-discovery --task`
> replaces it and seeds Background/Requirements/Plan from the brainstorm instead of an empty shell.

---

## The `--next` chain — one command, the whole loop

The execution commands chain through `--next`, so you typically type **one** command and the agent
walks the rest, stopping only at a real gate (a failed verdict, or a HITL approval you didn't skip):

```
/sp:dev-refine <wbs> --auto --next
        │  (task check passes)
        ▼
/sp:dev-run --mode implement <wbs> --next      ← writes code + the ## Solution change-map
        │  (implementation succeeds)
        ▼
/sp:dev-verify <wbs> --next                     ← maps requirements → evidence, SECU review
        │  (verdict = PASS)
        ▼
     done                                        ← testing → done transition
```

Any non-PASS verdict **stops the chain** and leaves the task at its current status with findings
written to `## Testing` / `## Review` — you fix and re-run, you never get a silent bad `done`.

---

## The autonomous path — let the pipeline drive

When you trust the loop, hand the whole task to the pipeline instead of chaining by hand:

```bash
# Full pipeline: precheck → implement → test → review → approve(HITL) → verify → record → done
/sp:dev-run 0042
```

This runs `config/workflows/task-pipeline.yaml`. It pauses at the HITL approval gate; approve and it
continues to a verified `done`. To run unattended (CI, batch), skip the human gate:

```bash
spur workflow run config/workflows/task-pipeline.yaml --vars '{"wbs":"0042","profile":"auto"}'
```

Three bundled workflows cover the altitudes:

| Workflow | Drives | Shape |
|----------|--------|-------|
| `task-pipeline.yaml` | one task | precheck → implement → test → review → approve → verify → record → done |
| `feature-dev.yaml` | a whole feature | brainstorm → plan → execute-tasks (loops every task through `task-pipeline`) → feature-verify → done |
| `planning-pipeline.yaml` | front-half only | phasing → feature-id → design-gen → design-approval → handoff |

`feature-dev.yaml` is the one to run when you want a feature taken from idea to verified completion
unattended: `spur workflow run config/workflows/feature-dev.yaml --vars '{"featureId":"B3"}'`.

---

## A worked example: idea → prototype in one sitting

> **Idea:** "I want a CLI flag that lets users preview an import without writing anything."

```bash
# Plan: it's one deliverable → fast lane.
/sp:dev-brainstorm "Add --dry-run to `spur history import` that previews without writing" --task
#   → grilling interview surfaces: where to short-circuit the write, how to report the preview,
#     what the JSON shape is. Lands task 0061 with seeded Background/Requirements/Plan.

# Execute the whole loop autonomously.
/sp:dev-refine 0061 --auto --next
#   → fills AC ("Given a populated source, When --dry-run, Then no rows are written and a
#     preview summary is printed"), Design, Plan
#   → /sp:dev-run --mode implement 0061 --next   (writes the code + ## Solution map)
#   → /sp:dev-verify 0061 --next                 (verdict PASS → done)

# Ship it.
/sp:dev-gitmsg --commit
```

Three commands. The interview did the thinking, the CLI gates kept the corpus honest, and the verdict
gate certified the prototype actually does what the AC said.

---

## Supporting commands (use as needed)

```bash
/sp:dev-unit 0042 --coverage 90      # generate/extend tests until coverage clears the bar
/sp:dev-review 0042 --focus security # standalone SECU review (security lens only)
/sp:dev-fixall "bun run check"       # loop lint+type+test until green
/sp:dev-handover "Blocked: the upstream rate-limiter has no test hook"  # honest handover when stuck
/sp:dev-changelog --version 0.3.0    # changelog from commit history
/sp:dev-dogfood "/sp:dev-run 0042 --auto" --max-retry 0 --save  # observe-only dogfood + report
```

---

## Two cross-cutting flags

**`--agent <name|auto>`** — pick which agent does the model work. Available on the
model-backed commands: `dev-refine`, `dev-plan`, `dev-brainstorm` (the AC/decomposition/ideation
synthesis), and `dev-run`, `dev-verify`, `dev-unit`, `dev-review` (the pipeline/verification steps).
Omit the flag and the default depends on the surface: **inline** commands (`dev-refine`/`dev-plan`/
`dev-brainstorm`/`dev-unit`) run the model step in the current session (no subprocess); **pipeline**
commands (`dev-run`/`dev-verify`/`dev-review`) forward nothing and the spawned step resolves to the
configured default executor (`omp`) — "current agent" is not expressible there. `auto` resolves the
current runtime to its canonical name; `<name>` (e.g. `codex`) is an explicit spawn.

> **Exception — `/sp:dev-dogfood --agent` is testee-scoped.** Because dogfood *drives* other commands,
> its `--agent` sets the agent the **testee** runs under (forwarded into the testee invocation), not
> the driver. The driver always runs in the current session.

**`--design` / `--auto` on `/sp:dev-plan`** — author a feature design satellite
(`docs/design/<slug>.md`) + its `04_DESIGN.md` index row. `--design` always authors; `--auto` lets the
agent decide via a cross-cutting-seam heuristic (new command/module/schema/transport); neither = no
design doc (the default). Idempotent — re-runs update in place.

---

## Guardrails — what keeps this safe

1. **Never skip a gate.** A clean `feature check` is the only proof your AC is valid; a passing
   `batch-create` is the only proof your decomposition is well-formed; a PASS verdict is the only
   proof the code matches the requirements. The commands won't let an agent route around them.
2. **The pipeline writes results, not you.** `## Testing` and `## Review` are filled by the verify
   step; `## Solution` by the implement step. Don't hand-edit them mid-run.
3. **Refine just-in-time.** Fill a task's Design/Plan *immediately before* executing it, not in bulk
   at decomposition — design written against a stale codebase rots.
4. **BDD is the default, not a flag.** Acceptance criteria are authored as Gherkin and validated by
   `spur feature check`. To skip AC for a genuine chore, pick a `meta`/`issue` task template — there
   is no "turn off BDD" switch, by design. (`--bdd` on `dev-verify` is the opposite: an opt-in to
   *also* map scenarios to tests during verification.)

---

## See also

- [How to Use Spur for Daily Software Development](./how_to_use_spur_for_daily_software_development.md) — the CLI layer beneath these commands
- [`spur task`](./cmd_task.md) · [`spur feature`](./cmd_feature.md) · [`spur workflow`](./cmd_workflow.md) — the verbs the commands gate on
- [`dev-operations.md`](../../plugins/sp/skills/spur-dev/references/dev-operations.md) — the authoritative per-operation reference
- [`ac-style-guide.md`](../../plugins/sp/skills/spur-dev/references/ac-style-guide.md) — BDD acceptance-criteria authoring conventions
