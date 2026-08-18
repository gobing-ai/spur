---
template: issue
schema_version: 1
name: "Decide the confirmation matrix for Features detail actions"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0351", "0352"]
created_at: "2026-07-27T17:49:48.949Z"
updated_at: "2026-08-18T04:42:48.196Z"
---

## 0353. Decide the confirmation matrix for Features detail actions

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Important lifecycle ops must not fire accidentally. Cancel already confirms; most FSM transitions do not. Decide the confirmation matrix for the action group.
### Requirements
R1. For every operation retained in 0351 (primary + overflow), decide: no confirm | soft confirm (modal) | hard confirm (type name / explicit risk copy).

R2. Specify confirm copy requirements for destructive ops (cancel, rework, push-sync that rewrites status, move if in group).

R3. State interaction with async runner (0352): confirm **before** enqueue, never after.

R4. Decision only. Depends on 0351 membership and 0352 runner (ordering of confirm vs enqueue).
### Acceptance Criteria
```gherkin
Feature: Confirmation matrix for Features detail actions

  Scenario: Confirm level per op decided
    Given the membership matrix from 0351 (primary + overflow ops)
    When decision ticket 0353 is resolved
    Then Solution assigns each op a confirm level: no confirm | soft confirm (modal) | hard confirm (type name / explicit risk copy)

  Scenario: Destructive-op copy specified
    Given cancel, rework, push-sync (rewrites status), and move are destructive
    When the matrix is recorded
    Then Solution specifies confirm copy requirements for each destructive op

  Scenario: Async interaction pinned
    Given 0352 defines the async runner and enqueue semantics
    When the confirm matrix is finalized
    Then Solution states that confirm happens before enqueue, never after

  Scenario: Decision only — depends on 0351 and 0352
    Given 0351 owns membership and 0352 owns the runner
    When 0353 completes
    Then Solution records the confirm decision only and references 0351/0352
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan
1. Read 0351 membership matrix and 0352 async-runner model (both `done`) as inputs.
2. Inspect `feature-actions.ts`, `FeatureDetail.tsx`, `feature-lifecycle.yaml` for current button/modal placement and the rework History-entry mandate.
3. Decide confirm-level vocabulary (none/soft/hard) and the blast-radius principle deriving each per-op assignment.
4. Assign a confirm level to every op 0351 retained as primary or overflow (R1).
5. Specify risk-statement + typed-input gate + button label for each destructive op (R2).
6. Pin confirm-before-enqueue ordering against 0352's all-async-except-`check` runner (R3).
7. Record decision only; no UI implementation (R4 — owned by 0355 / action-group build-out).
### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Decision matrix (0353) — 2026-07-27.** Wayfinder `grilling` for map F81 (Features detail action group). Inputs: 0351 membership matrix (this turn, `done`), 0352 async-runner model (this turn, `done`), `feature-actions.ts` current button/modal map, `feature-lifecycle.yaml` rework guard. **Scope: confirm levels only** — membership (0351) and the runner model (0352) are closed decisions referenced here, not re-decided.

## Confirm levels (vocabulary)

- **none** — fires immediately on click; no modal.
- **soft** — modal with a `Confirm` / `Cancel` pair; `Cancel` is the default (non-destructive) focus. No typed input.
- **hard** — modal requiring typed input (the feature name, a target id, or a one-line reason) before the `Confirm` button enables. The typed value is captured as the operation's payload where the op needs it (rework reason → History entry; move → new parent id).

**Principle (the rule the per-op assignments derive from):** confirm level scales with blast radius.

| Risk class | Level | Examples |
|---|---|---|
| Terminal / cascade-mutating / traceability-severing / status-rewriting-across-corpus | **hard** | cancel, rework, move, unlink-task, sync push |
| Expensive mutating (FSM-guarded shell run, status recompute, multi-hop) or terminal-success | **soft** | complete, verify, sync pull, advance |
| Agent dispatch (long, channel-bound) | **soft** (existing channel selector IS the confirm) | brainstorm, plan |
| Reversible / read-only / growth (creation with naming gate) | **none** | start, block, unblock, check, derive, refresh, add-child, add-task, link-task |

## R1 — Confirm level per op (every op 0351 retained as primary or overflow)

Ops 0351 placed at `never` (illegal / elsewhere / broken-stub) are out of scope — they are not retained on the action group, so they get no confirm assignment. `sync push`, `sync all`, `body edit`, `update field`, `update section` are `never`/elsewhere and excluded; `sync push` appears in R2 only because its copy is pre-decided for the day it is un-hidden.

**FSM transitions**

| Op | Surfaces on (0351) | Confirm | Reason |
|----|---|---|---|
| **start** (→active) | backlog P | **none** | Primary CTA; forward, benign, reversible (cancel). |
| **verify** (→verifying) | active P | **soft** | [expensive] FSM-guarded shell run (`feature check`); soft confirm sets expectation of multi-second work. Copy: "Start verification? Runs feature check." |
| **complete** (→done) | verifying P | **soft** | Terminal (done is success-terminal; reopen is CLI-only today per 0351). Copy: "Mark feature done? Done is terminal." |
| **rework** (→active) | verifying P | **hard** | [destructive]; `config/workflows/feature-lifecycle.yaml:60-63` makes a History entry mandatory — the typed reason IS that entry. See R2. |
| **block** (→blocked) | active P | **none** | Reversible impediment pause (unblock returns); low accidental cost. |
| **unblock** (→active) | blocked P | **none** | Resumes work; benign forward progress. |
| **cancel** (→cancelled) | all non-terminal P | **hard** | [destructive], terminal. Today already opens `showCancelModal` (`FeatureDetail.tsx:57,607-637`); upgrade modal to typed input. See R2. |

**Status-sync**

| Op | Surfaces on (0351) | Confirm | Reason |
|----|---|---|---|
| **sync pull** (tasks→feature) | active/verifying P; backlog/blocked/done OF | **soft** | [expensive]; recomputes and may **transition** the feature's status. Copy: "Recompute feature status from linked tasks? May change this feature's status." |
| **sync push** (feature→tasks) | never (broken, 0351) | **hard** (when un-hidden) | [destructive] — rewrites status across N linked tasks. Decision recorded for the day 0352 queues it with a real push impl. See R2. |
| **derive** (dry-run) | all non-terminal OF | **none** | Read-only proposal; no mutation. |
| **sync all** | elsewhere (shell toolbar) | — | Not on the detail action group (0351); out of scope. |

**Validation & maintenance**

| Op | Surfaces on (0351) | Confirm | Reason |
|----|---|---|---|
| **check** | verifying P; others OF | **none** | Read-only validation; the single sync exception in 0352 R3 (`feature/handlers.ts:74-87`). No mutation, no deferred outcome → no confirm and no enqueue. |
| **advance** | non-terminal OF | **soft** | [expensive] multi-hop forward transition. Copy: "Advance feature to the next status?" |
| **refresh** | all non-terminal incl done OF | **none** | Idempotent INDEX + `## Tasks` rebuild; no destructive mutation. |
| **move** (re-parent) | non-terminal OF | **hard** | [destructive] — re-parents + cascades id rename to children. See R2. |

**Composition & linking**

| Op | Surfaces on (0351) | Confirm | Reason |
|----|---|---|---|
| **add-child** | non-terminal P | **none** | The inline naming modal (`inlineModal`, `apps/web/src/modules/features/FeatureDetail.tsx:59`) is its own gate; creation is non-destructive growth. |
| **add-task** | non-terminal P | **none** | Same — inline naming gate; growth. |
| **link-task** | active/verifying P; backlog/blocked OF | **none** | Inline selection modal gates the action; linking is additive. |
| **unlink-task** | non-terminal OF | **hard** | [destructive] — severs the feature↔task traceability edge. Not in R2's named list but flagged destructive by 0351; copy specified below for completeness. |

**Agent workflows**

| Op | Surfaces on (0351) | Confirm | Reason |
|----|---|---|---|
| **brainstorm** | backlog/active OF | **soft** (existing selector) | [stub][expensive] agent run. The `actionModal` channel selector (`FeatureDetail.tsx:58,640-707`, collects channel at `:677`) already serves as a soft confirm — the `Dispatch` button (`:703`) is the affirmative action. Add the risk line to the modal copy; no second modal. |
| **plan** | backlog/active OF | **soft** (existing selector) | Same as brainstorm — channel selector is the soft confirm. |

## R2 — Destructive-op confirm copy requirements

Each destructive op gets a modal with: (a) a one-line **risk statement** naming what becomes irreversible, (b) the **typed-input gate** (what the user must type), and (c) a `Confirm` button that stays disabled until the typed value matches the gate.

| Op | Risk statement (modal body) | Typed-input gate | Confirm button label |
|----|---|---|---|
| **cancel** | "This feature moves to `cancelled` (terminal). **Linked tasks are NOT cancelled automatically.** Reopening requires `spur feature update <id> active` on the CLI." | Type the **feature name** (exact). | "Cancel feature" |
| **rework** | "Send feature back to `active`. A **reason is required** and recorded in History (FSM mandate, `config/workflows/feature-lifecycle.yaml:60-63`)." | Type a **one-line reason** (non-empty; min ~10 chars). | "Send back to active" |
| **move** (re-parent) | "Re-parenting **renames this feature's id and cascades the rename to all children**. Existing links/shortcuts may break." | Type the **new parent id** (must resolve to an existing feature). | "Re-parent" |
| **unlink-task** | "Unlinking **severs the feature↔task traceability edge**. The task itself is not deleted; the edge is removed and WBS roll-ups will drop it." | Type the **task WBS** being unlinked (exact). | "Unlink task" |
| **sync push** (when un-hidden) | "Push **overwrites the status of N linked tasks** to match this feature's status. Task-level in-flight state (e.g. `testing`) will be replaced." | Type the **feature name** (exact). | "Push status to tasks" |

Copy rules for the implementing ticket (0355 / the action-group build-out):
- **Default focus is the non-destructive button** (`Cancel` / close). The `Confirm` action never receives initial focus.
- **Risk statements name the concrete consequence** (terminal / cascade / sever / overwrite), not generic "Are you sure?" text.
- **Typed-input gates are exact-match** against a value already shown in the modal (feature name / target id / WBS), never a free recall prompt — lowers the chance of a typed-but-wrong confirmation.
- The `rework` reason is the exception: it is free text, because it becomes the mandatory History entry — the gate is non-emptiness + min length, not exact match.

## R3 — Interaction with the async runner (0352): confirm BEFORE enqueue, never after

0352 R3 decided: **all feature detail actions go through the job queue, with exactly one sync exception — read-only `check`.** This pins the confirm ordering:

```
click → [confirm modal: soft|hard] --on-confirm--> POST /features/{id}/action --> server enqueues --> { runId, status: 'queued' }
```

**Rules:**

1. **Confirm is a precondition to dispatch, not a post-hoc acknowledgment.** The modal runs in the click handler, synchronously, before any HTTP call. The server only sees the request after the user has affirmed.
2. **Never confirm after enqueue.** Once `{ runId, status: 'queued' }` returns, the job is server-durable in `queue_jobs` (0352 R2) — popping a "did you mean it?" modal after that point cannot un-enqueue the work and is prohibited. If a destructive op was enqueued by mistake, the remedy is the action's own undo path (e.g. re-open after cancel) or out-of-band correction, not a retroactive confirm.
3. **The typed-input payload rides with the enqueue.** For hard-confirms whose typed value is part of the operation (`rework` reason → History entry; `move` → new parent id), the confirmed value is placed in the job payload (`{ featureId, action, command }`, 0352 R4) before enqueue, so the worker executes with the affirmed parameters — no second prompt in the worker.
4. **Sync exception (`check`) needs no confirm and no enqueue** — it is read-only, returns inline, and is the only op outside this flow (0352 R3). The ordering rule is moot for it by construction.

This ordering is why the confirm matrix is a **pre-dispatch** concern owned here, while the **post-dispatch** observation contract (queued → running → settled over SSE) is owned by 0354 — the two do not overlap.

## R4 — Scope respected (decision only; references 0351 / 0352)

- **No UI implemented.** This ticket records confirm levels and copy requirements only. The modal IA / visual hierarchy is 0355; the action-group build-out implements the modals.
- **Membership is closed (0351).** Every op assigned a confirm level above is an op 0351 retained as primary or overflow; no new ops are introduced and no `never` op is resurrected.
- **Runner model is closed (0352).** The confirm-before-enqueue ordering (R3) consumes 0352's all-async-except-`check` decision verbatim; the runner model is not re-litigated.
- **Reuse of existing modal primitives** is noted (cancel modal, channel/sync-direction selector, inline naming modal) so 0355 and the build-out extend in place rather than invent parallel affordances — but no code is changed by this ticket.
### Testing
**Mode:** decision / wayfinder (no runtime code change). Re-verified 2026-07-27 under `/sp-dev-verify 0353 --auto --next --force --focus all --fix all`.

**Method:** Re-read Solution confirm matrix against 0351 membership scope, 0352 confirm-before-enqueue, FeatureDetail cancel modal, feature-lifecycle rework History requirement.

**Coverage:** N/A (decision-only).

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Solution §R1 tables assign none/soft/hard to every 0351 primary+overflow op (FSM, sync, check/advance/refresh/move, agent, compose) with one-line reasons |
| R2 | MET | Solution §R2 destructive copy for cancel, rework, move, unlink, sync push (when un-hidden): risk statement + typed-input gate + button labels |
| R3 | MET | Solution §R3: click → confirm → POST → enqueue → {runId,queued}; never after enqueue; check excluded as 0352 sync exception |
| R4 | MET | Decision only; references 0351 membership + 0352 runner; no UI implemented |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Confirm level per op decided | MET | static-ref | Solution §R1 tables [docs-only] |
| Scenario: Destructive-op copy specified | MET | static-ref | Solution §R2 [docs-only] |
| Scenario: Async interaction pinned | MET | static-ref | Solution §R3 confirm-before-enqueue [docs-only] |
| Scenario: Decision only — depends on 0351 and 0352 | MET | static-ref | Solution §R4 [docs-only] |

**SECUA (`--focus all`):** N/A decision-only.

**`--fix all`:** no UNMET/PARTIAL on requirements; map gist added this batch.

**`--next`:** no-op — already terminal (`done`).

**Verdict: PASS**
### Review
**Review (0353) — /sp-dev-review, three-dimensional.** Decision-only `wayfinder:grilling` (R4: no code). All Solution anchors re-verified this turn against the working tree (see anchor table below). Aggregated verdict: **PASS** (functional PASS; SECUA PASS w/ 1 minor; architecture PASS w/ 1 advisory — both non-blocking).

**Functional traceability (sp-functional-review)**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 — confirm level per retained op | MET | §R1 tables assign none/soft/hard to all 17 ops 0351 retains as primary/overflow; cross-checked against 0351 §R1 matrix (all covered, never/elsewhere excluded w/ rationale). |
| R2 — destructive-op copy | MET | §R2 table: risk statement + typed-input gate + button label for cancel, rework, move, sync push, unlink-task; copy-rules block pins default-focus + exact-match gates + rework-reason exception. |
| R3 — confirm-before-enqueue | MET | §R3 flow `click → confirm → POST → enqueue → {runId, queued}`; 4 rules pin precondition, prohibit post-enqueue confirm, ride typed payload in job body (`{featureId, action, command}`, 0352 R4), exclude `check` as the one sync exception (0352 R3). |
| R4 — decision only, refs deps | MET | §R4 "No UI implemented"; 0351 membership + 0352 runner model referenced, not re-decided; existing modal primitives noted for 0355. |

Functional Verdict: **PASS**.

**SECUA (sp-code-verification, review mode)** — decision-quality lens (no source in scope).

| Dim | Result |
|---|---|
| Security | No secrets/injection (no code). Risk-copy names irreversibility correctly (cancel terminal, move id cascade). |
| Efficiency | Confirm-before-enqueue avoids wasted job rows for cancelled intents; `check` sync exception avoids queue overhead for read-only. |
| Correctness | **P3 (minor)** — R2 prose names `rework` as destructive, but 0351 flags rework only as "mandatory History entry," not `[destructive]`. 0353 silently promotes it. Decision is defensible (History mandate ⇒ hard confirm) but the drift should be explicit so 0355 doesn't inherit a mismatched classification. |
| Usability | Typed-input gates are exact-match against shown values; default-focus on non-destructive button; rework free-text reason is the justified exception. |
| Architecture | Reuses existing modal primitives (cancel modal `FeatureDetail.tsx:607-637`, channel selector `:640-707`, inline modal `:59`) — extends in place, consistent with monorepo style. |

SECUA Verdict: **PASS** (1 minor, non-blocking).

**Architecture (sp-code-improvement)** — no source modules; decision-structure lens.

| # | Signal | Result |
|---|---|---|
| 1 | Shallow module | N/A — no code. |
| 2 | Tight coupling | **A1 (advisory)** — matrix coupled to 0351 membership + 0352 runner by design (R4 deps); no maintenance trigger stated. Non-blocking: wayfinder decisions are point-in-time; 0355 re-grounds against live membership. |
| 3 | Wrong seam | None — confirm-as-precondition-to-dispatch is the correct seam. |
| 4 | Weak locality | None — confirm logic colocated in this decision; modal primitives colocated in `FeatureDetail.tsx`. |
| 5 | Poor test surface | N/A — ticket correctly defers test surface to 0355. |

Architecture Verdict: **PASS** (1 advisory, non-blocking).

**Findings**

| ID | Severity | Blocking? | Finding | Action |
|---|---|---|---|---|
| P3 | minor | no | R2 names `rework` destructive; 0351 flags it only as "mandatory History entry," not `[destructive]`. Silent promotion. | Add one line to §R2: "rework is treated as destructive here despite 0351 not flagging it `[destructive]`, because the mandatory History entry makes the transition reason-bearing and irreversible in intent." |
| A1 | advisory | no | Matrix coupled to 0351/0352 with no maintenance trigger. | Optional: add to §R4 — "re-derive when 0351 gains an op or 0352 adds a sync exception." |

**Line-anchor re-verification (this turn)**

| Anchor | Re-read confirms subject? |
|---|---|
| `apps/cli/config/workflows/feature-lifecycle.yaml:60-63` | ✅ rework transition, "mandatory History entry" |
| `apps/web/src/modules/features/FeatureDetail.tsx:57,607-637` | ✅ `showCancelModal` state + cancel modal block |
| `apps/web/src/modules/features/FeatureDetail.tsx:58,640-707` | ✅ `actionModal` state + channel selector, Dispatch `:703` |
| `apps/web/src/modules/features/FeatureDetail.tsx:59` | ✅ `inlineModal` state |
| `apps/server/src/modules/feature/handlers.ts:74-87` (inherited) | ✅ `check` handler, read-only `FeatureCheckService` |

**Residual risk:** none blocking. P3 + A1 are documentation-precision improvements for 0355; the decision matrix itself is complete, internally consistent, and grounded.

**Final disposition:** PASS — clear for pipeline progression (record → done). Status left `wip`; not force-transitioned by this review (review does not own the `testing → done` gate; that is `/sp-dev-verify`).

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | spur task check | — | task check passed; no P1–P3 findings |
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T19:15:27.252Z todo → wip (system)
- 2026-07-27T19:16:39.830Z wip → testing (system)
- 2026-07-27T19:17:15.824Z testing → wip (system)
- 2026-07-27T19:29:52.642Z wip → testing (system)
- 2026-07-27T19:29:52.930Z testing → done (system)
