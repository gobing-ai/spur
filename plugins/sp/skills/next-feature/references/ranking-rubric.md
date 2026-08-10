# Ranking rubric — ordinal tiers, explicit tie-breaks, evidence per candidate

The corpus carries no value/effort estimates, so no numeric score is honest (0493: WSJF/RICE/CD3
rejected for absent denominators; Eisenhower's tiered shape selected with modification). The rubric
produces **tiers with evidence**, and the operator overrides.

## Tiers

| Tier | Meaning | Placement rule |
| --- | --- | --- |
| **T1 — work now** | Actionable and high-leverage | Passes the gate; strong on ≥2 surviving signals |
| **T2 — unblock first** | Highest-value work that is gated | Fails the gate, but would be T1 if unblocked; report the blocker and who owns it |
| **T3 — specify first** | Not ready to be worked | 0 AC scenarios, or zero dogfood contact, or a container with no own work — most valuable to *specify*, not to start |
| **T4 — stale-done / hygiene** | Finished work wearing an open status | Post-sync would be `done`; the valuable action is wrap/sync, not ranking |

A candidate appears in exactly one tier. T2 exists because the gate is not a trash bin: H1-class
features (blocked externally, highest churn, richest AC) must stay visible with their blocker named.

## Tie-breaks (in order, within a tier)

1. **Churn exposure** — higher cost of delay first.
2. **AC coverage** — more completely specified first.
3. **Authority pull** — named in roadmap/ADR first.
4. **Closure pressure** — work that reduces the count of open/active features outranks work that
   raises it (finish-before-start; post-sync WIP makes this a weak tie-break, not a dominant axis).
5. **Feature id** — deterministic final ordering.

## Output contract — per candidate row

Every ranked candidate row carries the evidence that placed it:

```text
| rank | feature id + name | tier | evidence |
```

`evidence` cites the derived signals with their numbers (`churn 368 commits/40d on packages/app +
plugins/sp; 70 AC scenarios; named in roadmap §3`) — not adjectives. A rank with prose justification
and no command-derived number or `file:line` citation is a defect in the report, not a ranking.

## The gated list

Gated features are listed **separately, never ranked**, each with its gate reason from the
actionability pass (`blocked: 0142 — external trigger` / `no open tasks` / `all tasks terminal`).
Features whose gate reason is "all tasks terminal" are T4 candidates — say so once, in the sync-first
block, rather than repeating per row.

## The empty-frontier case

If the post-sync actionable frontier is empty, the honest report is: **"None — sync first, unblock
T2 candidates, or decompose T3 candidates."** An empty frontier is a finding, not a failure. 0493
measured exactly this state on 2026-08-10: 25 candidates → 22 stale-done, 2 externally blocked,
1 stale stub → 0 actionable.
