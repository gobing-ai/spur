---
template: meta
schema_version: 1
name: "Decide refresh command surface: single dev-refresh with modes vs dev-refresh + dev-refreshall"
description: ""
status: done
type: meta
profile: standard
feature_id: R
parent_wbs: null
priority: P2
tags: ["meta"]
dependencies: ["0322", "0323"]
created_at: "2026-07-24T23:40:28.090Z"
updated_at: "2026-07-25T00:23:59.537Z"
---

## 0324. Decide refresh command surface: single dev-refresh with modes vs dev-refresh + dev-refreshall

### Background
**Ticket type:** `wayfinder:grilling` — resolve via `/sp:dev-refine`; record the decision in this body.

**Question:** What is the operator-facing command surface for feature-status refresh?

**Options:**

- (a) **Single `/sp:dev-refresh [feature-id | <wbs> | --all]`** — modes via args. *Recommendation* — matches the operator's lean (one daily driver; smart hooks make it rare anyway).
- (b) `/sp:dev-refresh` + `/sp:dev-refreshall` — explicit batch command.
- (c) Fold into an existing command (dev-wrap / dev-next) — no new surface.

**Sub-questions:**

- Arg resolution: feature id ⇒ direct; task WBS ⇒ linked feature (suggest+confirm via feature-link-helper when missing); `--all` ⇒ batch sweep: orphan-task linking + stale-status refresh, per-item confirm.
- Confirm UX per item and summary report shape; idempotence (re-running is a no-op when already in sync).
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

1. **Surface:** single `/sp:dev-refresh [feature-id | <wbs> | --all] [--auto]` — one daily driver, modes via args. Thin wrapper (command conventions per `plugins/sp/commands/dev-wrap.md:1`): orchestrates `spur feature sync` (derivation-rules decision) + `feature-link-helper`, zero duplicated logic. The hooks from the hook-placement decision make manual runs the exception.
2. **`--all` scope:** combined pass — orphan link sweep (link-helper batch mode: propose → confirm/skip/override per orphan) AND stale-status refresh for linked features, in one operator-confirmed pass. This is the current-drift backfill scenario.
3. **Confirm UX:** per-item confirm with derivation reason (e.g. "F2: all 14 tasks done ⇒ propose backlog→done via verifying") + skip/override; final summary report (applied vs skipped). `--auto` runs the unattended policy (forward-only auto-apply; link proposals queued to report).
4. **Arg resolution:** feature id ⇒ direct sync; task WBS ⇒ linked feature (link-helper propose/confirm/skip when missing, persisted skip honored); no arg ⇒ usage error listing modes.
### Testing
N/A — decision ticket, no code.

**Confidence ratings (decision claims):**

- HIGH — link-helper batch-sweep exists with per-orphan confirm/skip/override, the reuse target for `--all` (verified `plugins/sp/skills/spur-dev/references/feature-link-helper.md` today).
- MEDIUM — command file shape follows existing dev-* conventions (`plugins/sp/commands/dev-wrap.md` verified today); exact argument-hint / allowed-tools finalized at authoring.
- MEDIUM — `--auto` unattended semantics inherited from the hook-placement decision; dogfood before trusting in dev-runall.
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P4 | `docs/tasks2/0324_decide-refresh-command-surface-single-dev-refresh-with-modes.md` | Decision reviewed with operator via structured Q&A; all three recommendations accepted (single dev-refresh with modes, combined link+refresh `--all` pass, per-item confirm + summary) | None — graduate fog into implementation tickets |
| P4 | `plugins/sp/skills/spur-dev/references/feature-link-helper.md` | Batch-sweep mode confirmed as the reuse target for `--all` | Wire in the command implementation ticket |

Residual risk: `--auto` unattended semantics unproven until dogfooded (MEDIUM); command argument-hint details finalized at authoring.
### References

<!-- Links to docs, tasks, decisions, or external references. -->

### History
- 2026-07-25T00:03:32.812Z todo → wip (system)
- 2026-07-25T00:23:56.947Z wip → testing (system)
- 2026-07-25T00:23:59.537Z testing → done (system)
