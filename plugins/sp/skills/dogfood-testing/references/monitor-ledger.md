---
name: monitor-ledger
description: "The dogfood monitor methodology + on-disk live ledger column contract + dual-write + token/cache estimation heuristic + the cache-health finding rule. The on-disk ledger is the single source of truth the report is assembled from — recorded live, per step, never reconstructed."
see_also:
  - dogfood-testing
  - report-template
protocol: sp:dogfood-testing@1.2
---

# Monitor + Ledger

The ledger is the **single source of truth** for the report. It is recorded **live on disk** — one
row per step, written the moment the step resolves — never reconstructed from memory at the end.
Reconstruction produces fiction: it cannot honestly distinguish a step that passed first-try from
one that took three attempts, and it loses the per-step signal that drives testee refinement.

**Disk SSOT (protocol @1.2).** Working-memory-only ledgers are a contract violation. The ledger
lives in the dual artifacts (see [report-template.md](report-template.md) → Always-on dual
artifacts):

| File | Path |
| ------ | ------ |
| Live | `.spur/run/dogfood/<run_id>.md` |
| Report | `docs/dogfood/YYYY-MM-DD-<testee-slug>-dogfood.md` |

## The live-ledger rule

1. **Open both artifacts in Phase 1**, before the first step runs (frontmatter `status: running` +
   empty ledger table in each).
2. **Write a row the instant a step resolves** (pass, fixed, unresolved, or N/A) — not after the run.
3. **Dual-write every step:** append/update the row on the **live** file first, then mirror to the
   **report** path. Do not batch rows until Phase 4. If the report write fails, continue with live
   as SSOT, emit a P2 finding, and retry promote on finalize.
4. **The report reads the on-disk ledger, not your memory.** Every number in the report traces to a
   ledger row on disk. If it is not in the ledger file, it does not go in the report.
5. **Cardinality (@1.2).** The ledger's data-row count MUST equal the `**Steps:** N derived, N executed` declared
   in the report's §2 Execution Summary. N/A steps are not dropped — each gets its own row with
   `Outcome: N/A`. A count mismatch refuses `status: complete` at finalize (see
6. **R2 drift row (task 0296).** A ledger row tagged `drift:external` in the `Step` column documents
   workspace drift detected during the run — files changed by an external writer that neither the
   driver nor testee ledger rows name. The row carries `Outcome: drift`, `Fix Applied: <drifted paths>`,
   `Finding: P2 — workspace drift detected during run; attribution to external writer`,
   and `Basis: <fingerprint diff>`. A drift row never changes a step's outcome and never results in
   a `FIXED` / `PASS` outcome — it is purely documentary. Cache columns carry `—` (not estimated).
   See [SKILL.md §Workspace-drift guard](../SKILL.md#workspace-drift-guard-r2--task-0296).

### Fast-run exemption (task 0294 R6a)

The per-step live-write mandate (rules 1–4) exists to bound information loss when a mid-run crash
terminates the driver before finalize. That risk is real for long runs (multi-step pipelines,
mutating testees); it is **marginal for fast runs** where wall-clock is short enough that an
operator would naturally watch the run to completion.

**Codified exemption.** A run with **total wall-clock < 3 minutes** MAY batch-write all ledger
rows at finalize, provided **both** of the following hold:

1. The report's §2 Execution Summary carries an explicit note:
   `Ledger write mode: batch-finalize (fast-run exemption, total wall-clock < 3 min)`.
2. The driver is still prepared to reconstruct per-step ordering honestly — batched does not mean
   fictional. If the driver cannot reconstruct attempts/outcomes per step from its own tool-call
   history, the exemption does NOT apply and the strict per-step rule is back in force (rule 4:
   "if it is not in the ledger file, it does not go in the report").

This matches how the 0280 fast-run actually behaved (batch-finalize, still validated `complete`)
and preserves the strict mandate for long runs where mid-run crash loss is the real risk. A run
≥ 3 min that batch-writes is a **protocol violation the driver must self-report** as a P3 finding
in the report's §6 Findings (no exemption applies).

## Column contract

```
| Step | Attempts | Outcome | Fix Applied | Finding | Fresh Tokens | Cached Tokens | Cache % | Basis | Wall-clock |
```

| Column | Meaning |
| -------- | --------- |
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

### Multi-source Cost block (report §2)

Ledger estimates alone are **confidence: LOW**. When assembling the report Cost block
([report-template.md](report-template.md) §2):

| Source | When to use | Confidence | Scope label |
| -------- | ------------- | ------------ | ------------- |
| Ledger `chars/4` heuristic | Always | LOW | per-step trend |
| `ccusage` daily/session | If CLI available and returns data | MEDIUM | day or session — **not** per-step |
| Agent usage fields in tool results | If present (never invent) | MEDIUM | as reported by the tool |

If no external meter is available, print `Meter: n/a`. Never merge a day-level meter into a
per-step ledger cell as if it were measured per step.

### Chained-step rows (implement-heavy derived steps)

When a derived step is implement-heavy (it runs a pipeline leg, writes code, or otherwise mutates more
than its own arguments), its row is tagged `chained:<step>` in the Step column and its Fresh/Cached
columns reflect the **chained leg's** cost, not the driver's. The driver's monitoring cost for that
step stays on the driver's own row.

- Observable chained usage (subagent output in driver context, or the operator explicitly provided
  the artifact) → estimate Fresh/Cached from that output normally.
- Unobservable chained usage (subagent ran in a different session, usage data never surfaced) →
  label Fresh `~unknown`, Cached `~0`, Basis `chained-leg usage not observable from driver`. **MUST**
  emit a P3 finding: `P3 — chained-step cost not observable` (task 0278 R3). Do not invent totals.

Never fold a chained row into the driver's row; the whole point of dogfooding a pipeline-driving
testee is to see the testee's own cost separately from the driver's monitoring cost. See
[SKILL.md §Cost segmentation for implement-heavy steps](../SKILL.md#cost-segmentation-for-implement-heavy-steps).

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

### Driver cache checklist (task 0278 R7)

When aggregate cache% risks falling under 50%, apply this checklist **before** re-reading:

| # | Action | Why |
| --- | -------- | ----- |
| 1 | Reuse the Step-1 `spur task show --json` capture for the rest of the run | Avoids re-tokenizing the full task body |
| 2 | Do not re-Read SKILL.md / report-template after Phase 1 loaded them | Skill body is large; keep one copy in context |
| 3 | Prefer `--json` CLI over re-parsing freeform prose | Smaller, stable payloads |
| 4 | Dual-write ledger rows without re-reading the whole report each step | Append/patch; don't full-file re-load |
| 5 | Skip redundant `bun test` full suite between steps when a focused file suite already green | Run the broad suite once at the end |
| 6 | For batch testees (`verifyall` / `runall` / `refineall`): freeze `task list --json` once at resolve | Re-listing the set per task is the #1 sub-50% cache pattern on feature dogfoods |
| 7 | On re-verify of done tasks: re-read only cited `file:line` anchors, not full Solution blobs | Anchor-first re-verify keeps cache% above the 50% floor |

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
