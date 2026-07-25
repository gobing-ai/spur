---
template: meta
schema_version: 1
name: "Decide post-verify feature-refresh hook placement, missing-feature-id UX, and unattended policy"
description: ""
status: done
type: meta
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: []
created_at: "2026-07-24T23:40:25.668Z"
updated_at: "2026-07-25T00:02:54.045Z"
---

## 0323. Decide post-verify feature-refresh hook placement, missing-feature-id UX, and unattended policy

### Background
**Ticket type:** `wayfinder:grilling` — resolve via `/sp:dev-refine`; record the decision in this body.

**Question:** Where does the feature-status refresh fire after a task verifies PASS, and how does it behave interactively vs unattended?

**Sub-questions:**

- Hook point(s): `/sp:dev-verify` PASS path (interactive single task), `task-pipeline.yaml` record phase (every pipeline run), `wrapup-pipeline.yaml` feature-transition step (explicit wrap) — pick one, several, or all. **Recommendation:** derivation-based refresh in the pipeline record phase + wrapup (replacing wrapup's unconditional advance), with dev-verify delegating to the same path so behavior is identical everywhere.
- Missing `feature_id`: reuse `feature-link-helper`'s propose/confirm/skip verbatim; explicit operator skip is allowed and recorded.
- Unattended policy (`profile=auto`, dev-runall/dev-verifyall): no HITL possible. **Recommendation:** feature_id present ⇒ auto-refresh + report; absent ⇒ queue the link proposal into the run report for a later operator-confirmed batch run — never block the batch.
### Requirements

<!-- R-numbered expectations for the process/docs/chore outcome. Keep empty if not applicable. -->

### Acceptance Criteria

<!-- Lightweight checklist or Given/When/Then if there is an observable completion condition. -->

### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design

<!-- Approach and tradeoffs for process/docs/config changes. Keep this short. -->

### Plan

<!-- Ordered checklist. Fill before moving to todo/wip. -->

### Solution
**Decision (2026-07-24, operator-confirmed via grilling):**

1. **Hook points — all three, one implementation:**
   - `task-pipeline.yaml` record phase calls `spur feature sync <id> --json` after the record write (config-only change per ADR-022 — the pipeline never touches files directly).
   - `wrapup-pipeline.yaml` feature-transition step (`.spur/workflows/wrapup-pipeline.yaml:118`) replaces today's unconditional `spur feature advance ${vars.feature}` with derivation sync.
   - `/sp:dev-verify` PASS adds an interactive confirm step delegating to the same verb. Behavior identical across entry points.
2. **Unattended runs (profile=auto, dev-runall/dev-verifyall), feature_id present:** forward derivations auto-apply via legal advance hops and are reported in run output; reopen/regression proposals are queued, never auto-applied.
3. **Unattended runs, feature_id missing:** LLM-judge link proposals are queued into the run report for a later operator-confirmed sweep (`/sp:dev-refresh --all`); the batch never blocks.
4. **Interactive missing-feature_id UX:** reuse `feature-link-helper` (`plugins/sp/skills/spur-dev/references/feature-link-helper.md`) propose/confirm/skip verbatim; an explicit skip is persisted as a task-frontmatter marker so future runs don't re-prompt, plus a report line.
### Testing
N/A — decision ticket, no code.

**Confidence ratings (decision claims):**

- HIGH — wrapup's feature-transition step runs unconditional `spur feature advance` only when `vars.feature` is set (verified `.spur/workflows/wrapup-pipeline.yaml:118-129` today).
- HIGH — feature-link-helper already implements candidate listing → LLM-judge → propose/confirm → apply, plus batch-sweep mode (verified `plugins/sp/skills/spur-dev/references/feature-link-helper.md` today).
- MEDIUM — persisted-skip frontmatter marker (field name like `feature_link_declined`) — exact key to finalize at implementation against the task frontmatter schema.
- MEDIUM — record-phase wiring is config-only (ADR-022), but unattended auto-apply semantics need a dogfood pass before trusting them in dev-runall.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `docs/tasks2/0323_decide-post-verify-feature-refresh-hook-placement-missing-fe.md` | Decision reviewed with operator via structured Q&A; all four recommendations accepted (three hook points one implementation, unattended forward-only auto-apply, orphan proposals queued, link-helper reuse with persisted skip) | None — proceed to command-surface ticket |
| P4 | `.spur/workflows/wrapup-pipeline.yaml:118` | Existing unconditional advance step identified as the exact replacement point | Swap to derivation sync in the hook-wiring implementation ticket |

Residual risk: persisted-skip frontmatter key and record-phase YAML wiring unproven until built (MEDIUM); dogfood pass planned before trusting unattended auto-apply in batch runs.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-07-24T23:54:14.971Z todo → wip (system)
- 2026-07-25T00:02:51.450Z wip → testing (system)
- 2026-07-25T00:02:54.045Z testing → done (system)
