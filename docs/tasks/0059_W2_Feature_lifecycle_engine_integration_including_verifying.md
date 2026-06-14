---
name: "W2: Feature lifecycle engine integration including verifying"
description: "W2: Feature lifecycle engine integration including verifying"
status: Done
created_at: 2026-06-13T01:08:18.984Z
updated_at: 2026-06-14T18:40:42.864Z
folder: docs/tasks
type: task
feature-id: F4
priority: P1
tags: ["rd3-migration","wave-2"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0059. "W2: Feature lifecycle engine integration including verifying"

### Background

Design §2.3/§5, DD-13. Same mechanism as tasks; feature:<id> run binding.


### Requirements

R1. feature-lifecycle run binding + requestTransition path.
R2. verifying guards: enter warns unless linked tasks done/cancelled; verifying→done = feature check --strict (+ optional HITL); rework path.
R3. feature.transitioned events + History append.


### Q&A



### Design

Authority: design §2.3 feature graph + DD-13 guard placement (active→verifying warns unless linked tasks
done/cancelled; verifying→done requires `feature check --strict` + optional HITL; verifying→active =
rework with mandatory History entry), §5.2 binding `feature:<id>`, DD-04 file-wins. Same upstream gate as
0055 (ts-libs E1/E2).

> **Gate resolved (2026-06-14):** engine 0.3.17 ships the E1/E2 surface (same as 0055). `FeatureLifecycleAdapter`
> mirrors the 0055 `LifecycleAdapter` (createOrAttach `feature:<id>` / reseed / requestTransition); the
> `verifying` readiness warning ("linked tasks not done/cancelled") was added to `spur feature check` L4 so
> the non-blocking `active→verifying` guard surfaces it. HITL on `verifying→done` is deferred (optional in R2).


### Solution

1. Extend the 0055 lifecycle adapter for features: createOrAttach(`feature:<id>`,
   feature-lifecycle definition); linked-task completeness computed from the task corpus (feature_id
   edges) and surfaced to the entry guard.
2. `feature.transitioned` events + History append ride the existing write-service steps — no new
   emission code, only the feature lifecycle wiring.
3. Tests: verifying entry warning vs clean entry; strict-gate on done; rework path History entry;
   file-wins re-seed for features.
4. Gate: `bun run check`; ≥90%; integration against released engine version (shared gate with 0055).


### Plan

- [x] `FeatureLifecycleAdapter` over engine 0.3.17 — create-or-attach `feature:<id>`, reseed (DD-04), requestTransition (R1)
- [x] One `task_run_links` row (kind=feature-lifecycle) on first attach
- [x] R2: `verifying` guards via `feature-lifecycle.yaml` — active→verifying non-blocking `feature check`, verifying→done blocking `--strict`, verifying→active rework (mandatory History)
- [x] R2: `feature check` L4 warns when a verifying feature has linked tasks not done/cancelled (non-blocking)
- [x] R3: `feature.transitioned` + History append ride the write-service steps (no new emission code)
- [x] Wire `FeatureLifecycleAdapter` into `PlanningWriteService` from the feature CLI `makeService`
- [x] Tests: 6 engine-integration (allow/deny/guard/attach/rework/file-wins) + verifying-readiness warning; E2E
- [x] R-doc: `04_DESIGN §7.5` engine-integration-live note


### Review

**SECU verdict: FAIL → PASS** (verified + fully implemented 2026-06-14 via `/rd3:dev-verify 0059 --force --fix all`)

As shipped, `FeatureLifecycleAdapter` was a **pure stub** (same as 0055's was): `requestTransition` did no
engine call, `rehydrateIfNeeded` empty, no run-link writes, not wired into the feature write path. All of
R1/R2/R3 UNMET. Built the real engine integration during the fix-pass, mirroring the 0055 `LifecycleAdapter`.

**S — Security:** Parameterized DB access; the `feature check` guard runs in the injected `cwd` with a
validated feature id (`^[A-Z][1-9]*$`); no injection surface.

**C — Correctness / architecture:**
- R1 ✓ `FeatureLifecycleAdapter` over engine 0.3.17: create-or-attach durable run keyed `feature:<id>`
  (`createOrAttachRun` + `findRunByKey`), `reseedRun` (DD-04 file-wins), `requestTransition` with
  `TransitionAllowed`/`TransitionDenied` mapping. Wired into `PlanningWriteService` from the feature CLI
  `makeService`. One `task_run_links` row (kind=`feature-lifecycle`) on first attach.
- R2 ✓ `verifying` guards (DD-13) live in `feature-lifecycle.yaml`: `active→verifying` shell guard
  `spur feature check <id>` is **non-blocking** (exit 0 on warnings) — and `feature check` now emits an L4
  warning when a verifying feature has linked tasks not done/cancelled (the "warns unless linked tasks
  done/cancelled" rule). `verifying→done` shell guard `spur feature check <id> --strict` **blocks**.
  `verifying→active` rework path (always guard) → write-service step 7 appends the mandatory History line.
  Verified: rework allowed, strict-done denied with guard report.
- R3 ✓ `feature.transitioned` event + History append ride the existing write-service steps (no new
  emission code, Solution step 2). E2E: `spur feature update A active` emits `feature.transitioned` and
  appends `backlog → active (system)` to History.

**U — Usability:** Guard denials carry the engine `detail` + `guardReport` into the port `report`.

### Findings

| # | Finding | Dim | Location | P | Disposition |
|---|---------|-----|----------|---|-------------|
| 1 | `FeatureLifecycleAdapter` was a pure stub (no engine calls, empty rehydrate, no run links, not wired) — R1/R2/R3 UNMET despite the engine APIs being available (0.3.17). The stub test only exercised the schema fallback (vacuous R8). | Correctness | `feature-lifecycle-adapter.ts`, `feature.ts` | P1 | **FIXED** — real engine integration (createOrAttach/reseed/requestTransition), CLI wiring, 6 engine-integration tests; E2E-verified. |
| 2 | R2 verifying-readiness rule ("warns unless linked tasks done/cancelled") had no implementation — the `active→verifying` guard ran `feature check` but `feature check` never checked linked-task completeness. | Correctness | `feature-check.ts` runL4 | P2 | **FIXED** — L4 emits a non-blocking warning when a `verifying` feature has linked tasks not done/cancelled; tested. |

No remaining P1/P2.

**Gate (post-fix):** `bun run lint` clean (251 files; 7 workspaces typecheck) · `bun run test` 1062 pass / 0
fail · `feature-lifecycle-adapter.ts` 100% line+func · `feature.ts` 96% func / 92.8% line · E2E `spur feature
update A active` transitions + emits event + appends History + writes the run link.


### Testing

Verified 2026-06-14. Real engine-integration tests (no stubs).

- `packages/app/tests/workflow/feature-lifecycle-adapter.test.ts` — 6 tests against in-memory SQLite + the
  real `config/workflows/feature-lifecycle.yaml` + engine 0.3.17:
  - R1: allows a graph-declared transition (backlog→active); denies an undeclared one (backlog→done).
  - R2: `verifying→done` shell guard (`feature check --strict`) denies with its report; `verifying→active`
    rework path allowed.
  - R1: create-or-attach binds `feature:<id>`, writes exactly one `feature-lifecycle` link, reuses the run
    on a second transition (no duplicate).
  - DD-04: engine self-heals from a disagreeing state (file wins).
- `packages/app/tests/services/feature-check.test.ts` — DD-13 verifying-readiness, both cases (Solution
  "warning vs clean entry"): a `verifying` feature with an incomplete (wip) linked task emits the
  non-blocking L4 warning (gate still passes); a `verifying` feature whose linked tasks are all
  done/cancelled is a **clean entry** — no readiness warning, no orphan warning.

E2E through the real CLI: `spur feature update A active` (after `migrate` + `feature create`) transitioned
backlog→active, emitted `feature.transitioned`, appended `backlog → active (system)` to History, and wrote
`task_run_links` `{wbs:A, kind:feature-lifecycle, run_id:run_…}`.

Full suite: 1062 pass / 0 fail. `feature-lifecycle-adapter.ts` 100% line+func.


### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


