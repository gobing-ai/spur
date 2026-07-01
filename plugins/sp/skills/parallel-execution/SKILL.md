---
name: parallel-execution
description: "The parallel-execution competency — decide when to fan out independent work across subagents, choose the right fan-out pattern for the job, and synthesize parallel results into a single coherent output. The decision framework the spine consults when a task batch contains independent items. Use when deciding whether work can be parallelized, fanning out N independent tasks, running a review panel, or merging subagent outputs. Triggers on \"fan out\", \"run in parallel\", \"parallel tasks\", \"parallelize\", \"concurrent execution\", \"multi-agent run\"."
license: Apache-2.0
metadata:
  author: spur
  version: "1.0"
  platforms: "claude-code,codex,openclaw,opencode,antigravity"
  category: execution
  interactions:
    - technique
    - pipeline
  operations:
    - fan-out
    - review-panel
    - investigation
    - result-synthesis
see_also:
  - sp:spur-dev
  - sp:super-coder
---

# sp:parallel-execution — Parallel Execution & Fan-Out

The parallel-execution competency — decide when to fan out independent work across subagents, choose the right fan-out pattern, and synthesize parallel results. This skill owns the **decision framework** (when to parallelize) and the **execution patterns** (how to structure fan-out); the spine (`sp:spur-dev`) and batch orchestrator (`sp:super-coder`) consult it when they encounter independent work.

This is a **competency skill** — it teaches the agent *how* to parallelize, not *what* to parallelize. The spine owns the lifecycle and task selection; this skill owns the fan-out mechanics.

## The decision framework

**The one question:** can these items run independently with no shared mutable state and no sequential dependency?

Ask these five questions before fanning out:

| Question | Yes → | No → |
|----------|-------|------|
| Do the items share mutable state (files, DB, global config)? | Serialize | Continue |
| Is there a hard sequential dependency (B needs A's output)? | Serialize A→B | Continue |
| Do the items target overlapping files (same file:line range)? | Serialize or merge-first | Continue |
| Is the remaining token budget ≥ (N × estimated cost per subagent)? | Continue | Reduce N or serialize |
| Are the items truly independent concerns (different skills/modules)? | Fan out | Question whether splitting is artificial |

**Hard rule:** if ANY question in rows 1-3 is Yes, serialize. Rows 4-5 are advisory — they guide N and pattern choice but don't block fan-out.

## Fan-out patterns

Four proven patterns, cataloged in [fan-out-patterns.md](references/fan-out-patterns.md):

| Pattern | Use when | Token cost | Result shape |
|---------|----------|------------|--------------|
| **N-way investigation** | One question, N independent search angles | ~N × 3k | Merged findings, deduped |
| **Competency-lens review** | One artifact, N review dimensions | ~N × 5k | Per-lens verdicts, unified report |
| **Independent-task batch** | M tasks, zero dependency edges | ~M × 8k | Per-task results, batch summary |
| **Adversarial verification panel** | One claim, N independent skeptics | ~N × 4k | Vote tally (survives if ≥2/3 affirm) |

**Pattern selection rule:** match the work shape to the pattern. Don't force a pattern onto mismatched work — N-way investigation on dependent tasks produces conflicting results; adversarial panel on a fact-check produces noise.

## Result synthesis

Parallel subagent outputs must be **synthesized**, not concatenated. The synthesis contract:

1. **Dedup** — merge findings with the same `file:line` anchor; keep the highest-severity version.
2. **Resolve conflicts** — when two subagents disagree on the same claim, surface the disagreement explicitly; don't silently pick one.
3. **Rank by confidence** — sort synthesized results by confidence (HIGH → MEDIUM → LOW); unresolved conflicts go last.
4. **Unified format** — emit one coherent output, not N raw dumps.

Full synthesis methodology: [result-synthesis.md](references/result-synthesis.md).

## Integration with the spine

- **`sp:spur-dev`** owns task selection and lifecycle. When a batch contains independent tasks, the spine consults this skill for the fan-out pattern.
- **`sp:super-coder`** is the orchestrator that executes the fan-out. Its parallel mode (documented in its agent definition) applies the patterns from this skill.
- **`/sp:dev-parallel`** is the thin slash-command entry point that delegates to this skill.

## When to use

- Deciding whether a set of tasks can run in parallel.
- Choosing the right fan-out pattern for a batch.
- Synthesizing results from multiple subagent runs.
- The operator says "fan out", "run in parallel", or "parallelize this batch."

Do **not** use this skill for:
- Sequential pipeline execution — that is `sp:spur-dev`'s execution half.
- Single-task lifecycle — that is `sp:spur-dev` (`/sp:dev-run`).
- Batch orchestration logic — that is `sp:super-coder` (the orchestrator); this skill is the *decision support* it consults.

## Gotchas

1. **Silent truncation is a finding.** If you fan out 10 items but only report on 8, the 2 dropped items are a finding — document them explicitly.
2. **Token budget is real.** Fan-out multiplies token cost. The framework's row 4 is not optional — check `remaining budget` before spawning.
3. **Same-file overlap = serialize.** Two subagents editing the same file WILL conflict. The framework catches this at decision time; don't override it.
4. **Synthesis is work.** Merging N outputs is not free — budget ~2k tokens for synthesis per pattern. Plan for it.

## References

| Reference | Covers |
|-----------|--------|
| [fan-out-patterns.md](references/fan-out-patterns.md) | Four fan-out patterns, per-pattern token-cost estimates, when-to-use decision table |
| [result-synthesis.md](references/result-synthesis.md) | Merge/dedup/conflict-resolution strategies, anti-patterns, unified-report template |

## See also

- **`sp:spur-dev`** — the orchestration spine that consults this skill for fan-out decisions.
- **`sp:super-coder`** — the batch orchestrator that executes fan-out patterns.
- **`/sp:dev-parallel`** — the slash command entry point for parallel execution.

## Platform Notes

### Claude Code

Native — `Skill()` delegation and `spur agent run` for subagent spawns. The decision framework is consumed by the agent in-session; fan-out execution uses `spur agent run <prompt> --agent <name>` for each subagent.

### Codex / OpenClaw / OpenCode / Antigravity

Run the decision framework manually; spawn subagents via the platform's native multi-agent mechanism. Parse `--json` outputs for result synthesis.

---

**Template type**: technique
**Purpose**: The decision framework and execution patterns for parallel subagent fan-out — when to parallelize, which pattern to use, and how to synthesize results.
