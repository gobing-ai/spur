# Proposal contract — D1–D4 defect set, evidence bar, mapping-schema conformance

Structure-defect detection is bounded by ranking: a defect qualifies only if it measurably moves a
rank (0495). Untidiness that moves no rank is not emitted. **Silence is the expected steady state.**

## The defect set (0495 Artifact A, frozen)

| # | Defect | Signal corrupted | Direction | Detection |
| --- | --- | --- | --- | --- |
| **D1** | Container counted as rankable work-item (has children, zero own open tasks) | All four — dilutes the denominator | Suppresses real ranks | Feature has children AND no own open tasks, yet appears in the candidate set |
| **D2** | Near-duplicate features (two ids, one product surface) | Churn, AC coverage — splits one concept across two ids | Inflates spread / suppresses the true concept | Name + Goal/Scope overlap; **requires the intentional-split check below** |
| **D3** | Unreliable container marker (children present, no `group` tag) | Dogfood, AC coverage — lets containers into the candidate set | Inflates candidate set | `frontmatter.tags` vs child-count mismatch |
| **D4** | Historical mapping read as current tree (recycled letters) | Authority pull, churn — proposes moves for dead features or the wrong live one | Corrupts the tree, not just the rank | Resolve every `old_id` against `spur feature list --json`; a live feature whose `created_at` post-dates the applied mapping is a different feature |

Defects justified only by a 0493-rejected signal (fan-out, status-based urgency, staleness) are
dropped by construction. Hygiene conditions owned by next-router rows B4–B7 (missing/invalid AC,
zero tasks, all-done-but-open, mixed cancelled/done) are **deferred** — the de-duplication invariant:
B4–B7 fire on `frontier tasks == 0`; this detector fires on frontier-corrupting structure. One
surface speaks per feature (0495 Artifact B).

## Evidence bar (mirrors `sp:conflict-finding` finding-contract)

Every emitted proposal carries:

1. **The signal corrupted** (from the four survivors), the direction of error, and the detection
   method — not just "K and F8 overlap".
2. **A `false_positive_check`** ruling out the four challenge classes
   (`plugins/sp/skills/conflict-finding/references/finding-contract.md:100`, classes at `:105-110`):
   lifecycle, supersession, abstraction level, **intentional deprecation**. A proposal that cannot
   clear them is demoted to `confidence: low` candidate or dropped. (Worked example: the K⊕F8
   near-duplicate is a **low-confidence candidate**, because K's Scope documents the split as
   intentional — `docs/features/K_features-module-spur-board.md:26`.)
3. **Two opposing anchors** for contradiction/stale types (`finding-contract.md:153`): D2 quotes both
   features' Goal/Scope; D4 cites both the map row and the live feature's `created_at`.

## Proposal format — conformance to the existing mapping schema

Proposals conform to `docs/plans/feature-tree-restructure-map.md` `## Schema` (`:10`; dispositions at
`:15`): `old_id | disposition | new_parent | expected_new_id | rationale | conf | task_edge_notes |
docs_root_refs`. No second schema. Detector rules that need no tree edit (D1/D3 exclusion, D4
live-resolution) are reported as **rules**, not proposal rows.

**Suppression list.** `## Rejected merges` (`:54`) is loaded at start: B∪H and the J∪K body-merge are
never re-proposed. `## Applied mapping` (`:78`) is a historical record, never current state (D4).

## Silence

A tree with no D1–D4 instances produces **zero proposals** — the expected steady state, printed as a
one-line "no rank-distorting defects found", never padded with tidiness findings.
