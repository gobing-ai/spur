---
template: issue
schema_version: 1
name: "Decide executor quality ordering: capable sub-tiers vs orthogonal tier+rank"
description: ""
status: done
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P1
tags: ["wayfinder:grilling", "config", "adr-033"]
dependencies: []
created_at: "2026-07-27T01:27:19.099Z"
updated_at: "2026-07-27T02:06:37.739Z"
---

## 0343. Decide executor quality ordering: capable sub-tiers vs orthogonal tier+rank

### Background

Wayfinder ticket for map B2. Type: grilling (`sp:dev-refine`).

`tier` today is a 3-value cost axis (cheap/standard/capable) and is the *only* capability signal. Two executors in the same tier are indistinguishable, and ties break by position in the `agent.executors` array — an invisible, easily-broken rule.

The operator proposes splitting `capable` into `capable-1/2/3` (1 = low output quality, 3 = high). The counter-proposal on the map is an orthogonal `rank` (ordinal, higher = better) *within* each tier.

The trade-off to settle: sub-tiers change the enum from 3 values to 5, which forces every `min_tier` in the registry to choose a sub-tier and makes the existing `min_tier: capable` ambiguous; they also leave `standard` un-ordered despite having the same quality spread (glm-5.2 vs astron-code vs ollama-cloud). `tier`+`rank` keeps `isTierEligible` and every current `min_tier` value untouched, generalizes to all three tiers, and makes the tie-break declared instead of positional — at the cost of two fields where the operator asked for one.

This ticket is unblocked: the answer does not depend on how intention is emitted.

### Requirements
R1. Decide between `capable-1/2/3` sub-tiers and orthogonal `tier` + `rank`, or a third option that emerges. Record the decision and its one-line reason in the task body.

R2. State what happens to the existing `min_tier` values in `REGISTERED_CANONICAL_STAGES` under the chosen model, and whether `isTierEligible` / `TIER_RANK` change.

R3. State the backward-compatibility behavior for an executor that declares no quality field, and for a config written against the current 3-value enum.

R4. State whether the chosen field replaces array-order tie-breaking or merely supplements it.

R5. Do not implement — this ticket ends at a recorded decision. Implementation is decomposed after the map clears.
### Acceptance Criteria

<!-- Given/When/Then regression scenario or checklist proving the bug is fixed. -->

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Resolved 2026-07-26 (operator ruling). Decision ticket — no code changed; the citations below are
the surfaces the decision binds. Re-verify 2026-07-26 closed R2–R4 gaps with provisional
consequences of the chosen model (not a reopening of the operator ruling).**

**Decision (R1):** `capable` splits into `capable-1` / `capable-2` / `capable-3` (1 = low, 3 = high
output quality). `cheap` and `standard` remain single, unsubdivided tiers.

**Reason:** granularity is warranted only where several models genuinely compete on output quality —
true of the capable band, not of cheap or standard. Sub-tiering all three (`cheap-1/2/3`,
`standard-1/2/3`) was considered explicitly and declined as complexity without a use.

**Counter-proposal declined.** An orthogonal `tier` + `rank` was raised — it would keep
`isTierEligible` and every existing `min_tier` untouched, generalize to all tiers, and replace
array-order tie-breaking with a declared field. The operator declined: the generality buys a case
that does not exist, and one field is simpler to reason about than two. Do not reopen without a
concrete case requiring two cheap or two standard executors to be ranked.

**Surfaces this decision binds:**

- `packages/config/src/index.ts:130` — `tier: z.enum(['cheap', 'standard', 'capable']).optional()`
  on `AgentExecutorConfigSchema`; the enum grows to five values
  (`cheap | standard | capable-1 | capable-2 | capable-3`).
- `packages/domain/src/stage-registry/schema.ts:324` — `min_tier: z.enum(['cheap','standard','capable'])`
  in the stage model-policy schema; same enum, second definition site.
- `packages/domain/src/stage-registry/schema.ts:346-357` — `CapabilityTier`, `TIER_RANK`, and
  `isTierEligible` (rank comparison) expand with the enum.
- `packages/domain/src/stage-registry/schema.ts:655` — `REGISTERED_CANONICAL_STAGES`; three records
  (`plan`, `verify`, `dogfood`) declare `min_tier: 'capable'` and need a sub-tier reading.
- `apps/cli/schemas/spur-config.schema.json` — the published JSON schema mirrors the executor enum
  for editor validation and must move in lockstep.
- `.spur/config.yaml` executors block — all 10 active executors already declare an explicit `tier`,
  so the migration has an enumerated starting point rather than an inferred one.
- `packages/app/src/services/agent-service.ts:716` — eligible sort is `TIER_RANK` ascending; same-tier
  order falls through to array order (stable sort over the filtered `executors` list).

**R2 — `min_tier` / `isTierEligible` / `TIER_RANK` under the chosen model:**

| Surface | What changes |
| --- | --- |
| Live enum | 3 → 5 values: `cheap \| standard \| capable-1 \| capable-2 \| capable-3`. Bare `capable` leaves the live enum. |
| `TIER_RANK` | Expands: cheap=1, standard=2, capable-1=3, capable-2=4, capable-3=5. |
| `isTierEligible` | Formula unchanged: `TIER_RANK[candidate] >= TIER_RANK[min]`. Signature only widens the type union. |
| Existing `min_tier: capable` | Cannot stay as written once bare `capable` is removed. Affects **plan**, **verify**, **dogfood** (3 of 10 stages). |

**Open handoff → 0348 (not a reopening of the quality-ordering decision):** whether legacy
`min_tier: capable` is accepted during migration as an **alias for `capable-1`** (floor =
capable-1-and-above via the expanded rank table) or every such stage must be **restated** to an
explicit sub-tier. The structural answer above is settled here; the migration reading is 0348's.

**R3 — backward-compatibility:**

| Case | Behavior under the chosen model |
| --- | --- |
| Executor declares **no** `tier` | Field stays **optional**. Resolver (`getExecutorTier`, `agent-service.ts:1083`) still infers today via name/model/agent regex. Under sub-tiers, inference may only yield `cheap`, `standard`, or **`capable-1`** — never invent `capable-2`/`capable-3` from a regex. |
| Config written against the **3-value** enum | `cheap` / `standard` unchanged. `tier: capable` (or inferred `capable`) is a **migration synonym for `capable-1`** for one deprecation window; after the window, bare `capable` is rejected. JSON schema + zod move in lockstep. |
| Third-party / unpublished configs | Full inventory of external consumers is **0347**; this ticket only records the intended reading so implementers are not blocked. |

**R4 — array-order tie-breaking:**

Sub-tiers **replace** array-order as the quality signal **across** `capable-1` / `capable-2` /
`capable-3` (selection uses expanded `TIER_RANK`; cheaper eligible first, so capable-1 before
capable-2 when both clear a floor). Array-order **remains** the last-resort tie-break for executors
that share the **same exact** tier value (two `capable-2`s, two `standard`s, two `cheap`s). No
orthogonal `rank` field is introduced. Cheap/standard stay single-valued, so within those bands
array-order is still the only intra-tier preference (as today).

**R5 — no implementation:** this ticket ends at the recorded decision. Enum expansion, registry
migration, schema publish, and config rewrite are decomposed after map B2 clears (0347 inventory,
0348 registry fate, then implementable follow-ups).
### Testing
**Mode:** re-verify of decision ticket (`--force` on terminal `done`). Documentation/decision only.

**Coverage:** N/A (documentation-only change; no runtime code path added).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Solution **Decision** + **Reason** + counter-proposal declined; mirrored on feature B2 Notes → Decisions so far |
| R2 | MET | Solution **R2** table: enum 3→5, TIER_RANK expansion, isTierEligible formula unchanged, plan/verify/dogfood called out; open alias vs restate → 0348 |
| R3 | MET | Solution **R3** table: no-tier → optional + infer floor capable-1; bare `capable` → synonym capable-1 then reject; 0347 owns inventory |
| R4 | MET | Solution **R4**: sub-tiers replace array-order across capable-N; same exact tier still array-order last resort |
| R5 | MET | No enum/schema code change in tree; only decision corpus + feature Notes. Binding surfaces still 3-value enum at `packages/config/src/index.ts:130`, `schema.ts:324` |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| (empty AC section) | N/A | n/a | Task AC is placeholder-only; decision completeness is gated by R1–R5 |

**Checks**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Design section empty (grilling ticket); Solution holds the operator-approved decision artifact |
| scope-creep | pass | Fix-pass only extended Solution R2–R4 statements + Testing; no code |
| evidence-rule-pass | pass | No behavior-bearing AC; static-ref/manual-review appropriate for decision ticket |
| line-anchors | pass | Re-read this run: config enum L130; min_tier schema L324; CapabilityTier/TIER_RANK/isTierEligible L346–357; REGISTERED L655; capable stages plan@687 verify@747 dogfood@804; sort L716; getExecutorTier L1083 |
| fix-pass-artifacts | pass | `.spur/run/0343-verdict.json` written this run after R2–R4 completion |

**Commands this run**

```text
# line-anchor re-read (exit 0)
rg -n "tier: z.enum|min_tier: z.enum|CapabilityTier|TIER_RANK|isTierEligible|REGISTERED_CANONICAL_STAGES|min_tier: 'capable'" \
  packages/config/src/index.ts packages/domain/src/stage-registry/schema.ts
# capable stages: plan, verify, dogfood (3)
# R5: no code diff for enum expansion — still 3-value at cited lines
```

**SECUA (focus=all):** no production code changed by this ticket. Residual risks (documented, not blockers):
MEDIUM — `min_tier: capable` migration reading deferred to 0348; LOW until 0347 — third-party 3-value configs.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `docs/tasks2/0343_decide-executor-quality-ordering-capable-sub-tiers-vs-orthog.md` | Decision reviewed with operator across two exchanges; counter-proposal (`tier` + `rank`) raised with reasons, considered, and declined — sub-tiering only `capable` is a deliberate scope choice, not an oversight | None — record and proceed to dependent tickets |
| P4 | `.spur/config.yaml` | All 10 executors already declare an explicit `tier` against the current three-value enum, so the sub-tier migration has a known, enumerated starting point | Migrate `capable` entries to a sub-tier when the enum lands |
| P4 | `packages/domain/src/stage-registry/schema.ts:655` | Three stages declare `min_tier: capable`; their meaning under sub-tiers is undefined and deliberately deferred | Resolve in 0348 alongside the registry's fate |

Residual risk: `min_tier: capable` semantics under sub-tiers remain unresolved (MEDIUM) — every
capable-tier stage's routing depends on whether it reads as `capable-1`-and-above or must be
restated. Backward compatibility for third-party configs written against the three-value enum is
LOW-confidence until 0347's inventory lands.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T01:52:19.149Z todo → wip (system)
- 2026-07-27T01:52:48.608Z wip → testing (system)
- 2026-07-27T01:52:51.217Z testing → done (system)
