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
- **Testee agent:** `<value forwarded via --agent>` | `inherit (default)`
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

### 3. What We Did

Narrative, one numbered entry per logical action (a step, a fix, a gate check). Include `path:line`
references. Someone should understand the run without reading the ledger.

```
### 3. What We Did

1. **Action label** — what happened, what was observed, the decision made.
2. **Action label** — …
```

### 4. Issues

Always include both sub-headings, with `(none)` when empty — consistent structure matters for parsing.

```
### 4. Issues

#### Fixed

1. **Issue title** — description.
   - Root cause: why it happened.
   - Fix: `file:line` + one-line summary of the change.

#### Unresolved

- (none)  |  each with diagnosis + everything tried.
```

### 5. Findings

Findings are the **fine-tuning payload**. Each carries a severity, a `file:line`, and a concrete
**recommended action** — what to change, not just what's wrong. Default lists P1+P2; `--full` adds
P3+P4.

```
### 5. Findings

- **P1** — <what's wrong>. → **Action:** <concrete change>.  (`file:line`, ~effort)
- **P2** — …
```

Severity scale:
- **P1** — blocks correct use or causes drift/wrong output; fix before shipping the testee.
- **P2** — real friction or a latent correctness gap; fix soon.
- **P3** — efficiency / DX / observation (includes the cache-health rule below).
- **P4** — nice-to-have, cosmetic, or speculative.

**Cache-health rule** (from [monitor-ledger.md](monitor-ledger.md)): if aggregate cache% < 50% or any
step < 40%, emit a **P3** — "Low cache hit rate — candidate for context-window or prompt trimming"
with the offending step(s).

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

**Do not leave `### Review` non-placeholder without a P-column.** The review template ships two
tables: `#### Review Findings` (under `### Background`) is the *input*; `### Review` is the *post-fix
reflection*. `spur task check` fires a **hard L3 error** ("Review must contain P1–P4 priority findings
table") whenever `### Review` is present *and non-placeholder* but carries no `P1`–`P4` token. Safe
path: write **only** `#### Review Findings`; leave `### Review` as the scaffold (its placeholder
already contains `P1`/`P2`). Verify with `spur task check <wbs> --json` before handoff.
