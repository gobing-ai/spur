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
| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
```

| Column | Meaning |
|--------|---------|
| `Step` | The derived step label (Phase 1) or `N` for a single-step testee. |
| `Attempts` | How many times the step was run (1 = first-try; >1 = retried under the fix budget). |
| `Outcome` | `PASS` / `FIXED` / `UNRESOLVED` / `N/A`. (`FIXED` = failed then passed within budget.) |
| `Fix Applied` | `file:line` + one-line summary, or `—`. |
| `Finding` | One-line finding surfaced at this step, or `—`. A finding does **not** change `Outcome`. |
| `Fresh Tokens` | Estimated fresh context for the step. Prefix with `~`. |
| `Cached Tokens` | Estimated reused context for the step. Prefix with `~`. |
| `Cache %` | `Cached Tokens / (Fresh Tokens + Cached Tokens)`, rounded to the nearest whole percent. |
| `Basis` | Observable basis for the estimate: command output, prior file read reused, generated text, etc. |
| `Wall-clock` | Elapsed time for the step. |

## Token + cache estimation heuristic

A skill **cannot read its own exact token meter** — derive an estimate and label every number
`~estimate`. The accepted methodology is deterministic from the ledger rows:

1. Estimate **Fresh Tokens** from new material consumed or produced by the step:
   - text read from files or command output: `ceil(characters / 4)`, rounded to the nearest 100;
   - generated prose/code/report text: `ceil(characters / 4)`, rounded to the nearest 100;
   - short command/control overhead: add `~100` per tool invocation that produced non-empty output.
2. Estimate **Cached Tokens** only for material already present in the current session and actively
   reused by reference in this step. Use the same `ceil(characters / 4)` basis and round to the
   nearest 100. Do not count fresh command output, newly read files, or regenerated scaffolding as
   cached.
3. Compute each row: `Cache % = round(Cached Tokens / (Fresh Tokens + Cached Tokens) * 100)`.
4. Compute the report aggregate from row sums:
   `aggregate cache% = round(sum(Cached Tokens) / sum(Fresh Tokens + Cached Tokens) * 100)`.

The **trend across runs** is the signal, not the absolute value: rising cache% = the testee is
reusing context efficiently; falling cache% = context bloat creeping in.

> Never print a precise token number you cannot substantiate. The numbers exist to show a *trend*,
> not to bill anyone.

## Anti-fiction rule

Never reuse a convenient cache percentage such as `45%` because it "feels right." A cache percentage
is valid only when it can be recomputed from the ledger row sums. If the basis is missing, mark the
row pessimistically (`Cached Tokens = ~0`) and explain the missing basis.

## Cache-health finding rule

Cache% is the operational signal for testee-tuning:

- Any **individual step with cache% < 40%** → it is re-reading files or re-sending prompt context
  unnecessarily. Emit a **P3** finding naming that step, **even if the step succeeded**.
- A run with **aggregate cache% < 50%** → the testee is a tuning candidate regardless of the
  PASS/PARTIAL/FAIL verdict. Emit a **P3** finding: "Low cache hit rate — candidate for
  context-window or prompt trimming."

These feed the report's §6 Findings (see [report-template.md](report-template.md)).

## Cache-conservation discipline (how to keep cache% high)

The cache-health rule above *detects* waste; this section is the mitigation. The dogfooding driver
(the agent running Phase 2/3) controls most of the cache% it later reports — low cache% is usually
the driver re-fetching data it already holds. Apply these while monitoring each step:

1. **Reuse CLI output already in context.** If a prior step (or a prior tool call this step)
   captured `spur task show`/`check`/`list` output, do **not** re-invoke the same command for that
   data — reference the prior result. Re-invocation is the #1 cause of sub-40% steps. Only re-fetch
   when the underlying state *changed* (e.g. you just wrote a section and need the new
   `requiredSections`).
2. **Don't re-ground shared scaffolding per step.** Command docs, the skill preamble, and the
   testee's own argument-hint are loaded once into your context — they do not need to be re-read or
   re-quoted for each step. Re-sending unchanged preamble registers as fresh tokens, not cached.
3. **Prefer `--json` + targeted fields over full human output.** When you must fetch, ask for the
   smallest shape that answers the question (`--json` and read one field), not the full
   human-formatted dump.
4. **Estimate `~cached` honestly against this discipline.** If *you* re-read a file or re-sent
   scaffolding this step, that portion is **not** cached — mark cache% down. The estimate is only
   useful as a trend if it reflects what actually happened.

The point is not to game the number — it is to drive the testee (and your own monitoring) toward
reusing context, which is the real cost saving the cache% signal stands for.

## Worked ledger example

```
| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
|------|----------|---------|-------------|---------|--------------|---------------|---------|-------|------------|
| 1 resolve | 1 | PASS | — | — | ~600 | ~400 | 40% | task JSON output + prior command docs reused | ~3s |
| 2 analyze | 1 | PASS | — | over-specified for refine | ~1100 | ~700 | 39% | task file read + prior task summary reused | ~5s |
| 3 synthesize | 2 | FIXED | spur-dev/SKILL.md:88 thread --agent | — | ~1500 | ~600 | 29% | edit diff + prior plan reused | ~8s |
| 4 profile | 1 | PASS | — | — | ~500 | ~350 | 41% | command output + prior profile reused | ~2s |
```

Aggregate: total = `3700 + 2050 = 5750`; cached = `2050`; cache% =
`round(2050 / 5750 * 100) = 36%` `[~estimate]` — below the 50% floor, so emit the P3 cache-health
finding.
