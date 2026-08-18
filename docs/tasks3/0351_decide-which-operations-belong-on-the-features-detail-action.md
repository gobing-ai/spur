---
template: issue
schema_version: 1
name: "Decide which operations belong on the Features detail action group per status"
description: ""
status: done
type: issue
profile: standard
feature_id: F81
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: ["0349"]
created_at: "2026-07-27T17:49:44.771Z"
updated_at: "2026-08-18T04:42:48.165Z"
---

## 0351. Decide which operations belong on the Features detail action group per status

### Background
Wayfinder ticket for map F81. Type: **grilling** (`wayfinder:grilling`).

Given the ops inventory (0349), decide which operations appear on the Features **detail** action group, for each feature status: primary row, overflow, or never (elsewhere only). This is the membership matrix the UI redesign binds to.
### Requirements
R1. Produce a per-status matrix: operation → primary | overflow | never, with one-line reason each.

R2. Explicitly place at least: FSM transitions (start/verify/complete/rework/block/unblock/cancel), sync (and pull vs push), check, advance, move, refresh, brainstorm, plan, add-child, add-task, link-task.

R3. State default for newly discovered ops from 0349 not listed in R2.

R4. Do not implement UI. Do not decide async/confirm details (0352/0353) beyond noting ops that are inherently expensive or destructive.

R5. Record the matrix in the task Solution; map Decisions so far gets a one-line gist on close.
### Acceptance Criteria
```gherkin
Feature: Per-status operation membership matrix for Features detail action group

  Scenario: Per-status matrix produced
    Given the operation inventory from 0349 and the async-runner patterns from 0350
    When decision ticket 0351 is resolved
    Then Solution holds a per-status matrix: operation → primary | overflow | never, with one-line reason each

  Scenario: Required ops placed
    Given FSM transitions, sync (pull vs push), check, advance, move, refresh, brainstorm, plan, add-child, add-task, link-task
    When the matrix is recorded
    Then each required op is placed in the matrix with a per-status disposition

  Scenario: Newly discovered ops covered
    Given 0349 surfaced ops beyond the R2 list
    When the matrix is finalized
    Then each discovered op receives a default disposition and reason

  Scenario: Scope respected — no UI, no async/confirm detail
    Given 0352 owns the async model and 0353 owns the confirm matrix
    When 0351 completes
    Then Solution records membership only, noting inherently expensive or destructive ops, and defers async/confirm to 0352/0353
```
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design
**Method (grilling ticket):** Derive the matrix from three grounded inputs, no code.

1. **Legality floor** — read `apps/cli/config/workflows/feature-lifecycle.yaml` transitions to fix which FSM ops are legal per status. Every `never (illegal)` row cites this graph. Noted that `SchemaLifecyclePort` (`planning-write-service.ts:85-94`) does not enforce the graph server-side, so the action group is the user-facing guardrail.
2. **Inventory input** — 0349 Solution (op → CLI/oRPC/service/Board coverage + 8 gaps). Drove the broken/stub/CLI-only flags and the "elsewhere only" placements (body edit, update field/section, sync all).
3. **Runner-pattern input** — 0350 Solution (sync-await vs job-queue, confirm modals, SSE scope). Informed the [expensive]/[destructive] flags handed to 0352/0353/0354 without deciding those contracts here.

Tradeoffs: chose **overflow-by-default** for newly discovered ops (R3) over hide-by-default — counters the "API exists, no UI" drift 0349 found for `check`, at the cost of a kebab menu that needs IA work in 0355. Chose **hide (never) for broken/stub** over surface-disabled — a missing button is clearer than a disabled one whose failure mode is invisible.
### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause

<!-- Verified underlying cause with file:line evidence. Fill once reproduced/isolated. -->

### Solution
**Decision matrix (0351) — 2026-07-27.** Wayfinder `grilling` for map F81 (Features detail action group). Inputs: 0349 inventory (this turn), 0350 async-runner patterns (this turn), `feature-lifecycle.yaml` FSM, `feature-actions.ts` current button map. **Scope: membership only** — async-runner model (0352), confirm matrix (0353), observability (0354) are explicitly deferred; notes below flag inherently expensive / destructive ops for those tickets, never decide them here.

## Vocabulary

- **primary** — surfaced as a visible button in the status's action row.
- **overflow** — reachable behind a "More"/kebab menu on the detail; not in the primary row.
- **never** — does not appear on the Features detail action group for this status (either illegal under the FSM, owned elsewhere, or broken/stub).
- **N/A** — op does not apply to this status by construction (e.g. terminal freeze).

Cost flags consumed by 0352/0353/0354 (not decided here): **[expensive]** multi-second / agent / corpus-wide; **[destructive]** irreversible or cascade-mutating; **[stub]** server pretends success; **[broken]** server throws.

## FSM legality (from `apps/cli/config/workflows/feature-lifecycle.yaml`)

Legal outbound transitions per status — the authority for every `never (illegal)` row below:

| Status | Legal targets |
|--------|---------------|
| backlog | active, cancelled |
| active | verifying, blocked, cancelled |
| verifying | done, active (rework), cancelled |
| blocked | active, cancelled |
| done | *(terminal, none)* |
| cancelled | *(terminal, none)* |

Note: `SchemaLifecyclePort` (`packages/app/src/services/planning-write-service.ts:85-94`) is a same-status guard only — it does NOT enforce the graph. The action group is the primary user-facing guardrail against illegal transitions; a `never (illegal)` disposition means "do not offer the button," not "server will reject."

---

## R1 — Per-status membership matrix (operation → primary | overflow | never)

Columns per status: **P** = primary, **OF** = overflow, **—** = never. Reasons are one line; "(illegal)" cites the FSM row above; "(broken)" / "(stub)" cite 0349 gap numbers.

**FSM transitions** (`feature-actions.ts` FSM_ACTIONS)

| Op | backlog | active | verifying | blocked | done | cancelled | Reason (one line) |
|----|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **start** (→active) | P | — | — | — | — | — | Only legal from backlog (FSM); primary CTA to begin work. |
| **verify** (→verifying) | — | P | — | — | — | — | Only legal from active; guarded by `feature check` (FSM). [expensive] |
| **complete** (→done) | — | — | P | — | — | — | Only legal from verifying; strict-check guarded. [expensive] |
| **rework** (→active) | — | — | P | — | — | — | Only legal from verifying; mandatory History entry. |
| **block** (→blocked) | — | P | — | — | — | — | Only legal from active; impediment pause. |
| **unblock** (→active) | — | — | — | P | — | — | Only legal from blocked; resumes work. |
| **cancel** (→cancelled) | P | P | P | P | — | — | Legal from every non-terminal status; terminal. [destructive] |

Terminal statuses (done, cancelled) get **no FSM buttons** — matches current `FEATURE_STATUS_ACTIONS` empty rows. Reopen-from-done is CLI-only today (`spur feature update <id> active`); no Board surface until a `reopen` transition is added to the FSM — see R3 default.

**Status-sync** (`derive` + apply)

| Op | backlog | active | verifying | blocked | done | cancelled | Reason |
|----|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **sync pull** (tasks→feature) | OF | P | P | OF | OF | — | Recompute status from linked tasks; primary signal while active/verifying. [expensive] |
| **sync push** (feature→tasks) | — | — | — | — | — | — | **Hide — broken** (server throws, 0349 gap #2). Do not surface until implemented; defer wiring to 0352. [broken] |
| **sync all** | — | — | — | — | — | — | Corpus-wide, not single-feature; belongs on a Features shell toolbar, not the detail group. |
| **derive (dry-run)** | OF | OF | OF | OF | OF | — | Read-only proposal; useful pre-sync preview. [expensive] |

Push is `never` everywhere because it is broken, not because it is conceptually wrong — once 0352/0353 land a real implementation with a confirm gate, revisit as `overflow` on active/verifying.

**Validation & maintenance** (single-feature)

| Op | backlog | active | verifying | blocked | done | cancelled | Reason |
|----|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **check** | OF | OF | P | OF | OF | — | L1–L4 validation; primary pre-verify/complete gate (FSM guards call it anyway). [expensive] |
| **advance** | OF | OF | OF | OF | — | — | Multi-hop forward; legal from non-terminal pre-done states. [expensive]; CLI-only today (0349 gap #5) — surface as overflow only after oRPC lands. |
| **refresh** | OF | OF | OF | OF | OF | — | INDEX + `## Tasks` rebuild; useful after task re-parenting. [expensive]; API-only today (0349 gap #4) — overflow once Board client wraps it. |
| **move** (re-parent) | OF | OF | OF | OF | OF | — | Re-parents + cascades id rename. [destructive]; CLI-only today (0349 gap #5) — overflow only, behind the 0353 confirm gate. |
| **body edit** | — | — | — | — | — | — | Owned by the detail editor chrome, not the action group (0349 "Not on button group"). |
| **update field** (priority, …) | — | — | — | — | — | — | Scalar fm edits belong on inline pickers in the detail header, not action buttons (0349 gap #5). |
| **update section** | — | — | — | — | — | — | Named-section replace is an authoring action; surface via the detail's section editor, not the action group. |

**Composition & linking**

| Op | backlog | active | verifying | blocked | done | cancelled | Reason |
|----|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **add-child** | P | P | P | P | — | — | Create child feature; primary growth action while feature is live. |
| **add-task** | P | P | P | P | — | — | Create task linked to feature; primary growth action while live. |
| **link-task** | OF | P | P | OF | — | — | Link existing task; primary on active/verifying (where WBS curation happens), overflow elsewhere. |
| **unlink-task** | OF | OF | OF | OF | — | — | Not on any Board surface today (0349 gap, "none" coverage); add as overflow on live statuses behind the 0353 confirm. [destructive] (severs traceability edge) |

**Agent workflows**

| Op | backlog | active | verifying | blocked | done | cancelled | Reason |
|----|:---:|:---:|:---:|:---:|:---:|:---:|---|
| **brainstorm** | OF | OF | — | — | — | — | Agent idea-generation; only meaningful pre-start. **[stub]** (0349 gap #1) — overflow, disabled until `/features/{id}/action` is real; defer dispatch shape to 0352. |
| **plan** | OF | OF | — | — | — | — | Agent planning; only meaningful pre/during early start. **[stub]** — same disposition as brainstorm. |

Both stay **overflow, not primary**, even after the stub is fixed: they are [expensive] agent runs, not deterministic FSM hops, and 0353 will require a confirm + channel selector (current `actionModal` already collects channel).

---

## R2 — Required-ops placement checklist

Every op named in R2 is placed above with a per-status disposition:

- FSM transitions (start/verify/complete/rework/block/unblock/cancel) → FSM table.
- sync (pull vs push) → sync table.
- check, advance, move, refresh → validation/maintenance table.
- brainstorm, plan → agent table.
- add-child, add-task, link-task → composition table.

## R3 — Default for newly discovered ops (not in R2)

**Default disposition: `overflow` on every non-terminal status, `never` on terminal (done/cancelled), until a ticket moves it.** Rationale: the action group is the single user-facing surface for single-feature ops; surfacing a new op as overflow (behind a kebab) is low-cost and discoverable, while hiding it entirely risks the "API exists, no UI" drift 0349 documented for `check`. Exceptions to the default:

1. **Ops that mutate status or cascade across the corpus** → `overflow` + [expensive]/[destructive] flag, and MUST pass the 0353 confirm gate before promotion to primary.
2. **Ops with no oRPC endpoint** (CLI-only) → `never` until the endpoint lands (matches 0349 gaps #4/#5 for advance/move/refresh/field/section); promotion is blocked on API parity, not on this ticket.
3. **Ops that are stubs/broken** → `never` until fixed (matches push, brainstorm, plan today); a visible-but-broken button is worse than absent.
4. **Read-only / navigation ops** (list, show, body edit, linked-task navigation) → `never` on the action group by construction — they belong to the detail chrome, not a button row.

Discovered candidates from 0349 not in R2: **unlink-task** (overflow, [destructive]), **derive/dry-run** (overflow, [expensive]), **sync all** (elsewhere — shell toolbar), **update field / update section** (elsewhere — inline editors), **body edit** (elsewhere — editor chrome). Each follows rule 2 or 4.

## R4 — Scope respected

- **No UI implemented.** This ticket records the matrix only; 0355 owns the IA/visual-hierarchy prototype.
- **No async/confirm detail decided.** Ops are merely *flagged* `[expensive]` / `[destructive]` / `[stub]` / `[broken]` as inputs to 0352 (async runner), 0353 (confirm matrix), 0354 (observability). The flags do not prescribe a runner model or a confirm policy.
- **Inherently expensive ops flagged for 0352/0354:** verify, complete (FSM-guarded shell runs), sync pull, derive, check, advance, refresh, brainstorm, plan.
- **Inherently destructive ops flagged for 0353:** cancel (terminal), move (id cascade), unlink-task (traceability sever), push (cascade-mutates tasks once implemented).
- **Broken/stub ops flagged for fix-before-surface:** push (broken), brainstorm + plan (stub).

## R5 — Handoff

- **Solution holds the matrix** (this section) — the membership SSOT for 0355 (IA prototype) and 0352/0353/0354 (cross-cutting contracts).
- **Map Decisions gist (one line):** *Features detail action group = status-gated; FSM transitions + add-child/add-task primary on live statuses; sync-pull/check primary on active/verifying; brainstorm/plan/sync-push hidden until fixed; advance/move/refresh/unlink overflow behind confirm once API parity lands.*
### Testing
**Mode:** decision / wayfinder grilling (no runtime code change). Re-verified 2026-07-27 under `/sp-dev-verify 0351 --auto --next --force --focus all --fix all`.

**Method:** Re-read Solution membership matrix + R2–R5 handoff against FSM source (`config/workflows/feature-lifecycle.yaml` / `apps/cli/config/workflows/feature-lifecycle.yaml`), `SchemaLifecyclePort` same-status-only guard, current `FEATURE_STATUS_ACTIONS` empty terminal rows, and F81 map Decisions.

**Coverage:** N/A (decision-only ticket; no production path under test).

**Per-requirement traceability**

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | Solution §R1 per-status matrix: op → P / OF / — across backlog/active/verifying/blocked/done/cancelled with one-line reasons; FSM table cites `feature-lifecycle.yaml` |
| R2 | MET | Solution §R2 checklist places FSM (start/verify/complete/rework/block/unblock/cancel), sync pull/push, check, advance, move, refresh, brainstorm, plan, add-child, add-task, link-task |
| R3 | MET | Solution §R3 default `overflow` on non-terminal / `never` on terminal + four exception rules; candidates unlink/derive/sync-all/field/section/body |
| R4 | MET | Solution §R4 no UI; expensive/destructive/stub/broken flags only — defers 0352/0353/0354 |
| R5 | MET | Matrix in Solution; F81 map Decisions one-line gist recorded this run under `--fix all` (was missing at verify start) |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: Per-status matrix produced | MET | static-ref | Solution §R1 multi-status tables [docs-only decision] |
| Scenario: Required ops placed | MET | static-ref | Solution §R2 checklist + tables [docs-only] |
| Scenario: Newly discovered ops covered | MET | static-ref | Solution §R3 default + candidates [docs-only] |
| Scenario: Scope respected — no UI, no async/confirm detail | MET | static-ref | Solution §R4 + no production UI diff [docs-only] |

**SECUA (`--focus all`):** N/A — decision-only; no production code. Note: Solution correctly documents `SchemaLifecyclePort` (`planning-write-service.ts` same-status only) so Board membership is the user-facing FSM guardrail.

**`--fix all`:** R5 map gist was UNMET (Decisions so far lacked 0351 one-liner). Fixed: `spur feature update F81 --section Notes` added membership gist and trimmed resolved “Not yet specified” bullets. Re-checked → MET.

**`--next`:** no-op — task already terminal (`done`).

**Verdict artifact:** `.spur/run/0351-verdict.json` (this run).

**Verdict: PASS**
### Review
**Disposition:** APPROVE for wayfinder grilling close — decision-only, no production code change.

| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | None — no runtime code modified | N/A |
| P2 | `###` subheads under §R1 stripped by section writer (phantom guard); rewritten as bold labels on re-write | Resolved; structure verified intact (`show 0351` → labels present at expected lines) |
| P3 | L4 warnings: 4 task scenarios not traced to F81 feature AC (DD-09 subset rule) | Accepted — same severity as sibling tickets 0349/0350; feature AC traceability is a map-level concern, not a task blocker. `pass: true`. |
| P4 | `SchemaLifecyclePort` does not enforce the FSM graph server-side — action group is the de-facto guardrail against illegal transitions | Noted in Solution §FSM legality; informs 0352 (runner) to harden server-side eventually |

**Residual risk:** Matrix can drift if (a) oRPC lands endpoints for advance/move/refresh before promotion, (b) push/brainstorm/plan get fixed without revisiting their `never`→`overflow` promotion, or (c) a `reopen` transition is added to the FSM. Each is flagged in Solution §R3/§R4 as a re-evaluation trigger.
### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
- 2026-07-27T18:43:21.575Z todo → wip (system)
- 2026-07-27T18:45:13.247Z wip → testing (system)
- 2026-07-27T18:45:47.720Z testing → done (system)
- 2026-07-27T18:46:04.687Z done → wip (system)
- 2026-07-27T18:54:13.865Z wip → testing (system)
- 2026-07-27T18:54:14.149Z testing → done (system)
