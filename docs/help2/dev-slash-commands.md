# Slash Commands for Daily Development

The CLI verbs are the engine; the `sp` plugin's `/sp:dev-*` slash commands are the driver's seat.
Inside a coding-agent session with the plugin installed, a full day of work is a handful of slash
commands. Each one gates on the same Spur CLI verbs documented across this help — nothing here
runs a parallel process.

## The mental model

- **One router.** When in doubt, run `/sp:dev-next <wbs|feature-id>` — it inspects status, applies
  light gates, and dispatches exactly one next command (or stops with a reason).
- **Gates are CLI, not vibes.** Planning ends at `spur feature check`; decomposition ends at
  `spur task batch-create`; completion is a `PASS` verdict, not a claim.
- **Batches exist, but one task is fine.** Single-task commands have batch siblings (`runall`,
  `verifyall`, `wrapall`) that traverse tasks in dependency-correct order.

## The command map

| Command | Phase | What it does |
| --- | --- | --- |
| `/sp:dev-next` | Router | Status-aware router: pick and dispatch the single best next step (`--dry-run` previews) |
| `/sp:dev-idea` | Planning | Unified entry: vague idea → feature + acceptance criteria + task batch; stops at handoff |
| `/sp:dev-brainstorm` | Planning | Grilling interview → options with trade-offs → landed artifact (`--task` or `--feature`) |
| `/sp:dev-plan` | Planning | Feature → BDD acceptance criteria → check gate → decomposed task batch |
| `/sp:dev-refine` | Planning→Exec | Fill one task's acceptance criteria, design, and plan just-in-time via Q&A |
| `/sp:dev-run` | Execution | Run one task through its full pipeline; `--mode implement` for just the code step |
| `/sp:dev-runall` | Exec (batch) | Run a batch of tasks through their pipelines in dependency order (`--feature <id>`) |
| `/sp:dev-parallel` | Exec (batch) | Fan out independent tasks across parallel subagents; serialize on any conflict |
| `/sp:dev-unit` | Execution | Generate or extend tests until the unit target is met |
| `/sp:dev-review` | Execution | Multi-dimensional review of a task or a code path |
| `/sp:dev-verify` | Execution | Map requirements → evidence; emit a PASS/PARTIAL/FAIL verdict |
| `/sp:dev-verifyall` | Exec (batch) | Batch-verify tasks into one consolidated report |
| `/sp:dev-fixall` | Hygiene | Loop lint, typecheck, and tests until the working tree is clean |
| `/sp:dev-simplify` | Hygiene | Simplify recently changed code for clarity without changing behavior |
| `/sp:dev-debug` | Operations | Systematic debugging: reproduce → isolate → root cause → minimal fix → regression test |
| `/sp:dev-daily` | Operations | Daily summary report from agent usage data, git history, and notes |
| `/sp:dev-handover` | Operations | Write an honest handover doc when blocked instead of stalling silently |
| `/sp:dev-wrap` | Wrap-up | Wrap one completed task: learnings, metrics, doc-sync (`--merge` adds branch cleanup) |
| `/sp:dev-wrapall` | Wrap-up | Batch wrap-up; the only path that advances the feature lifecycle |
| `/sp:spur-init` | Bootstrap | Initialize a new Spur project, then customize for stack and scope |

## Two paths from idea to prototype

**Path A — the idea is a capability.** Interview once, decompose once, then drive the whole
feature:

```text
/sp:dev-brainstorm "Users can reset their password via email" --feature --next
# → feature + acceptance criteria (gated by spur feature check)
# → /sp:dev-plan decomposes (gated by spur task batch-create)
/sp:dev-runall --feature F7 --auto
```

**Path B — the idea is one deliverable.** Fast lane, no feature ceremony:

```text
/sp:dev-brainstorm "Fix the flaky retry in the uploader" --skip-discovery --task
/sp:dev-refine 0061 --auto --next      # refine → implement → verify → done, one chain
```

No shape at all? `/sp:dev-idea "<thought>"` picks the lane for you and stops at a handoff with
the feature id and task list.

## The `--next` chain

Most commands accept `--next`: on success they chain into the next best step via the router, so
`refine → run → verify → wrap` becomes one command with the gates still enforced. A non-PASS
verdict **stops the chain** with findings written into the task — there is no silent bad `done`.

## The autonomous path

```text
/sp:dev-run 0061 --auto        # full pipeline, HITL gates auto-confirmed
/sp:dev-runall --feature F7 --auto
/sp:dev-parallel --feature F7  # independent tasks fan out across subagents
```

`--auto` skips objective confirmations only. Irreversible gates (branch cleanup, merges) always
pause for a human.

## Wrap-up

```text
/sp:dev-wrap 0061 --auto           # learnings, metrics, doc-sync for one task
/sp:dev-wrapall --feature F7 --auto
```

Wrap-up consumes completed tasks and never mutates task status; the feature lifecycle advances
only through `wrapall`.

## Getting unstuck

```text
/sp:dev-handover "Blocked: the upstream rate-limiter has no test hook"
```

An honest handover document — goal, progress, blocker, rejected approaches, next steps — beats a
silent stall. Route back in later with `/sp:dev-next <wbs>`.

<!-- Provenance (invisible)
Generated: 2026-09-11 via the kk-itc-generating three-reference merge.
References: live spur CLI --help output (authoritative; snapshots: .spur/run/help2-spur-help-snapshots/) >
docs/help carry-over (accuracy; slash-command names/flags come from the sp plugin layer) >
DeepWiki TOC (structure signal only).
Verified: every spur command, verb, and flag named above matches the live snapshots.
-->
