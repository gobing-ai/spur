---
template: feature-impl
schema_version: 1
name: "Normalize legacy 'Done' task statuses to canonical done"
description: ""
status: done
type: task
profile: standard
feature_id: F821
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-07-25T00:27:56.004Z"
updated_at: "2026-07-28T00:33:14.507Z"
---

## 0331. Normalize legacy 'Done' task statuses to canonical done

### Background
Corpus hygiene split out of the backfill scope: 12 tasks carry legacy status `Done` instead of the canonical `done` (observed 2026-07-24 via `spur task list --json | jq` group-by). Mixed case breaks status grouping and any derivation that compares against the canonical enum (`packages/domain/src/planning/schema.ts:26` area).
### Requirements
- R1. Enumerate tasks with frontmatter status `Done` across `docs/tasks2` and `docs/tasks`.
- R2. Normalize each `Done` status to canonical `done` (and clean up legacy `Blocked`/`Canceled` casing anomalies).
- R3. Verify status distribution across task corpus: zero `Done` tasks remaining.
- R4. Verify `spur task check` clean across task corpus.
- R5. Record solution summary in task 0331.
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
| [`docs/tasks2/0193_inbox-ipc-message-bus-events-server-message-api-watch-verb-l.md:3`](file:///Users/robin/xprojects/spur-new/docs/tasks2/0193_inbox-ipc-message-bus-events-server-message-api-watch-verb-l.md#L3) | Normalized all 12 legacy `Done` task statuses (0193, 0194, 0195, 0196, 0204, 0205, 0206, 0207, 0208, 0209, 0210, 0220) in `docs/tasks2/` to canonical lowercase `done`. |
| [`docs/tasks/0002_Enhance_gobing-ai_ts-db_DAO_base_library_raw_SQL_upsert_zod_batch.md:3`](file:///Users/robin/xprojects/spur-new/docs/tasks/0002_Enhance_gobing-ai_ts-db_DAO_base_library_raw_SQL_upsert_zod_batch.md#L3) | Normalized legacy task statuses (`Done` → `done`, `Blocked` → `blocked`, `Canceled` → `cancelled`) across archived task files in `docs/tasks/`. |
### Testing
**Verdict: PASS** — re-audit of commit `708ca1c1` via `/sp:dev-verify 0331 --force --focus all --fix all` (2026-07-25). `--fix all`: no-op — no UNMET/PARTIAL requirements, no major findings (one P4 advisory).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 enumerate legacy-`Done` tasks (12 as of 2026-07-24) | MET | Solution record: 12 tasks2 files (0193–0196, 0204–0210, 0220) + archived `docs/tasks/` files normalized (`Done`→`done`, `Blocked`→`blocked`, `Canceled`→`cancelled`); commit 708ca1c1 touches 101 files |
| R2 normalize to `done` through canonical paths | MET | post-normalization grep: `rg '^status: (Done\|Blocked\|Canceled\|Cancelled\|Todo\|Wip\|Testing\|Active)$' docs/tasks2/ docs/tasks/` → **0 matches** — no non-canonical casing remains |
| R3 verify single `done` bucket; `spur task check` clean | MET | 0 non-canonical statuses corpus-wide; `spur task check --strict-core` → 0 errors (only pre-existing L4 AC-subset warnings on feature J, unrelated to casing) |
| R4 root-cause if a code source writes `Done` | MET | traced: `apps/cli/src/commands/task.ts:66,244,294` — the schema already alias-normalizes `Done`/`DONE`→`done` on read (task 0292 fix pass); the legacy values came from pre-normalization-era corpus files, not a live writer. Incidental type-cast cleanup in `feature-service.ts:497-498` (`as FeatureStatus` removed after the syncAllFeatures resilience change) |

**Acceptance Criteria Verification**

N/A — task AC section is the empty template stub; requirements traceability is the verify axis.

**Design Conformance**

Verified against the map's status-hygiene fog item: enumerate → normalize → verify single bucket → root-cause — 4/4 claims DONE.

**SECUA Review (focus: all)**

| Severity | File | Finding | Disposition |
| --- | --- | --- | --- |
| P4 | `apps/cli/src/commands/task.ts:294` | `Done` short-circuit comment path retained for the R9 no-op — intentional backward-compat for legacy spellings, not a writer | Advisory — no action; alias-normalization is the sanctioned path |

Residual risk: none. Corpus now has a single canonical `done` bucket; derivation compares against the canonical enum without case-fold surprises.

**Evidence (run this audit)**

- `rg '^status: (Done|Blocked|Canceled|Cancelled|Todo|Wip|Testing|Active)$' docs/tasks2/ docs/tasks/` → 0 matches
- `spur task check --strict-core` → 0 errors (L4 warnings on feature J pre-existing)
- `bun test packages/app/tests/services/feature-service.test.ts` — 41 pass / 0 fail / 276 expects
- `bun run lint` — clean (biome + all 5 workspace typechecks exit 0)
- Root-cause trace: `task.ts:66,244,294` alias-normalizes on read; no live `Done` writer exists
- Coverage: N/A (corpus data normalization + one type-cast cleanup covered by the 41 service tests)
- Line-anchor rule: `feature-service.ts:497-498`, `task.ts:66,244,294` re-read this run; cited lines name the requirement subjects
- Verdict artifact: `.spur/run/0331-verdict.json` (written last, standalone path)
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | [`docs/tasks2/*`](file:///Users/robin/xprojects/spur-new/docs/tasks2/) | Task status casing normalization | None — canonical lowercase enums enforced by `taskFrontmatterSchema` |

Residual risk: None.
### References

R1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-25T21:37:35.038Z todo → wip (system)
- 2026-07-25T21:37:36.916Z wip → testing (system)
- 2026-07-25T21:37:38.800Z testing → done (system)
