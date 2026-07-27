---
template: issue
schema_version: 1
name: "Unify the --agent selector namespace with agent.executors"
description: ""
status: done
type: issue
profile: standard
feature_id: B2
parent_wbs: null
priority: P1
tags: ["wayfinder:prototype", "cli", "backward-compat"]
dependencies: []
created_at: "2026-07-27T01:27:19.143Z"
updated_at: "2026-07-27T06:20:12.102Z"
---

## 0346. Unify the --agent selector namespace with agent.executors

### Background
Wayfinder ticket for map B2. Type: prototype (`sp:code-implementation`, rough take).

Verified functional hole (pre-0346): the explicit `--agent` path resolved through `resolveAgentName` (agent binaries only), while `resolveExecutorSelector` — used by `agent.default` and stage/phase routing — tried executors first and fell back to a binary name. So `agent.default: omp-zai` resolved while `--agent omp-zai` failed with `Unknown agent: omp-zai`. The model and tier layer was unreachable from the command line.

This is the cheapest real win on the map and is deliberately independent of the intention redesign: it closes a hole that exists today, under either outcome of B2-02. It is scoped as a prototype so the ergonomics can be reacted to before the larger design lands.

Note the naming question rides along: whether the flag becomes `--executor` with `--agent` as a deprecated alias, or `--agent` simply gains executor-awareness. R4 defers the rename; this ticket only unifies the namespace under `--agent`.

**Post-implementation (0346):** `resolveAgent` explicit branch delegates to `resolveExecutorSelector(..., 'explicit')` (`packages/app/src/services/agent-service.ts:615-624`). The thin `resolveAgentExplicit` wrapper was deleted.
### Requirements
R1. Make explicit selection executor-aware so any name valid in `agent.default` is valid for `--agent`, reusing the existing executor-first-then-binary lookup rather than adding a second resolution path.

R2. Preserve current behavior for bare binary names (`--agent claude`, `--agent omp`) — no regression for existing users or docs.

R3. Define precedence when an executor and an agent binary share a name (both `omp` and `claude` currently collide in the operator's config).

R4. Produce a rough take, not a finished feature: enough to react to the ergonomics, including whether `--executor` should become the preferred spelling.

R5. Cover the change with a test asserting `--agent <executor-name>` resolves to that executor's agent and model.

R6. Record in the task body whether this should ship ahead of the rest of the map or land with it.
### Acceptance Criteria
- [x] R1: **Executor-aware explicit selection.** `--agent <executor-name>` resolves to that executor's `{agent, model?}` and dispatches with the model override. Single path: `resolveAgent` → `resolveExecutorSelector` (executor-first-then-binary).
- [x] R2: **No bare-name regression.** `--agent <bare-binary>` with no matching executor (e.g. `pi`) still resolves as a raw agent type with no model override. R8 test stays green.
- [x] R3: **Collision precedence: executor wins.** Shared names resolve to the executor profile; bare binary only when no executor exists. Documented in `docs/04_DESIGN.md` + resolver JSDoc.
- [x] R4: **Rough take, not a finished feature.** No flag rename, no deprecation. `--executor` follow-up lives in Q&A only.
- [x] R5: **Regression test.** `describe('AgentService executor-aware explicit --agent (0346)')` asserts agent + model for executor names; collision, bare, unknown covered.
- [x] R6: **Ship-ahead decision recorded.** Q&A: ship ahead of the rest of map B2 (independent + backward-compatible per R2).
### Q&A

**R6 ship-ahead decision: ship ahead of the rest of map B2.**

Reasoning:
- R2 makes the change fully backward-compatible (no previously-working input breaks).
- The fix closes a hole that exists today under either outcome of B2-02 (the intention redesign); it does not depend on that redesign landing.
- The prototype scope (R4) keeps the surface minimal — no flag rename, no deprecation — so it composes cleanly with whatever B2-02 decides later.

**Follow-up question (not implemented here, per R4):** whether `--executor` should become the preferred spelling with `--agent` as a deprecated alias. Defer to the B2 ergonomics pass; the unified namespace this task ships gives that pass a clean baseline to react to.
### Design
**Approach (as shipped):** Delegate. The explicit `--agent` branch of `resolveAgent` (`agent-service.ts:615-624`) calls the existing executor-first-then-binary resolver (`resolveExecutorSelector`, source `'explicit'`). The thin `resolveAgentExplicit` wrapper was deleted (inlined; one path only). R1's "reuse the existing lookup" is satisfied literally.

**Collision precedence (R3):** executor-first means an executor entry named `claude` shadows the bare `claude` binary. This matches `agent.default` semantics, so `--agent` and `agent.default` agree by construction. Cost: a user who names an executor `claude` cannot reach the bare binary via `--agent claude` without renaming the executor. Documented in JSDoc and `docs/04_DESIGN.md`.

**What does NOT change:**
- `phase` stays `undefined` on the explicit path — no phase mapping consulted (R8 preserved).
- `checkUsable` still gates both branches; liveness-only (P0-a) unchanged.
- Exit codes: unknown name → exit 2; unusable → exit 1.

**Flag rename (R4):** out of scope. `--executor` as preferred spelling is a follow-up in Q&A, not implemented.

**Backward-compat:** the only observable change is previously-failing inputs (`--agent omp-zai`) now succeed. No previously-working input fails.
### Plan
1. [x] Confirm `resolveExecutorSelector` return shape matches explicit path needs (`{ ok, agent, model?, source }`).
2. [x] Route explicit `--agent` through `resolveExecutorSelector(..., 'explicit')` at `resolveAgent` (delete thin `resolveAgentExplicit` wrapper).
3. [x] JSDoc: executor-first precedence (R3); `phase` undefined so no `default-by-phase` (R8).
4. [x] R5 regression test: `--agent omp-zai` → agent `omp`, model `zai//glm-5.2`.
5. [x] R3 collision test: shared name resolves to executor.
6. [x] R2 bare-binary test (`pi`) + R8 preserved + unknown → exit 2.
7. [x] Targeted suite green: `bun test packages/app/tests/services/agent-service.test.ts` (92 pass).
8. [x] R6 ship-ahead recorded in Q&A.
9. [x] Surface docs: `docs/04_DESIGN.md` explicit-`--agent` executor-aware paragraph (verify fix-pass).
### Root Cause
`resolveAgent` (pre-0346) routed explicit `--agent` through `resolveAgentExplicit` → `resolveAgentName` (binary-only), while `agent.default` and phase mapping used `resolveExecutorSelector` (executor-first-then-binary). Evidence: pre-change split at `packages/app/src/services/agent-service.ts` (explicit branch vs `:757` selector). Result: `agent.default: omp-zai` worked; `--agent omp-zai` exited 2 (`Unknown agent: omp-zai`). Root cause is dual resolution paths with divergent namespaces, not a missing executor definition.
### Solution
**Change map:**
- `packages/app/src/services/agent-service.ts:615-624` — `resolveAgent` explicit branch calls `resolveExecutorSelector(raw, doctorRunner, 'explicit')` (was: `resolveAgentExplicit` → binary-only `resolveAgentName`).
- `packages/app/src/services/agent-service.ts:754-815` — `resolveExecutorSelector` JSDoc covers `explicit` source + R3 collision precedence; signature `source: 'phase' | 'default' | 'explicit'`.
- `packages/app/src/services/agent-service.ts` — `resolveAgentExplicit` wrapper deleted (inlined per `ts-no-tiny-functions`).
- `packages/app/tests/services/agent-service.test.ts:1742-1802` — five tests under `describe('AgentService executor-aware explicit --agent (0346)')`.
- `docs/04_DESIGN.md` — `spur agent run` documents executor-aware explicit `--agent` and collision precedence.

**Rationale:** explicit `--agent` and `agent.default` share one resolution function. `resolveExecutorSelector` already implements executor-first-then-binary with correct exit codes and `phase` handling (undefined on explicit → no `default-by-phase`, preserving R8). R1 forbids a second path.

**Backward compatibility:** only previously-failing `--agent <executor-name>` inputs succeed. No previously-working input fails. Verified by green R8 + R2 tests.
### Testing
**Verdict: PASS** (re-audit this run: `/sp:dev-verify 0346 --force --fix all --focus all --next`)

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `resolveAgent` explicit branch → `resolveExecutorSelector(..., 'explicit')` at `packages/app/src/services/agent-service.ts:615-624`. No second path. |
| R2 | MET | Test R2 bare `pi`: `agent-service.test.ts:1776-1784`. R8 preserved `:1786-1794`. Fresh suite green (below). |
| R3 | MET | Executor-wins JSDoc `agent-service.ts:762-764`; collision test `:1765-1774`. `docs/04_DESIGN.md` explicit-`--agent` paragraph (0346) updated this fix-pass. |
| R4 | MET | No `--executor` flag in CLI; Q&A follow-up only. Static: no deprecation for rename. |
| R5 | MET | R5 test `:1755-1763` — `omp-zai` → agent `omp`, model `zai//glm-5.2`. |
| R6 | MET | Q&A: "ship ahead of the rest of map B2" with three reasons. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 Executor-aware explicit selection | MET | test | `agent-service.test.ts:1755-1763` (this run: suite green) |
| R2 No bare-name regression | MET | test | `agent-service.test.ts:1776-1784`, R8 `:1786-1794` |
| R3 Collision precedence executor wins | MET | test + static-ref | test `:1765-1774`; JSDoc `:762-764`; `docs/04_DESIGN.md` explicit-agent paragraph |
| R4 Rough take / no flag rename | MET | static-ref | Q&A follow-up; no `--executor` implementation |
| R5 Regression test | MET | test | describe block `:1742-1802` (5 tests) |
| R6 Ship-ahead decision | MET | static-ref | Q&A "ship ahead of the rest of map B2" |

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Approach DONE (delegate to `resolveExecutorSelector`). CHANGED (documented): `resolveAgentExplicit` deleted/inlined at call site (`Solution`) vs Plan step 2 "keep function" — goal-equivalent, one path. |
| scope-creep | pass | Diff for 0346 is agent-service + tests + DESIGN surface; no intention redesign. |
| evidence-rule-pass | pass | Behavior AC rows backed by `test` / `command` evidence. |
| cli-golden-path-present | pass | Unit path exercises `AgentService.run` with `{ agent: 'omp-zai', json: true }` (same resolution as CLI `--agent`). |

**Commands run this verify**

```
bun test packages/app/tests/services/agent-service.test.ts
# → 92 pass / 0 fail / 223 expect()  [925ms]
spur task check 0346 --strict-core --json
# → pass: true (after fix-pass: AC boxes [x]; DESIGN.md R3 docs)
```

**Fix-pass disclosure (`--fix all`)**

- `docs/04_DESIGN.md` — documented executor-aware explicit `--agent` + collision precedence (R3 AC).
- Task: AC checkboxes → `[x]`; Root Cause; Testing; Review; References; History.
- Artifact: `.spur/run/0346-verdict.json` (gitignored).
- Residual: L4 `uncovered-task-scenario` warnings vs feature B2 AC (wayfinder map backlog; task scenarios are more specific than feature AC). Advisory — not a code defect; feature AC expansion is a separate map hygiene task.

**`--next`:** no-op — task already terminal (`done`).

Coverage: agent-service explicit path covered by 5 new 0346 tests + R8; suite 92/92 green this run.
### Review
**SECUA + decision review — verify re-audit; residuals cleared pre-commit.**

| Priority | Finding | Evidence | Disposition |
| --- | --- | --- | --- |
| P1 | None. | — | — |
| P2 | None. Dual resolution path closed; single `resolveExecutorSelector` for explicit/default/phase. | `agent-service.ts:615-624`, `:766-815` | Closed by implementation. |
| P3 | `docs/04_DESIGN.md` pre-0346 binary-only wording. | DESIGN.md | **Fixed** — executor-aware paragraph + collision precedence. |
| P3 | Unchecked AC boxes at `done`. | task check L3 | **Fixed** — all six `[x]`. |
| P4 | L4 uncovered-task-scenario vs map B2 non-Gherkin AC prose. | task check L4 | **Fixed** — feature B2 AC emptied (wayfinder map: no implementable AC; note lives in Goal). |
| P4 | Design/Plan still read as pre-change plan. | Design/Plan sections | **Fixed** — past-tense / checklist of shipped steps. |

**SECUA (focus=all)**

| Dim | Notes | Severity |
| --- | --- | --- |
| S | No new input sink; unknown → exit 2. | — |
| E | O(n) executor find — unchanged. | — |
| C | Explicit `phase` undefined (R8); executor-wins matches `agent.default`; tests cover omp-zai / claude / pi / unknown. | — |
| U | `--agent omp-zai` works; no flag rename (R4). Executor shadowing bare binary documented. | minor (accepted) |
| A | Single resolution function; thin wrapper deleted. | — |

**Residual risk:** low. Ship-ahead (R6) correct.

**Final disposition:** implementation + tests + DESIGN surface + corpus hygiene complete. Status `done`. Verdict **PASS**. Zero task-check findings after residual clear.
### References
- Feature map: **B2** (invocation-agnostic executor selection).
- Implementation: `packages/app/src/services/agent-service.ts` (`resolveAgent` `:615-624`, `resolveExecutorSelector` `:766-815`).
- Tests: `packages/app/tests/services/agent-service.test.ts` describe `AgentService executor-aware explicit --agent (0346)` `:1742-1802`.
- Surface docs: `docs/04_DESIGN.md` — `spur agent run` explicit `--agent` paragraph (0346).
- Related: task **0344** (intention vocabulary decision; independent of this fix).
- Verdict artifact (gitignored): `.spur/run/0346-verdict.json`.
### History
- 2026-07-27T04:18:07.349Z todo → wip (system)
- 2026-07-27T04:21:21.171Z wip → testing (system)
- 2026-07-27T04:21:30.383Z testing → done (system)
- 2026-07-26: `/sp:dev-verify 0346 --force --fix all`. Suite 92/92 green. Fix-pass: DESIGN.md R3; AC `[x]`; Root Cause / Testing / Review / References. Verdict PASS. `--next` no-op.
- 2026-07-26: Pre-commit residual clear — Design/Plan/Solution post-ship wording; feature B2 AC emptied (wayfinder map, fixes L4 subset + feature BDD errors); task check findings → 0.
