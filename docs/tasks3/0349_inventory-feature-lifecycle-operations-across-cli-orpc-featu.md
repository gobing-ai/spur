---
template: issue
schema_version: 1
name: "Inventory feature lifecycle operations across CLI, oRPC, FeatureService, and Board action map"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-07-27T17:49:41.046Z"
updated_at: "2026-07-27T21:53:20.671Z"
---

## 0349. Inventory feature lifecycle operations across CLI, oRPC, FeatureService, and Board action map

### Background
Wayfinder ticket for map F81 (Features detail action group). Type: **research** (`wayfinder:research`).

Board Features detail already exposes a status-gated button group (`FEATURE_STATUS_ACTIONS`), while the product surface for feature lifecycle has grown (CLI `sync`/`check`/`advance`/`move`/`refresh`, oRPC parity, FeatureService derive/sync). Before redesigning buttons, we need a citeable inventory of every operation applicable to a **single feature**, with Board coverage gaps called out.
### Requirements
R1. Inventory every operator-facing feature operation from CLI (`spur feature *`), oRPC (`featureContract`), and `FeatureService` public methods — table of verb → effect → mutates status? → time-consuming?

R2. Inventory Board coverage: map each op to `FEATURE_STATUS_ACTIONS` / FeatureDetail handlers / missing. Include sync pull vs push, check, advance, move, refresh, body edit, agent brainstorm/plan, add-child, add-task, link-task, FSM transitions.

R3. Note dead or half-wired paths (UI label without handler, API without UI, CLI without API).

R4. Do not redesign the button group — inventory only. Decisions on membership are 0351.

R5. Record the inventory as a linked artifact under the task (or Solution section) with path:line evidence.
### Acceptance Criteria
```gherkin
Feature: Feature lifecycle ops inventory for Board action group

  Scenario: Inventory covers all surfaces
    Given CLI, oRPC, FeatureService, and Board action maps
    When research ticket 0349 is resolved
    Then Solution lists each operator-facing op with status/slow/CLI/oRPC/service/Board coverage

  Scenario: Gaps are explicit
    Given half-wired paths exist (action stub, push sync, check without UI)
    When the inventory is recorded
    Then R3 lists those gaps with path:line evidence for ticket 0351
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Research inventory (0349) — 2026-07-27.** Artifact lives in this Solution (map F81). Evidence paths below.


| Col | Meaning |
|-----|---------|
| Mutates status? | Y = may change feature `status` frontmatter |
| Slow? | Y = likely multi-second / agent / corpus-wide |
| CLI | `spur feature <verb>` |
| oRPC | `featureContract` + `apps/server/.../handlers.ts` |
| Service | `FeatureService` / `FeatureCheckService` |
| Board button | In `FEATURE_STATUS_ACTIONS` + `handleAction` |
| Board other | Detail/shell UI outside the action group |

Coverage codes: **full** · **partial** · **client-only** · **API-only** · **CLI-only** · **none** · **stub**

---


| Op | Effect | Status? | Slow? | CLI | oRPC / server | Service | Board button | Board other | Coverage |
|----|--------|---------|-------|-----|---------------|---------|--------------|-------------|----------|
| **list** | List features | N | N | `list` | GET `/features` | `list()` | — | Tree load (`loadFeatures`) | full (read) |
| **show** | Load one feature body+fm | N | N | `show` | GET `/features/{id}` | `show()` | — | Detail load | full (read) |
| **create (root)** | New top-level feature | N (new=backlog) | N | `create` | POST `/features` | `create()` | — | Shell `+` / NewFeaturePanel | full |
| **create (child)** | Child under current | N | N | `create --parent` | POST `/features/{id}/children` | `create(name, parentId)` | `add-child` | panel | full |
| **transition** | Legal FSM hop | Y | N–M | `update <id> <status>` | PATCH `/features/{id}/status` | `transition()` | `start` `verify` `complete` `rework` `block` `unblock` `cancel` | — | full (buttons) |
| **advance** | Multi-hop forward path | Y | M | `advance` | **none** | via repeated `transition` in CLI | **none** | none | **CLI-only** |
| **update field** | Scalar fm (priority, …) | maybe | N | `update --field` | **none** | `update()` | none | none | **CLI-only** |
| **update section** | Replace named section | N | N | `update --section` | **none** | `updateSection()` | none | none | **CLI-only** |
| **body edit** | Replace markdown body | N | N | via section/file | PATCH `/features/{id}/body` | `updateBody()` | none | Detail edit/save (`saveFeatureBody`) | full (editor, not button group) |
| **move** | Re-parent + cascade rename | N (ids change) | M | `move` | **none** | `move()` | none | none | **CLI-only** |
| **refresh** | INDEX + `## Tasks` rebuild | N | M–Y | `refresh` | POST `/features/refresh` (corpus-wide) | `refresh()` | none | none | **API-only** (no Board call) |
| **check** | L1–L4 validation | N | M | `check [id]` | POST `/features/{id}/check` | `FeatureCheckService.check` | **none** (not in STATUS_ACTIONS) | **client exists** (`checkFeature`) unused by UI | **API+client, no UI** |
| **sync pull** | Derive status from linked tasks; apply | Y | M | `sync [id]` (default pull semantics) | POST sync `direction=pull` | `syncFeature` / `deriveFeatureStatus` | `sync-status` (+ direction modal, default push!) | — | **partial** — see gaps |
| **sync push** | Feature→tasks cascade | Y? | M | (CLI sync is task→feature oriented; push not first-class in help) | POST sync `direction=push` | **throws** not implemented (`handlers.ts:122-124`) | offered in Sync modal | — | **stub / broken** |
| **sync all** | All features | Y | Y | `sync --all` | **none** | `syncAllFeatures()` | none | none | **CLI-only** |
| **agent brainstorm** | Agent workflow | maybe | Y | via `spur agent` / sp | POST `/features/{id}/action` | **stub** returns ok only (`handlers.ts:95-99`) | `brainstorm` (backlog) | channel modal | **stub** (UI pretends dispatch) |
| **agent plan** | Agent workflow | maybe | Y | via agent | same `action` | **stub** | `plan` (backlog) | channel modal | **stub** |
| **create linked task** | New task w/ feature_id | N | N | `task create --feature` | POST `/features/{id}/tasks` | `taskService.create` | `add-task` | panel | full |
| **link existing task** | Set task.feature_id | N | N | task update field | PATCH `/features/{id}/link` | `taskService.updateField` | `link-task` | inline WBS | full |
| **unlink task** | Clear feature_id | N | N | task field clear | **none** | none dedicated | none | none | **none** |
| **derive (read-only)** | Proposal without apply | N | M | `sync --dry-run` | none dedicated | `deriveFeatureStatus` | none | none | CLI dry-run only |

**Service helpers (not primary operator verbs):** `parentOf`, `depthOf`, `isValidId`, `collectTasksByFeature` — internal/support.

**Evidence anchors**

- CLI verbs: `apps/cli/src/commands/feature.ts` (help surface via monorepo CLI)
- oRPC: `packages/contracts/src/feature.ts:170-312`
- Server: `apps/server/src/modules/feature/handlers.ts:31-137`
- Service: `packages/app/src/services/feature-service.ts` (create/transition/refresh/sync/move/…)
- Check: `packages/app/src/services/feature-check.ts` + handler `handlers.ts:74-87`
- Board map: `apps/web/src/modules/features/feature-actions.ts:1-65`
- Dispatch: `apps/web/src/modules/features/FeatureDetail.tsx:221-338`
- Client: `apps/web/src/lib/feature-client.ts`

---


From `FEATURE_STATUS_ACTIONS`:

| Status | Buttons |
|--------|---------|
| backlog | brainstorm, plan, add-child, add-task, start, cancel |
| active | add-child, add-task, link-task, sync-status, verify, block, cancel |
| verifying | sync-status, complete, rework, cancel |
| blocked | add-child, add-task, unblock, cancel |
| done | *(empty)* |
| cancelled | *(empty)* |

**Handler wiring (`handleAction`)**

| Button id | Handler path | API |
|-----------|--------------|-----|
| start/verify/complete/rework/block/unblock | FSM → `transitionFeature` (cancel opens modal first) | PATCH status |
| cancel | confirm modal → transition | PATCH status |
| brainstorm / plan | channel modal → `dispatchFeatureAction` | POST action (**stub server**) |
| add-child / add-task | dedicated panels → create* | POST children/tasks |
| link-task | inline WBS → `linkTaskToFeature` | PATCH link |
| sync-status | modal direction pull\|push → `syncFeatureStatus` | POST sync |

**Not on button group but on detail**

- Body edit/save (`saveFeatureBody`) — editor chrome
- Linked-task navigation (read)
- Close panel

**Not on Board at all (despite F8 AC / lifecycle surface)**

- **check** (client helper ready, zero UI call sites outside tests)
- **advance**
- **move**
- **refresh** (no Board client wrapper)
- **sync --all** / dry-run / force
- field-only edits (priority picker, etc.)
- unlink

---


1. **POST `/features/{id}/action` is a stub** — always `{ ok: true }` without agent run (`handlers.ts:95-99`). Board brainstorm/plan buttons show success-shaped flow but do no work.
2. **Sync push not implemented** — server throws if `direction === 'push'` (`handlers.ts:122-124`). Board Sync modal still offers push (`FeatureDetail` `syncDirection` default is **`push`** per state init — high risk of fail-on-first-use).
3. **checkFeature client without UI** — API + `feature-client.ts:72` + tests; F8 Goal/AC promised check in detail panel; **no button**.
4. **refresh oRPC without Board client** — corpus INDEX rebuild reachable only via CLI / raw API.
5. **advance / move / update-field / update-section** — CLI (+ service for move) with **no oRPC**, hence no Board.
6. **CLI sync --all / --dry-run / --force** — richer than Board modal (single-id pull only when it works).
7. **verbs.md lag** — skill reference command surface list may omit `sync` (CLI help has it); inventory trusts monorepo CLI + code over stale prose.
8. **done/cancelled empty action row** — intentional freeze; no reopen button (reopen only via CLI transition if legal).

---


No button redesign here. Membership decisions → **0351**. Async runner → **0352**. Confirm → **0353**.

---


Candidates to evaluate for primary/overflow: **check**, **sync pull** (fix default), **advance**, **refresh** (scoped?), **move** (destructive), reopen-from-done, priority edit. Treat brainstorm/plan as **broken until action handler is real**. Treat push-sync as **hide or implement**.
### Testing
**Mode:** research / inventory (no runtime code change). Re-verified 2026-07-27 under `/sp-dev-verifyall --feature F81 --auto --next --force --focus all --fix all` (dogfood run `2026-07-27-verifyall-f81-215120`).

**Method:** Read-only re-survey of monorepo CLI `apps/cli/src/commands/feature.ts`, `packages/contracts/src/feature.ts:170-312`, `apps/server/src/modules/feature/handlers.ts`, `feature-actions.ts:1-65`, `FeatureDetail.tsx` action state/handlers, `feature-client.ts:72`.

**Coverage claim:** N/A — documentation-only research ticket; no production paths under test.

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Solution inventory table; contracts `feature.ts:170-312`; CLI verbs create/show/update/advance/list/move/refresh/check/sync in `feature.ts` |
| R2 | MET | `feature-actions.ts:1-9` FEATURE_STATUS_ACTIONS; `FeatureDetail.tsx:55-64` action state; `:221-274` handleAction/FSM; checkFeature client-only |
| R3 | MET | action stub `handlers.ts:95-101`; push throw `:122-124`; sync default push `FeatureDetail.tsx:62`; checkFeature no UI call sites |
| R4 | MET | Explicit no-redesign; handoff 0351+ |
| R5 | MET | Inventory in Solution on this task file |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Inventory covers all surfaces | MET | static-ref | Solution multi-surface table [docs-only] |
| Scenario: Gaps are explicit | MET | static-ref | R3 gap list with path:line [docs-only] |

**SECUA (focus all):** no runtime code modified — N/A security/correctness surface; inventory honesty check: default syncDirection=push vs server reject remains the highest residual product risk (documented, deferred to membership/impl).

**`--next`:** no-op — task already terminal (`done`).

**Verdict: PASS**
### Review
**Disposition:** APPROVE for wayfinder research close — inventory-only, no production code change.

| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | None — no runtime code modified | N/A |
| P2 | Solution `###` subheads were stripped by section writer (content retained as tables) | Accepted; bold labels used where critical |
| P3 | Board Sync default direction is `push` while server rejects push — high user-facing risk | Documented in R3; membership ticket 0351 should hide or redefault |
| P4 | CLI feature verbs.md may lag `sync` | Documented; trust monorepo CLI + code |

**Residual risk:** Inventory can drift if oRPC gains endpoints before 0351 — re-read `featureContract` + handlers at 0351 start.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T18:11:25.039Z todo → wip (system)
- 2026-07-27T18:13:20.684Z wip → testing (system)
- 2026-07-27T18:13:22.326Z testing → done (system)
