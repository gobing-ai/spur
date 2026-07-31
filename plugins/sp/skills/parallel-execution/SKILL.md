---
name: parallel-execution
description: "Decide when to fan out independent work across subagents, choose the fan-out pattern, synthesize parallel results. Triggers: \"fan out\", \"run in parallel\", \"parallelize\", \"concurrent execution\", \"multi-agent run\"."
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
  - sp:super-planner
---

# sp:parallel-execution — Parallel Execution & Fan-Out

The parallel-execution competency — decide when to fan out independent work across subagents, choose the right fan-out pattern, and synthesize parallel results. This skill owns the **decision framework** (when to parallelize) and the **execution patterns** (how to structure fan-out); the spine (`sp:spur-dev`) and batch orchestrator (`sp:super-planner`) consult it when they encounter independent work.

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

## Subagent execution disciplines

When you dispatch work to a subagent - a fan-out worker, an adversarial reviewer, a research angle -
four disciplines keep the dispatch reliable and cheap. They apply to every pattern above and are the
SSOT the batch orchestrator (`sp:super-planner`) and [execution-batch.md](../spur-dev/references/execution-batch.md) point back to. The choice of which **execution surface** carries the dispatch
(native subagent vs `spur agent run`) is decided by [dispatch-surface.md](references/dispatch-surface.md) - apply it before these disciplines.

### Hand artifacts as files, not pasted context

Never paste bulk context into a dispatch prompt. Write the artifact — the diff, the file set, the
spec excerpt, the data — to a file and hand the subagent the **path**. Pasting bulk text bloats the
prompt, truncates unpredictably, and cannot be re-read after compaction. A file handoff is durable,
re-readable, and keeps the dispatch prompt small enough to reason about.

### Keep a durable progress ledger

Maintain a progress ledger that survives compaction — a file (or the batch report table) recording,
per dispatched item, its status (pending / running / done / failed) and its result location. When the
session compacts or a run resumes, the ledger is the source of truth for what already ran; working
memory is not. Update it as each item terminates, not in one batch at the end.

### Select the cheapest model that fits each role

Match the model to the role. A mechanical extraction or a structural check runs on a cheap model; a
nuanced design review or a hard implementation wants a stronger one. Paying for the top model on every
subagent role is waste; using a weak model on a judgment role is a false economy. Choose per role.

### Never pre-judge the reviewer

A reviewer/skeptic subagent must receive the artifact and the contract and nothing that steers its
verdict. No "don't worry about X", no "this part is fine", no pre-rated severity, no "focus only on
Y". A pre-judged reviewer confirms your framing instead of testing it — the exact failure the fan-out
was meant to avoid. Let the reviewer reach its own conclusion.

## Integration with the spine

- **`sp:spur-dev`** owns task selection and lifecycle. When a batch contains independent tasks, the spine consults this skill for the fan-out pattern.
- **`sp:super-planner`** is the orchestrator that executes the fan-out. Its parallel mode (documented in its agent definition) applies the patterns from this skill.
- **`/sp:dev-parallel`** is the thin slash-command entry point that delegates to this skill.

## When to use

- Deciding whether a set of tasks can run in parallel.
- Choosing the right fan-out pattern for a batch.
- Synthesizing results from multiple subagent runs.
- The operator says "fan out", "run in parallel", or "parallelize this batch."

Do **not** use this skill for:
- Sequential pipeline execution — that is `sp:spur-dev`'s execution half.
- Single-task lifecycle — that is `sp:spur-dev` (`/sp:dev-run`).
- Batch orchestration logic — that is `sp:super-planner` (the orchestrator); this skill is the *decision support* it consults.

## Gotchas

1. **Silent truncation is a finding.** If you fan out 10 items but only report on 8, the 2 dropped items are a finding — document them explicitly.
2. **Token budget is real.** Fan-out multiplies token cost. The framework's row 4 is not optional — check `remaining budget` before spawning.
3. **Same-file overlap = serialize.** Two subagents editing the same file WILL conflict. The framework catches this at decision time; don't override it.
4. **Synthesis is work.** Merging N outputs is not free — budget ~2k tokens for synthesis per pattern. Plan for it.

## References

| [fan-out-patterns.md](references/fan-out-patterns.md) | Four fan-out patterns, per-pattern token-cost estimates, when-to-use decision table |
| [result-synthesis.md](references/result-synthesis.md) | Merge/dedup/conflict-resolution strategies, anti-patterns, unified-report template |
| [dispatch-surface.md](references/dispatch-surface.md) | Native subagent vs `spur agent run` decision rule: default, four escalation triggers, naming requirement, ADR-033 composition, sandbox reliability tax |

## See also

- **`sp:spur-dev`** — the orchestration spine that consults this skill for fan-out decisions.
- **`sp:super-planner`** — the batch orchestrator that executes fan-out patterns.
- **`/sp:dev-parallel`** — the slash command entry point for parallel execution.

## Platform Notes

### Claude Code

Native - `Skill()`/`Task()` delegation for subagent spawns. The decision framework is consumed by the agent in-session; fan-out execution uses the **native subagent by default** and escalates to `spur agent run <prompt> --agent <name>` only when a named trigger in [dispatch-surface.md](references/dispatch-surface.md) applies.

### Codex / OpenClaw / OpenCode / Antigravity

Run the decision framework manually; spawn subagents via the platform's native multi-agent mechanism. Parse `--json` outputs for result synthesis.
