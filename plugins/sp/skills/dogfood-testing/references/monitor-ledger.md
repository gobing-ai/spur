---
name: monitor-ledger
description: "The dogfood monitor methodology + live ledger column contract + token/cache estimation heuristic + the cache-health finding rule. The ledger is the single source of truth the report is assembled from — recorded live, per step, never reconstructed."
see_also:
  - dogfood-testing
  - report-template
---

# Monitor + Ledger

The ledger is the **single source of truth** for the report. It is recorded **live** — one row per
step, written the moment the step resolves — never reconstructed from memory at the end.
Reconstruction produces fiction: it cannot honestly distinguish a step that passed first-try from
one that took three attempts, and it loses the per-step signal that drives testee refinement.

## The live-ledger rule

1. **Open the ledger in Phase 1**, before the first step runs.
2. **Write a row the instant a step resolves** (pass, fixed, unresolved, or N/A) — not after the run.
3. **The report reads the ledger, not your memory.** Every number in the report traces to a ledger
   row. If it is not in the ledger, it does not go in the report.

## Column contract

```
| step | attempts | outcome | fix applied | finding | ~tokens | ~cached | cache% | wall-clock |
```

| Column | Meaning |
|--------|---------|
| `step` | The derived step label (Phase 1) or `N` for a single-step testee. |
| `attempts` | How many times the step was run (1 = first-try; >1 = retried under the fix budget). |
| `outcome` | `PASS` / `FIXED` / `UNRESOLVED` / `N/A`. (`FIXED` = failed then passed within budget.) |
| `fix applied` | `file:line` + one-line summary, or `—`. |
| `finding` | One-line finding surfaced at this step, or `—`. A finding does **not** change `outcome`. |
| `~tokens` | Estimated total tokens for the step (tool calls + I/O). Label the aggregate `~estimate`. |
| `~cached` | Estimated tokens served from context cache (re-reads, unchanged prompt context). |
| `cache%` | `~cached / ~tokens` as a percentage. |
| `wall-clock` | Elapsed time for the step. |

## Token + cache estimation heuristic

A skill **cannot read its own exact token meter** — derive an estimate and label every number
`~estimate`. The accepted heuristic:

- **`~tokens`** ≈ a function of tool-call count + transcript size for the step (more/larger tool
  I/O → more tokens). Round to the nearest few hundred; precision is false confidence.
- **`~cached`** ≈ the portion of that context that was unchanged from a prior step (re-read of a file
  already read this session, repeated prompt scaffolding). Fresh reads and new output are *not* cached.
- **`cache%`** = `~cached / ~tokens`. The **trend across runs** is the signal, not the absolute value:
  rising cache% = the testee is reusing context efficiently (getting leaner); falling cache% = context
  bloat creeping in.

> Never print a precise token number you cannot substantiate. The numbers exist to show a *trend*,
> not to bill anyone.

## Cache-health finding rule

Cache% is the operational signal for testee-tuning:

- Any **individual step with cache% < 40%** → it is re-reading files or re-sending prompt context
  unnecessarily. Emit a **P3** finding naming that step, **even if the step succeeded**.
- A run with **aggregate cache% < 50%** → the testee is a tuning candidate regardless of the
  PASS/PARTIAL/FAIL verdict. Emit a **P3** finding: "Low cache hit rate — candidate for
  context-window or prompt trimming."

These feed the report's §5 Findings (see [report-template.md](report-template.md)).

## Worked ledger example

```
| step | attempts | outcome | fix applied | finding | ~tokens | ~cached | cache% | wall-clock |
|------|----------|---------|-------------|---------|---------|---------|--------|-----------|
| 1 resolve | 1 | PASS | — | — | ~600 | ~400 | ~67% | ~3s |
| 2 analyze | 1 | PASS | — | over-specified for refine | ~1100 | ~700 | ~64% | ~5s |
| 3 synthesize | 2 | FIXED | spur-dev/SKILL.md:88 thread --agent | — | ~1500 | ~600 | ~40% | ~8s |
| 4 profile | 1 | PASS | — | — | ~500 | ~350 | ~70% | ~2s |
```

Aggregate: ~3,700 ~tokens | ~2,050 ~cached (~55% hit rate) `[~estimate]` — above the 50% floor, no
cache-health finding. Step 3 sits exactly at 40% — a borderline P3 candidate worth a note.
