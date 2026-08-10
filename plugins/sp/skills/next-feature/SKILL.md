---
name: next-feature
description: "Prompt-first feature frontier prioritizer — answers 'which feature should we work on now?' by deriving importance/urgency from corpus, git, and authority-doc evidence, and emits rank-distorting tree defects as proposals /sp:dev-featurechange consumes. Triggers: find next, which feature, feature ranking, frontier priority, what should I work on."
license: Apache-2.0
version: 1.0.0
metadata:
  author: spur
  platforms: "claude-code,codex,openclaw,opencode,antigravity,pi"
  category: analysis-core
  interactions:
    - audit
    - recommendation
  pipeline_steps:
    - sync-check
    - gate
    - derive
    - rank
    - report
see_also:
  - sp:next-router
  - sp:spur-cli
  - sp:conflict-finding
  - sp:spur-dev
---

# sp:next-feature — Feature Frontier Prioritizer

A prompt-first prioritizer that answers **"which feature should we work on now?"** — the question
`sp:next-router` deliberately does not answer (`routing-table.md` §0 step 1c: target omitted → not
v1). It derives importance and urgency from evidence already in the corpus, ranks the actionable
frontier in **tiers with per-candidate evidence**, and emits rank-distorting tree defects as
**proposals** `/sp:dev-featurechange` consumes.

**Honesty contract:** prompt-first. The model applies the rubric; existing deterministic tools
(`spur feature|task … --json`, `git`, `rg`) gather facts. No TypeScript analyzer, no numeric scores,
no new spur verbs, no feature frontmatter fields. The `priority` field is never used as an ordering —
in this corpus it is 76% one value (0493 measurement).

**Propose, never apply.** This skill performs no `spur feature move` and no corpus mutation. The only
path from its output to a changed tree is `/sp:dev-featurechange` (dry-run → confirm → apply).

## When to Use

- "Which feature next?" / "what should I work on?" / "rank the frontier" / "find next"
- Portfolio hygiene: which features are stale-done, blocked, or ill-specified.

**Do NOT use for:**

- Advancing an already-chosen task or feature — that is `/sp:dev-next` (`sp:next-router`).
- Applying tree changes — that is `/sp:dev-featurechange` (feature F31).
- Task-level ordering inside a feature — next-router's TABLE A owns that.

## Protocol

Run the steps in order. Each step's depth lives in its reference; this file is the spine.

0. **Sync-first precondition.** `spur feature sync --all --dry-run --json`. Feature `status` is
   bookkeeping, not ground truth (0493 measured 96% drift on this tree). If any proposal would
   change a frontier feature's status, the report **leads with the drift summary** ("sync first")
   and the ranking is computed over the *post-sync* status view. Details:
   [references/signal-derivation.md](references/signal-derivation.md) §0.
1. **Assemble the candidate set.** `spur feature list --json`; drop `done`/`cancelled`, drop
   structural containers (has children, no own open tasks — defect D1), drop the map/feature that
   owns this investigation if present. The `group` tag is **not** a reliable container marker (D3).
2. **Gate on actionability.** Read the frontier predicate **at runtime** from
   `plugins/sp/skills/next-router/references/routing-table.md` row **B3** — this skill intentionally
   does not copy it. A feature with zero open, unblocked child tasks is **gated, not ranked**;
   record the reason (all tasks terminal / blocked on X / no tasks). See
   [references/signal-derivation.md](references/signal-derivation.md) §1.
3. **Derive the four surviving signals** per gated survivor — AC coverage, churn exposure, dogfood
   proximity, authority pull — with the exact commands in
   [references/signal-derivation.md](references/signal-derivation.md) §2. A signal that comes back
   degenerate on the current frontier is reported as rejected-with-spread, never silently dropped.
4. **Tier, don't score.** Place each candidate per
   [references/ranking-rubric.md](references/ranking-rubric.md): ordinal tiers, explicit
   tie-breaks, evidence per candidate. No candidate carries a number derived from estimates the
   corpus does not hold.
5. **Defect pass.** Check the tree for rank-distorting defects D1–D4 per
   [references/proposal-contract.md](references/proposal-contract.md). Each emitted proposal
   conforms to the `docs/plans/feature-tree-restructure-map.md` schema and clears the evidence bar
   (`false_positive_check` mandatory). **Silence is a valid outcome.**
6. **Report + handoff.** Ranked frontier table + gated list + proposals, per
   [references/handoff-routing.md](references/handoff-routing.md). The report stops at the ranking;
   advancing a chosen feature is `/sp:dev-next`'s job.

## Anti-patterns — do not do these

- Ranking by the `priority` frontmatter field (degenerate; fakes a signal).
- Ranking a feature whose actionability gate fails. Gate first, rank second.
- Emitting a numeric score (WSJF/RICE arithmetic) from absent value/effort estimates.
- Copying the B3 predicate into this skill. Cite it; read it at runtime.
- Any `spur feature move`, or writing proposals anywhere `docs/features/**` — featurechange owns apply.
- Padding the defect list with tidiness findings that move no rank.
- Re-proposing F31's rejected merges (B∪H, J∪K body-merge) or reading
  `## Applied mapping` as current state — letters are recycled; resolve against live features.

## References

| File | Owns |
| --- | --- |
| [references/signal-derivation.md](references/signal-derivation.md) | Sync precondition, B3 runtime citation, per-signal derivation commands, degenerate-spread rejection |
| [references/ranking-rubric.md](references/ranking-rubric.md) | Tier definitions, tie-breaks, evidence-per-candidate output contract |
| [references/proposal-contract.md](references/proposal-contract.md) | D1–D4 defect set, evidence bar, mapping-schema conformance, silence |
| [references/handoff-routing.md](references/handoff-routing.md) | featurechange handoff, next-router seam, OQ1 conditional dispatch |

Grounding: tickets 0493 (measured signals), 0494 (reuse ledger), 0495 (defect contract) under
feature H12.
