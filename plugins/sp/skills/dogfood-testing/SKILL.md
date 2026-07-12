---
name: dogfood-testing
description: "Drive a testee (skill/command/CLI) end-to-end as a real user, fix within a bounded retry budget, monitor with a live ledger, emit a structured report. Triggers: \"dogfood this\", \"drive this command end-to-end\", \"test this skill as a user\", \"dogfood report\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.1"
  protocol: "sp:dogfood-testing@1.1"
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
  → PLAN     classify + derive steps + open dual artifacts (live + docs/dogfood) with status:running
  → EXECUTE  run each step as a user; on failure, bounded diagnose→fix→re-run (or observe-only)
  → MONITOR  dual-write ledger row to disk on every step resolve — never reconstruct from memory
  → REPORT   finalize-or-abort (non-skippable): status complete|aborted, Cost block, both paths, footer
```

## Arguments

The command forwards these via `$ARGUMENTS`:

| Argument | Description | Default |
|----------|-------------|---------|
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--agent <name\|auto>` | **Testee-scoped** agent: the agent the **testee** runs under, forwarded into the testee invocation. The driver (this skill) always runs in the current session. **Omit it** to forward nothing — the testee runs under its own default. See [§Testee-scoped agent](#testee-scoped-agent). | (omitted → forward nothing) |
| `--max-retry <n>` | Fix attempts per failed step. The **default is `2`** (fix mode): apply `Edit`/`Write` fixes to the working tree, up to 2 attempts per step. For pipeline-driving testees, this flag is mandatory: pass `--max-retry 0` for **observe-only**, or `--max-retry N` to acknowledge fix-mode mutation risk. | `2` unless the testee is pipeline-driving |
| `--save` | **Back-compat no-op for delivery.** Reports are always written to `docs/dogfood/…` and `.spur/run/dogfood/<run_id>.md`. The flag still documents/prints the report path. | always-on (flag optional) |
| `--task` | File findings as a review-template task via `spur task create --template review`. | off |
| `--full` | Include all severity findings (P1–P4). Default: P1+P2 only. | off |

> ⚠️ **Repo-mutation warning.** The default is **fix mode (`--max-retry 2`)** — it applies
> `Edit`/`Write` fixes to the working tree as it finds breakages. For a non-mutating run, opt into
> **observe-only** with `--max-retry 0`: monitor and report, never touch files, full findings report
> still produced. When the testee is pipeline-driving (`--next`, `run`, `runall`, `wrap`, or
> `idea`), omission is ambiguous and MUST fail before planning with:
> `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`.
> Explicit `--max-retry 0` and explicit `--max-retry N` both proceed.

## Phase 1 — Plan

0. **Refuse ambiguous pipeline-driving testees.** Before deriving steps, inspect the raw `testee`
   string. If it contains any of `--next`, ` run`, ` runall`, ` wrap`, or ` idea` and the dogfood
   invocation did not explicitly pass `--max-retry`, exit non-zero with exactly:
   `⚠ pipeline-driving testee detected; pass --max-retry 0 (observe-only) or --max-retry N (fix mode, tree mutation acknowledged)`.
   Do not auto-substitute `--max-retry 0`: the driver retry budget does not constrain the testee's
   own pipeline chain, which may still mutate through its own tools.
1. **Resolve + classify** the testee: slash command (`/sp:...`), agent skill (`Skill(...)`), or shell
   CLI (`spur ...`, `bun run ...`). Everything before the first dogfood flag is the testee; if it
   carries its own flags, it must be quoted.
2. **Derive ordered steps** from the testee's own docstring / `argument-hint` / workflow. If no step
   list can be derived, treat the whole invocation as one step.
3. **Open dual artifacts (always-on delivery — not gated on `--save`).**
   - Generate `run_id` (uuid or timestamp-slug).
   - `mkdir -p .spur/run/dogfood docs/dogfood`.
   - Write **both** files with identical YAML frontmatter (`status: running`, testee, mode,
     timestamps, paths, `protocol: sp:dogfood-testing@1.1`) + six section heading stubs + empty
     Monitor Ledger table:
     - Live: `.spur/run/dogfood/<run_id>.md`
     - Report: `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`
   - Canonical frontmatter and skeleton: [report-template.md](references/report-template.md).
   - Column contract + dual-write: [monitor-ledger.md](references/monitor-ledger.md).

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

The ledger is updated **live on disk** during Phase 2 and is the single source of truth for the
report — the report is assembled from the files, not from memory.

On **every** step resolve:

1. Append/update the ledger row on the **live** file first.
2. Mirror the same row to the **report** path under `docs/dogfood/`.
3. Do **not** batch rows until Phase 4.

The final report MUST include a `### 3. Monitor Ledger` section containing those rows. Full
methodology, column contract, token/cache estimation, multi-source Cost honesty, the cache-health
finding rule, and the **cache-conservation discipline** live in
**[monitor-ledger.md](references/monitor-ledger.md)**. Apply the conservation discipline while
monitoring — low cache% is usually the driver re-fetching data it already holds.

## Phase 4 — Report (finalize-or-abort — non-skippable)

**Terminal gate.** Before this skill may stop (PASS / PARTIAL / FAIL / observe-only end / abort /
any early exit), the driver MUST run the finalize-or-abort checklist. Skipping it is a **driver
contract violation**.

1. Set frontmatter `status: complete` or `status: aborted` and `finished_at`.
2. Ensure all six mandatory section headings exist. Unfinished narrative sections:
   `⚠ incomplete — not reached` — never invent What-We-Did / Issues / Findings fiction.
3. Write the **Cost** block under §2 (ledger `~estimate` + Method + confidence; `Meter: n/a` or
   optional ccusage/agent usage when real).
4. Sync final content to **both** live and report paths (always — not gated on `--save`).
5. Print the mandatory summary footer with **both** `[Live: …]` and `[Report: …]` always.

Full section contract, frontmatter, Cost shape, and footer:
**[report-template.md](references/report-template.md)**.

**Sinks** (composable):
- **Always-on report files** → live + `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` (see Phase 1).
- `--save` → no-op for delivery; still print/document the report path (back-compat).
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
("testee ignores `--agent`") rather than forcing the flag. **Omitting `--agent` (the default)
forwards nothing** — the testee runs under whatever it would default to (which, for a `spur agent
run`-backed testee, is `--agent auto` → the configured default executor). There is no `inherit` or
`current` token: "run under the current agent" is simply the default for an inline slash command
(it executes in this session) and is **not** expressible for the spawned `spur agent run` path,
which always launches a fresh agent subprocess.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run.

Do **not** use this skill for:
- Requirements-traceability verdicts — use `sp:code-verification` (`/sp:dev-verify`).
- SECU code review of a diff — use `sp:code-verification` (`/sp:dev-review`).
- Running a task through the fix pipeline — use `sp:spur-dev` (`/sp:dev-run`).

## Gotchas

1. **Observe-only for unfamiliar testees.** The default is fix mode (`--max-retry 2`), which mutates
   the working tree. Against any testee you don't own or fully trust — or one that drives a long,
   mutating pipeline — pass `--max-retry 0` first and inspect the findings before letting it apply
   fixes.
2. **The ledger is live on disk, not reconstructed.** Honest fixed-vs-unresolved accounting depends
   on dual-writing each step *as it happens* to both artifacts. Reconstructing at the end produces
   fiction. Working-memory-only ledgers are a contract violation.
3. **A hiding fix is a finding.** If "fixing" a step would mask the bug, log it as a finding and
   leave the step unresolved.
4. **Token numbers are estimates, but cache math is not free-form.** A skill cannot read its own
   exact token meter, so label numbers `~estimate` and put Method + confidence in the Cost block;
   however, cache% must be recomputable from Monitor Ledger row sums. Never invent or reuse a fixed
   percentage. Optional meters (`ccusage`, agent usage) are session/day scope — never fake per-step.
5. **Testee-scoped `--agent`.** Don't confuse the driver agent (always current) with the testee
   agent (the forwarded value).
6. **Stale command snapshot.** Slash-command definitions are snapshotted at session start. If you
   just edited the testee command's own `.md` (or this command's), invoking it in the **same
   session** may run the **old** body. Verify in a fresh session, or invoke the backing skill
   directly, before trusting an in-session dogfood of a command you just changed. Note same-session
   edits under §1 Testee when relevant.
7. **Finalize-or-abort is non-skippable.** Ending a run without updating `status`, syncing both
   paths, and printing the footer with `[Live:]` + `[Report:]` fails the delivery contract — even if
   the testee itself passed.
8. **`--save` is not required for a file.** Dual artifacts are always-on. Do not skip writing
   `docs/dogfood/` because the operator omitted `--save`.

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

A session on these platforms never sees `Skill()` reference-file expansion, so the report contract
is restated here **verbatim** rather than by pointer — do not fall back to a looser ad hoc report
shape just because `report-template.md` wasn't auto-loaded.

**Always-on dual artifacts (not gated on `--save`).** Every run MUST open and maintain:

- Live: `.spur/run/dogfood/<run_id>.md`
- Report: `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`

Both start with YAML frontmatter including `status: running | aborted | complete`, `run_id`,
`protocol: sp:dogfood-testing@1.1`, and paths. Dual-write a ledger row to both files on every step
resolve. On stop, set `status` to `complete` or `aborted` (finalize-or-abort — non-skippable).

**The six mandatory section headings** (in order, each report MUST contain all six):

1. `### 1. Testee` (include **Repro:** line)
2. `### 2. Execution Summary` (include `#### Cost` with Method, confidence, Meter)
3. `### 3. Monitor Ledger`
4. `### 4. What We Did`
5. `### 5. Issues`
6. `### 6. Findings`

Unfinished narrative sections after abort: `⚠ incomplete — not reached` (never invent).

**The ledger requirement.** `### 3. Monitor Ledger` MUST contain the live per-step ledger table
populated on disk during Phase 2/3 as steps run, never reconstructed from memory at the end.

**Cost honesty.** Ledger totals are `~estimate` with Method + confidence LOW unless a real meter
(`ccusage` day/session, agent usage fields) is also present (then MEDIUM). If no meter:
`Meter: n/a`. Never invent billed precision.

**The footer requirement.** Every report MUST end by printing this exact block (verdict is strictly
`PASS` / `PARTIAL` / `FAIL`, grading the testee, not the surrounding task):

```
── Dogfood Summary ──
Result: PASS   (N fixed, N unresolved, N findings)
Tokens: ~N total  |  ~N cached (~X% hit rate)  [~estimate]

Fixed issues:
  • <label>   (or: (none))

Unresolved issues:
  • <label>   (or: (none))

Findings (P1+P2):
  • P? — <label>   (or: (none))

[Live: .spur/run/dogfood/<run_id>.md]
[Report: docs/dogfood/YYYY-MM-DD-<slug>-dogfood.md]
[Task: <wbs>]      ← only with --task
```

A report missing any of the six headings, the on-disk live ledger, dual paths, terminal `status`,
the Cost block, or this footer does not satisfy the dogfood contract on this platform, regardless
of `Skill()` availability.
