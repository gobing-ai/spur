---
name: report-template
description: "The dogfood report section contract + mandatory summary footer + the --task sink L3 rule. The report is assembled from the live ledger and is designed to be actionable — a reader should be able to fine-tune the testee from the report alone."
see_also:
  - dogfood-testing
  - monitor-ledger
---

# Dogfood Report Template

The report is the deliverable. It is assembled from the live ledger (never reconstructed from
memory) and is designed so a reader can **fine-tune the testee from the report alone** — every
finding carries a location and a recommended action, not just an observation.

## Section contract

Emit these sections in order. Headings are fixed (machine-parseable); never rename or drop one.

### 1. Testee

```
## Dogfood Report — `<testee invocation>`

### 1. Testee

- **Command:** `<slash command or CLI invocation>`
- **Classification:** `slash command` | `agent skill` | `CLI invocation`
- **Exact invocation:** the underlying `Skill()` call or shell command
- **Testee agent:** `<value forwarded via --agent>` | `omitted (testee runs in current session)`
- **Mode:** `observe-only (--max-retry 0)` | `fix (--max-retry N)`
- **Task under test:** WBS + title (if applicable)
```

### 2. Execution Summary

```
### 2. Execution Summary

- **Result:** PASS / PARTIAL / FAIL  `(N fixed, N unresolved, N findings)`
- **Wall-clock:** ~N min  `[~estimate]`
- **~Token cost:** ~N total | ~N cached (~X% hit rate)  `[~estimate]`
- **Steps:** N derived, N executed, N N/A
- **Fix attempts:** N (one brief label per fix)
```

**Verdict rule** — `PASS` = every step ran and no unresolved issue; `PARTIAL` = ran to the end but
≥1 unresolved issue; `FAIL` = the run could not complete (a step blocked all downstream steps). A
finding alone never lowers the verdict — findings are improvements, not failures.

### 3. Monitor Ledger

The report MUST include the live ledger table before the narrative. Do not summarize the ledger away:
it is the audit trail for step outcomes, fix attempts, findings, and cache math.

```
### 3. Monitor Ledger

| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
|------|----------|---------|-------------|---------|--------------|---------------|---------|-------|------------|
| resolve | 1 | PASS | — | — | ~800 | ~300 | 27% | 1 command + reused task summary | ~3s |

**Cache calculation:** aggregate cache% = round((sum(Cached Tokens) / sum(Fresh Tokens + Cached Tokens)) * 100).
```

Ledger rules:

- Every executed step gets exactly one row, recorded when the step resolves.
- `Fresh Tokens` and `Cached Tokens` must be numbers with `~` prefixes; `Cache %` must be computed
  from those two cells, not guessed.
- `Basis` is mandatory. It names the observable inputs used for the estimate: command output,
  previously-read file reused from context, generated report text, or similar.
- The aggregate cache line in `### 2. Execution Summary` must equal the ledger formula above. If it
  does not, the report is invalid.
- If the driver cannot make a defensible estimate for a row, write `~0` cached and explain the
  missing basis in `Basis`; do not invent a stable percentage.

### 4. What We Did

Narrative, one numbered entry per logical action (a step, a fix, a gate check). Include `path:line`
references. Someone should understand the run without reading the ledger.

```
### 4. What We Did

1. **Action label** — what happened, what was observed, the decision made.
2. **Action label** — …
```

### 5. Issues

Always include both sub-headings, with `(none)` when empty — consistent structure matters for parsing.

```
### 5. Issues

#### Fixed

1. **Issue title** — description.
   - Root cause: why it happened.
   - Fix: `file:line` + one-line summary of the change.

#### Unresolved

- (none)  |  each with diagnosis + everything tried.
```

### 6. Findings

Findings are the **fine-tuning payload**. Each carries a severity, a `file:line`, and a concrete
**recommended action** — what to change, not just what's wrong. Default lists P1+P2; `--full` adds
P3+P4.

```
### 6. Findings

- **P1** — <what's wrong>. → **Action:** <concrete change>.  (`file:line`, ~effort)  `[feasible]`
- **P2** — …
```

Each finding MUST carry a **verification-feasibility tag** in brackets at the end of the line, so
downstream task creation does not inherit an unactionable acceptance criterion:

- `[feasible]` — the recommendation is verifiable (a test, a CLI check, an observable behavior).
  This is the default; most findings are feasible.
- `[stale]` — on re-check the finding no longer holds (the code already does the right thing, the
  condition was misread). Do **not** file as a task — close inline with evidence. Catching this at
  report time saves a no-op implementation task downstream.
- `[unverifiable]` — the recommendation cannot be confirmed with existing tooling (e.g. a
  cache-hit finding with no per-step telemetry; a perf claim with no measurement loop). If filed as
  a task, its acceptance criterion must be reframed to what *can* be verified (e.g. "ship the
  lever; measured proof deferred"), or the task should be deferred until the missing tooling exists.
  Do not let it become a normal implementation task — it will ship an unverifiable "improvement."

The tag is a prompt to whoever turns findings into tasks: `[stale]` → drop, `[unverifiable]` →
reframe or defer, `[feasible]` → proceed. A finding without a tag is treated as `[feasible]`.

Severity scale:
- **P1** — blocks correct use or causes drift/wrong output; fix before shipping the testee.
- **P2** — real friction or a latent correctness gap; fix soon.
- **P3** — efficiency / DX / observation (includes the cache-health rule below).
- **P4** — nice-to-have, cosmetic, or speculative.

**Cache-health rule** (from [monitor-ledger.md](monitor-ledger.md)): if aggregate cache% < 50% or any
step < 40%, emit a **P3** — "Low cache hit rate — candidate for context-window or prompt trimming"
with the offending step(s).

**Migration grep rule.** When dogfooding migrations or retired surfaces, distinguish intentional
legacy-term mentions in guidance from live routed surfaces. Pair any broad grep for old skill or
command names with a live-surface grep over the command and agent roots before filing a stale-routing
finding. A deliberate rejection note in a reference file is not a live surface.

## Mandatory Summary Footer

Print **after every run, inline, regardless of `--save`** — it is the last thing the user sees.

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

[Report: <path>]   ← only with --save
[Task: <wbs>]      ← only with --task
```

Rules:
- **Result** and **Tokens** lines are mandatory; always tag token numbers `[~estimate]`.
- List Fixed / Unresolved / Findings; print `(none)` when empty — never omit a sub-list.
- With `--full`, Findings include P3+P4.
- If PASS with zero issues and zero findings: collapse to one line `Result: PASS — no issues, no
  findings.` (still print the Tokens line).
- Print `--save` path and `--task` WBS **after** the write/creation, as the last lines.

## Task sink — the `task check` L3 contract

`--task` files findings as a `review`-template task:

```bash
spur task create "<testee> dogfood findings" --template review --json
```

Write the **Unresolved issues** and **Findings** into the task's `#### Review Findings` table — one
row per item: `Severity` (`P1`–`P4`), `File`, `Finding`, `Recommendation`. That heading is a
sub-section of `### Background`, so:

```bash
spur task update <wbs> --section "Background" --from-file <path>   # body starts with "#### Review Findings"
```

**Where the P-rows live, and how the L3 Review rule behaves.** The review template ships two tables:
`#### Review Findings` (under `### Background`) is the *input* you populate from the dogfood findings;
`### Review` is the *post-fix reflection* table, shipped as an **empty-cell scaffold**
(`| P1 | | | |`). `spur task check`'s L3 Review rule keys off `### Review`, not `#### Review Findings`:

- Write the dogfood findings into **`#### Review Findings`** (that is the `--task` sink target).
- Leave **`### Review`** as the shipped empty-cell scaffold. The hardened L3 rule tolerates the empty
  scaffold **wherever `### Review` is optional** (review variant: `backlog`/`todo` — the freshly
  created state) and only requires a *populated* P-table once `### Review` becomes **required**
  (`wip`+). So a freshly created `review` task at `backlog`/`todo` passes `task check` with the
  scaffold untouched — no hand-written P-row is needed, and a bare prose note in `### Review` is the
  thing that errors (it is neither the scaffold nor a populated table).

Always verify with `spur task check <wbs> --json` before handoff; the sink path below writes only
`#### Review Findings` and leaves `### Review` as the scaffold.
