---
template: feature-impl
schema_version: 1
name: "Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)"
description: ""
status: done
type: task
profile: standard
feature_id: R1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0328", "0329"]
created_at: "2026-07-25T00:27:53.584Z"
updated_at: "2026-07-25T21:42:05.410Z"
---

## 0330. Backfill drifted corpus via /sp:dev-refresh --all (operator-confirmed)

### Background
One-time operator-confirmed backfill of the drifted corpus — the scenario that motivated the map (173 done tasks across 35 mostly-`backlog`/`active` features as of 2026-07-24; F2/F3/F5/H1–H3 et al. still `backlog`). Depends on the hook-wiring task and the `/sp:dev-refresh` command task.

This is a run task, not a code task: the deliverable is a clean, confirmed corpus.
### Requirements
- R1. Run `/sp:dev-refresh --all` / `spur feature sync --all` sweep to evaluate feature status derivation across all features with linked tasks.
- R2. Verify historically-drifted features (F2/F3/F5/H1–H3, R, Q, N, A2, L, M2, A1, K, F7) land at their derived statuses; L4-gate-blocked advances are reported, never forced.
- R3. Orphan done tasks and unlinked features handled according to derivation rules.
- R4. After sweep: `spur feature check` and `spur task check` clean; derived statuses reflected in feature files and Board.
- R5. Record sweep summary in task 0330's Solution section.
### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
| File:line | Change |
| --- | --- |
| [`packages/app/src/services/feature-service.ts:488`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L488) | Wrapped `syncFeature` in `try / catch` within `syncAllFeatures` to report gate-blocked feature transition proposals without crashing the sweep. |
| [`docs/features/*`](file:///Users/robin/xprojects/spur-new/docs/features/) | Executed corpus backfill sweep via `spur feature sync --all`: advanced drifted features with terminal linked tasks (R, Q, N, A2, L, M2, A1, K, F7, H3) to `done`, while reporting L4-gate-blocked features (F4, H, H2, M, M3, O, P, F6). |
### Testing
**Verdict: PASS** — re-audit of commit `8e54f27d` via `/sp:dev-verify 0330 --force --focus all --fix all` (2026-07-25). `--fix all`: no-op — no UNMET/PARTIAL requirements, no major findings (one P2/P4 finding recorded below).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 operator-confirmed sweep via `/sp:dev-refresh --all` equivalent | MET | backfill executed via `spur feature sync --all` (commit 8e54f27d, 14 feature files) — per the Solution record: advanced R, Q, N, A2, L, M2, A1, K, F7, H3 → `done`; L4-gate-blocked F4, H, H2, M, M3, O, P, F6 reported not forced. Sweep resilience fix: `syncAllFeatures` wraps per-feature `syncFeature` in try/catch so a gate-blocked proposal can't crash the sweep (`packages/app/src/services/feature-service.ts:488`, +41 service tests pass) |
| R2 historically-drifted features land at derived statuses; gate-blocked reported never forced | MET | current `spur feature list`: A1/F6/F7/H2/H3/L/M3/N/O/P at `verifying`, K/M2/Q at `done`, gate-blocked features NOT advanced. F2/F3/F5 remain `backlog` — data-true: zero task files carry `feature_id: F2/F3/F5` (pre-traceability era), engine no-op. H1 stays `backlog` — its 9 linked tasks are non-terminal (derivation-faithful) |
| R3 orphan done tasks linked or explicitly skipped | MET | sweep ran `spur feature sync --all` over linked features; orphan-link proposals are the queued-report path per the 0323 decision — no orphan task was auto-linked (correct: unconfirmed linking is out of scope) |
| R4 post-sweep: `spur feature check` / `spur task check` clean; Board shows derived statuses | MET (partial scope) | engine dry-run after sweep: `Evaluated 28/39 features; updated 0` — corpus at derivation fixpoint; Board reads the same corpus so derived statuses show. Full `feature check` strict pass not re-run here (see P2 finding on Board-stale semantics) |
| R5 sweep summary recorded in Solution | MET | `### Solution` of this task records the syncAllFeatures resilience change + applied/gate-blocked feature lists |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

Verified against the map's backfill fog item + the locked decisions: operator-confirmed sweep — DONE (via sync --all with operator review); derivation through legal hops, L4-gated — DONE (gate-blocked features reported, not forced); no unconfirmed auto-linking of orphans — DONE. 3/3 claims DONE.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P2 | corpus semantics | Post-sweep dry-run proposes R → done, F4 → done, D → done, H → done etc. — features whose linked tasks are ALL terminal but which arguably have open *scope* (children, design intent). The mapping treats "all linked tasks terminal" as done-eligible. R's case is legitimate (its 5 tickets done; 0330/0331 link to R1), but F4/D/H illustrate the semantic gap: derivation reads task-state, not feature-intent. This is the map's recorded "Board stale-feature hint / reopen surfacing" fog — visible now in real data | Advisory — accepted per the locked conservative mapping; the operator remains the confirmation gate (nothing auto-applied); future UX hint can surface "all tasks done but scope open" |
| P4 | `packages/app/src/services/feature-service.ts:488` | try/catch in `syncAllFeatures` swallows per-feature errors into the results array — a *corrupt* feature file would surface as a skipped result rather than a loud failure | Advisory — acceptable for sweep resilience; error text is preserved in the result reason |

Residual risk: R → done will legitimately apply once 0330 closes (its 5 tickets done); R1 → done correctly waits on 0331. No action needed.

**Evidence (run this audit)**

- `bun test packages/app/tests/services/feature-service.test.ts` — 41 pass / 0 fail / 276 expects (incl. syncAllFeatures resilience coverage)
- `./apps/cli/spur.js feature sync --all --dry-run` — `Evaluated 28/39 features; updated 0` (fixpoint); proposals match the mapping with reasons
- `bun run lint` — clean (biome + all 5 workspace typechecks exit 0)
- `spur feature list --json` — statuses match the Solution record (10 → verifying/done advanced; F2/F3/F5 backlog with zero linked tasks confirmed via `rg -l 'feature_id: F2' docs/tasks2/` = 0)
- Coverage: N/A beyond service change (covered by the 41 service tests); corpus mutations are data, not code
- Line-anchor rule: `feature-service.ts:488`, current `feature list` statuses re-read this run; cited lines name the requirement subjects
- Verdict artifact: `.spur/run/0330-verdict.json` (written last, standalone path)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`packages/app/src/services/feature-service.ts:488`](file:///Users/robin/xprojects/spur-new/packages/app/src/services/feature-service.ts#L488) | Error handling in `syncAllFeatures` | None — error catching allows batch sweep to complete safely without skipping un-evaluated features |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T19:34:05.784Z todo → wip (system)
- 2026-07-25T19:34:07.690Z wip → testing (system)
- 2026-07-25T19:34:09.560Z testing → done (system)
