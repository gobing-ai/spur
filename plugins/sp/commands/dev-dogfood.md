---
description: Dogfood an agent skill/command/CLI — drive it end-to-end with bounded auto-fix, self-monitor, and emit a comprehensive report
argument-hint: "<testee> [--max-retry <n>] [--save] [--task]"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "Grep", "Glob"]
---

# Dev Dogfood

Drive an agent skill, slash command, or CLI invocation **end-to-end** as a real user would,
fix what breaks along the way (within a bounded retry budget), monitor the whole run, and emit a
comprehensive report of what happened.

This is the codification of the manual dogfooding loop run across tasks `0109`–`0114`: execute the
testee, hit an issue, diagnose + fix it, retry, advance to the next step, and at the end write up
everything that was done, broke, was fixed, and should be improved.

> **Fat-file exception.** Unlike every other `sp:*` command (thin wrappers over a `Skill()`), this
> command carries its full protocol inline. This is a **sanctioned, temporary** exception to the
> "fat skill, thin others" principle so the protocol can be iterated in one file. Once stable, the
> core graduates to an `sp:dogfood` backbone skill and this file collapses to a thin wrapper.

## When to use

- Debugging or hardening an agent skill / slash command you are actively developing.
- Validating that a command works end-to-end before shipping it.
- Producing a structured findings report (and optionally a fix task) from a real run, instead of
  re-typing the same dogfood instructions every session.

> ⚠️ **Repo mutation warning.** By default (`--max-retry 2`), this command applies `Edit`/`Write`
> fixes directly to the working tree. **For a first run against any unfamiliar testee, always use
> `--max-retry 0` (observe-only)** — it monitors and reports without mutating the repo. Review the
> findings, then re-run with `--max-retry 2` (or higher) to apply fixes. This is the safe default for
> testing commands like `/sp:dev-run` that can modify files across the working tree.

## Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `testee` | What to exercise — a slash command, agent skill, or CLI invocation (positional, required). Quote it if it contains flags. | (required) |
| `--max-retry <n>` | Fix attempts per failed step. **`0` = observe-only**: monitor and report, never mutate the repo. Recommended for first runs against unfamiliar testees. | `2` |
| `--save` | Write the report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`. | off |
| `--task` | File the findings as a review-template task via `spur task create --template review`. | off |
| `--full` | Include **all** severity findings (P1–P4) in the report and `--task` output. Default filters to P1+P2 only — actionable items. | off |

`--save` and `--task` are independent and composable. The full report is written to disk only with `--save`, but a **mandatory summary footer** (result + issues + findings) is always printed inline — see §Mandatory Summary Footer.

## Behavior

A 4-phase protocol. Maintain a **live monitor ledger** throughout (phase 3) — record each step as it
happens, never reconstruct it at the end. Honest fixed-vs-unresolved accounting depends on this.

### Phase 1 — Plan

1. Resolve the testee. Classify it: slash command (`/sp:...`), agent skill (`Skill(...)`), or shell
   CLI invocation (`spur ...`, `bun run ...`).
2. Derive the **ordered steps** the testee is expected to walk through (from its own docstring /
   `argument-hint` / workflow). If a step list cannot be derived, treat the whole invocation as one
   step.
3. Open the monitor ledger (in working memory):

   ```
   | step | attempts | outcome | fix applied | finding | ~tokens | wall-clock |
   ```

### Phase 2 — Execute + bounded fix

For each step, in order:

1. **Run** the step as a user would.
2. On **success** → log the row, advance to the next step.
3. On **failure** →
   - If `--max-retry` is `0`: log the failure as an **Unresolved issue** with diagnosis, do **not**
     mutate the repo, and advance (observe-only mode).
   - Otherwise: diagnose root cause → apply the smallest fix (`Edit`/`Write`) → **re-run the same
     step**. Repeat up to `--max-retry` times.
   - If it passes within budget → log as a **Fixed issue** with the fix recorded. Advance.
   - If it still fails after `--max-retry` → log as an **Unresolved issue** with everything tried.
     Advance to the next step anyway (do not abort the run — partial signal is the point).

**Fix discipline:** fix the testee or its real dependency — never weaken the testee, stub the
failure away, or `--no-verify` past a gate just to make the step "pass". A fix that hides the bug
you are hunting is a finding, not a fix.

### Phase 3 — Monitor

The ledger is updated **live** in Phase 2. It is the single source of truth for the report — the
report is assembled from it, not from memory. Capture for every step: attempts, outcome, any fix
applied (file + one-line summary), findings surfaced, and the per-step cost estimate.

### Phase 4 — Report

Assemble the comprehensive report from the ledger. Required sections:

1. **Testee** — what was exercised, classification, exact invocation.
2. **Execution Summary** — overall result (PASS / PARTIAL / FAIL), **wall-clock time**,
   **~estimated token cost** (see note below — always labeled as an estimate), total steps,
   total fix attempts.
3. **What We Did** — the ordered narrative of steps walked and actions taken.
4. **Issues** — two groups:
   - **Fixed** — issue, root cause, and the fix applied (file + change).
   - **Unresolved** — issue, diagnosis, everything tried, why it still fails.
5. **Findings** — improvement opportunities (not run-blocking), each with **severity** (`P1`–`P4`)
   and **estimated effort** (e.g. S/M/L or hours). By default, only **P1 and P2** findings are
   listed (actionable items). Pass `--full` to include P3/P4 (observations, nice-to-haves).

> **Token cost is an estimate.** A slash command cannot read its own exact token meter. Derive a
> heuristic from tool-call count + transcript size + wall-clock and **label it `~estimate`**. Never
> print a precise token number you cannot substantiate.

### Mandatory Summary Footer

**After every run, always print this summary inline — regardless of `--save`:**

```
── Dogfood Summary ──
Result: PASS   (3 issues fixed, 0 unresolved, 2 findings)

Fixed issues:
  • ts-runtime: added signal?: AbortSignal to ProcessOptions
  • CLI: dedup now self-heals on next write
  ...

Unresolved issues:
  • (none)

Findings (P1+P2):
  • P2 — pipeline assumes standard/feature-impl variants
  • P2 — CLI has no --template option on spur task update
  ...
```

**Rules:**

- **Result line** is mandatory: `PASS / PARTIAL / FAIL` with counts `(N fixed, N unresolved, N findings)`.
- **Fixed issues** — list each if any; print `(none)` if empty.
- **Unresolved issues** — list each if any; print `(none)` if empty.
- **Findings** — list P1+P2 by default; with `--full`, include P3+P4. Print `(none)` if empty.
- **If nothing to report** (PASS, zero issues, zero findings): print a single line `Result: PASS — no issues, no findings.`
- **If `--save`**: append the report file path as the last line.
- **If `--task`**: append the created task WBS as the last line.
- Print the footer **after** any `--save` file write or `--task` creation — it's the last thing the user sees.

### Sinks

- **`--save`** → write the full report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`
  (create `docs/dogfood/` if absent). Path surfaced in the mandatory summary footer.
- **`--task`** → create a fix task from the findings. Task WBS surfaced in the mandatory summary footer.

  ```bash
  spur task create "<testee> dogfood findings" --template review --json
  ```

  Then write the **Issues (Unresolved)** and **Findings** into the task's `#### Review Findings`
  table — one row per item, `Severity` = `P1`/`P2`, with `File` / `Finding` / `Recommendation`
  filled. The `#### Review Findings` heading is a sub-section within `### Background`, so use
  `spur task update <wbs> --section "Background" --from-file <path>` with a body that starts with
  the `#### Review Findings` heading followed by the table. The resulting task feeds straight
  into `/sp:dev-run` for the fix pass.

## Implementation

No skill delegation yet (fat-file exception). Execute the four phases above directly.

**Arguments received:** `$ARGUMENTS`

Parse them per the Arguments table above:
- `testee` (positional, required): the skill / slash command / CLI invocation to exercise.
  Everything before the first dev-dogfood flag (`--max-retry`, `--save`, `--task`, `--full`)
  is the testee. If the testee itself contains flags (e.g. `/sp:dev-run 0110 --auto`), quote
  it so its flags are not mistaken for dev-dogfood's. Strip surrounding quotes after extracting.
- `--max-retry <n>` (default `2`): fix attempts per failed step. `0` = observe-only.
- `--save`: write the full report to `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md`.
- `--task`: file findings as a review-template task via `spur task create --template review`.
- `--full`: include all severity findings (P1–P4) in the report and task. Default: P1+P2 only.

The auto-fix loop is the deliberate reason this command holds `Edit`/`Write` in `allowed-tools`,
unlike the read-mostly `/sp:dev-verify` and `/sp:dev-review` wrappers — `--max-retry 0` is the
safe, non-mutating inspection path.

## Platform Notes

- **Claude Code:** native — argument substitution, `Skill()`, and the `Edit`/`Write`/`Bash` toolset
  work directly.
- **Other platforms:** argument substitution and `Skill()` are Claude-specific. Run the four-phase
  protocol manually and invoke the `spur` CLI directly for the `--task` sink.

## See Also

- **`/sp:dev-verify`** — requirements-traceability verdict for a coded task (PASS/PARTIAL/FAIL).
- **`/sp:dev-review`** — SECU code review of a task's diff.
- **`/sp:dev-run`** — runs a task (e.g. the one produced by `--task`) through the fix pipeline.
- `config/templates/task/review.md` — the template `--task` populates.
