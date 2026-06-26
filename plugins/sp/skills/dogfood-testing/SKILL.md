---
name: dogfood-testing
description: The backbone skill for dogfooding agent skills, slash commands, and CLI invocations — drive a testee end-to-end as a real user, fix what breaks within a bounded retry budget, monitor every step with a live ledger, and emit a structured report rich enough to fine-tune the testee. Backs the `/sp:dev-dogfood` command. Triggers on "dogfood this", "drive this command end-to-end", "test this skill as a user", "dogfood report", "exercise this command", or validating an agent skill/command/CLI before shipping.
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  interactions:
    - pipeline
    - reviewer
  modes:
    - observe
    - fix
  phases:
    - plan
    - execute
    - monitor
    - report
  openclaw:
    emoji: "🐕"
---

# Dogfood Testing — The Backbone Skill

`sp:dogfood-testing` drives an agent skill, slash command, or CLI invocation **end-to-end** as a
real user would: run the testee step by step, fix what breaks (within a bounded retry budget),
monitor the whole run with a live ledger, and emit a structured report of what happened, what broke,
what was fixed, and what should improve.

This is the codification of the manual dogfooding loop run across tasks `0109`–`0114` and `0124`.
It backs the `/sp:dev-dogfood` thin-wrapper command — the command parameterizes the testee and
sinks; this skill owns the protocol.

## The 4-phase protocol at a glance

```
testee (a /sp:... command, Skill(...), or shell CLI invocation)
  → PLAN     classify + derive ordered steps + open the live ledger
  → EXECUTE  run each step as a user; on failure, bounded diagnose→fix→re-run (or observe-only)
  → MONITOR  update the ledger live, per step — never reconstruct from memory at the end
  → REPORT   assemble the report from the ledger; print the mandatory summary footer
```

## Arguments

The command forwards these via `$ARGUMENTS`:

| Argument | Description | Default |
|----------|-------------|---------|
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--agent <name\|inherit\|auto>` | **Testee-scoped** agent: the agent the **testee** runs under, forwarded into the testee invocation. The driver (this skill) always runs in the current session. See [§Testee-scoped agent](#testee-scoped-agent). | inherit |
| `--max-retry <n>` | Fix attempts per failed step. **`0` = observe-only**: monitor and report, never mutate the repo. | `2` |
| `--save` | Write the report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`. | off |
| `--task` | File findings as a review-template task via `spur task create --template review`. | off |
| `--full` | Include all severity findings (P1–P4). Default: P1+P2 only. | off |

> ⚠️ **Repo-mutation warning.** Default (`--max-retry 2`) applies `Edit`/`Write` fixes to the working
> tree. **First run against any unfamiliar testee → use `--max-retry 0` (observe-only)** — monitor
> and report without mutating. Review findings, then re-run with `--max-retry 2` to apply fixes.

## Phase 1 — Plan

1. **Resolve + classify** the testee: slash command (`/sp:...`), agent skill (`Skill(...)`), or shell
   CLI (`spur ...`, `bun run ...`). Everything before the first dogfood flag is the testee; if it
   carries its own flags, it must be quoted.
2. **Derive ordered steps** from the testee's own docstring / `argument-hint` / workflow. If no step
   list can be derived, treat the whole invocation as one step.
3. **Open the live ledger** (working memory) — see [monitor-ledger.md](references/monitor-ledger.md)
   for the exact column contract.

## Phase 2 — Execute + bounded fix

For each step, in order:

1. **Run** the step as a user would — forwarding `--agent` into the testee invocation (§below).
2. **Success** → log the row, advance.
3. **Failure** →
   - `--max-retry 0` → log as an **Unresolved issue** with diagnosis, mutate nothing, advance.
   - else → diagnose root cause → apply the smallest `Edit`/`Write` fix → **re-run the same step**,
     up to `--max-retry` times. Pass within budget → **Fixed issue** (record the fix); still failing
     → **Unresolved issue** (record everything tried). Either way, advance — partial signal is the point.

**Fix discipline.** Fix the testee or its real dependency. Never weaken the testee, stub the failure
away, or `--no-verify` past a gate to make a step "pass". A fix that hides the bug you are hunting is
a **finding**, not a fix.

## Phase 3 — Monitor

The ledger is updated **live** in Phase 2 and is the single source of truth for the report — the
report is assembled from it, not from memory. Full methodology, column contract, token/cache
estimation, and the cache-health finding rule: **[monitor-ledger.md](references/monitor-ledger.md)**.

## Phase 4 — Report

Assemble the report from the ledger using the fixed template, then print the mandatory summary footer
(always, regardless of `--save`). Full section contract and the footer spec:
**[report-template.md](references/report-template.md)**.

**Sinks** (composable):
- `--save` → write the full report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`.
- `--task` → file findings as a review task (`spur task create --template review`), writing the
  **Findings** into the task's `#### Review Findings` table under `### Background`. See
  [report-template.md → Task sink](references/report-template.md) for the `task check` L3 contract.

## Testee-scoped agent

`dogfood-testing` is a **driver** that runs *other* testees, so `--agent` here is different from the
standard `/sp:dev-*` semantics: it sets the agent the **testee** runs under, **not** the driver.

- The **driver** (this skill — planning, monitoring, reporting) always runs in the **current
  session**. `--agent` never changes that.
- The **testee** invocation receives the forwarded `--agent`. Concretely: append/splice `--agent
  <value>` into the testee's own flags before running it.

```
/sp:dev-dogfood "/sp:dev-run 0125 --auto" --agent codex
        ↓ driver = current session (monitors, reports)
        ↓ testee runs as:  /sp:dev-run 0125 --auto --agent codex
```

If the testee does not accept `--agent` (e.g. a pure-inline command), record that as a **finding**
("testee ignores `--agent`") rather than forcing the flag. `inherit` (default) forwards nothing —
the testee runs under whatever it would default to.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run.

Do **not** use this skill for:
- Requirements-traceability verdicts — use `sp:code-verification` (`/sp:dev-verify`).
- SECU code review of a diff — use `sp:code-verification` (`/sp:dev-review`).
- Running a task through the fix pipeline — use `sp:spur-dev` (`/sp:dev-run`).

## Gotchas

1. **Observe-only first.** Against any unfamiliar testee, `--max-retry 0` — inspect before you let
   it mutate the working tree.
2. **The ledger is live, not reconstructed.** Honest fixed-vs-unresolved accounting depends on
   recording each step *as it happens*. Reconstructing at the end produces fiction.
3. **A hiding fix is a finding.** If "fixing" a step would mask the bug, log it as a finding and
   leave the step unresolved.
4. **Token numbers are estimates.** A skill cannot read its own exact token meter — label every
   number `~estimate`. The signal is the **trend** across runs, not the absolute per-run value.
5. **Testee-scoped `--agent`.** Don't confuse the driver agent (always current) with the testee
   agent (the forwarded value).
6. **Stale command snapshot.** Slash-command definitions are snapshotted at session start. If you
   just edited the testee command's own `.md` (or this command's), invoking it in the **same
   session** may run the **old** body. Verify in a fresh session, or invoke the backing skill
   directly, before trusting an in-session dogfood of a command you just changed.

## Additional Resources

- [references/report-template.md](references/report-template.md) — the report section contract +
  mandatory summary footer + task-sink L3 rule.
- [references/monitor-ledger.md](references/monitor-ledger.md) — the live-ledger column contract,
  token/cache estimation heuristic, and the cache-health finding rule.

## Platform Notes

### Claude Code

Native — `Skill()` delegation, argument substitution, and the `Edit`/`Write`/`Bash` toolset work
directly. The `/sp:dev-dogfood` command is the entry point.

### Codex / OpenClaw / OpenCode / Antigravity

Run the four-phase protocol via the Bash/CLI toolset; invoke this skill directly for the protocol
logic and the `spur` CLI for the `--task` sink. Parse `--json` where the testee supports it.

---

**Template type**: technique
**Purpose**: Drive a testee end-to-end, fix-within-budget, monitor with a live ledger, and emit a structured report rich enough to fine-tune the testee
