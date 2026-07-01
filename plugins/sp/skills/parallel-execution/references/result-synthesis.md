---
name: result-synthesis
description: "Merge/dedup/conflict-resolution strategies for parallel subagent outputs, anti-patterns, and the unified-report template."
see_also:
  - parallel-execution
  - fan-out-patterns
---

# Result Synthesis

Parallel subagent outputs must be **synthesized**, not concatenated. Raw dumps from N subagents are noise; a synthesized report is signal. This reference defines the synthesis contract — the rules every fan-out pattern's merge step follows.

## The synthesis contract

### 1. Dedup

Merge findings that share the same `file:line` anchor. Keep the **highest-severity** version.

```
Subagent A: src/auth.ts:42 — P2 — missing null check
Subagent B: src/auth.ts:42 — P3 — variable naming unclear

Merged:    src/auth.ts:42 — P2 — missing null check (P3 naming note appended)
```

**Rule:** same file + same line → one finding. Different lines in the same file are distinct findings.

### 2. Resolve conflicts

When two subagents disagree on the same claim, **surface the disagreement explicitly**. Don't silently pick one.

```
Subagent A: "The Redis migration is safe — all writes are idempotent"
Subagent B: "The Redis migration is unsafe — key TTL change breaks cache warming"

Synthesis:  ⚠ CONFLICT — Redis migration safety
            A: safe (writes idempotent)
            B: unsafe (TTL breaks cache warming)
            → Escalate to operator for resolution
```

**Rule:** conflicts are findings, not failures. Surface them with both positions stated; let the operator resolve.

### 3. Rank by confidence

Sort synthesized results:
1. HIGH confidence (empirically verified, source-cited)
2. MEDIUM confidence (reasoned, but not empirically verified)
3. LOW confidence (heuristic, pattern-match, or uncertain)
4. Unresolved conflicts (both sides stated)

Within each tier, sort by severity (P1 → P2 → P3 → P4).

### 4. Unified format

Emit one coherent output. The unified report has:

```
## Synthesized Results

### HIGH Confidence
| # | Finding | Source | Severity | File:Line |
|---|---------|--------|----------|-----------|

### MEDIUM Confidence
...

### Conflicts (unresolved)
...

### Dropped (deduped into higher-severity)
...

**Synthesis stats:** N subagents, M raw findings, K after dedup, J conflicts
```

## Anti-patterns

| Anti-pattern | Why it fails | Fix |
|-------------|-------------|-----|
| **Silent truncation** | "10 items found" but only 8 reported — 2 silently dropped | Always report total → after-dedup counts; document what was dropped and why |
| **Raw concatenation** | Pasting N subagent outputs end-to-end without merging | Apply the synthesis contract: dedup → resolve → rank → format |
| **Majority-wins on facts** | "3 subagents say X, 1 says Y → X is correct" — but Y has the evidence | Weight by evidence, not count. One subagent with a repro wins over three without |
| **Synthesis without audit** | Merged report with no trace of which subagent found what | Every synthesized finding carries a `Source` column naming the originating subagent |
| **Conflicts resolved silently** | Two opposing findings merged into one without surfacing the disagreement | Conflicts are an explicit section in the unified report |

## Synthesis cost

Budget ~2k tokens for synthesis per pattern. The synthesis step is:
1. Read all subagent outputs (cached from their runs)
2. Apply dedup + conflict detection
3. Emit unified report

Don't re-run subagents during synthesis — their outputs are the input. If a subagent output is malformed or empty, log it as a **dropped subagent** in the synthesis stats.
